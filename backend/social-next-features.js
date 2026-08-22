const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');
const multer = require('multer');
const { sendWebPush } = require('./web-push-native');

const execFileAsync = promisify(execFile);
const QR_TTL_MS = 10 * 60 * 1000;
const qrUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 2 * 1024 * 1024, files: 1 },
});

const sha256 = (value) => crypto.createHash('sha256').update(String(value)).digest('hex');

const ensureSocialNextSchema = async (db) => {
    await db.query(`CREATE TABLE IF NOT EXISTS push_subscriptions (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
        user_id INT UNSIGNED NOT NULL,
        endpoint_hash CHAR(64) NOT NULL,
        endpoint TEXT NOT NULL,
        p256dh VARCHAR(255) NOT NULL,
        auth_key VARCHAR(255) NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY unique_push_endpoint (endpoint_hash),
        KEY idx_push_user (user_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

    await db.query(`CREATE TABLE IF NOT EXISTS friend_qr_tokens (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
        user_id INT UNSIGNED NOT NULL,
        token_hash CHAR(64) NOT NULL,
        expires_at DATETIME NOT NULL,
        used_at DATETIME NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY unique_friend_qr_token (token_hash),
        KEY idx_friend_qr_user (user_id, expires_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
};

const registerSocialNextFeatures = ({ app, db, verifyToken, notifyClients, isUserOnline }) => {
    ensureSocialNextSchema(db).catch((error) => {
        console.error('Social next schema initialization failed:', error.message);
    });

    app.get('/push/public-key', (req, res) => {
        const publicKey = String(process.env.VAPID_PUBLIC_KEY || '');
        if (!publicKey) {
            return res.status(503).json({ message: 'Push notifications are not configured', code: 'PUSH_NOT_CONFIGURED' });
        }
        res.json({ publicKey });
    });

    app.post('/push/subscribe', verifyToken, async (req, res) => {
        const subscription = req.body?.subscription || req.body;
        const endpoint = String(subscription?.endpoint || '');
        const p256dh = String(subscription?.keys?.p256dh || '');
        const auth = String(subscription?.keys?.auth || '');
        if (!endpoint || !p256dh || !auth || !/^https:\/\//i.test(endpoint)) {
            return res.status(400).json({ message: 'Некорректная push-подписка', code: 'PUSH_SUBSCRIPTION_INVALID' });
        }

        try {
            await db.query(
                `INSERT INTO push_subscriptions (user_id, endpoint_hash, endpoint, p256dh, auth_key)
                 VALUES (?, ?, ?, ?, ?)
                 ON DUPLICATE KEY UPDATE user_id = VALUES(user_id), endpoint = VALUES(endpoint),
                   p256dh = VALUES(p256dh), auth_key = VALUES(auth_key), updated_at = CURRENT_TIMESTAMP`,
                [req.user.id, sha256(endpoint), endpoint, p256dh, auth]
            );
            res.json({ ok: true });
        } catch (error) {
            console.error('Push subscribe error:', error.message);
            res.status(500).json({ message: 'Не удалось сохранить push-подписку' });
        }
    });

    app.delete('/push/subscribe', verifyToken, async (req, res) => {
        const endpoint = String(req.body?.endpoint || '');
        if (endpoint) await db.query('DELETE FROM push_subscriptions WHERE user_id = ? AND endpoint_hash = ?', [req.user.id, sha256(endpoint)]);
        res.json({ ok: true });
    });

    app.post('/friend-qr/token', verifyToken, async (req, res) => {
        try {
            const token = crypto.randomBytes(32).toString('base64url');
            const expiresAt = new Date(Date.now() + QR_TTL_MS);
            await db.query('UPDATE friend_qr_tokens SET used_at = NOW() WHERE user_id = ? AND used_at IS NULL', [req.user.id]);
            await db.query(
                'INSERT INTO friend_qr_tokens (user_id, token_hash, expires_at) VALUES (?, ?, ?)',
                [req.user.id, sha256(token), expiresAt]
            );
            const frontendUrl = String(process.env.FRONTEND_URL || '').replace(/\/$/, '');
            const payload = `${frontendUrl}/friend-qr/${encodeURIComponent(token)}`;
            res.json({ token, payload, expiresInSeconds: Math.floor(QR_TTL_MS / 1000) });
        } catch (error) {
            console.error('Friend QR token error:', error.message);
            res.status(500).json({ message: 'Не удалось создать QR-код' });
        }
    });

    app.get('/friend-qr/image/:token.svg', async (req, res) => {
        const token = String(req.params.token || '');
        if (!token || token.length > 128) return res.status(400).end();
        try {
            const [rows] = await db.query(
                'SELECT id FROM friend_qr_tokens WHERE token_hash = ? AND used_at IS NULL AND expires_at > NOW() LIMIT 1',
                [sha256(token)]
            );
            if (rows.length === 0) return res.status(404).end();
            const frontendUrl = String(process.env.FRONTEND_URL || '').replace(/\/$/, '');
            const payload = `${frontendUrl}/friend-qr/${encodeURIComponent(token)}`;
            const { stdout } = await execFileAsync('/usr/bin/qrencode', ['-t', 'SVG', '-m', '2', '-s', '7', '-o', '-', payload], {
                encoding: 'utf8',
                maxBuffer: 1024 * 1024,
                timeout: 5000,
            });
            res.type('image/svg+xml').set('Cache-Control', 'no-store').send(stdout);
        } catch (error) {
            console.error('Friend QR render error:', error.message);
            res.status(503).json({ message: 'QR renderer unavailable' });
        }
    });

    app.post('/friend-qr/scan', verifyToken, qrUpload.single('image'), async (req, res) => {
        if (!req.file?.buffer) return res.status(400).json({ message: 'Нет изображения', code: 'QR_IMAGE_REQUIRED' });
        const filename = path.join(os.tmpdir(), `itbird-qr-${process.pid}-${Date.now()}-${crypto.randomBytes(6).toString('hex')}.jpg`);
        try {
            await fs.promises.writeFile(filename, req.file.buffer, { mode: 0o600 });
            const { stdout } = await execFileAsync('/usr/bin/zbarimg', ['--quiet', '--raw', filename], {
                encoding: 'utf8',
                maxBuffer: 64 * 1024,
                timeout: 5000,
            });
            const payload = String(stdout || '').trim().split(/\r?\n/).find(Boolean) || '';
            if (!payload) return res.status(404).json({ message: 'QR-код не найден', code: 'QR_NOT_FOUND' });
            res.json({ payload });
        } catch (error) {
            if (Number(error?.code) === 4 || /no barcode/i.test(String(error?.stderr || ''))) {
                return res.status(404).json({ message: 'QR-код не найден', code: 'QR_NOT_FOUND' });
            }
            console.error('Friend QR scan error:', error.message);
            res.status(503).json({ message: 'Не удалось распознать QR-код', code: 'QR_SCAN_FAILED' });
        } finally {
            fs.promises.unlink(filename).catch(() => undefined);
        }
    });

    app.post('/friend-qr/add', verifyToken, async (req, res) => {
        const token = String(req.body?.token || '').trim();
        if (!token || token.length > 128) return res.status(400).json({ message: 'Некорректный QR-код' });
        const currentUserId = Number(req.user.id);

        try {
            const [tokens] = await db.query(
                `SELECT id, user_id FROM friend_qr_tokens
                 WHERE token_hash = ? AND used_at IS NULL AND expires_at > NOW() LIMIT 1`,
                [sha256(token)]
            );
            if (tokens.length === 0) return res.status(410).json({ message: 'QR-код истёк. Попросите показать новый.', code: 'QR_EXPIRED' });
            const qr = tokens[0];
            const targetUserId = Number(qr.user_id);
            if (targetUserId === currentUserId) return res.status(400).json({ message: 'Нельзя добавить самого себя' });

            const [blocked] = await db.query(
                `SELECT 1 FROM user_blacklist WHERE
                 (blocker_id = ? AND blocked_id = ?) OR (blocker_id = ? AND blocked_id = ?) LIMIT 1`,
                [currentUserId, targetUserId, targetUserId, currentUserId]
            );
            if (blocked.length > 0) return res.status(403).json({ message: 'Добавление в друзья недоступно' });

            const [existing] = await db.query(
                `SELECT id, user_id, friend_id, status FROM friends WHERE
                 (user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?) LIMIT 1`,
                [currentUserId, targetUserId, targetUserId, currentUserId]
            );

            if (existing.length > 0) {
                const friendship = existing[0];
                if (friendship.status === 'accepted') {
                    return res.json({ status: 'accepted', message: 'Вы уже друзья' });
                }
                if (Number(friendship.user_id) === targetUserId && Number(friendship.friend_id) === currentUserId) {
                    await db.query("UPDATE friends SET status = 'accepted' WHERE id = ?", [friendship.id]);
                    await db.query('UPDATE friend_qr_tokens SET used_at = NOW() WHERE id = ?', [qr.id]);
                    notifyClients({
                        type: 'FRIENDSHIP_CHANGED',
                        data: { targetIds: [currentUserId, targetUserId], userId: currentUserId, friendId: targetUserId, status: 'accepted' },
                    });
                    return res.json({ status: 'accepted', message: 'Вы стали друзьями' });
                }
                return res.json({ status: 'pending', message: 'Заявка уже отправлена' });
            }

            await db.query('INSERT INTO friends (user_id, friend_id, status) VALUES (?, ?, ?)', [currentUserId, targetUserId, 'pending']);
            await db.query('UPDATE friend_qr_tokens SET used_at = NOW() WHERE id = ?', [qr.id]);
            const [senders] = await db.query('SELECT username, avatar FROM users WHERE id = ? LIMIT 1', [currentUserId]);
            notifyClients({
                type: 'FRIEND_REQUEST_CREATED',
                data: {
                    recipientId: targetUserId,
                    recipientIds: [targetUserId],
                    request: {
                        user_id: currentUserId,
                        friend_id: targetUserId,
                        status: 'pending',
                        user_name: senders[0]?.username || 'Пользователь',
                        avatar: senders[0]?.avatar || null,
                    },
                },
            });
            res.json({ status: 'pending', message: 'Заявка в друзья отправлена' });
        } catch (error) {
            console.error('Friend QR add error:', error.message);
            res.status(500).json({ message: 'Не удалось добавить пользователя по QR-коду' });
        }
    });

    const sendOfflineCallPush = async (targetIds, callData = {}, senderId = 0) => {
        const vapidPublicKey = String(process.env.VAPID_PUBLIC_KEY || '');
        const vapidPrivateKey = String(process.env.VAPID_PRIVATE_KEY || '');
        if (!vapidPublicKey || !vapidPrivateKey) return;

        const uniqueTargets = Array.from(new Set((targetIds || []).map(Number).filter(Number.isFinite)))
            .filter((userId) => !isUserOnline(userId));
        if (uniqueTargets.length === 0) return;

        const [subscriptions] = await db.query(
            'SELECT id, user_id, endpoint, p256dh, auth_key FROM push_subscriptions WHERE user_id IN (?)',
            [uniqueTargets]
        );
        if (subscriptions.length === 0) return;

        let callerName = String(callData.callerName || callData.fromName || '').trim();
        if (!callerName && senderId) {
            const [users] = await db.query('SELECT username FROM users WHERE id = ? LIMIT 1', [senderId]);
            callerName = users[0]?.username || '';
        }
        const isVideo = callData.callKind === 'video';
        const chatId = callData.chatId;
        const mode = callData.mode === 'group' ? 'group' : 'private';
        const url = mode === 'group' ? `/group-chats/${chatId}` : `/chats/${chatId}`;
        const payload = {
            type: 'incoming-call',
            title: callerName ? `${callerName} звонит` : 'Входящий звонок IT-BIRD',
            body: isVideo ? 'Входящий видеозвонок' : 'Входящий голосовой звонок',
            url,
            tag: `itbird-call-${mode}-${chatId}-${senderId}`,
            call: { senderId: Number(senderId), chatId, mode, callKind: isVideo ? 'video' : 'voice' },
        };

        await Promise.all(subscriptions.map(async (row) => {
            try {
                const result = await sendWebPush({
                    subscription: {
                        endpoint: row.endpoint,
                        keys: { p256dh: row.p256dh, auth: row.auth_key },
                    },
                    payload,
                    vapidPublicKey,
                    vapidPrivateKey,
                    subject: process.env.VAPID_SUBJECT || (process.env.SMTP_USER ? `mailto:${process.env.SMTP_USER}` : 'mailto:admin@socialbird.local'),
                });
                if ([404, 410].includes(result.status)) {
                    await db.query('DELETE FROM push_subscriptions WHERE id = ?', [row.id]);
                } else if (!result.ok) {
                    console.warn('Push delivery failed:', result.status, result.text.slice(0, 160));
                }
            } catch (error) {
                console.warn('Push delivery error:', error.message);
            }
        }));
    };

    return { sendOfflineCallPush };
};

module.exports = {
    ensureSocialNextSchema,
    registerSocialNextFeatures,
};
