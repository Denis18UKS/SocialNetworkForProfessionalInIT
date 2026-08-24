const crypto = require('crypto');

const EMAIL_CODE_TTL_SECONDS = 10 * 60;
const RESEND_COOLDOWN_SECONDS = 60;
const PENDING_TTL_HOURS = 48;

const normalizeEmail = (value) => String(value || '').trim().toLowerCase();
const normalizeUsername = (value) => String(value || '').trim();
const normalizeProviderUsername = (value) => {
    const normalized = String(value || '').trim();
    return normalized || null;
};

const emailLooksValid = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && value.length <= 320;
const nowPlusSeconds = (seconds) => new Date(Date.now() + seconds * 1000);
const nowPlusHours = (hours) => new Date(Date.now() + hours * 60 * 60 * 1000);
const toMysqlDate = (date) => date.toISOString().slice(0, 19).replace('T', ' ');

const maskEmail = (email) => {
    const [local, domain] = String(email || '').split('@');
    if (!local || !domain) return email;
    const visible = local.length <= 2 ? local.slice(0, 1) : local.slice(0, 2);
    return `${visible}${'*'.repeat(Math.max(2, Math.min(8, local.length - visible.length)))}@${domain}`;
};

const getClientAddress = (req) => {
    const direct = String(req.socket?.remoteAddress || req.ip || '').trim();
    const localProxy = !direct || direct === '127.0.0.1' || direct === '::1' || direct === '::ffff:127.0.0.1';
    if (localProxy) {
        const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
        if (forwarded) return forwarded;
    }
    return direct || 'unknown';
};

