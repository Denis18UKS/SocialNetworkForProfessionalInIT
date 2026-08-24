const crypto = require('crypto');
const express = require('express');
const fs = require('fs');
const path = require('path');

const DEFAULT_CHUNK_BYTES = 8 * 1024 * 1024;
const DEFAULT_MAX_UPLOAD_BYTES = 8 * 1024 * 1024 * 1024;
const DEFAULT_SESSION_TTL_HOURS = 24;

const safeFileName = (value) => {
    const raw = path.basename(String(value || 'file'));
    const cleaned = raw
        .replace(/[\u0000-\u001f<>:"/\\|?*]/g, '_')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 180);
    return cleaned || 'file';
};

const normalizeScope = (value) => value === 'group' ? 'group' : value === 'personal' ? 'personal' : null;
const normalizeMessage = (value) => String(value || '').slice(0, 10000);

const registerResumableChatUpload = ({
    app,
    db,
    verifyToken,
    notifyClients,
    resolveGroupMentionRecipients,
    notifyOfflineUsersByEmail,
    getChatParticipants,
    hasUserBlockBetween,
}) => {
    const uploadsRoot = path.join(__dirname, 'uploads');
    const chunksRoot = path.join(uploadsRoot, 'chat_chunks');
    const finalRoot = path.join(uploadsRoot, 'chat_files');
    const chunkBytes = Math.max(1024 * 1024, Number(process.env.CHAT_UPLOAD_CHUNK_BYTES || DEFAULT_CHUNK_BYTES));
    const maxUploadBytes = Math.max(chunkBytes, Number(process.env.MAX_RESUMABLE_UPLOAD_BYTES || DEFAULT_MAX_UPLOAD_BYTES));
    const sessionTtlHours = Math.max(1, Number(process.env.CHAT_UPLOAD_SESSION_TTL_HOURS || DEFAULT_SESSION_TTL_HOURS));
    const rawChunk = express.raw({ type: 'application/octet-stream', limit: chunkBytes + 1024 * 1024 });

    let schemaPromise = null;
    const ensureSchema = async () => {
        if (!schemaPromise) {
            schemaPromise = (async () => {
                await fs.promises.mkdir(chunksRoot, { recursive: true });
                await fs.promises.mkdir(finalRoot, { recursive: true });
                await db.query(`CREATE TABLE IF NOT EXISTS chat_upload_sessions (
                    upload_id CHAR(36) NOT NULL PRIMARY KEY,
                    user_id BIGINT NOT NULL,
                    scope_name VARCHAR(16) NOT NULL,
                    chat_id BIGINT NOT NULL,
                    original_name VARCHAR(255) NOT NULL,
                    mime_type VARCHAR(255) NULL,
                    file_size BIGINT UNSIGNED NOT NULL,
                    chunk_size INT UNSIGNED NOT NULL,
                    total_chunks INT UNSIGNED NOT NULL,
                    message_text TEXT NULL,
                    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                    expires_at DATETIME NOT NULL,
                    KEY idx_chat_upload_owner (user_id, updated_at),
                    KEY idx_chat_upload_expiry (expires_at)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
            })().catch((error) => {
                schemaPromise = null;
                throw error;
            });
        }
        return schemaPromise;
    };

    const loadSession = async (uploadId, userId) => {
        await ensureSchema();
        const [rows] = await db.query(
            `SELECT upload_id, user_id, scope_name, chat_id, original_name, mime_type,
                    file_size, chunk_size, total_chunks, message_text, expires_at
             FROM chat_upload_sessions
             WHERE upload_id = ? AND user_id = ? LIMIT 1`,
            [uploadId, userId]
        );
        return rows[0] || null;
    };

    const getGroupMemberIds = async (chatId) => {
        const [rows] = await db.query(
            'SELECT user_id FROM group_chat_members WHERE group_chat_id = ?',
            [chatId]
        );
        return rows.map((row) => Number(row.user_id)).filter(Number.isFinite);
    };

    const assertAccess = async ({ scope, chatId, userId }) => {
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

        const memberIds = await getGroupMemberIds(chatId);
        if (!memberIds.includes(Number(userId))) {
            const error = new Error('Вы не участник этого группового чата');
            error.statusCode = 403;
            throw error;
        }
        return memberIds;
    };

    const removeSessionFiles = async (uploadId) => {
        await fs.promises.rm(path.join(chunksRoot, uploadId), { recursive: true, force: true }).catch(() => undefined);
    };

    const cleanupExpired = async () => {
        await ensureSchema();
        const [rows] = await db.query('SELECT upload_id FROM chat_upload_sessions WHERE expires_at < NOW() LIMIT 200');
        for (const row of rows) {
            await removeSessionFiles(row.upload_id);
        }
        if (rows.length > 0) {
            await db.query('DELETE FROM chat_upload_sessions WHERE expires_at < NOW()');
        }
    };

    app.get('/chat-upload/config', verifyToken, async (_req, res) => {
        res.json({
            resumable: true,
            preservesOriginalBytes: true,
            chunkBytes,
            maxUploadBytes,
            sessionTtlHours,
        });
    });

    app.post('/chat-upload/start', verifyToken, async (req, res) => {
        try {
            await ensureSchema();
            void cleanupExpired().catch((error) => console.warn('Upload cleanup failed:', error.message));

            const scope = normalizeScope(req.body?.scope);
            const chatId = Number(req.body?.chatId);
            const fileSize = Number(req.body?.fileSize);
            const originalName = safeFileName(req.body?.fileName);
            const mimeType = String(req.body?.mimeType || 'application/octet-stream').slice(0, 255);
            const messageText = normalizeMessage(req.body?.message);

            if (!scope || !Number.isInteger(chatId) || chatId <= 0) {
                return res.status(400).json({ message: 'Некорректный чат для загрузки' });
            }
            if (!Number.isSafeInteger(fileSize) || fileSize <= 0) {
                return res.status(400).json({ message: 'Некорректный размер файла' });
            }
            if (fileSize > maxUploadBytes) {
                return res.status(413).json({
                    message: `Файл превышает серверный лимит ${(maxUploadBytes / 1024 / 1024 / 1024).toFixed(1)} ГБ.`,
                    code: 'FILE_TOO_LARGE',
                    maxUploadBytes,
                });
            }

            await assertAccess({ scope, chatId, userId: req.user.id });

            const uploadId = crypto.randomUUID();
            const totalChunks = Math.ceil(fileSize / chunkBytes);
            const expiresAt = new Date(Date.now() + sessionTtlHours * 60 * 60 * 1000);
            await db.query(
                `INSERT INTO chat_upload_sessions
                 (upload_id, user_id, scope_name, chat_id, original_name, mime_type, file_size, chunk_size, total_chunks, message_text, expires_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [uploadId, req.user.id, scope, chatId, originalName, mimeType, fileSize, chunkBytes, totalChunks, messageText, expiresAt]
            );
            await fs.promises.mkdir(path.join(chunksRoot, uploadId), { recursive: true });

            res.status(201).json({ uploadId, chunkBytes, totalChunks, fileSize, expiresAt });
        } catch (error) {
            console.error('Resumable upload start error:', error);
            res.status(error.statusCode || 500).json({ message: error.message || 'Не удалось начать загрузку', code: error.code });
        }
    });

    app.get('/chat-upload/:uploadId/status', verifyToken, async (req, res) => {
        try {
            const session = await loadSession(req.params.uploadId, req.user.id);
            if (!session) return res.status(404).json({ message: 'Сессия загрузки не найдена' });
            const directory = path.join(chunksRoot, session.upload_id);
            const entries = await fs.promises.readdir(directory).catch(() => []);
            const receivedChunks = entries
                .map((name) => /^([0-9]+)\.part$/.exec(name)?.[1])
                .filter(Boolean)
                .map(Number)
                .sort((a, b) => a - b);
            res.json({
                uploadId: session.upload_id,
                totalChunks: Number(session.total_chunks),
                chunkBytes: Number(session.chunk_size),
                receivedChunks,
            });
        } catch (error) {
            console.error('Resumable upload status error:', error);
            res.status(500).json({ message: 'Не удалось проверить загрузку' });
        }
    });

    app.put('/chat-upload/:uploadId/chunks/:index', verifyToken, rawChunk, async (req, res) => {
        try {
            const session = await loadSession(req.params.uploadId, req.user.id);
            if (!session) return res.status(404).json({ message: 'Сессия загрузки не найдена' });
            if (new Date(session.expires_at).getTime() < Date.now()) {
                return res.status(410).json({ message: 'Сессия загрузки истекла' });
            }

            const index = Number(req.params.index);
            const totalChunks = Number(session.total_chunks);
            if (!Number.isInteger(index) || index < 0 || index >= totalChunks) {
                return res.status(400).json({ message: 'Некорректный номер части файла' });
            }
            if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
                return res.status(400).json({ message: 'Часть файла пуста' });
            }

            const expected = index === totalChunks - 1
                ? Number(session.file_size) - (Number(session.chunk_size) * index)
                : Number(session.chunk_size);
            if (req.body.length !== expected) {
                return res.status(400).json({
                    message: 'Размер части файла не совпадает с ожидаемым',
                    expectedBytes: expected,
                    receivedBytes: req.body.length,
                });
            }

            const directory = path.join(chunksRoot, session.upload_id);
            await fs.promises.mkdir(directory, { recursive: true });
            const finalPath = path.join(directory, `${index}.part`);
            const temporaryPath = `${finalPath}.${crypto.randomBytes(4).toString('hex')}.tmp`;
            await fs.promises.writeFile(temporaryPath, req.body, { flag: 'wx' });
            await fs.promises.rename(temporaryPath, finalPath);
            await db.query('UPDATE chat_upload_sessions SET updated_at = NOW() WHERE upload_id = ?', [session.upload_id]);

            res.status(204).end();
        } catch (error) {
            console.error('Resumable upload chunk error:', error);
            res.status(500).json({ message: 'Не удалось сохранить часть файла' });
        }
    });

    const createPersonalMessage = async (session, userId, mediaUrl, participantIds) => {
        const [result] = await db.query(
            `INSERT INTO messages (chat_id, user_id, message, media, file_name, file_size)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [session.chat_id, userId, session.message_text || '', mediaUrl, session.original_name, session.file_size]
        );
        const [rows] = await db.query(
            `SELECT m.*, u.username
             FROM messages m
             JOIN users u ON u.id = m.user_id
             WHERE m.id = ? LIMIT 1`,
            [result.insertId]
        );
        const recipientIds = participantIds.filter((id) => Number(id) !== Number(userId));
        const message = { ...rows[0], recipientIds };
        notifyClients({ type: 'NEW_MESSAGE', data: message });
        if (notifyOfflineUsersByEmail) {
            await notifyOfflineUsersByEmail(
                recipientIds,
                'Новый файл в личном чате SocialBIRD',
                `${message.username || 'Пользователь'} отправил файл: ${session.original_name}`
            ).catch(() => undefined);
        }
        return message;
    };

    const createGroupMessage = async (session, userId, mediaUrl, memberIds) => {
        const [result] = await db.query(
            `INSERT INTO group_chat_messages
             (group_chat_id, user_id, message, media, file_name, file_size)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [session.chat_id, userId, session.message_text || '', mediaUrl, session.original_name, session.file_size]
        );
        const [rows] = await db.query(
            `SELECT gcm.*, u.username, u.avatar
             FROM group_chat_messages gcm
             JOIN users u ON u.id = gcm.user_id
             WHERE gcm.id = ? LIMIT 1`,
            [result.insertId]
        );
        const recipientIds = memberIds.filter((id) => Number(id) !== Number(userId));
        const mentionRecipientIds = resolveGroupMentionRecipients
            ? await resolveGroupMentionRecipients(session.chat_id, session.message_text || '', userId)
            : [];
        const message = { ...rows[0], recipientIds, mentionRecipientIds };
        notifyClients({ type: 'NEW_GROUP_MESSAGE', data: message });
        if (mentionRecipientIds.length > 0) {
            notifyClients({
                type: 'GROUP_MENTION',
                data: { ...message, recipientIds: mentionRecipientIds },
            });
        }
        if (notifyOfflineUsersByEmail) {
            await notifyOfflineUsersByEmail(
                recipientIds,
                'Новый файл в групповом чате SocialBIRD',
                `${message.username || 'Пользователь'} отправил файл: ${session.original_name}`
            ).catch(() => undefined);
        }
        return message;
    };

    app.post('/chat-upload/:uploadId/finish', verifyToken, async (req, res) => {
        let finalPath = null;
        try {
            const session = await loadSession(req.params.uploadId, req.user.id);
            if (!session) return res.status(404).json({ message: 'Сессия загрузки не найдена' });
            const scope = normalizeScope(session.scope_name);
            const participantIds = await assertAccess({ scope, chatId: Number(session.chat_id), userId: req.user.id });
            const directory = path.join(chunksRoot, session.upload_id);

            let totalBytes = 0;
            for (let index = 0; index < Number(session.total_chunks); index += 1) {
                const stat = await fs.promises.stat(path.join(directory, `${index}.part`)).catch(() => null);
                if (!stat) {
                    return res.status(409).json({
                        message: 'Загружены не все части файла',
                        code: 'MISSING_CHUNK',
                        missingChunk: index,
                    });
                }
                totalBytes += stat.size;
            }
            if (totalBytes !== Number(session.file_size)) {
                return res.status(409).json({ message: 'Итоговый размер частей не совпадает с исходным файлом' });
            }

            const storedName = `${Date.now()}-${crypto.randomBytes(8).toString('hex')}-${safeFileName(session.original_name)}`;
            finalPath = path.join(finalRoot, storedName);
            await fs.promises.writeFile(finalPath, Buffer.alloc(0), { flag: 'wx' });
            for (let index = 0; index < Number(session.total_chunks); index += 1) {
                const partPath = path.join(directory, `${index}.part`);
                const chunk = await fs.promises.readFile(partPath);
                await fs.promises.appendFile(finalPath, chunk);
            }
            const finalStat = await fs.promises.stat(finalPath);
            if (finalStat.size !== Number(session.file_size)) {
                throw new Error('Файл собран с неверным размером');
            }

            const mediaUrl = `/uploads/chat_files/${storedName}`;
            const message = scope === 'personal'
                ? await createPersonalMessage(session, req.user.id, mediaUrl, participantIds)
                : await createGroupMessage(session, req.user.id, mediaUrl, participantIds);

            await db.query('DELETE FROM chat_upload_sessions WHERE upload_id = ?', [session.upload_id]);
            await removeSessionFiles(session.upload_id);
            res.status(201).json(message);
        } catch (error) {
            console.error('Resumable upload finish error:', error);
            if (finalPath) await fs.promises.rm(finalPath, { force: true }).catch(() => undefined);
            res.status(error.statusCode || 500).json({ message: error.message || 'Не удалось завершить загрузку', code: error.code });
        }
    });

    app.delete('/chat-upload/:uploadId', verifyToken, async (req, res) => {
        try {
            const session = await loadSession(req.params.uploadId, req.user.id);
            if (!session) return res.status(204).end();
            await db.query('DELETE FROM chat_upload_sessions WHERE upload_id = ?', [session.upload_id]);
            await removeSessionFiles(session.upload_id);
            res.status(204).end();
        } catch (error) {
            console.error('Resumable upload abort error:', error);
            res.status(500).json({ message: 'Не удалось отменить загрузку' });
        }
    });

    void ensureSchema().catch((error) => console.error('Resumable upload schema error:', error));
    return { chunkBytes, maxUploadBytes };
};

module.exports = { registerResumableChatUpload };
