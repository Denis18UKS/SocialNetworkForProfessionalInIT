const crypto = require('crypto');

const base64url = (value) => Buffer.from(value)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');

const fromBase64url = (value) => {
    const normalized = String(value || '').replace(/-/g, '+').replace(/_/g, '/');
    const padding = '='.repeat((4 - (normalized.length % 4 || 4)) % 4);
    return Buffer.from(normalized + padding, 'base64');
};

const hmac = (key, data) => crypto.createHmac('sha256', key).update(data).digest();

const hkdfExpand = (prk, info, length) => {
    const chunks = [];
    let previous = Buffer.alloc(0);
    let counter = 1;
    while (Buffer.concat(chunks).length < length) {
        previous = hmac(prk, Buffer.concat([previous, info, Buffer.from([counter])]));
        chunks.push(previous);
        counter += 1;
    }
    return Buffer.concat(chunks).subarray(0, length);
};

const getVapidKeyObject = (publicKey, privateKey) => {
    const publicBytes = fromBase64url(publicKey);
    const privateBytes = fromBase64url(privateKey);
    if (publicBytes.length !== 65 || publicBytes[0] !== 4 || privateBytes.length !== 32) {
        throw new Error('Invalid VAPID key material');
    }
    return crypto.createPrivateKey({
        key: {
            kty: 'EC',
            crv: 'P-256',
            x: base64url(publicBytes.subarray(1, 33)),
            y: base64url(publicBytes.subarray(33, 65)),
            d: base64url(privateBytes),
        },
        format: 'jwk',
    });
};

const createVapidJwt = ({ endpoint, publicKey, privateKey, subject }) => {
    const audience = new URL(endpoint).origin;
    const header = base64url(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
    const payload = base64url(JSON.stringify({
        aud: audience,
        exp: Math.floor(Date.now() / 1000) + (12 * 60 * 60),
        sub: subject || 'mailto:admin@socialbird.local',
    }));
    const input = `${header}.${payload}`;
    const signature = crypto.sign('sha256', Buffer.from(input), {
        key: getVapidKeyObject(publicKey, privateKey),
        dsaEncoding: 'ieee-p1363',
    });
    return `${input}.${base64url(signature)}`;
};

const encryptPayload = (subscription, payload) => {
    const clientPublic = fromBase64url(subscription?.keys?.p256dh);
    const authSecret = fromBase64url(subscription?.keys?.auth);
    if (clientPublic.length !== 65 || authSecret.length === 0) {
        throw new Error('Invalid push subscription keys');
    }

    const serverEcdh = crypto.createECDH('prime256v1');
    const serverPublic = serverEcdh.generateKeys();
    const sharedSecret = serverEcdh.computeSecret(clientPublic);

    const authPrk = hmac(authSecret, sharedSecret);
    const keyInfo = Buffer.concat([
        Buffer.from('WebPush: info\0', 'utf8'),
        clientPublic,
        serverPublic,
    ]);
    const ikm = hkdfExpand(authPrk, keyInfo, 32);

    const salt = crypto.randomBytes(16);
    const prk = hmac(salt, ikm);
    const cek = hkdfExpand(prk, Buffer.from('Content-Encoding: aes128gcm\0', 'utf8'), 16);
    const nonce = hkdfExpand(prk, Buffer.from('Content-Encoding: nonce\0', 'utf8'), 12);

    const plain = Buffer.concat([
        Buffer.from(JSON.stringify(payload), 'utf8'),
        Buffer.from([2]),
    ]);
    const cipher = crypto.createCipheriv('aes-128-gcm', cek, nonce);
    const encrypted = Buffer.concat([cipher.update(plain), cipher.final(), cipher.getAuthTag()]);

    const recordSize = Buffer.alloc(4);
    recordSize.writeUInt32BE(4096, 0);
    return Buffer.concat([
        salt,
        recordSize,
        Buffer.from([serverPublic.length]),
        serverPublic,
        encrypted,
    ]);
};

const sendWebPush = async ({ subscription, payload, vapidPublicKey, vapidPrivateKey, subject, ttl = 90 }) => {
    if (!subscription?.endpoint) throw new Error('Push endpoint is missing');
    const body = encryptPayload(subscription, payload);
    const jwt = createVapidJwt({
        endpoint: subscription.endpoint,
        publicKey: vapidPublicKey,
        privateKey: vapidPrivateKey,
        subject,
    });

    const response = await fetch(subscription.endpoint, {
        method: 'POST',
        headers: {
            TTL: String(ttl),
            Urgency: 'high',
            'Content-Encoding': 'aes128gcm',
            'Content-Type': 'application/octet-stream',
            Authorization: `vapid t=${jwt}, k=${vapidPublicKey}`,
        },
        body,
    });

    return {
        ok: response.ok,
        status: response.status,
        text: response.ok ? '' : await response.text().catch(() => ''),
    };
};

module.exports = {
    sendWebPush,
};
