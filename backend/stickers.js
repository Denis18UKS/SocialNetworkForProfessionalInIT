const registerStickers = ({
    app,
    db,
    verifyToken,
    notifyClients,
    getChatParticipants,
    hasUserBlockBetween,
    resolveGroupMentionRecipients,
}) => {
    let schemaPromise = null;

    const ensureColumn = async (table, column, definition) => {
        try {
            await db.query(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
        } catch (error) {
            if (error.code !== 'ER_DUP_FIELDNAME') throw error;
        }
    };

    const ensureSchema = async () => {
        if (!schemaPromise) {
            schemaPromise = (async () => {
                await db.query(`CREATE TABLE IF NOT EXISTS sticker_packs (
                    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
                    slug VARCHAR(64) NOT NULL UNIQUE,
                    name VARCHAR(120) NOT NULL,
                    icon_url VARCHAR(500) NULL,
                    sort_order INT NOT NULL DEFAULT 0,
                    is_active TINYINT(1) NOT NULL DEFAULT 1,
                    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

                await db.query(`CREATE TABLE IF NOT EXISTS stickers (
                    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
                    pack_id BIGINT UNSIGNED NOT NULL,
                    sticker_key VARCHAR(64) NOT NULL,
                    image_url VARCHAR(500) NOT NULL,
                    sort_order INT NOT NULL DEFAULT 0,
                    is_active TINYINT(1) NOT NULL DEFAULT 1,
                    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    UNIQUE KEY uq_sticker_pack_key (pack_id, sticker_key),
                    KEY idx_sticker_pack_sort (pack_id, sort_order),
                    CONSTRAINT fk_sticker_pack FOREIGN KEY (pack_id) REFERENCES sticker_packs(id) ON DELETE CASCADE
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

                await db.query(`CREATE TABLE IF NOT EXISTS user_recent_stickers (
                    user_id BIGINT NOT NULL,
                    sticker_id BIGINT UNSIGNED NOT NULL,
                    last_used_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                    PRIMARY KEY (user_id, sticker_id),
                    KEY idx_recent_sticker_time (user_id, last_used_at),
                    CONSTRAINT fk_recent_sticker FOREIGN KEY (sticker_id) REFERENCES stickers(id) ON DELETE CASCADE
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

                await ensureColumn('messages', 'sticker_id', 'BIGINT UNSIGNED NULL');
                await ensureColumn('group_chat_messages', 'sticker_id', 'BIGINT UNSIGNED NULL');

                await db.query(
                    `INSERT INTO sticker_packs (slug, name, icon_url, sort_order, is_active)
                     VALUES ('socialbird-birds', 'SocialBIRD', '/stickers/socialbird/bird-code.svg', 10, 1)
                     ON DUPLICATE KEY UPDATE name = VALUES(name), icon_url = VALUES(icon_url), is_active = 1`
                );
                const [packRows] = await db.query("SELECT id FROM sticker_packs WHERE slug = 'socialbird-birds' LIMIT 1");
                const packId = packRows[0].id;
                const seed = [
                    ['code', '/stickers/socialbird/bird-code.svg', 10],
                    ['hello', '/stickers/socialbird/bird-hello.svg', 20],
                    ['coffee', '/stickers/socialbird/bird-coffee.svg', 30],
                    ['bug', '/stickers/socialbird/bird-bug.svg', 40],
                    ['rocket', '/stickers/socialbird/bird-rocket.svg', 50],
                    ['love', '/stickers/socialbird/bird-love.svg', 60],
                    ['sleep', '/stickers/socialbird/bird-sleep.svg', 70],
                    ['wow', '/stickers/socialbird/bird-wow.svg', 80],
                ];
                for (const [key, imageUrl, sortOrder] of seed) {
                    await db.query(
                        `INSERT INTO stickers (pack_id, sticker_key, image_url, sort_order, is_active)
                         VALUES (?, ?, ?, ?, 1)
                         ON DUPLICATE KEY UPDATE image_url = VALUES(image_url), sort_order = VALUES(sort_order), is_active = 1`,
                        [packId, key, imageUrl, sortOrder]
                    );
                }
            })().catch((error) => {
                schemaPromise = null;
                throw error;
            });
        }
        return schemaPromise;
    };

    const loadSticker = async (stickerId) => {
        const [rows] = await db.query(
            `SELECT s.id, s.pack_id, s.sticker_key, s.image_url, p.name AS pack_name
             FROM stickers s
             JOIN sticker_packs p ON p.id = s.pack_id
             WHERE s.id = ? AND s.is_active = 1 AND p.is_active = 1
             LIMIT 1`,
            [stickerId]
        );
        return rows[0] || null;
    };

    const getGroupMemberIds = async (chatId) => {
        const [rows] = await db.query('SELECT user_id FROM group_chat_members WHERE group_chat_id = ?', [chatId]);
        return rows.map((row) => Number(row.user_id)).filter(Number.isFinite);
    };

    const assertScopeAccess = async (scope, chatId, userId) => {
        if (scope === 'personal') {
            const participants = await getChatParticipants(chatId);
            if (!participants || !participants.some((id) => Number(id) === Number(userId))) {
                const error = new Error('Нет доступа к этому чату');
                error.statusCode = 403;
                throw error;
            }
            const otherId = participants.find((id) => Number(id) !== Number(userId));
            if (otherId && await hasUserBlockBetween(userId, otherId)) {
                const error = new Error('Данный пользователь ограничил круг лиц');
                error.statusCode = 403;
                error.code = 'PROFILE_RESTRICTED';
                throw error;
            }
            return participants.map(Number);
        }
        if (scope === 'group') {
            const members = await getGroupMemberIds(chatId);
            if (!members.includes(Number(userId))) {
                const error = new Error('Вы не участник этого группового чата');
                error.statusCode = 403;
                throw error;
            }
            return members;
        }
        const error = new Error('Некорректный тип чата');
        error.statusCode = 400;
        throw error;
    };

    app.get('/stickers/packs', verifyToken, async (_req, res) => {
        try {
            await ensureSchema();
            const [packs] = await db.query(
                `SELECT id, slug, name, icon_url, sort_order
                 FROM sticker_packs
                 WHERE is_active = 1
                 ORDER BY sort_order, id`
            );
            const [stickers] = await db.query(
                `SELECT s.id, s.pack_id, s.sticker_key, s.image_url, s.sort_order
                 FROM stickers s
                 JOIN sticker_packs p ON p.id = s.pack_id
                 WHERE s.is_active = 1 AND p.is_active = 1
                 ORDER BY s.pack_id, s.sort_order, s.id`
            );
            res.json({
                packs: packs.map((pack) => ({
                    ...pack,
                    stickers: stickers.filter((sticker) => Number(sticker.pack_id) === Number(pack.id)),
                })),
            });
        } catch (error) {
            console.error('Sticker packs error:', error);
            res.status(500).json({ message: 'Не удалось загрузить стикеры' });
        }
    });

    app.get('/stickers/recent', verifyToken, async (req, res) => {
        try {
            await ensureSchema();
            const [rows] = await db.query(
                `SELECT s.id, s.pack_id, s.sticker_key, s.image_url
                 FROM user_recent_stickers r
                 JOIN stickers s ON s.id = r.sticker_id
                 JOIN sticker_packs p ON p.id = s.pack_id
                 WHERE r.user_id = ? AND s.is_active = 1 AND p.is_active = 1
                 ORDER BY r.last_used_at DESC
                 LIMIT 24`,
                [req.user.id]
            );
            res.json({ stickers: rows });
        } catch (error) {
            console.error('Recent stickers error:', error);
            res.status(500).json({ message: 'Не удалось загрузить недавние стикеры' });
        }
    });

    app.post('/stickers/send', verifyToken, async (req, res) => {
        try {
            await ensureSchema();
            const scope = req.body?.scope === 'group' ? 'group' : req.body?.scope === 'personal' ? 'personal' : null;
            const chatId = Number(req.body?.chatId);
            const stickerId = Number(req.body?.stickerId);
            if (!scope || !Number.isInteger(chatId) || chatId <= 0 || !Number.isInteger(stickerId) || stickerId <= 0) {
                return res.status(400).json({ message: 'Некорректный стикер или чат' });
            }
            const sticker = await loadSticker(stickerId);
            if (!sticker) return res.status(404).json({ message: 'Стикер не найден' });
            const participantIds = await assertScopeAccess(scope, chatId, req.user.id);

            let message;
            if (scope === 'personal') {
                const [result] = await db.query(
                    `INSERT INTO messages (chat_id, user_id, message, sticker_id)
                     VALUES (?, ?, '', ?)`,
                    [chatId, req.user.id, stickerId]
                );
                const [rows] = await db.query(
                    `SELECT m.*, u.username
                     FROM messages m JOIN users u ON u.id = m.user_id
                     WHERE m.id = ? LIMIT 1`,
                    [result.insertId]
                );
                const recipientIds = participantIds.filter((id) => Number(id) !== Number(req.user.id));
                message = { ...rows[0], sticker_url: sticker.image_url, recipientIds };
                notifyClients({ type: 'NEW_MESSAGE', data: message });
            } else {
                const [result] = await db.query(
                    `INSERT INTO group_chat_messages (group_chat_id, user_id, message, sticker_id)
                     VALUES (?, ?, '', ?)`,
                    [chatId, req.user.id, stickerId]
                );
                const [rows] = await db.query(
                    `SELECT gcm.*, u.username, u.avatar
                     FROM group_chat_messages gcm JOIN users u ON u.id = gcm.user_id
                     WHERE gcm.id = ? LIMIT 1`,
                    [result.insertId]
                );
                const recipientIds = participantIds.filter((id) => Number(id) !== Number(req.user.id));
                const mentionRecipientIds = resolveGroupMentionRecipients
                    ? await resolveGroupMentionRecipients(chatId, '', req.user.id)
                    : [];
                message = { ...rows[0], sticker_url: sticker.image_url, recipientIds, mentionRecipientIds };
                notifyClients({ type: 'NEW_GROUP_MESSAGE', data: message });
            }

            await db.query(
                `INSERT INTO user_recent_stickers (user_id, sticker_id, last_used_at)
                 VALUES (?, ?, NOW())
                 ON DUPLICATE KEY UPDATE last_used_at = NOW()`,
                [req.user.id, stickerId]
            );
            res.status(201).json(message);
        } catch (error) {
            console.error('Send sticker error:', error);
            res.status(error.statusCode || 500).json({ message: error.message || 'Не удалось отправить стикер', code: error.code });
        }
    });

    void ensureSchema().catch((error) => console.error('Sticker schema error:', error));
};

module.exports = { registerStickers };
