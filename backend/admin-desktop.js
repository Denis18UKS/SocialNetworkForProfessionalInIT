const crypto = require('crypto');
const fs = require('fs');
const jwt = require('jsonwebtoken');

const ADMIN_CODE_TTL_SECONDS = 5 * 60;
const ADMIN_SESSION_TTL = '30m';
const ADMIN_CODE_COOLDOWN_SECONDS = 60;

const toMysqlDate = (date) => date.toISOString().slice(0, 19).replace('T', ' ');

const registerAdminDesktop = ({ app, db, transporter, getOnlineUserIds }) => {
    const jwtSecret = String(process.env.JWT_SECRET || '');
    if (!jwtSecret) throw new Error('JWT_SECRET is required for admin desktop');

    const hmac = (value) => crypto.createHmac('sha256', jwtSecret).update(String(value)).digest('hex');
    const hashAdminCode = (adminId, challengeId, code) => hmac(`admin-desktop:${adminId}:${challengeId}:${code}`);

    const ensureSchema = async () => {
        await db.query(`CREATE TABLE IF NOT EXISTS admin_desktop_challenges (
            challenge_id CHAR(64) NOT NULL PRIMARY KEY,
            admin_id INT NOT NULL,
            code_hash CHAR(64) NOT NULL,
            expires_at DATETIME NOT NULL,
            attempts INT UNSIGNED NOT NULL DEFAULT 0,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            KEY idx_admin_challenge_admin (admin_id),
            KEY idx_admin_challenge_expiry (expires_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

        await db.query(`CREATE TABLE IF NOT EXISTS admin_desktop_audit (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
            admin_id INT NOT NULL,
            action_name VARCHAR(80) NOT NULL,
            target_type VARCHAR(40) NULL,
            target_id VARCHAR(120) NULL,
            details_json JSON NULL,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            KEY idx_admin_audit_admin (admin_id),
            KEY idx_admin_audit_created (created_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
    };

    const getBearerToken = (req) => String(req.header('Authorization') || '').replace(/^Bearer\s+/i, '').trim();

    const getFreshAdmin = async (id) => {
        const [rows] = await db.query(
            'SELECT id, email, username, role, isBlocked FROM users WHERE id = ? LIMIT 1',
            [id]
        );
        if (rows.length === 0) return null;
        const user = rows[0];
        if (String(user.role || 'user') !== 'admin') return null;
        if (String(user.isBlocked || '') === 'заблокирован') return null;
        return user;
    };

    const verifyNormalAdminToken = async (req, res, next) => {
        const token = getBearerToken(req);
        if (!token) return res.status(401).json({ message: 'Требуется авторизация администратора.' });
        try {
            const decoded = jwt.verify(token, jwtSecret);
            if (decoded.scope === 'admin-desktop') {
                return res.status(401).json({ message: 'Используйте основной токен для запроса кода.' });
            }
            const admin = await getFreshAdmin(decoded.id);
            if (!admin) return res.status(403).json({ message: 'Доступ администратора запрещён.' });
            req.desktopAdmin = admin;
            next();
        } catch (error) {
            return res.status(401).json({ message: 'Сессия входа недействительна.' });
        }
    };

    const verifyDesktopAdmin = async (req, res, next) => {
        const token = getBearerToken(req);
        if (!token) return res.status(401).json({ message: 'Требуется desktop-сессия администратора.' });
        try {
            const decoded = jwt.verify(token, jwtSecret);
            if (decoded.scope !== 'admin-desktop' || decoded.role !== 'admin') {
                return res.status(403).json({ message: 'Этот токен не является desktop-сессией администратора.' });
            }
            const admin = await getFreshAdmin(decoded.id);
            if (!admin) return res.status(403).json({ message: 'Права администратора отозваны.' });
            req.desktopAdmin = admin;
            req.desktopAdminToken = decoded;
            next();
        } catch (error) {
            return res.status(401).json({ message: 'Desktop-сессия истекла. Войдите заново.' });
        }
    };

    const audit = async (adminId, actionName, targetType = null, targetId = null, details = null) => {
        await db.query(
            'INSERT INTO admin_desktop_audit (admin_id, action_name, target_type, target_id, details_json) VALUES (?, ?, ?, ?, ?)',
            [adminId, actionName, targetType, targetId == null ? null : String(targetId), details ? JSON.stringify(details) : null]
        ).catch((error) => console.warn('Admin audit write failed:', error.message));
    };

    const sendAccountStatusEmail = async (user, blocked, reason) => {
        if (!transporter || !user?.email) return;
        const subject = blocked ? 'Ваш аккаунт SocialBIRD заблокирован' : 'Ваш аккаунт SocialBIRD разблокирован';
        const text = blocked
            ? `Ваш аккаунт SocialBIRD заблокирован администратором. Причина: ${reason}`
            : 'Ваш аккаунт SocialBIRD разблокирован. Теперь вы снова можете пользоваться сервисом.';
        await transporter.sendMail({
            from: process.env.SMTP_FROM || process.env.SMTP_USER,
            to: user.email,
            subject,
            text,
        }).catch((error) => console.warn('Admin account status email failed:', error.message));
    };

    app.get('/admin/desktop/status', async (req, res) => {
        await ensureSchema();
        res.json({ enabled: true, twoFactorRequired: true, sessionMinutes: 30 });
    });

    app.post('/admin/desktop/request-code', verifyNormalAdminToken, async (req, res) => {
        try {
            await ensureSchema();
            if (!transporter) {
                return res.status(503).json({ message: 'SMTP не настроен — двухфакторный код администратора отправить нельзя.' });
            }

            const admin = req.desktopAdmin;
            const [recent] = await db.query(
                'SELECT challenge_id, created_at FROM admin_desktop_challenges WHERE admin_id = ? ORDER BY created_at DESC LIMIT 1',
                [admin.id]
            );
            if (recent.length > 0) {
                const elapsed = Math.floor((Date.now() - new Date(recent[0].created_at).getTime()) / 1000);
                if (elapsed >= 0 && elapsed < ADMIN_CODE_COOLDOWN_SECONDS) {
                    const retryAfterSeconds = ADMIN_CODE_COOLDOWN_SECONDS - elapsed;
                    res.setHeader('Retry-After', String(retryAfterSeconds));
                    return res.status(429).json({
                        message: `Новый код можно запросить через ${retryAfterSeconds} сек.`,
                        retryAfterSeconds,
                    });
                }
            }

            await db.query('DELETE FROM admin_desktop_challenges WHERE admin_id = ? OR expires_at < NOW()', [admin.id]);
            const challengeId = crypto.randomBytes(32).toString('hex');
            const code = crypto.randomInt(100000, 1000000).toString();
            await db.query(
                'INSERT INTO admin_desktop_challenges (challenge_id, admin_id, code_hash, expires_at) VALUES (?, ?, ?, ?)',
                [challengeId, admin.id, hashAdminCode(admin.id, challengeId, code), toMysqlDate(new Date(Date.now() + ADMIN_CODE_TTL_SECONDS * 1000))]
            );

            try {
                await transporter.sendMail({
                    from: process.env.SMTP_FROM || process.env.SMTP_USER,
                    to: admin.email,
                    subject: 'Код входа в SocialBIRD Admin Desktop',
                    text: `Код входа в админ-панель SocialBIRD: ${code}\n\nКод действует 5 минут. Если это были не вы, смените пароль администратора.`,
                    html: `<div style="font-family:Arial,sans-serif;line-height:1.5"><h2>SocialBIRD Admin Desktop</h2><p>Код двухфакторного входа:</p><div style="font-size:32px;font-weight:800;letter-spacing:8px">${code}</div><p>Код действует 5 минут.</p><p style="color:#666">Если это были не вы, смените пароль администратора.</p></div>`,
                });
            } catch (error) {
                await db.query('DELETE FROM admin_desktop_challenges WHERE challenge_id = ?', [challengeId]);
                throw error;
            }

            await audit(admin.id, 'request_2fa_code', 'admin', admin.id);
            return res.json({
                challengeId,
                expiresInSeconds: ADMIN_CODE_TTL_SECONDS,
                resendAfterSeconds: ADMIN_CODE_COOLDOWN_SECONDS,
                emailHint: String(admin.email || '').replace(/^(.{1,2}).*(@.*)$/, '$1***$2'),
            });
        } catch (error) {
            console.error('Admin desktop request code failed:', error.message);
            return res.status(500).json({ message: 'Не удалось отправить код администратора.' });
        }
    });

    app.post('/admin/desktop/confirm-code', verifyNormalAdminToken, async (req, res) => {
        const challengeId = String(req.body?.challengeId || '').trim();
        const code = String(req.body?.code || '').replace(/\D/g, '').slice(0, 6);
        if (!/^[a-f0-9]{64}$/.test(challengeId) || code.length !== 6) {
            return res.status(400).json({ message: 'Некорректный challenge или код.' });
        }

        try {
            await ensureSchema();
            const admin = req.desktopAdmin;
            const [rows] = await db.query(
                'SELECT challenge_id, code_hash, expires_at, attempts FROM admin_desktop_challenges WHERE challenge_id = ? AND admin_id = ? LIMIT 1',
                [challengeId, admin.id]
            );
            if (rows.length === 0) return res.status(404).json({ message: 'Код не найден или уже использован.' });
            const challenge = rows[0];
            if (new Date(challenge.expires_at).getTime() <= Date.now()) {
                await db.query('DELETE FROM admin_desktop_challenges WHERE challenge_id = ?', [challengeId]);
                return res.status(410).json({ message: 'Код истёк. Запросите новый.' });
            }
            if (Number(challenge.attempts || 0) >= 6) {
                await db.query('DELETE FROM admin_desktop_challenges WHERE challenge_id = ?', [challengeId]);
                return res.status(429).json({ message: 'Слишком много неверных попыток. Запросите новый код.' });
            }

            const expected = hashAdminCode(admin.id, challengeId, code);
            const left = Buffer.from(expected, 'utf8');
            const right = Buffer.from(String(challenge.code_hash || ''), 'utf8');
            const valid = left.length === right.length && crypto.timingSafeEqual(left, right);
            if (!valid) {
                await db.query('UPDATE admin_desktop_challenges SET attempts = attempts + 1 WHERE challenge_id = ?', [challengeId]);
                return res.status(400).json({ message: 'Неверный код.' });
            }

            await db.query('DELETE FROM admin_desktop_challenges WHERE challenge_id = ?', [challengeId]);
            const desktopToken = jwt.sign(
                { id: admin.id, email: admin.email, role: 'admin', scope: 'admin-desktop' },
                jwtSecret,
                { expiresIn: ADMIN_SESSION_TTL }
            );
            await audit(admin.id, 'desktop_login', 'admin', admin.id);
            return res.json({
                token: desktopToken,
                expiresInSeconds: 30 * 60,
                admin: { id: admin.id, username: admin.username, email: admin.email },
            });
        } catch (error) {
            console.error('Admin desktop confirmation failed:', error.message);
            return res.status(500).json({ message: 'Не удалось подтвердить вход администратора.' });
        }
    });

    app.get('/admin/desktop/session', verifyDesktopAdmin, async (req, res) => {
        res.json({ ok: true, admin: { id: req.desktopAdmin.id, username: req.desktopAdmin.username, email: req.desktopAdmin.email } });
    });

    app.get('/admin/desktop/stats', verifyDesktopAdmin, async (req, res) => {
        try {
            const [totalRows] = await db.query('SELECT COUNT(*) AS count FROM users');
            const [blockedRows] = await db.query("SELECT COUNT(*) AS count FROM users WHERE isBlocked = 'заблокирован'");
            const [adminRows] = await db.query("SELECT COUNT(*) AS count FROM users WHERE role = 'admin'");
            const [pendingRows] = await db.query('SELECT COUNT(*) AS count FROM pending_registrations').catch(() => [[{ count: 0 }]]);
            const [pushRows] = await db.query('SELECT COUNT(*) AS count FROM native_push_tokens').catch(() => [[{ count: 0 }]]);
            const [pendingPostRows] = await db.query("SELECT COUNT(*) AS count FROM posts WHERE status = 'ожидание'").catch(() => [[{ count: 0 }]]);
            const onlineIds = typeof getOnlineUserIds === 'function' ? getOnlineUserIds() : [];
            res.json({
                users: Number(totalRows[0]?.count || 0),
                blocked: Number(blockedRows[0]?.count || 0),
                admins: Number(adminRows[0]?.count || 0),
                pendingRegistrations: Number(pendingRows[0]?.count || 0),
                pendingPosts: Number(pendingPostRows[0]?.count || 0),
                nativePushTokens: Number(pushRows[0]?.count || 0),
                onlineUsers: Array.isArray(onlineIds) ? onlineIds.length : 0,
                smtpConfigured: Boolean(transporter),
                fcmConfigured: fs.existsSync(String(process.env.FCM_SERVICE_ACCOUNT_FILE || '/etc/socialbird/firebase-service-account.json')),
                apiTime: new Date().toISOString(),
            });
        } catch (error) {
            console.error('Admin stats failed:', error.message);
            res.status(500).json({ message: 'Не удалось получить статистику.' });
        }
    });

    app.get('/admin/desktop/users', verifyDesktopAdmin, async (req, res) => {
        try {
            const query = String(req.query.q || '').trim();
            const limit = Math.max(1, Math.min(200, Number(req.query.limit || 100)));
            const pattern = `%${query}%`;
            const [rows] = query
                ? await db.query(
                    `SELECT id, username, email, user_tag, role, isBlocked, reason_blocked, github_username, gitlab_username
                     FROM users
                     WHERE username LIKE ? OR email LIKE ? OR user_tag LIKE ?
                     ORDER BY id DESC LIMIT ?`,
                    [pattern, pattern, pattern, limit]
                  )
                : await db.query(
                    `SELECT id, username, email, user_tag, role, isBlocked, reason_blocked, github_username, gitlab_username
                     FROM users ORDER BY id DESC LIMIT ?`,
                    [limit]
                  );
            res.json({ users: rows });
        } catch (error) {
            console.error('Admin user list failed:', error.message);
            res.status(500).json({ message: 'Не удалось получить пользователей.' });
        }
    });

    app.patch('/admin/desktop/users/:id/block', verifyDesktopAdmin, async (req, res) => {
        const targetId = Number(req.params.id);
        const blocked = Boolean(req.body?.blocked);
        const reason = String(req.body?.reason || '').trim().slice(0, 500);
        if (!Number.isInteger(targetId) || targetId <= 0) return res.status(400).json({ message: 'Некорректный пользователь.' });
        if (targetId === Number(req.desktopAdmin.id) && blocked) {
            return res.status(400).json({ message: 'Нельзя заблокировать собственный активный admin-аккаунт.' });
        }
        if (blocked && !reason) {
            return res.status(400).json({ message: 'Укажите причину блокировки.' });
        }
        try {
            const [users] = await db.query('SELECT id, username, email FROM users WHERE id = ? LIMIT 1', [targetId]);
            if (users.length === 0) return res.status(404).json({ message: 'Пользователь не найден.' });
            if (blocked) {
                await db.query("UPDATE users SET isBlocked = 'заблокирован', reason_blocked = ? WHERE id = ?", [reason, targetId]);
            } else {
                await db.query("UPDATE users SET isBlocked = 'активен', reason_blocked = NULL WHERE id = ?", [targetId]);
            }
            await audit(req.desktopAdmin.id, blocked ? 'block_user' : 'unblock_user', 'user', targetId, blocked ? { reason } : null);
            void sendAccountStatusEmail(users[0], blocked, reason);
            res.json({ ok: true, blocked, status: blocked ? 'заблокирован' : 'активен' });
        } catch (error) {
            console.error('Admin block update failed:', error.message);
            res.status(500).json({ message: 'Не удалось изменить блокировку.' });
        }
    });

    app.patch('/admin/desktop/users/:id/role', verifyDesktopAdmin, async (req, res) => {
        const targetId = Number(req.params.id);
        const role = String(req.body?.role || '').trim();
        if (!Number.isInteger(targetId) || targetId <= 0) return res.status(400).json({ message: 'Некорректный пользователь.' });
        if (!['user', 'admin'].includes(role)) return res.status(400).json({ message: 'Допустимые роли: user или admin.' });
        if (targetId === Number(req.desktopAdmin.id) && role !== 'admin') {
            return res.status(400).json({ message: 'Нельзя снять роль admin у собственной активной desktop-сессии.' });
        }
        try {
            const [result] = await db.query('UPDATE users SET role = ? WHERE id = ?', [role, targetId]);
            if (!result.affectedRows) return res.status(404).json({ message: 'Пользователь не найден.' });
            await audit(req.desktopAdmin.id, 'change_user_role', 'user', targetId, { role });
            res.json({ ok: true, role });
        } catch (error) {
            console.error('Admin role update failed:', error.message);
            res.status(500).json({ message: 'Не удалось изменить роль.' });
        }
    });

    app.get('/admin/desktop/audit', verifyDesktopAdmin, async (req, res) => {
        try {
            const limit = Math.max(1, Math.min(200, Number(req.query.limit || 100)));
            const [rows] = await db.query(
                `SELECT a.id, a.admin_id, u.username AS admin_username, a.action_name, a.target_type,
                        a.target_id, a.details_json, a.created_at
                 FROM admin_desktop_audit a
                 LEFT JOIN users u ON u.id = a.admin_id
                 ORDER BY a.id DESC LIMIT ?`,
                [limit]
            );
            res.json({ audit: rows });
        } catch (error) {
            console.error('Admin audit read failed:', error.message);
            res.status(500).json({ message: 'Не удалось получить журнал действий.' });
        }
    });

    ensureSchema().catch((error) => console.error('Admin desktop schema failed:', error.message));
    console.log('SocialBIRD Admin Desktop API with email 2FA is enabled.');
};

module.exports = { registerAdminDesktop };
