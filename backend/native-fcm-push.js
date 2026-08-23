const crypto = require('crypto');
const fs = require('fs');

const TOKEN_SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';
const DEFAULT_SERVICE_ACCOUNT_FILE = '/etc/socialbird/firebase-service-account.json';
const ACCESS_TOKEN_SKEW_MS = 60 * 1000;
const FCM_DATA_LIMIT = 3600;

const sha256 = (value) => crypto.createHash('sha256').update(String(value)).digest('hex');
const base64urlJson = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
const truncate = (value, max = 220) => Array.from(String(value || '')).slice(0, max).join('');

const getTargets = (notification) => {
    const data = notification?.data || {};
    const values = [
        ...(Array.isArray(data.targetIds) ? data.targetIds : []),
        ...(Array.isArray(data.recipientIds) ? data.recipientIds : []),
        ...(Array.isArray(data.memberIds) ? data.memberIds : []),
        data.recipientId,
        data.friendId,
    ];
    const senderId = Number(data.senderId || data.user_id || data.userId || 0);
    return Array.from(new Set(values.map(Number).filter(Number.isFinite)))
        .filter((id) => id > 0 && id !== senderId);
};

const supportedTypes = new Set([
    'CALL_INVITE',
    'CALL_HANGUP',
    'NEW_MESSAGE',
    'NEW_GROUP_MESSAGE',
    'GROUP_MENTION',
    'NEW_FORUM_ANSWER',
    'FRIEND_REQUEST_CREATED',
    'FRIENDSHIP_CHANGED',
    'NEW_GROUP_CHAT',
    'NEW_GROUP_MEMBER',
    'GROUP_MEMBER_REMOVED',
    'GROUP_CHAT_DELETED',
]);

const getRoute = (type, data) => {
    const chatId = data.chatId ?? data.chat_id ?? data.group_chat_id ?? data.groupChatId;
    if (type === 'CALL_INVITE') {
        return data.mode === 'group' ? `/group-chats/${chatId || ''}` : `/chats/${chatId || ''}`;
    }
    if (type === 'NEW_MESSAGE') return `/chats/${chatId || ''}`;
    if (['NEW_GROUP_MESSAGE', 'GROUP_MENTION', 'NEW_GROUP_CHAT', 'NEW_GROUP_MEMBER', 'GROUP_MEMBER_REMOVED', 'GROUP_CHAT_DELETED'].includes(type)) {
        return `/group-chats/${chatId || data.chat?.id || ''}`;
    }
    if (type === 'NEW_FORUM_ANSWER') return `/forums/${data.forum_id || data.forumId || ''}/answers`;
    if (type === 'FRIEND_REQUEST_CREATED' || type === 'FRIENDSHIP_CHANGED') return '/friend-requests';
    return '/';
};

const makePresentation = async (db, type, data) => {
    if (type === 'CALL_HANGUP') {
        return { title: '', body: '', route: getRoute(type, data) };
    }

    if (type === 'CALL_INVITE') {
        let callerName = truncate(data.callerName || data.fromName || data.title || '', 80);
        const senderId = Number(data.senderId || 0);
        if (!callerName && senderId) {
            const [rows] = await db.query('SELECT username FROM users WHERE id = ? LIMIT 1', [senderId]);
            callerName = truncate(rows[0]?.username || '', 80);
        }
        const video = data.callKind === 'video';
        return {
            title: callerName ? `${callerName} звонит` : 'Входящий звонок SocialBIRD',
            body: video ? 'Входящий видеозвонок' : 'Входящий голосовой звонок',
            route: getRoute(type, data),
        };
    }

    if (type === 'NEW_MESSAGE') {
        return {
            title: truncate(data.username || data.user_name || 'Новое сообщение', 90),
            body: truncate(data.message || data.file_name || 'Медиафайл', 220),
            route: getRoute(type, data),
        };
    }

    if (type === 'NEW_GROUP_MESSAGE') {
        return {
            title: truncate(data.group_chat_name || 'Новое сообщение в группе', 90),
            body: truncate(`${data.username ? `${data.username}: ` : ''}${data.message || data.file_name || 'Медиафайл'}`, 220),
            route: getRoute(type, data),
        };
    }

    if (type === 'GROUP_MENTION') {
        return {
            title: data.mentionEveryone ? 'Упоминание @everyone' : 'Вас упомянули',
            body: truncate(`${data.username ? `${data.username}: ` : ''}${data.message || 'Сообщение'}`, 220),
            route: getRoute(type, data),
        };
    }

    if (type === 'FRIEND_REQUEST_CREATED') {
        return {
            title: 'Новая заявка в друзья',
            body: `${truncate(data.request?.user_name || 'Пользователь', 80)} хочет добавить вас в друзья`,
            route: '/friend-requests',
        };
    }

    if (type === 'NEW_FORUM_ANSWER') {
        return {
            title: 'Новый ответ на форуме',
            body: truncate(data.forumTitle || data.answer || 'Откройте SocialBIRD, чтобы посмотреть ответ', 220),
            route: getRoute(type, data),
        };
    }

    if (type === 'FRIENDSHIP_CHANGED') {
        return { title: 'Друзья SocialBIRD', body: 'Статус дружбы обновлён', route: '/friend-requests' };
    }

    if (type === 'NEW_GROUP_CHAT' || type === 'NEW_GROUP_MEMBER') {
        return {
            title: 'Вас добавили в группу',
            body: truncate(data.chat?.name || data.group_chat_name || 'Откройте групповой чат', 160),
            route: getRoute(type, data),
        };
    }

    if (type === 'GROUP_MEMBER_REMOVED') {
        return { title: 'Изменения в группе', body: 'Состав группового чата изменён', route: getRoute(type, data) };
    }

    if (type === 'GROUP_CHAT_DELETED') {
        return { title: 'Группа удалена', body: 'Групповой чат больше недоступен', route: '/group-chats' };
    }

    return { title: 'SocialBIRD', body: 'Новое уведомление', route: '/' };
};

