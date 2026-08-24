const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const jwt = require('jsonwebtoken');
const express = require('express');

const EMAIL_CODE_TTL_MS = 10 * 60 * 1000;
const EMAIL_CODE_COOLDOWN_SECONDS = 60;
const CINEMA_UPLOAD_CHUNK_BYTES = 8 * 1024 * 1024;
const CINEMA_MAX_UPLOAD_BYTES = 16 * 1024 * 1024 * 1024;
const PROFILE_RESTRICTED_MESSAGE = 'Данный пользователь ограничил круг лиц';

const toMysqlDate = (date) => date.toISOString().slice(0, 19).replace('T', ' ');
const randomCode = () => crypto.randomInt(100000, 1000000).toString();
const safeName = (value) => path.basename(String(value || 'file')).replace(/[\u0000-\u001f<>:"/\\|?*]/g, '_').trim().slice(0, 180) || 'file';
const hashWithSecret = (secret, value) => crypto.createHmac('sha256', secret).update(String(value)).digest('hex');

const registerSocialBirdFinalPlatform = ({ app, db, verifyToken, transporter, notifyClients }) => {
    const jwtSecret = String(process.env.JWT_SECRET || '');
    if (!jwtSecret) throw new Error('JWT_SECRET is required for SocialBIRD final platform');

    let schemaPromise = null;
    const ensureSchema = async () => {
        if (!schemaPromise) {
            schemaPromise = (async () => {
                await db.query(`CREATE TABLE IF NOT EXISTS account_email_change_challenges (
                    challenge_id CHAR(64) NOT NULL PRIMARY KEY,
                    user_id BIGINT NOT NULL,
                    old_email VARCHAR(320) NOT NULL,
                    new_email VARCHAR(320) NOT NULL,
                    old_code_hash CHAR(64) NOT NULL,
                    new_code_hash CHAR(64) NOT NULL,
                    old_confirmed TINYINT(1) NOT NULL DEFAULT 0,
                    old_attempts INT UNSIGNED NOT NULL DEFAULT 0,
                    new_attempts INT UNSIGNED NOT NULL DEFAULT 0,
                    expires_at DATETIME NOT NULL,
                    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    KEY idx_email_change_user (user_id, created_at),
                    KEY idx_email_change_expiry (expires_at)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

                await db.query(`CREATE TABLE IF NOT EXISTS chat_folders (
                    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
                    user_id BIGINT NOT NULL,
                    name VARCHAR(80) NOT NULL,
                    sort_order INT NOT NULL DEFAULT 0,
                    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    UNIQUE KEY uq_chat_folder_name (user_id, name),
                    KEY idx_chat_folder_user (user_id, sort_order, id)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

                await db.query(`CREATE TABLE IF NOT EXISTS chat_folder_items (
                    folder_id BIGINT UNSIGNED NOT NULL,
                    user_id BIGINT NOT NULL,
                    scope_name VARCHAR(16) NOT NULL,
                    target_id BIGINT NOT NULL,
                    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    PRIMARY KEY (folder_id, scope_name, target_id),
                    KEY idx_chat_folder_items_user (user_id, scope_name, target_id),
                    CONSTRAINT fk_chat_folder_items_folder FOREIGN KEY (folder_id) REFERENCES chat_folders(id) ON DELETE CASCADE
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

                await db.query(`CREATE TABLE IF NOT EXISTS socialbird_deleted_users (
                    user_id BIGINT NOT NULL PRIMARY KEY,
                    deleted_by BIGINT NOT NULL,
                    original_username VARCHAR(255) NULL,
                    original_email_hash CHAR(64) NULL,
                    reason VARCHAR(500) NULL,
                    deleted_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

                await db.query(`CREATE TABLE IF NOT EXISTS news_first_seen (
                    news_key CHAR(64) NOT NULL PRIMARY KEY,
                    first_seen_at DATETIME NOT NULL,
                    source_time DATETIME NULL,
                    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

                await db.query(`CREATE TABLE IF NOT EXISTS cinema_people (
                    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
                    name VARCHAR(180) NOT NULL,
                    photo_url VARCHAR(600) NULL,
                    birth_date DATE NULL,
                    bio TEXT NULL,
                    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    KEY idx_cinema_people_name (name)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

                await db.query(`CREATE TABLE IF NOT EXISTS cinema_titles (
                    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
                    title VARCHAR(255) NOT NULL,
                    description TEXT NULL,
                    poster_url VARCHAR(600) NULL,
                    media_url VARCHAR(700) NULL,
                    content_type VARCHAR(16) NOT NULL DEFAULT 'movie',
                    genres VARCHAR(500) NULL,
                    release_year INT NULL,
                    release_end_year INT NULL,
                    duration_minutes INT NULL,
                    country VARCHAR(120) NULL,
                    age_rating VARCHAR(40) NULL,
                    created_by BIGINT NULL,
                    is_public TINYINT(1) NOT NULL DEFAULT 1,
                    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    KEY idx_cinema_title_name (title),
                    KEY idx_cinema_title_public (is_public, release_year)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

                await db.query(`CREATE TABLE IF NOT EXISTS cinema_title_people (
                    title_id BIGINT UNSIGNED NOT NULL,
                    person_id BIGINT UNSIGNED NOT NULL,
                    role_name VARCHAR(40) NOT NULL,
                    character_name VARCHAR(180) NULL,
                    sort_order INT NOT NULL DEFAULT 0,
                    PRIMARY KEY (title_id, person_id, role_name),
                    CONSTRAINT fk_cinema_tp_title FOREIGN KEY (title_id) REFERENCES cinema_titles(id) ON DELETE CASCADE,
                    CONSTRAINT fk_cinema_tp_person FOREIGN KEY (person_id) REFERENCES cinema_people(id) ON DELETE CASCADE
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

                await db.query(`CREATE TABLE IF NOT EXISTS cinema_episodes (
                    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
                    title_id BIGINT UNSIGNED NOT NULL,
                    season_number INT NOT NULL,
                    episode_number INT NOT NULL,
                    episode_title VARCHAR(255) NULL,
                    media_url VARCHAR(700) NULL,
                    duration_minutes INT NULL,
                    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    UNIQUE KEY uq_cinema_episode (title_id, season_number, episode_number),
                    CONSTRAINT fk_cinema_episode_title FOREIGN KEY (title_id) REFERENCES cinema_titles(id) ON DELETE CASCADE
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

                await db.query(`CREATE TABLE IF NOT EXISTS cinema_rooms (
                    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
                    owner_id BIGINT NOT NULL,
                    room_name VARCHAR(180) NOT NULL,
                    visibility VARCHAR(16) NOT NULL DEFAULT 'public',
                    invite_token CHAR(64) NOT NULL UNIQUE,
                    chat_enabled TINYINT(1) NOT NULL DEFAULT 1,
                    source_type VARCHAR(16) NOT NULL DEFAULT 'library',
                    title_id BIGINT UNSIGNED NULL,
                    episode_id BIGINT UNSIGNED NULL,
                    media_url VARCHAR(700) NULL,
                    playback_position DOUBLE NOT NULL DEFAULT 0,
                    playback_state VARCHAR(16) NOT NULL DEFAULT 'paused',
                    playback_updated_at DATETIME NOT NULL,
                    is_active TINYINT(1) NOT NULL DEFAULT 1,
                    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    KEY idx_cinema_room_public (visibility, is_active, created_at),
                    KEY idx_cinema_room_owner (owner_id, created_at)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

                await db.query(`CREATE TABLE IF NOT EXISTS cinema_room_messages (
                    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
                    room_id BIGINT UNSIGNED NOT NULL,
                    user_id BIGINT NOT NULL,
                    message TEXT NOT NULL,
                    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    KEY idx_cinema_room_message (room_id, id),
                    CONSTRAINT fk_cinema_room_message_room FOREIGN KEY (room_id) REFERENCES cinema_rooms(id) ON DELETE CASCADE
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

                await db.query(`CREATE TABLE IF NOT EXISTS cinema_upload_sessions (
                    upload_id CHAR(36) NOT NULL PRIMARY KEY,
                    user_id BIGINT NOT NULL,
                    original_name VARCHAR(255) NOT NULL,
                    mime_type VARCHAR(255) NULL,
                    file_size BIGINT UNSIGNED NOT NULL,
                    chunk_size INT UNSIGNED NOT NULL,
                    total_chunks INT UNSIGNED NOT NULL,
                    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                    expires_at DATETIME NOT NULL,
                    KEY idx_cinema_upload_user (user_id, updated_at),
                    KEY idx_cinema_upload_expiry (expires_at)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
            })().catch((error) => {
                schemaPromise = null;
                throw error;
            });
        }
        return schemaPromise;
    };

    const auth = (req, res, next) => verifyToken(req, res, next);
    const getUserId = (req) => Number(req.user?.id || req.userId || req.user?.userId || 0);

    const verifyDesktopAdmin = async (req, res, next) => {
        const token = String(req.header('Authorization') || '').replace(/^Bearer\s+/i, '').trim();
        if (!token) return res.status(401).json({ message: 'Требуется desktop-сессия администратора.' });
        try {
            const decoded = jwt.verify(token, jwtSecret);
            if (decoded.scope !== 'admin-desktop' || decoded.role !== 'admin') return res.status(403).json({ message: 'Недостаточно прав.' });
            const [rows] = await db.query('SELECT id, role, isBlocked FROM users WHERE id = ? LIMIT 1', [decoded.id]);
            if (!rows.length || String(rows[0].role) !== 'admin' || String(rows[0].isBlocked || '') === 'заблокирован') return res.status(403).json({ message: 'Права администратора отозваны.' });
            req.desktopAdmin = rows[0];
            next();
        } catch {
            return res.status(401).json({ message: 'Desktop-сессия недействительна или истекла.' });
        }
    };

    app.get('/socialbird-final/status', async (_req, res) => {
        await ensureSchema();
        res.json({
            enabled: true,
            strictPrivacy: true,
            emailChangeVerification: true,
            chatFolders: true,
            groupOwnerClear: true,
            adminUserDelete: true,
            stableNewsTime: true,
            cinemaParty: true,
            cinemaResumableUpload: true,
            cinemaChunkBytes: CINEMA_UPLOAD_CHUNK_BYTES,
            cinemaMaxUploadBytes: CINEMA_MAX_UPLOAD_BYTES,
            videoRecompression: false,
        });
    });

    // ----- email change: verify both the current and new addresses -----
    app.post('/account/email-change/start', auth, async (req, res) => {
        await ensureSchema();
        const userId = getUserId(req);
        const newEmail = String(req.body?.newEmail || '').trim().toLowerCase();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail) || newEmail.length > 320) return res.status(400).json({ message: 'Некорректный email.' });
        if (!transporter) return res.status(503).json({ message: 'Отправка почты сейчас не настроена.' });

        const [userRows] = await db.query('SELECT id, email FROM users WHERE id = ? LIMIT 1', [userId]);
        if (!userRows.length) return res.status(404).json({ message: 'Пользователь не найден.' });
        const oldEmail = String(userRows[0].email || '').trim().toLowerCase();
        if (!oldEmail) return res.status(400).json({ message: 'У аккаунта отсутствует текущая почта.' });
        if (oldEmail === newEmail) return res.status(400).json({ message: 'Новая почта совпадает с текущей.' });
        const [exists] = await db.query('SELECT id FROM users WHERE LOWER(email) = ? AND id <> ? LIMIT 1', [newEmail, userId]);
        if (exists.length) return res.status(409).json({ message: 'Эта почта уже используется другим аккаунтом.' });

        const [recent] = await db.query('SELECT created_at FROM account_email_change_challenges WHERE user_id = ? ORDER BY created_at DESC LIMIT 1', [userId]);
        if (recent.length) {
            const elapsed = Math.floor((Date.now() - new Date(recent[0].created_at).getTime()) / 1000);
            if (elapsed >= 0 && elapsed < EMAIL_CODE_COOLDOWN_SECONDS) return res.status(429).json({ message: `Повторный запрос можно выполнить через ${EMAIL_CODE_COOLDOWN_SECONDS - elapsed} сек.` });
        }

        await db.query('DELETE FROM account_email_change_challenges WHERE user_id = ? OR expires_at < NOW()', [userId]);
        const challengeId = crypto.randomBytes(32).toString('hex');
        const oldCode = randomCode();
        const newCode = randomCode();
        const expires = new Date(Date.now() + EMAIL_CODE_TTL_MS);
        await db.query(`INSERT INTO account_email_change_challenges
            (challenge_id, user_id, old_email, new_email, old_code_hash, new_code_hash, expires_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)`, [
            challengeId,
            userId,
            oldEmail,
            newEmail,
            hashWithSecret(jwtSecret, `email-old:${challengeId}:${oldCode}`),
            hashWithSecret(jwtSecret, `email-new:${challengeId}:${newCode}`),
            toMysqlDate(expires),
        ]);

        try {
            await transporter.sendMail({ from: process.env.SMTP_FROM || process.env.SMTP_USER, to: oldEmail, subject: 'Подтверждение смены почты SocialBIRD', text: `Код подтверждения для текущей почты: ${oldCode}\nКод действует 10 минут.` });
            await transporter.sendMail({ from: process.env.SMTP_FROM || process.env.SMTP_USER, to: newEmail, subject: 'Подтверждение новой почты SocialBIRD', text: `Код подтверждения новой почты: ${newCode}\nКод действует 10 минут.` });
        } catch (error) {
            await db.query('DELETE FROM account_email_change_challenges WHERE challenge_id = ?', [challengeId]);
            return res.status(502).json({ message: 'Не удалось отправить письма подтверждения.' });
        }

        res.json({ challengeId, expiresInSeconds: Math.floor(EMAIL_CODE_TTL_MS / 1000), oldEmailHint: oldEmail.replace(/^(.{1,2}).*(@.*)$/, '$1***$2'), newEmailHint: newEmail.replace(/^(.{1,2}).*(@.*)$/, '$1***$2') });
    });

    app.post('/account/email-change/confirm-old', auth, async (req, res) => {
        await ensureSchema();
        const userId = getUserId(req);
        const challengeId = String(req.body?.challengeId || '');
        const code = String(req.body?.code || '').replace(/\D/g, '').slice(0, 6);
        const [rows] = await db.query('SELECT * FROM account_email_change_challenges WHERE challenge_id = ? AND user_id = ? LIMIT 1', [challengeId, userId]);
        if (!rows.length) return res.status(404).json({ message: 'Запрос смены почты не найден.' });
        const challenge = rows[0];
        if (new Date(challenge.expires_at).getTime() < Date.now()) return res.status(410).json({ message: 'Коды истекли. Запросите новые.' });
        if (Number(challenge.old_attempts) >= 8) return res.status(429).json({ message: 'Слишком много неверных попыток.' });
        const expected = hashWithSecret(jwtSecret, `email-old:${challengeId}:${code}`);
        if (!crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(challenge.old_code_hash))) {
            await db.query('UPDATE account_email_change_challenges SET old_attempts = old_attempts + 1 WHERE challenge_id = ?', [challengeId]);
            return res.status(400).json({ message: 'Неверный код текущей почты.' });
        }
        await db.query('UPDATE account_email_change_challenges SET old_confirmed = 1 WHERE challenge_id = ?', [challengeId]);
        res.json({ confirmed: true });
    });

    app.post('/account/email-change/confirm-new', auth, async (req, res) => {
        await ensureSchema();
        const userId = getUserId(req);
        const challengeId = String(req.body?.challengeId || '');
        const code = String(req.body?.code || '').replace(/\D/g, '').slice(0, 6);
        const [rows] = await db.query('SELECT * FROM account_email_change_challenges WHERE challenge_id = ? AND user_id = ? LIMIT 1', [challengeId, userId]);
        if (!rows.length) return res.status(404).json({ message: 'Запрос смены почты не найден.' });
        const challenge = rows[0];
        if (!challenge.old_confirmed) return res.status(409).json({ message: 'Сначала подтвердите текущую почту.' });
        if (new Date(challenge.expires_at).getTime() < Date.now()) return res.status(410).json({ message: 'Коды истекли. Запросите новые.' });
        if (Number(challenge.new_attempts) >= 8) return res.status(429).json({ message: 'Слишком много неверных попыток.' });
        const expected = hashWithSecret(jwtSecret, `email-new:${challengeId}:${code}`);
        if (!crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(challenge.new_code_hash))) {
            await db.query('UPDATE account_email_change_challenges SET new_attempts = new_attempts + 1 WHERE challenge_id = ?', [challengeId]);
            return res.status(400).json({ message: 'Неверный код новой почты.' });
        }
        const [exists] = await db.query('SELECT id FROM users WHERE LOWER(email) = LOWER(?) AND id <> ? LIMIT 1', [challenge.new_email, userId]);
        if (exists.length) return res.status(409).json({ message: 'Эта почта уже занята.' });
        await db.query('UPDATE users SET email = ? WHERE id = ?', [challenge.new_email, userId]);
        await db.query('DELETE FROM account_email_change_challenges WHERE challenge_id = ?', [challengeId]);
        if (transporter) {
            transporter.sendMail({ from: process.env.SMTP_FROM || process.env.SMTP_USER, to: challenge.old_email, subject: 'Почта SocialBIRD изменена', text: `Почта вашего аккаунта SocialBIRD была изменена на ${challenge.new_email}. Если это были не вы, немедленно смените пароль и обратитесь к администратору.` }).catch(() => undefined);
        }
        res.json({ changed: true, email: challenge.new_email });
    });

    // ----- chat folders -----
    app.get('/chat-folders', auth, async (req, res) => {
        await ensureSchema();
        const userId = getUserId(req);
        const [folders] = await db.query('SELECT id, name, sort_order, created_at FROM chat_folders WHERE user_id = ? ORDER BY sort_order, id', [userId]);
        const [items] = await db.query('SELECT folder_id, scope_name, target_id FROM chat_folder_items WHERE user_id = ? ORDER BY created_at', [userId]);
        res.json({ folders, items });
    });

    app.post('/chat-folders', auth, async (req, res) => {
        await ensureSchema();
        const userId = getUserId(req);
        const name = String(req.body?.name || '').trim().slice(0, 80);
        if (!name) return res.status(400).json({ message: 'Введите название папки.' });
        try {
            const [result] = await db.query('INSERT INTO chat_folders (user_id, name, sort_order) VALUES (?, ?, ?)', [userId, name, Number(req.body?.sortOrder || 0)]);
            const [rows] = await db.query('SELECT id, name, sort_order, created_at FROM chat_folders WHERE id = ?', [result.insertId]);
            res.status(201).json(rows[0]);
        } catch (error) {
            if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ message: 'Папка с таким названием уже существует.' });
            throw error;
        }
    });

    app.patch('/chat-folders/:id', auth, async (req, res) => {
        await ensureSchema();
        const userId = getUserId(req);
        const folderId = Number(req.params.id);
        const name = String(req.body?.name || '').trim().slice(0, 80);
        if (!name) return res.status(400).json({ message: 'Введите название папки.' });
        const [result] = await db.query('UPDATE chat_folders SET name = ?, sort_order = ? WHERE id = ? AND user_id = ?', [name, Number(req.body?.sortOrder || 0), folderId, userId]);
        if (!result.affectedRows) return res.status(404).json({ message: 'Папка не найдена.' });
        res.json({ updated: true });
    });

    app.delete('/chat-folders/:id', auth, async (req, res) => {
        await ensureSchema();
        const [result] = await db.query('DELETE FROM chat_folders WHERE id = ? AND user_id = ?', [Number(req.params.id), getUserId(req)]);
        if (!result.affectedRows) return res.status(404).json({ message: 'Папка не найдена.' });
        res.json({ deleted: true });
    });

    app.put('/chat-folders/:id/items', auth, async (req, res) => {
        await ensureSchema();
        const userId = getUserId(req);
        const folderId = Number(req.params.id);
        const scope = req.body?.scope === 'group' ? 'group' : req.body?.scope === 'personal' ? 'personal' : null;
        const targetId = Number(req.body?.targetId);
        if (!scope || !targetId) return res.status(400).json({ message: 'Некорректный чат.' });
        const [folders] = await db.query('SELECT id FROM chat_folders WHERE id = ? AND user_id = ?', [folderId, userId]);
        if (!folders.length) return res.status(404).json({ message: 'Папка не найдена.' });
        await db.query(`INSERT INTO chat_folder_items (folder_id, user_id, scope_name, target_id)
            VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE user_id = VALUES(user_id)`, [folderId, userId, scope, targetId]);
        res.json({ added: true });
    });

    app.delete('/chat-folders/:id/items/:scope/:targetId', auth, async (req, res) => {
        await ensureSchema();
        const userId = getUserId(req);
        await db.query(`DELETE cfi FROM chat_folder_items cfi JOIN chat_folders cf ON cf.id = cfi.folder_id
            WHERE cfi.folder_id = ? AND cfi.scope_name = ? AND cfi.target_id = ? AND cf.user_id = ?`, [Number(req.params.id), String(req.params.scope), Number(req.params.targetId), userId]);
        res.json({ removed: true });
    });

    // ----- friendship removal with schema discovery -----
    const removeFriendship = async (userId, friendId) => {
        const candidates = [
            ['friends', 'user_id', 'friend_id'],
            ['friends', 'user_id_1', 'user_id_2'],
            ['friends', 'user1_id', 'user2_id'],
            ['friendships', 'user_id', 'friend_id'],
            ['friendships', 'user_id_1', 'user_id_2'],
            ['friendships', 'requester_id', 'addressee_id'],
        ];
        for (const [table, left, right] of candidates) {
            try {
                const [columns] = await db.query(`SHOW COLUMNS FROM \`${table}\``);
                const names = new Set(columns.map((column) => column.Field));
                if (!names.has(left) || !names.has(right)) continue;
                const [result] = await db.query(`DELETE FROM \`${table}\` WHERE (\`${left}\` = ? AND \`${right}\` = ?) OR (\`${left}\` = ? AND \`${right}\` = ?)`, [userId, friendId, friendId, userId]);
                if (result.affectedRows) return true;
            } catch {}
        }
        return false;
    };

    app.delete('/friends/:friendId/v2', auth, async (req, res) => {
        const userId = getUserId(req);
        const friendId = Number(req.params.friendId);
        if (!friendId || friendId === userId) return res.status(400).json({ message: 'Некорректный пользователь.' });
        const removed = await removeFriendship(userId, friendId);
        if (!removed) return res.status(404).json({ message: 'Связь дружбы не найдена.' });
        if (notifyClients) {
            try { notifyClients([userId, friendId], { type: 'FRIENDSHIP_REMOVED', data: { userId, friendId } }); } catch {}
        }
        res.json({ removed: true });
    });

    app.get('/relationship/:username', auth, async (req, res) => {
        const userId = getUserId(req);
        const [targetRows] = await db.query('SELECT id, username FROM users WHERE username = ? LIMIT 1', [String(req.params.username)]);
        if (!targetRows.length) return res.status(404).json({ message: 'Пользователь не найден.' });
        const targetId = Number(targetRows[0].id);
        let isFriend = false;
        for (const [table, left, right] of [['friends', 'user_id', 'friend_id'], ['friends', 'user_id_1', 'user_id_2'], ['friends', 'user1_id', 'user2_id'], ['friendships', 'user_id', 'friend_id'], ['friendships', 'user_id_1', 'user_id_2'], ['friendships', 'requester_id', 'addressee_id']]) {
            try {
                const [columns] = await db.query(`SHOW COLUMNS FROM \`${table}\``);
                const names = new Set(columns.map((column) => column.Field));
                if (!names.has(left) || !names.has(right)) continue;
                const [rows] = await db.query(`SELECT 1 FROM \`${table}\` WHERE (\`${left}\` = ? AND \`${right}\` = ?) OR (\`${left}\` = ? AND \`${right}\` = ?) LIMIT 1`, [userId, targetId, targetId, userId]);
                if (rows.length) { isFriend = true; break; }
            } catch {}
        }
        res.json({ targetId, username: targetRows[0].username, isFriend });
    });

    // ----- creator-only group history wipe -----
    app.delete('/group-chats/:id/messages/all-v2', auth, async (req, res) => {
        const userId = getUserId(req);
        const groupId = Number(req.params.id);
        const [groups] = await db.query('SELECT id, creator_id FROM group_chats WHERE id = ? LIMIT 1', [groupId]);
        if (!groups.length) return res.status(404).json({ message: 'Группа не найдена.' });
        if (Number(groups[0].creator_id) !== userId) return res.status(403).json({ message: 'Очистить чат у всех может только создатель группы.' });
        await db.query('DELETE FROM group_chat_messages WHERE group_chat_id = ?', [groupId]);
        const [members] = await db.query('SELECT user_id FROM group_chat_members WHERE group_chat_id = ?', [groupId]);
        const memberIds = members.map((row) => Number(row.user_id)).filter(Number.isFinite);
        if (notifyClients) {
            try { notifyClients(memberIds, { type: 'GROUP_CHAT_CLEARED', data: { groupChatId: groupId, clearedBy: userId } }); } catch {}
        }
        res.json({ cleared: true });
    });

    // ----- Admin Desktop v2 -----
    app.get('/admin/v2/users', verifyDesktopAdmin, async (req, res) => {
        await ensureSchema();
        const search = String(req.query.search || '').trim();
        const like = `%${search}%`;
        const [rows] = await db.query(`SELECT id, username, email, role, isBlocked, avatar
            FROM users
            WHERE (? = '' OR username LIKE ? OR email LIKE ?)
              AND id NOT IN (SELECT user_id FROM socialbird_deleted_users)
            ORDER BY id DESC LIMIT 500`, [search, like, like]);
        res.json(rows);
    });

    app.post('/admin/v2/users/:id/block', verifyDesktopAdmin, async (req, res) => {
        const targetId = Number(req.params.id);
        const reason = String(req.body?.reason || 'Нарушение правил SocialBIRD').trim().slice(0, 500);
        if (targetId === Number(req.desktopAdmin.id)) return res.status(400).json({ message: 'Нельзя заблокировать собственный admin-аккаунт.' });
        const [result] = await db.query("UPDATE users SET isBlocked = 'заблокирован' WHERE id = ?", [targetId]);
        if (!result.affectedRows) return res.status(404).json({ message: 'Пользователь не найден.' });
        res.json({ blocked: true, reason });
    });

    app.delete('/admin/v2/users/:id/block', verifyDesktopAdmin, async (req, res) => {
        const targetId = Number(req.params.id);
        const [result] = await db.query("UPDATE users SET isBlocked = NULL WHERE id = ?", [targetId]);
        if (!result.affectedRows) return res.status(404).json({ message: 'Пользователь не найден.' });
        res.json({ blocked: false });
    });

    app.delete('/admin/v2/users/:id', verifyDesktopAdmin, async (req, res) => {
        await ensureSchema();
        const targetId = Number(req.params.id);
        const reason = String(req.body?.reason || 'Удалено администратором').trim().slice(0, 500);
        if (targetId === Number(req.desktopAdmin.id)) return res.status(400).json({ message: 'Нельзя удалить собственный admin-аккаунт.' });
        const [rows] = await db.query('SELECT id, username, email FROM users WHERE id = ? LIMIT 1', [targetId]);
        if (!rows.length) return res.status(404).json({ message: 'Пользователь не найден.' });
        const original = rows[0];
        const deletedUsername = `deleted_user_${targetId}_${crypto.randomBytes(4).toString('hex')}`;
        const deletedEmail = `deleted_${targetId}_${crypto.randomBytes(8).toString('hex')}@deleted.invalid`;
        const randomPassword = crypto.randomBytes(48).toString('hex');
        await db.query(`INSERT INTO socialbird_deleted_users (user_id, deleted_by, original_username, original_email_hash, reason)
            VALUES (?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE deleted_by = VALUES(deleted_by), reason = VALUES(reason), deleted_at = CURRENT_TIMESTAMP`, [targetId, req.desktopAdmin.id, original.username, crypto.createHash('sha256').update(String(original.email || '')).digest('hex'), reason]);
        await db.query("UPDATE users SET username = ?, email = ?, password = ?, avatar = NULL, role = 'user', isBlocked = 'заблокирован' WHERE id = ?", [deletedUsername, deletedEmail, randomPassword, targetId]);
        res.json({ deleted: true, userId: targetId });
    });

    // ----- CinemaParty library -----
    app.get('/cinema/library', auth, async (req, res) => {
        await ensureSchema();
        const query = String(req.query.q || '').trim();
        const type = String(req.query.type || '').trim();
        const genre = String(req.query.genre || '').trim();
        const year = Number(req.query.year || 0);
        const [rows] = await db.query(`SELECT id, title, description, poster_url, content_type, genres, release_year, release_end_year,
                duration_minutes, country, age_rating
            FROM cinema_titles
            WHERE is_public = 1
              AND (? = '' OR title LIKE ?)
              AND (? = '' OR content_type = ?)
              AND (? = '' OR genres LIKE ?)
              AND (? = 0 OR release_year = ? OR (? BETWEEN release_year AND COALESCE(release_end_year, release_year)))
            ORDER BY created_at DESC LIMIT 300`, [query, `%${query}%`, type, type, genre, `%${genre}%`, year, year, year]);
        res.json(rows);
    });

    app.get('/cinema/library/:id', auth, async (req, res) => {
        await ensureSchema();
        const [titles] = await db.query('SELECT * FROM cinema_titles WHERE id = ? AND is_public = 1 LIMIT 1', [Number(req.params.id)]);
        if (!titles.length) return res.status(404).json({ message: 'Фильм или сериал не найден.' });
        const [people] = await db.query(`SELECT p.id, p.name, p.photo_url, tp.role_name, tp.character_name
            FROM cinema_title_people tp JOIN cinema_people p ON p.id = tp.person_id
            WHERE tp.title_id = ? ORDER BY tp.sort_order, p.name`, [Number(req.params.id)]);
        const [episodes] = await db.query('SELECT id, season_number, episode_number, episode_title, duration_minutes FROM cinema_episodes WHERE title_id = ? ORDER BY season_number, episode_number', [Number(req.params.id)]);
        res.json({ ...titles[0], people, episodes });
    });

    app.get('/cinema/people/:id', auth, async (req, res) => {
        await ensureSchema();
        const [people] = await db.query('SELECT * FROM cinema_people WHERE id = ? LIMIT 1', [Number(req.params.id)]);
        if (!people.length) return res.status(404).json({ message: 'Персона не найдена.' });
        const [filmography] = await db.query(`SELECT t.id, t.title, t.poster_url, t.release_year, tp.role_name, tp.character_name
            FROM cinema_title_people tp JOIN cinema_titles t ON t.id = tp.title_id
            WHERE tp.person_id = ? AND t.is_public = 1 ORDER BY t.release_year DESC, t.title`, [Number(req.params.id)]);
        res.json({ ...people[0], filmography });
    });

    app.get('/cinema/rooms', auth, async (req, res) => {
        await ensureSchema();
        const userId = getUserId(req);
        const mine = String(req.query.mine || '') === '1';
        const [rows] = await db.query(`SELECT r.id, r.owner_id, r.room_name, r.visibility, r.chat_enabled, r.source_type,
                r.title_id, r.episode_id, r.playback_position, r.playback_state, r.playback_updated_at, r.created_at,
                u.username AS owner_username, t.title AS library_title, t.poster_url
            FROM cinema_rooms r
            LEFT JOIN users u ON u.id = r.owner_id
            LEFT JOIN cinema_titles t ON t.id = r.title_id
            WHERE r.is_active = 1 AND ((? = 1 AND r.owner_id = ?) OR (? = 0 AND r.visibility = 'public'))
            ORDER BY r.created_at DESC LIMIT 200`, [mine ? 1 : 0, userId, mine ? 1 : 0]);
        res.json(rows);
    });

    app.post('/cinema/rooms', auth, async (req, res) => {
        await ensureSchema();
        const userId = getUserId(req);
        const roomName = String(req.body?.roomName || '').trim().slice(0, 180);
        if (!roomName) return res.status(400).json({ message: 'Введите название комнаты.' });
        const visibility = req.body?.visibility === 'private' ? 'private' : 'public';
        const sourceType = req.body?.sourceType === 'upload' ? 'upload' : 'library';
        const titleId = req.body?.titleId ? Number(req.body.titleId) : null;
        const episodeId = req.body?.episodeId ? Number(req.body.episodeId) : null;
        const mediaUrl = req.body?.mediaUrl ? String(req.body.mediaUrl).slice(0, 700) : null;
        if (sourceType === 'library' && !titleId) return res.status(400).json({ message: 'Выберите фильм или сериал из библиотеки.' });
        if (sourceType === 'upload' && !mediaUrl) return res.status(400).json({ message: 'Сначала загрузите видео.' });
        const inviteToken = crypto.randomBytes(32).toString('hex');
        const [result] = await db.query(`INSERT INTO cinema_rooms
            (owner_id, room_name, visibility, invite_token, chat_enabled, source_type, title_id, episode_id, media_url, playback_updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`, [userId, roomName, visibility, inviteToken, req.body?.chatEnabled === false ? 0 : 1, sourceType, titleId, episodeId, mediaUrl]);
        res.status(201).json({ id: result.insertId, roomName, visibility, inviteToken, inviteUrl: `/c-party/room/${result.insertId}?invite=${inviteToken}` });
    });

    const loadRoomForViewer = async (roomId, userId, inviteToken) => {
        const [rows] = await db.query(`SELECT r.*, u.username AS owner_username, t.title AS library_title,
                COALESCE(e.media_url, t.media_url, r.media_url) AS resolved_media_url
            FROM cinema_rooms r
            LEFT JOIN users u ON u.id = r.owner_id
            LEFT JOIN cinema_titles t ON t.id = r.title_id
            LEFT JOIN cinema_episodes e ON e.id = r.episode_id
            WHERE r.id = ? AND r.is_active = 1 LIMIT 1`, [roomId]);
        if (!rows.length) return { error: 404 };
        const room = rows[0];
        if (room.visibility === 'private' && Number(room.owner_id) !== Number(userId) && String(room.invite_token) !== String(inviteToken || '')) return { error: 403 };
        return { room };
    };

    app.get('/cinema/rooms/:id', auth, async (req, res) => {
        await ensureSchema();
        const result = await loadRoomForViewer(Number(req.params.id), getUserId(req), req.query.invite);
        if (result.error === 404) return res.status(404).json({ message: 'Комната не найдена.' });
        if (result.error === 403) return res.status(403).json({ message: 'Приватная комната доступна только по приглашению.' });
        const room = result.room;
        const elapsed = room.playback_state === 'playing' ? Math.max(0, (Date.now() - new Date(room.playback_updated_at).getTime()) / 1000) : 0;
        res.json({ ...room, effective_position: Number(room.playback_position || 0) + elapsed, is_owner: Number(room.owner_id) === getUserId(req), invite_token: Number(room.owner_id) === getUserId(req) ? room.invite_token : undefined });
    });

    app.post('/cinema/rooms/:id/state', auth, async (req, res) => {
        await ensureSchema();
        const userId = getUserId(req);
        const roomId = Number(req.params.id);
        const [rows] = await db.query('SELECT owner_id FROM cinema_rooms WHERE id = ? AND is_active = 1 LIMIT 1', [roomId]);
        if (!rows.length) return res.status(404).json({ message: 'Комната не найдена.' });
        if (Number(rows[0].owner_id) !== userId) return res.status(403).json({ message: 'Управлять сеансом может только создатель комнаты.' });
        const position = Math.max(0, Number(req.body?.position || 0));
        const state = req.body?.state === 'playing' ? 'playing' : 'paused';
        const episodeId = req.body?.episodeId ? Number(req.body.episodeId) : null;
        await db.query('UPDATE cinema_rooms SET playback_position = ?, playback_state = ?, playback_updated_at = NOW(), episode_id = COALESCE(?, episode_id) WHERE id = ?', [position, state, episodeId, roomId]);
        res.json({ updated: true, position, state, serverTime: Date.now() });
    });

    app.delete('/cinema/rooms/:id', auth, async (req, res) => {
        const [result] = await db.query('UPDATE cinema_rooms SET is_active = 0 WHERE id = ? AND owner_id = ?', [Number(req.params.id), getUserId(req)]);
        if (!result.affectedRows) return res.status(403).json({ message: 'Завершить комнату может только её создатель.' });
        res.json({ ended: true });
    });

    app.get('/cinema/rooms/:id/messages', auth, async (req, res) => {
        await ensureSchema();
        const result = await loadRoomForViewer(Number(req.params.id), getUserId(req), req.query.invite);
        if (result.error) return res.status(result.error).json({ message: result.error === 403 ? 'Нет доступа к комнате.' : 'Комната не найдена.' });
        if (!result.room.chat_enabled) return res.status(409).json({ message: 'Чат этой комнаты отключён.' });
        const after = Math.max(0, Number(req.query.after || 0));
        const [rows] = await db.query(`SELECT m.id, m.user_id, m.message, m.created_at, u.username, u.avatar
            FROM cinema_room_messages m LEFT JOIN users u ON u.id = m.user_id
            WHERE m.room_id = ? AND m.id > ? ORDER BY m.id ASC LIMIT 300`, [Number(req.params.id), after]);
        res.json(rows);
    });

    app.post('/cinema/rooms/:id/messages', auth, async (req, res) => {
        await ensureSchema();
        const userId = getUserId(req);
        const result = await loadRoomForViewer(Number(req.params.id), userId, req.body?.invite);
        if (result.error) return res.status(result.error).json({ message: 'Нет доступа к комнате.' });
        if (!result.room.chat_enabled) return res.status(409).json({ message: 'Чат этой комнаты отключён.' });
        const message = String(req.body?.message || '').trim().slice(0, 4000);
        if (!message) return res.status(400).json({ message: 'Сообщение пустое.' });
        const [insert] = await db.query('INSERT INTO cinema_room_messages (room_id, user_id, message) VALUES (?, ?, ?)', [Number(req.params.id), userId, message]);
        const [rows] = await db.query(`SELECT m.id, m.user_id, m.message, m.created_at, u.username, u.avatar
            FROM cinema_room_messages m LEFT JOIN users u ON u.id = m.user_id WHERE m.id = ?`, [insert.insertId]);
        res.status(201).json(rows[0]);
    });

    // ----- Cinema resumable uploads, original bytes only -----
    const cinemaUploadsRoot = path.join(__dirname, 'uploads', 'cinema_chunks');
    const cinemaMediaRoot = path.join(__dirname, 'uploads', 'cinema_media');
    const rawChunk = express.raw({ type: 'application/octet-stream', limit: CINEMA_UPLOAD_CHUNK_BYTES + 1024 * 1024 });

    app.post('/cinema/uploads', auth, async (req, res) => {
        await ensureSchema();
        await fs.promises.mkdir(cinemaUploadsRoot, { recursive: true });
        await fs.promises.mkdir(cinemaMediaRoot, { recursive: true });
        const userId = getUserId(req);
        const fileSize = Number(req.body?.fileSize || 0);
        const fileName = safeName(req.body?.fileName);
        const mimeType = String(req.body?.mimeType || 'application/octet-stream').slice(0, 255);
        if (!Number.isSafeInteger(fileSize) || fileSize <= 0 || fileSize > CINEMA_MAX_UPLOAD_BYTES) return res.status(413).json({ message: 'Видео слишком большое.', maxBytes: CINEMA_MAX_UPLOAD_BYTES });
        const uploadId = crypto.randomUUID();
        const totalChunks = Math.ceil(fileSize / CINEMA_UPLOAD_CHUNK_BYTES);
        await fs.promises.mkdir(path.join(cinemaUploadsRoot, uploadId), { recursive: true });
        await db.query(`INSERT INTO cinema_upload_sessions
            (upload_id, user_id, original_name, mime_type, file_size, chunk_size, total_chunks, expires_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, [uploadId, userId, fileName, mimeType, fileSize, CINEMA_UPLOAD_CHUNK_BYTES, totalChunks, toMysqlDate(new Date(Date.now() + 24 * 60 * 60 * 1000))]);
        res.status(201).json({ uploadId, chunkSize: CINEMA_UPLOAD_CHUNK_BYTES, totalChunks, maxBytes: CINEMA_MAX_UPLOAD_BYTES, preservesOriginalBytes: true });
    });

    app.put('/cinema/uploads/:uploadId/chunks/:index', auth, rawChunk, async (req, res) => {
        await ensureSchema();
        const userId = getUserId(req);
        const uploadId = String(req.params.uploadId);
        const index = Number(req.params.index);
        const [rows] = await db.query('SELECT * FROM cinema_upload_sessions WHERE upload_id = ? AND user_id = ? LIMIT 1', [uploadId, userId]);
        if (!rows.length) return res.status(404).json({ message: 'Сессия загрузки не найдена.' });
        const session = rows[0];
        if (!Number.isInteger(index) || index < 0 || index >= Number(session.total_chunks)) return res.status(400).json({ message: 'Некорректный номер части.' });
        if (!Buffer.isBuffer(req.body) || req.body.length <= 0 || req.body.length > Number(session.chunk_size)) return res.status(400).json({ message: 'Некорректная часть файла.' });
        const chunkPath = path.join(cinemaUploadsRoot, uploadId, `${index}.part`);
        await fs.promises.writeFile(chunkPath, req.body, { flag: 'w' });
        await db.query('UPDATE cinema_upload_sessions SET updated_at = CURRENT_TIMESTAMP WHERE upload_id = ?', [uploadId]);
        res.json({ received: true, index, bytes: req.body.length });
    });

    app.post('/cinema/uploads/:uploadId/complete', auth, async (req, res) => {
        await ensureSchema();
        const userId = getUserId(req);
        const uploadId = String(req.params.uploadId);
        const [rows] = await db.query('SELECT * FROM cinema_upload_sessions WHERE upload_id = ? AND user_id = ? LIMIT 1', [uploadId, userId]);
        if (!rows.length) return res.status(404).json({ message: 'Сессия загрузки не найдена.' });
        const session = rows[0];
        const extension = path.extname(session.original_name).slice(0, 20);
        const finalName = `${crypto.randomUUID()}${extension}`;
        const finalPath = path.join(cinemaMediaRoot, finalName);
        const output = fs.createWriteStream(finalPath, { flags: 'wx' });
        let written = 0;
        try {
            for (let index = 0; index < Number(session.total_chunks); index += 1) {
                const chunk = await fs.promises.readFile(path.join(cinemaUploadsRoot, uploadId, `${index}.part`));
                written += chunk.length;
                if (!output.write(chunk)) await new Promise((resolve) => output.once('drain', resolve));
            }
            await new Promise((resolve, reject) => { output.end(resolve); output.on('error', reject); });
            if (written !== Number(session.file_size)) throw new Error(`size mismatch ${written} != ${session.file_size}`);
        } catch (error) {
            output.destroy();
            await fs.promises.rm(finalPath, { force: true }).catch(() => undefined);
            return res.status(409).json({ message: 'Не все части видео загружены. Продолжите загрузку и повторите.' });
        }
        await fs.promises.rm(path.join(cinemaUploadsRoot, uploadId), { recursive: true, force: true });
        await db.query('DELETE FROM cinema_upload_sessions WHERE upload_id = ?', [uploadId]);
        res.json({ complete: true, mediaUrl: `/cinema/media/${finalName}`, fileName: session.original_name, fileSize: Number(session.file_size), mimeType: session.mime_type, recompressed: false });
    });

    app.get('/cinema/media/:fileName', auth, async (req, res) => {
        const fileName = safeName(req.params.fileName);
        const filePath = path.join(cinemaMediaRoot, fileName);
        let stat;
        try { stat = await fs.promises.stat(filePath); } catch { return res.status(404).end(); }
        const range = req.headers.range;
        const contentType = fileName.endsWith('.webm') ? 'video/webm' : fileName.endsWith('.mov') ? 'video/quicktime' : 'video/mp4';
        res.setHeader('Accept-Ranges', 'bytes');
        res.setHeader('Content-Type', contentType);
        if (!range) {
            res.setHeader('Content-Length', stat.size);
            return fs.createReadStream(filePath).pipe(res);
        }
        const match = /^bytes=(\d*)-(\d*)$/.exec(range);
        if (!match) return res.status(416).end();
        const start = match[1] ? Number(match[1]) : 0;
        const end = match[2] ? Math.min(Number(match[2]), stat.size - 1) : stat.size - 1;
        if (start > end || start >= stat.size) return res.status(416).setHeader('Content-Range', `bytes */${stat.size}`).end();
        res.status(206);
        res.setHeader('Content-Range', `bytes ${start}-${end}/${stat.size}`);
        res.setHeader('Content-Length', end - start + 1);
        fs.createReadStream(filePath, { start, end }).pipe(res);
    });
};

module.exports = { registerSocialBirdFinalPlatform, PROFILE_RESTRICTED_MESSAGE };
