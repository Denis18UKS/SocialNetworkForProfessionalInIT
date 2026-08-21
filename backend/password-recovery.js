const RESET_CODE_TTL_MS = 10 * 60 * 1000;
const RESET_CODE_MAX_ATTEMPTS = 5;
const REQUEST_WINDOW_MS = 15 * 60 * 1000;
const REQUEST_LIMIT = 5;
const CONFIRM_LIMIT = 10;

const recoveryBuckets = new Map();

const normalizeEmail = (value) => String(value || '').trim().toLowerCase();
const isStrongEnoughPassword = (value) => typeof value === 'string' && value.length >= 8 && value.length <= 128;

const hitRateLimit = (key, limit) => {
    const now = Date.now();
    const bucket = recoveryBuckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
        recoveryBuckets.set(key, { count: 1, resetAt: now + REQUEST_WINDOW_MS });
        return false;
    }
    bucket.count += 1;
    recoveryBuckets.set(key, bucket);
    return bucket.count > limit;
};

const ensureRecoverySchema = async (db) => {
    await db.query(`CREATE TABLE IF NOT EXISTS password_reset_codes (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        code_hash VARCHAR(255) NOT NULL,
        attempts INT NOT NULL DEFAULT 0,
        expires_at DATETIME NOT NULL,
        used_at DATETIME NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_password_reset_user (user_id, used_at, expires_at)
    )`);

    await db.query(`CREATE TABLE IF NOT EXISTS owner_recovery_codes (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        code_hash VARCHAR(255) NOT NULL,
        used_at DATETIME NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_owner_recovery_user (user_id, used_at)
    )`);
};