const makeCompactPayload = (type, data, presentation) => {
    const compact = {
        type,
        title: presentation.title,
        body: presentation.body,
        route: presentation.route,
        senderId: Number(data.senderId || data.user_id || data.userId || 0) || undefined,
        chatId: data.chatId ?? data.chat_id ?? data.group_chat_id ?? data.groupChatId ?? data.chat?.id,
        mode: data.mode,
        callKind: data.callKind,
        callerName: truncate(data.callerName || data.fromName || data.username || '', 80),
        username: truncate(data.username || data.user_name || '', 80),
        message: truncate(data.message || '', 220),
    };
    Object.keys(compact).forEach((key) => compact[key] === undefined && delete compact[key]);
    let payloadJson = JSON.stringify(compact);
    if (Buffer.byteLength(payloadJson, 'utf8') > FCM_DATA_LIMIT) {
        compact.message = truncate(compact.message || '', 80);
        payloadJson = JSON.stringify(compact);
    }
    return { compact, payloadJson };
};

const readServiceAccount = () => {
    const file = String(process.env.FCM_SERVICE_ACCOUNT_FILE || DEFAULT_SERVICE_ACCOUNT_FILE);
    if (!file || !fs.existsSync(file)) return null;
    try {
        const account = JSON.parse(fs.readFileSync(file, 'utf8'));
        if (!account.project_id || !account.client_email || !account.private_key) return null;
        return account;
    } catch (error) {
        console.warn('FCM service account is unreadable:', error.message);
        return null;
    }
};

const createAccessTokenProvider = () => {
    let cache = null;
    return async () => {
        if (cache && cache.expiresAt - ACCESS_TOKEN_SKEW_MS > Date.now()) return cache.token;
        const account = readServiceAccount();
        if (!account) throw new Error('FCM service account is not configured');

        const now = Math.floor(Date.now() / 1000);
        const tokenUri = account.token_uri || 'https://oauth2.googleapis.com/token';
        const header = base64urlJson({ alg: 'RS256', typ: 'JWT' });
        const claims = base64urlJson({
            iss: account.client_email,
            scope: TOKEN_SCOPE,
            aud: tokenUri,
            iat: now,
            exp: now + 3600,
        });
        const unsigned = `${header}.${claims}`;
        const signature = crypto.sign('RSA-SHA256', Buffer.from(unsigned), account.private_key).toString('base64url');
        const assertion = `${unsigned}.${signature}`;

        const response = await fetch(tokenUri, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
                assertion,
            }),
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok || !result.access_token) {
            throw new Error(`FCM OAuth failed (${response.status}): ${JSON.stringify(result).slice(0, 240)}`);
        }
        cache = {
            token: result.access_token,
            expiresAt: Date.now() + Number(result.expires_in || 3600) * 1000,
        };
        return cache.token;
    };
};

