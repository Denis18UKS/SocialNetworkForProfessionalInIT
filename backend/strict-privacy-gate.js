const jwt = require('jsonwebtoken');

const RESTRICTED_MESSAGE = 'Данный пользователь ограничил круг лиц';

const registerStrictPrivacyGate = ({ app, getDb }) => {
    const jwtSecret = String(process.env.JWT_SECRET || '');
    if (!jwtSecret) throw new Error('JWT_SECRET is required for strict privacy gate');

    let blacklistSchemaPromise = null;
    const resolveBlacklistSchema = async () => {
        if (!blacklistSchemaPromise) {
            blacklistSchemaPromise = (async () => {
                const db = getDb();
                const [tables] = await db.query(`SELECT TABLE_NAME AS name
                    FROM information_schema.TABLES
                    WHERE TABLE_SCHEMA = DATABASE()
                      AND TABLE_NAME IN ('blacklist','black_list','user_blacklist','blocked_users')`);
                const candidates = tables.map((row) => row.name);
                for (const table of candidates) {
                    const [columns] = await db.query(`SHOW COLUMNS FROM \`${table}\``);
                    const names = new Set(columns.map((column) => column.Field));
                    const blockerCandidates = ['user_id', 'blocker_id', 'owner_id', 'userId'];
                    const blockedCandidates = ['blocked_user_id', 'blocked_id', 'target_user_id', 'blockedUserId'];
                    const blocker = blockerCandidates.find((name) => names.has(name));
                    const blocked = blockedCandidates.find((name) => names.has(name));
                    if (blocker && blocked && blocker !== blocked) return { table, blocker, blocked };
                }
                return null;
            })().catch((error) => {
                blacklistSchemaPromise = null;
                throw error;
            });
        }
        return blacklistSchemaPromise;
    };

    const decodeUserId = (req) => {
        const token = String(req.header('Authorization') || '').replace(/^Bearer\s+/i, '').trim();
        if (!token) return 0;
        try {
            const decoded = jwt.verify(token, jwtSecret);
            return Number(decoded.id || decoded.userId || 0);
        } catch {
            return 0;
        }
    };

    const isBlockedByTarget = async (viewerId, targetId) => {
        if (!viewerId || !targetId || Number(viewerId) === Number(targetId)) return false;
        const schema = await resolveBlacklistSchema();
        if (!schema) return false;
        const db = getDb();
        const [rows] = await db.query(`SELECT 1 FROM \`${schema.table}\`
            WHERE \`${schema.blocker}\` = ? AND \`${schema.blocked}\` = ? LIMIT 1`, [targetId, viewerId]);
        return rows.length > 0;
    };

    const restrictedObject = (id) => ({
        id,
        restricted: true,
        profile_restricted: true,
        username: RESTRICTED_MESSAGE,
        message: RESTRICTED_MESSAGE,
        avatar: null,
        user_tag: null,
        role: undefined,
        email: undefined,
    });

    const sanitizeUserArray = async (viewerId, users) => {
        if (!viewerId || !Array.isArray(users) || users.length === 0) return users;
        const schema = await resolveBlacklistSchema();
        if (!schema) return users;
        const ids = [...new Set(users.map((user) => Number(user?.id || user?.user_id || 0)).filter((id) => id > 0 && id !== viewerId))];
        if (!ids.length) return users;
        const db = getDb();
        const placeholders = ids.map(() => '?').join(',');
        const [rows] = await db.query(`SELECT \`${schema.blocker}\` AS blocker_id
            FROM \`${schema.table}\`
            WHERE \`${schema.blocked}\` = ? AND \`${schema.blocker}\` IN (${placeholders})`, [viewerId, ...ids]);
        const restrictedIds = new Set(rows.map((row) => Number(row.blocker_id)));
        return users.map((user) => {
            const id = Number(user?.id || user?.user_id || 0);
            return restrictedIds.has(id) ? restrictedObject(id) : user;
        });
    };

    const targetFromPath = async (req) => {
        const pathname = String(req.path || '');
        const directPatterns = [
            /^\/users\/(?!me$)([^/]+)$/i,
            /^\/user\/([^/]+)$/i,
            /^\/profiles\/([^/]+)$/i,
            /^\/profile\/([^/]+)$/i,
        ];
        let identifier = null;
        for (const pattern of directPatterns) {
            const match = pattern.exec(pathname);
            if (match) { identifier = decodeURIComponent(match[1]); break; }
        }
        if (!identifier) return null;
        const db = getDb();
        const numeric = Number(identifier);
        const [rows] = Number.isInteger(numeric) && numeric > 0
            ? await db.query('SELECT id, username FROM users WHERE id = ? LIMIT 1', [numeric])
            : await db.query('SELECT id, username FROM users WHERE username = ? OR user_tag = ? LIMIT 1', [identifier, identifier]);
        return rows[0] || null;
    };

    // This middleware is intentionally registered immediately after express() so it executes before legacy routes.
    app.use(async (req, res, next) => {
        try {
            const viewerId = decodeUserId(req);
            if (!viewerId) return next();

            const target = await targetFromPath(req);
            if (target && await isBlockedByTarget(viewerId, Number(target.id))) {
                return res.status(403).json(restrictedObject(Number(target.id)));
            }

            const shouldSanitizeResponse = req.method === 'GET' && (
                req.path === '/users'
                || req.path === '/friends'
                || req.path.startsWith('/users?')
                || req.path.startsWith('/friends?')
            );
            if (!shouldSanitizeResponse) return next();

            const originalJson = res.json.bind(res);
            res.json = (payload) => {
                Promise.resolve().then(async () => {
                    if (Array.isArray(payload)) return originalJson(await sanitizeUserArray(viewerId, payload));
                    if (payload && Array.isArray(payload.users)) return originalJson({ ...payload, users: await sanitizeUserArray(viewerId, payload.users) });
                    if (payload && Array.isArray(payload.friends)) return originalJson({ ...payload, friends: await sanitizeUserArray(viewerId, payload.friends) });
                    return originalJson(payload);
                }).catch(() => originalJson(payload));
                return res;
            };
            next();
        } catch (error) {
            console.warn('Strict privacy gate fallback:', error.message);
            next();
        }
    });

    app.get('/privacy/check/:username', async (req, res) => {
        const viewerId = decodeUserId(req);
        if (!viewerId) return res.status(401).json({ message: 'Требуется авторизация.' });
        const db = getDb();
        const [rows] = await db.query('SELECT id, username FROM users WHERE username = ? OR user_tag = ? LIMIT 1', [String(req.params.username), String(req.params.username)]);
        if (!rows.length) return res.status(404).json({ message: 'Пользователь не найден.' });
        const target = rows[0];
        const restricted = await isBlockedByTarget(viewerId, Number(target.id));
        if (restricted) return res.json({ restricted: true, message: RESTRICTED_MESSAGE });
        res.json({ restricted: false, userId: Number(target.id), username: target.username });
    });
};

module.exports = { registerStrictPrivacyGate, RESTRICTED_MESSAGE };