const registerPasswordRecoveryRoutes = ({ app, db, transporter, bcrypt, crypto }) => {
    ensureRecoverySchema(db).catch((error) => {
        console.error('Password recovery schema initialization failed:', error);
    });

    app.get('/password-reset/mail-status', (req, res) => {
        res.json({ configured: Boolean(transporter) });
    });

    app.post('/password-reset/request', async (req, res) => {
        const email = normalizeEmail(req.body?.email);
        if (!email) {
            return res.status(400).json({ message: 'Укажите почту', code: 'EMAIL_REQUIRED' });
        }

        const rateKey = `request:${req.ip}:${email}`;
        if (hitRateLimit(rateKey, REQUEST_LIMIT)) {
            return res.status(429).json({
                message: 'Слишком много запросов. Попробуйте позже.',
                code: 'RESET_RATE_LIMITED',
            });
        }

        if (!transporter) {
            return res.status(503).json({
                message: 'Отправка почты временно не настроена. Владелец может использовать аварийный backup-код.',
                code: 'MAIL_NOT_CONFIGURED',
            });
        }

        try {
            const [users] = await db.query(
                'SELECT id, email, username FROM users WHERE LOWER(email) = ? LIMIT 1',
                [email]
            );

            // Не раскрываем существование аккаунта по адресу почты.
            if (users.length === 0) {
                return res.json({
                    message: 'Если аккаунт существует, код восстановления будет отправлен на указанную почту.',
                    code: 'RESET_REQUEST_ACCEPTED',
                });
            }

            const user = users[0];
            const resetCode = crypto.randomInt(100000, 1000000).toString();
            const codeHash = await bcrypt.hash(resetCode, 10);
            const expiresAt = new Date(Date.now() + RESET_CODE_TTL_MS);

            await db.query(
                'UPDATE password_reset_codes SET used_at = NOW() WHERE user_id = ? AND used_at IS NULL',
                [user.id]
            );
            const [insertResult] = await db.query(
                'INSERT INTO password_reset_codes (user_id, code_hash, expires_at) VALUES (?, ?, ?)',
                [user.id, codeHash, expiresAt]
            );

            try {
                await transporter.sendMail({
                    from: process.env.SMTP_FROM || process.env.SMTP_USER,
                    to: user.email,
                    subject: 'Код восстановления пароля IT-BIRD',
                    text: `Код восстановления IT-BIRD: ${resetCode}. Код действует 10 минут. Если это были не вы, проигнорируйте письмо.`,
                    html: `
                        <div style="font-family:Arial,sans-serif;line-height:1.5;color:#111827">
                            <h2>Восстановление пароля IT-BIRD</h2>
                            <p>Здравствуйте, ${String(user.username || 'пользователь').replace(/[<>]/g, '')}.</p>
                            <p>Ваш код восстановления:</p>
                            <p style="font-size:28px;font-weight:700;letter-spacing:6px">${resetCode}</p>
                            <p>Код действует 10 минут и может быть использован один раз.</p>
                            <p style="color:#6b7280">Если вы не запрашивали восстановление пароля, просто проигнорируйте это письмо.</p>
                        </div>
                    `,
                });
            } catch (mailError) {
                await db.query('DELETE FROM password_reset_codes WHERE id = ?', [insertResult.insertId]);
                console.error('Password reset mail delivery failed:', mailError.message);
                return res.status(502).json({
                    message: 'Почтовый сервер не принял письмо. Пароль не изменён. Попробуйте позже или используйте аварийный backup-код владельца.',
                    code: 'MAIL_DELIVERY_FAILED',
                });
            }

            return res.json({
                message: 'Код восстановления отправлен на почту.',
                code: 'RESET_CODE_SENT',
                expiresInSeconds: Math.floor(RESET_CODE_TTL_MS / 1000),
            });
        } catch (error) {
            console.error('Password reset request error:', error);
            return res.status(500).json({ message: 'Не удалось подготовить восстановление пароля', code: 'RESET_REQUEST_FAILED' });
        }
    });

    app.post('/password-reset/confirm', async (req, res) => {
        const email = normalizeEmail(req.body?.email);
        const code = String(req.body?.code || '').trim();
        const newPassword = String(req.body?.newPassword || '');

        if (!email || !/^\d{6}$/.test(code)) {
            return res.status(400).json({ message: 'Укажите почту и 6-значный код', code: 'RESET_CODE_INVALID' });
        }
        if (!isStrongEnoughPassword(newPassword)) {
            return res.status(400).json({ message: 'Новый пароль должен содержать от 8 до 128 символов', code: 'PASSWORD_TOO_WEAK' });
        }

        const rateKey = `confirm:${req.ip}:${email}`;
        if (hitRateLimit(rateKey, CONFIRM_LIMIT)) {
            return res.status(429).json({ message: 'Слишком много попыток. Попробуйте позже.', code: 'RESET_RATE_LIMITED' });
        }

        try {
            const [users] = await db.query('SELECT id FROM users WHERE LOWER(email) = ? LIMIT 1', [email]);
            if (users.length === 0) {
                return res.status(400).json({ message: 'Неверный или просроченный код', code: 'RESET_CODE_INVALID' });
            }
            const userId = users[0].id;
            const [codes] = await db.query(
                `SELECT id, code_hash, attempts, expires_at
                 FROM password_reset_codes
                 WHERE user_id = ? AND used_at IS NULL
                 ORDER BY id DESC LIMIT 1`,
                [userId]
            );
            if (codes.length === 0) {
                return res.status(400).json({ message: 'Неверный или просроченный код', code: 'RESET_CODE_INVALID' });
            }

            const reset = codes[0];
            if (Number(reset.attempts) >= RESET_CODE_MAX_ATTEMPTS || new Date(reset.expires_at).getTime() < Date.now()) {
                await db.query('UPDATE password_reset_codes SET used_at = NOW() WHERE id = ?', [reset.id]);
                return res.status(400).json({ message: 'Код истёк. Запросите новый.', code: 'RESET_CODE_EXPIRED' });
            }

            const valid = await bcrypt.compare(code, reset.code_hash);
            if (!valid) {
                await db.query('UPDATE password_reset_codes SET attempts = attempts + 1 WHERE id = ?', [reset.id]);
                return res.status(400).json({ message: 'Неверный код', code: 'RESET_CODE_INVALID' });
            }

            const passwordHash = await bcrypt.hash(newPassword, 12);
            const connection = await db.getConnection();
            try {
                await connection.beginTransaction();
                await connection.query('UPDATE users SET password = ? WHERE id = ?', [passwordHash, userId]);
                await connection.query('UPDATE password_reset_codes SET used_at = NOW() WHERE id = ?', [reset.id]);
                await connection.query('UPDATE password_reset_codes SET used_at = NOW() WHERE user_id = ? AND used_at IS NULL', [userId]);
                await connection.commit();
            } catch (error) {
                await connection.rollback();
                throw error;
            } finally {
                connection.release();
            }

            return res.json({ message: 'Пароль успешно изменён', code: 'PASSWORD_RESET_COMPLETE' });
        } catch (error) {
            console.error('Password reset confirm error:', error);
            return res.status(500).json({ message: 'Не удалось изменить пароль', code: 'RESET_CONFIRM_FAILED' });
        }
    });

    app.post('/password-reset/owner-emergency', async (req, res) => {
        const email = normalizeEmail(req.body?.email);
        const recoveryCode = String(req.body?.recoveryCode || '').trim().toUpperCase();
        const newPassword = String(req.body?.newPassword || '');
        const ownerEmail = normalizeEmail(process.env.OWNER_ADMIN_EMAIL);

        if (!ownerEmail) {
            return res.status(503).json({ message: 'Аварийное восстановление владельца не настроено', code: 'OWNER_RECOVERY_NOT_CONFIGURED' });
        }
        if (!email || email !== ownerEmail || !recoveryCode) {
            return res.status(400).json({ message: 'Неверный аварийный код', code: 'OWNER_RECOVERY_INVALID' });
        }
        if (!isStrongEnoughPassword(newPassword)) {
            return res.status(400).json({ message: 'Новый пароль должен содержать от 8 до 128 символов', code: 'PASSWORD_TOO_WEAK' });
        }
        if (hitRateLimit(`owner:${req.ip}:${email}`, REQUEST_LIMIT)) {
            return res.status(429).json({ message: 'Слишком много попыток. Попробуйте позже.', code: 'RESET_RATE_LIMITED' });
        }

        try {
            const [users] = await db.query(
                "SELECT id FROM users WHERE LOWER(email) = ? AND role = 'admin' LIMIT 1",
                [ownerEmail]
            );
            if (users.length === 0) {
                return res.status(400).json({ message: 'Неверный аварийный код', code: 'OWNER_RECOVERY_INVALID' });
            }
            const userId = users[0].id;
            const [codes] = await db.query(
                'SELECT id, code_hash FROM owner_recovery_codes WHERE user_id = ? AND used_at IS NULL ORDER BY id DESC LIMIT 12',
                [userId]
            );

            let matched = null;
            for (const candidate of codes) {
                if (await bcrypt.compare(recoveryCode, candidate.code_hash)) {
                    matched = candidate;
                    break;
                }
            }
            if (!matched) {
                return res.status(400).json({ message: 'Неверный аварийный код', code: 'OWNER_RECOVERY_INVALID' });
            }

            const passwordHash = await bcrypt.hash(newPassword, 12);
            const connection = await db.getConnection();
            try {
                await connection.beginTransaction();
                await connection.query('UPDATE users SET password = ? WHERE id = ?', [passwordHash, userId]);
                await connection.query('UPDATE owner_recovery_codes SET used_at = NOW() WHERE id = ?', [matched.id]);
                await connection.query('UPDATE password_reset_codes SET used_at = NOW() WHERE user_id = ? AND used_at IS NULL', [userId]);
                await connection.commit();
            } catch (error) {
                await connection.rollback();
                throw error;
            } finally {
                connection.release();
            }

            return res.json({
                message: 'Пароль владельца изменён. Использованный backup-код больше не действует.',
                code: 'OWNER_RECOVERY_COMPLETE',
            });
        } catch (error) {
            console.error('Owner emergency recovery error:', error);
            return res.status(500).json({ message: 'Не удалось выполнить аварийное восстановление', code: 'OWNER_RECOVERY_FAILED' });
        }
    });
};

module.exports = {
    ensureRecoverySchema,
    registerPasswordRecoveryRoutes,
};