const registerNativeFcmPush = ({ app, db, verifyToken }) => {
    const getAccessToken = createAccessTokenProvider();

    const ensureSchema = async () => {
        await db.query(`CREATE TABLE IF NOT EXISTS native_push_tokens (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
            user_id INT NOT NULL,
            token_hash CHAR(64) NOT NULL,
            device_token TEXT NOT NULL,
            platform VARCHAR(32) NOT NULL DEFAULT 'android',
            app_version VARCHAR(64) NULL,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            UNIQUE KEY unique_native_push_token (token_hash),
            KEY idx_native_push_user (user_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
    };

    ensureSchema().catch((error) => console.error('Native push schema initialization failed:', error.message));

    const serviceAccount = readServiceAccount();
    if (serviceAccount) {
        console.log(`Native Android FCM push enabled for project ${serviceAccount.project_id}`);
    } else {
        console.warn('Native Android FCM push is disabled until FCM_SERVICE_ACCOUNT_FILE is configured');
    }

    app.get('/native-push/status', (req, res) => {
        const account = readServiceAccount();
        res.json({
            configured: Boolean(account),
            transport: 'fcm-http-v1',
            projectId: account?.project_id || null,
        });
    });

    app.post('/native-push/register', verifyToken, async (req, res) => {
        const deviceToken = String(req.body?.deviceToken || '').trim();
        const appVersion = truncate(req.body?.appVersion || '', 64);
        if (deviceToken.length < 32 || deviceToken.length > 8192) {
            return res.status(400).json({ message: 'Некорректный FCM device token', code: 'FCM_TOKEN_INVALID' });
        }
        try {
            await db.query(
                `INSERT INTO native_push_tokens (user_id, token_hash, device_token, platform, app_version)
                 VALUES (?, ?, ?, 'android', ?)
                 ON DUPLICATE KEY UPDATE user_id = VALUES(user_id), device_token = VALUES(device_token),
                   platform = 'android', app_version = VALUES(app_version), updated_at = CURRENT_TIMESTAMP`,
                [req.user.id, sha256(deviceToken), deviceToken, appVersion || null]
            );
            res.json({ ok: true });
        } catch (error) {
            console.error('Native push register error:', error.message);
            res.status(500).json({ message: 'Не удалось зарегистрировать push-уведомления' });
        }
    });

    app.delete('/native-push/register', verifyToken, async (req, res) => {
        const deviceToken = String(req.body?.deviceToken || '').trim();
        if (deviceToken) {
            await db.query('DELETE FROM native_push_tokens WHERE user_id = ? AND token_hash = ?', [req.user.id, sha256(deviceToken)]);
        } else {
            await db.query("DELETE FROM native_push_tokens WHERE user_id = ? AND platform = 'android'", [req.user.id]);
        }
        res.json({ ok: true });
    });

    const sendOne = async (row, type, data, presentation) => {
        const account = readServiceAccount();
        if (!account) return { skipped: true };
        const accessToken = await getAccessToken();
        const { compact, payloadJson } = makeCompactPayload(type, data, presentation);
        const android = {
            priority: 'HIGH',
            ttl: type === 'CALL_INVITE' ? '150s' : type === 'CALL_HANGUP' ? '60s' : '300s',
        };
        const response = await fetch(`https://fcm.googleapis.com/v1/projects/${encodeURIComponent(account.project_id)}/messages:send`, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                message: {
                    token: row.device_token,
                    android,
                    data: {
                        type,
                        title: String(compact.title || ''),
                        body: String(compact.body || ''),
                        route: String(compact.route || '/'),
                        payload_json: payloadJson,
                    },
                },
            }),
        });
        const text = await response.text();
        if (!response.ok) {
            if ([404, 410].includes(response.status) || /UNREGISTERED|registration-token-not-registered/i.test(text)) {
                await db.query('DELETE FROM native_push_tokens WHERE id = ?', [row.id]);
                return { removed: true };
            }
            throw new Error(`FCM send failed (${response.status}): ${text.slice(0, 260)}`);
        }
        return { ok: true };
    };

    const dispatch = async (notification) => {
        const type = String(notification?.type || '');
        if (!supportedTypes.has(type)) return;
        const data = notification?.data || {};
        const targetIds = getTargets(notification);
        if (targetIds.length === 0) return;

        const [tokens] = await db.query(
            'SELECT id, user_id, device_token FROM native_push_tokens WHERE user_id IN (?)',
            [targetIds]
        );
        if (tokens.length === 0) return;

        const presentation = await makePresentation(db, type, data);
        await Promise.all(tokens.map(async (row) => {
            try {
                await sendOne(row, type, data, presentation);
            } catch (error) {
                console.warn(`FCM delivery error for user ${row.user_id}:`, error.message);
            }
        }));
    };

    return { dispatch };
};

module.exports = { registerNativeFcmPush };