const registerEmailVerifiedRegistration = ({ app, db, transporter, bcrypt, normalizeUserTag, isValidUserTag }) => {
    const secret = String(process.env.JWT_SECRET || '');
    if (!secret) throw new Error('JWT_SECRET is required for registration verification');

    let lastCleanupAt = 0;

    const hmac = (value) => crypto.createHmac('sha256', secret).update(String(value)).digest('hex');
    const hashCode = (email, code) => hmac(`registration-code:${normalizeEmail(email)}:${code}`);
    const secureEquals = (first, second) => {
        const left = Buffer.from(String(first || ''), 'utf8');
        const right = Buffer.from(String(second || ''), 'utf8');
        return left.length === right.length && crypto.timingSafeEqual(left, right);
    };

    const ensureSchema = async () => {
        await db.query(`CREATE TABLE IF NOT EXISTS pending_registrations (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
            email VARCHAR(320) NOT NULL,
            username VARCHAR(100) NOT NULL,
            password_hash VARCHAR(255) NOT NULL,
            github_username VARCHAR(255) NULL,
            gitlab_username VARCHAR(255) NULL,
            user_tag VARCHAR(32) NULL,
            code_hash CHAR(64) NOT NULL,
            code_expires_at DATETIME NOT NULL,
            resend_available_at DATETIME NOT NULL,
            verify_attempts INT UNSIGNED NOT NULL DEFAULT 0,
            request_ip_hash CHAR(64) NULL,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            UNIQUE KEY uq_pending_registration_email (email),
            KEY idx_pending_registration_tag (user_tag),
            KEY idx_pending_registration_github (github_username),
            KEY idx_pending_registration_expiry (code_expires_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

        await db.query(`CREATE TABLE IF NOT EXISTS auth_rate_limits (
            rate_key VARCHAR(160) NOT NULL PRIMARY KEY,
            action_name VARCHAR(64) NOT NULL,
            hit_count INT UNSIGNED NOT NULL DEFAULT 0,
            window_started_at DATETIME NOT NULL,
            blocked_until DATETIME NULL,
            updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            KEY idx_auth_rate_action (action_name),
            KEY idx_auth_rate_updated (updated_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
    };

    const maybeCleanup = async () => {
        if (Date.now() - lastCleanupAt < 60 * 60 * 1000) return;
        lastCleanupAt = Date.now();
        await Promise.all([
            db.query('DELETE FROM pending_registrations WHERE updated_at < DATE_SUB(NOW(), INTERVAL ? HOUR)', [PENDING_TTL_HOURS]),
            db.query('DELETE FROM auth_rate_limits WHERE updated_at < DATE_SUB(NOW(), INTERVAL 3 DAY)'),
        ]).catch((error) => console.warn('Registration cleanup failed:', error.message));
    };

    const checkRate = async ({ action, key, maxHits, windowSeconds, blockSeconds }) => {
        const rateKey = `${action}:${hmac(key).slice(0, 96)}`;
        const [rows] = await db.query(
            'SELECT hit_count, window_started_at, blocked_until FROM auth_rate_limits WHERE rate_key = ? LIMIT 1',
            [rateKey]
        );
        const now = Date.now();
        if (rows.length === 0) {
            await db.query(
                'INSERT INTO auth_rate_limits (rate_key, action_name, hit_count, window_started_at) VALUES (?, ?, 1, NOW())',
                [rateKey, action]
            );
            return { allowed: true };
        }

        const row = rows[0];
        const blockedUntil = row.blocked_until ? new Date(row.blocked_until).getTime() : 0;
        if (blockedUntil > now) {
            return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((blockedUntil - now) / 1000)) };
        }

        const windowStartedAt = new Date(row.window_started_at).getTime();
        if (!Number.isFinite(windowStartedAt) || now - windowStartedAt >= windowSeconds * 1000) {
            await db.query(
                'UPDATE auth_rate_limits SET hit_count = 1, window_started_at = NOW(), blocked_until = NULL WHERE rate_key = ?',
                [rateKey]
            );
            return { allowed: true };
        }

        const nextHits = Number(row.hit_count || 0) + 1;
        if (nextHits > maxHits) {
            const blockedUntilDate = toMysqlDate(nowPlusSeconds(blockSeconds));
            await db.query(
                'UPDATE auth_rate_limits SET hit_count = ?, blocked_until = ? WHERE rate_key = ?',
                [nextHits, blockedUntilDate, rateKey]
            );
            return { allowed: false, retryAfterSeconds: blockSeconds };
        }

        await db.query('UPDATE auth_rate_limits SET hit_count = ? WHERE rate_key = ?', [nextHits, rateKey]);
        return { allowed: true };
    };

    const enforceRate = async (req, res, email, action) => {
        const address = getClientAddress(req);
        const profiles = action === 'verify'
            ? [
                { key: `ip:${address}`, maxHits: 50, windowSeconds: 15 * 60, blockSeconds: 15 * 60 },
                { key: `email:${email}`, maxHits: 12, windowSeconds: 15 * 60, blockSeconds: 15 * 60 },
              ]
            : action === 'resend'
                ? [
                    { key: `ip:${address}`, maxHits: 20, windowSeconds: 60 * 60, blockSeconds: 60 * 60 },
                    { key: `email:${email}`, maxHits: 6, windowSeconds: 60 * 60, blockSeconds: 60 * 60 },
                  ]
                : [
                    { key: `ip:${address}`, maxHits: 8, windowSeconds: 60 * 60, blockSeconds: 60 * 60 },
                    { key: `email:${email}`, maxHits: 4, windowSeconds: 60 * 60, blockSeconds: 60 * 60 },
                  ];

        for (const profile of profiles) {
            const result = await checkRate({ action, ...profile });
            if (!result.allowed) {
                res.setHeader('Retry-After', String(result.retryAfterSeconds));
                res.status(429).json({
                    message: 'Слишком много попыток. Попробуйте позже.',
                    code: 'RATE_LIMITED',
                    retryAfterSeconds: result.retryAfterSeconds,
                });
                return false;
            }
        }
        return true;
    };

    const sendVerificationEmail = async ({ email, username, code }) => {
        if (!transporter) throw new Error('SMTP_NOT_CONFIGURED');
        await transporter.sendMail({
            from: process.env.SMTP_FROM || process.env.SMTP_USER,
            to: email,
            subject: 'Код подтверждения регистрации SocialBIRD',
            text: `Здравствуйте, ${username}!\n\nКод подтверждения регистрации SocialBIRD: ${code}\n\nКод действует 10 минут. Если вы не регистрировались, просто проигнорируйте это письмо.`,
            html: `
                <div style="font-family:Arial,sans-serif;line-height:1.55;color:#171717;max-width:560px;margin:auto">
                    <h2 style="margin-bottom:8px">Подтверждение регистрации SocialBIRD</h2>
                    <p>Здравствуйте, ${String(username).replace(/[<>&]/g, '')}!</p>
                    <p>Введите этот код на странице регистрации:</p>
                    <div style="font-size:32px;font-weight:800;letter-spacing:8px;padding:18px 0">${code}</div>
                    <p>Код действует 10 минут. Никому его не сообщайте.</p>
                    <p style="color:#666;font-size:13px">Если вы не создавали аккаунт SocialBIRD, это письмо можно удалить.</p>
                </div>
            `,
        });
    };

    const sendGenericPendingResponse = (res, email, status = 202) => res.status(status).json({
        message: 'Код подтверждения отправлен на почту.',
        verificationRequired: true,
        email: maskEmail(email),
        resendAfterSeconds: RESEND_COOLDOWN_SECONDS,
        expiresInSeconds: EMAIL_CODE_TTL_SECONDS,
    });

    const checkConflicts = async ({ email, githubUsername, userTag, pendingEmail = null }) => {
        const [existingEmail] = await db.query('SELECT id FROM users WHERE LOWER(email) = ? LIMIT 1', [email]);
        if (existingEmail.length > 0) return { message: 'Пользователь с таким email уже существует!', code: 'EMAIL_EXISTS' };

        if (githubUsername) {
            const [rows] = await db.query('SELECT id FROM users WHERE github_username = ? LIMIT 1', [githubUsername]);
            if (rows.length > 0) return { message: 'Пользователь с таким GitHub Username уже существует!', code: 'GITHUB_EXISTS' };
            const [pending] = await db.query(
                'SELECT email FROM pending_registrations WHERE github_username = ? AND email != ? LIMIT 1',
                [githubUsername, pendingEmail || email]
            );
            if (pending.length > 0) return { message: 'Этот GitHub Username уже используется в другой незавершённой регистрации.', code: 'GITHUB_PENDING' };
        }

        if (userTag) {
            const [rows] = await db.query('SELECT id FROM users WHERE user_tag = ? LIMIT 1', [userTag]);
            if (rows.length > 0) return { message: 'Этот @username уже занят!', code: 'TAG_EXISTS' };
            const [pending] = await db.query(
                'SELECT email FROM pending_registrations WHERE user_tag = ? AND email != ? LIMIT 1',
                [userTag, pendingEmail || email]
            );
            if (pending.length > 0) return { message: 'Этот @username уже ожидает подтверждения в другой регистрации.', code: 'TAG_PENDING' };
        }

        return null;
    };

    app.get('/register/status', async (req, res) => {
        await ensureSchema();
        res.json({
            emailVerification: true,
            smtpConfigured: Boolean(transporter),
            codeTtlSeconds: EMAIL_CODE_TTL_SECONDS,
            resendCooldownSeconds: RESEND_COOLDOWN_SECONDS,
        });
    });

    app.post('/register', async (req, res) => {
        try {
            await ensureSchema();
            void maybeCleanup();

            // Honeypot: legitimate UI leaves this field empty. Bots get a fake success without creating anything.
            if (String(req.body?.website || req.body?.company_website || '').trim()) {
                return sendGenericPendingResponse(res, normalizeEmail(req.body?.email));
            }

            if (!transporter) {
                return res.status(503).json({
                    message: 'Регистрация временно недоступна: сервер почты ещё не настроен.',
                    code: 'SMTP_NOT_CONFIGURED',
                });
            }

            const username = normalizeUsername(req.body?.username);
            const email = normalizeEmail(req.body?.email);
            const password = String(req.body?.password || '');
            const githubUsername = normalizeProviderUsername(req.body?.github_username);
            const gitlabUsername = normalizeProviderUsername(req.body?.gitlab_username) || githubUsername;
            const userTag = normalizeUserTag(req.body?.user_tag);

            if (username.length < 2 || username.length > 100) {
                return res.status(400).json({ message: 'Имя пользователя должно содержать от 2 до 100 символов.' });
            }
            if (!emailLooksValid(email)) {
                return res.status(400).json({ message: 'Укажите корректный email.' });
            }
            if (password.length < 8 || password.length > 200) {
                return res.status(400).json({ message: 'Пароль должен содержать от 8 до 200 символов.' });
            }
            if (!isValidUserTag(userTag)) {
                return res.status(400).json({ message: '@username должен быть от 3 до 32 символов: латиница, цифры и _' });
            }
            if (!(await enforceRate(req, res, email, 'register'))) return;

            const conflict = await checkConflicts({ email, githubUsername, userTag, pendingEmail: email });
            if (conflict) return res.status(409).json(conflict);

            const [pendingRows] = await db.query(
                'SELECT email, code_expires_at, resend_available_at FROM pending_registrations WHERE email = ? LIMIT 1',
                [email]
            );
            if (pendingRows.length > 0) {
                const resendAt = new Date(pendingRows[0].resend_available_at).getTime();
                const expiresAt = new Date(pendingRows[0].code_expires_at).getTime();
                if (expiresAt > Date.now()) {
                    return res.status(409).json({
                        message: 'Регистрация уже ожидает подтверждения. Введите код из письма или запросите новый.',
                        code: 'VERIFICATION_PENDING',
                        verificationRequired: true,
                        email: maskEmail(email),
                        resendAfterSeconds: Math.max(0, Math.ceil((resendAt - Date.now()) / 1000)),
                    });
                }
            }

            const code = crypto.randomInt(100000, 1000000).toString();
            const passwordHash = await bcrypt.hash(password, 12);
            const addressHash = hmac(`ip:${getClientAddress(req)}`);
            const codeHash = hashCode(email, code);
            const expiresAt = toMysqlDate(nowPlusSeconds(EMAIL_CODE_TTL_SECONDS));
            const resendAt = toMysqlDate(nowPlusSeconds(RESEND_COOLDOWN_SECONDS));

            await db.query(
                `INSERT INTO pending_registrations
                (email, username, password_hash, github_username, gitlab_username, user_tag, code_hash, code_expires_at, resend_available_at, verify_attempts, request_ip_hash)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)
                ON DUPLICATE KEY UPDATE username = VALUES(username), password_hash = VALUES(password_hash),
                    github_username = VALUES(github_username), gitlab_username = VALUES(gitlab_username), user_tag = VALUES(user_tag),
                    code_hash = VALUES(code_hash), code_expires_at = VALUES(code_expires_at), resend_available_at = VALUES(resend_available_at),
                    verify_attempts = 0, request_ip_hash = VALUES(request_ip_hash), updated_at = CURRENT_TIMESTAMP`,
                [email, username, passwordHash, githubUsername, gitlabUsername, userTag, codeHash, expiresAt, resendAt, addressHash]
            );

            try {
                await sendVerificationEmail({ email, username, code });
            } catch (error) {
                await db.query('DELETE FROM pending_registrations WHERE email = ?', [email]);
                console.error('Registration verification email failed:', error.message);
                return res.status(503).json({
                    message: 'Не удалось отправить код подтверждения. Попробуйте позже.',
                    code: 'VERIFICATION_EMAIL_FAILED',
                });
            }

            return sendGenericPendingResponse(res, email);
        } catch (error) {
            console.error('Verified registration request failed:', error);
            return res.status(500).json({ message: 'Ошибка сервера при регистрации.' });
        }
    });

    app.post('/register/resend', async (req, res) => {
        try {
            await ensureSchema();
            const email = normalizeEmail(req.body?.email);
            if (!emailLooksValid(email)) return res.status(400).json({ message: 'Укажите корректный email.' });
            if (!(await enforceRate(req, res, email, 'resend'))) return;

            const [rows] = await db.query(
                'SELECT email, username, resend_available_at FROM pending_registrations WHERE email = ? LIMIT 1',
                [email]
            );
            if (rows.length === 0) {
                return res.json({
                    message: 'Если регистрация с такой почтой ожидает подтверждения, новый код отправлен.',
                    verificationRequired: true,
                    resendAfterSeconds: RESEND_COOLDOWN_SECONDS,
                });
            }

            const resendAt = new Date(rows[0].resend_available_at).getTime();
            if (resendAt > Date.now()) {
                const retryAfterSeconds = Math.max(1, Math.ceil((resendAt - Date.now()) / 1000));
                res.setHeader('Retry-After', String(retryAfterSeconds));
                return res.status(429).json({
                    message: `Новый код можно запросить через ${retryAfterSeconds} сек.`,
                    code: 'RESEND_COOLDOWN',
                    retryAfterSeconds,
                });
            }

            if (!transporter) {
                return res.status(503).json({ message: 'Сервер почты временно недоступен.', code: 'SMTP_NOT_CONFIGURED' });
            }

            const code = crypto.randomInt(100000, 1000000).toString();
            const codeHash = hashCode(email, code);
            await db.query(
                'UPDATE pending_registrations SET code_hash = ?, code_expires_at = ?, resend_available_at = ?, verify_attempts = 0 WHERE email = ?',
                [codeHash, toMysqlDate(nowPlusSeconds(EMAIL_CODE_TTL_SECONDS)), toMysqlDate(nowPlusSeconds(RESEND_COOLDOWN_SECONDS)), email]
            );
            await sendVerificationEmail({ email, username: rows[0].username, code });
            return sendGenericPendingResponse(res, email, 200);
        } catch (error) {
            console.error('Registration resend failed:', error);
            return res.status(500).json({ message: 'Не удалось отправить новый код.' });
        }
    });

    app.post('/register/verify', async (req, res) => {
        const email = normalizeEmail(req.body?.email);
        const code = String(req.body?.code || '').replace(/\D/g, '').slice(0, 6);
        if (!emailLooksValid(email) || code.length !== 6) {
            return res.status(400).json({ message: 'Укажите email и 6-значный код.', code: 'INVALID_VERIFICATION_INPUT' });
        }

        try {
            await ensureSchema();
            if (!(await enforceRate(req, res, email, 'verify'))) return;

            const connection = await db.getConnection();
            try {
                await connection.beginTransaction();
                const [rows] = await connection.query(
                    'SELECT * FROM pending_registrations WHERE email = ? LIMIT 1 FOR UPDATE',
                    [email]
                );
                if (rows.length === 0) {
                    await connection.rollback();
                    return res.status(404).json({ message: 'Регистрация не найдена или срок подтверждения истёк.', code: 'PENDING_NOT_FOUND' });
                }

                const pending = rows[0];
                if (new Date(pending.code_expires_at).getTime() <= Date.now()) {
                    await connection.rollback();
                    return res.status(410).json({ message: 'Код истёк. Запросите новый.', code: 'CODE_EXPIRED' });
                }
                if (Number(pending.verify_attempts || 0) >= 10) {
                    await connection.rollback();
                    return res.status(429).json({ message: 'Слишком много неверных кодов. Запросите новый код.', code: 'TOO_MANY_CODE_ATTEMPTS' });
                }

                const expectedHash = hashCode(email, code);
                if (!secureEquals(expectedHash, pending.code_hash)) {
                    await connection.query(
                        'UPDATE pending_registrations SET verify_attempts = verify_attempts + 1 WHERE email = ?',
                        [email]
                    );
                    await connection.commit();
                    return res.status(400).json({ message: 'Неверный код подтверждения.', code: 'CODE_INVALID' });
                }

                const [emailRows] = await connection.query('SELECT id FROM users WHERE LOWER(email) = ? LIMIT 1', [email]);
                if (emailRows.length > 0) {
                    await connection.query('DELETE FROM pending_registrations WHERE email = ?', [email]);
                    await connection.commit();
                    return res.status(409).json({ message: 'Аккаунт с такой почтой уже существует.', code: 'EMAIL_EXISTS' });
                }
                if (pending.github_username) {
                    const [githubRows] = await connection.query('SELECT id FROM users WHERE github_username = ? LIMIT 1', [pending.github_username]);
                    if (githubRows.length > 0) {
                        await connection.rollback();
                        return res.status(409).json({ message: 'Этот GitHub Username уже занят.', code: 'GITHUB_EXISTS' });
                    }
                }
                if (pending.user_tag) {
                    const [tagRows] = await connection.query('SELECT id FROM users WHERE user_tag = ? LIMIT 1', [pending.user_tag]);
                    if (tagRows.length > 0) {
                        await connection.rollback();
                        return res.status(409).json({ message: 'Этот @username уже занят.', code: 'TAG_EXISTS' });
                    }
                }

                const [result] = await connection.query(
                    'INSERT INTO users (username, email, password, github_username, gitlab_username, user_tag, avatar) VALUES (?, ?, ?, ?, ?, ?, ?)',
                    [
                        pending.username,
                        email,
                        pending.password_hash,
                        pending.github_username || null,
                        pending.gitlab_username || pending.github_username || null,
                        pending.user_tag || null,
                        '/uploads/avatar-default.png',
                    ]
                );
                await connection.query('DELETE FROM pending_registrations WHERE email = ?', [email]);
                await connection.commit();

                if (transporter) {
                    void transporter.sendMail({
                        from: process.env.SMTP_FROM || process.env.SMTP_USER,
                        to: email,
                        subject: 'Добро пожаловать в SocialBIRD',
                        text: `Здравствуйте, ${pending.username}! Ваш аккаунт SocialBIRD подтверждён и готов к работе.`,
                    }).catch((error) => console.warn('Welcome email failed:', error.message));
                }

                return res.status(201).json({
                    message: 'Почта подтверждена. Аккаунт создан — теперь можно войти.',
                    verified: true,
                    userId: result.insertId,
                });
            } catch (error) {
                await connection.rollback().catch(() => {});
                throw error;
            } finally {
                connection.release();
            }
        } catch (error) {
            console.error('Registration verification failed:', error);
            return res.status(500).json({ message: 'Не удалось подтвердить регистрацию.' });
        }
    });

    ensureSchema().catch((error) => console.error('Registration verification schema failed:', error.message));
    console.log('Email-verified registration with anti-bot rate limits is enabled.');
};

module.exports = { registerEmailVerifiedRegistration };
