const SIGNAL_TTL_SECONDS = 150;

const ensureOfflineCallSchema = async (db) => {
    await db.query(`CREATE TABLE IF NOT EXISTS pending_call_signals (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
        target_user_id INT UNSIGNED NOT NULL,
        sender_user_id INT UNSIGNED NOT NULL,
        call_key VARCHAR(255) NOT NULL,
        signal_type VARCHAR(40) NOT NULL,
        payload_json LONGTEXT NOT NULL,
        expires_at DATETIME NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        KEY idx_pending_call_target (target_user_id, expires_at, id),
        KEY idx_pending_call_key (call_key, target_user_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
};

const buildCallKey = (senderId, data = {}) => [
    Number(senderId) || 0,
    data.mode === 'group' ? 'group' : 'private',
    String(data.chatId ?? ''),
].join(':');

const registerOfflineCallQueue = ({ db, isUserOnline }) => {
    ensureOfflineCallSchema(db).catch((error) => {
        console.error('Offline call queue schema initialization failed:', error.message);
    });

    const queueOfflineCallSignal = async (type, targetIds, data = {}, senderId = 0) => {
        const uniqueTargets = Array.from(new Set((targetIds || []).map(Number).filter(Number.isFinite)));
        if (uniqueTargets.length === 0) return;
        const callKey = buildCallKey(senderId, data);

        try {
            await db.query('DELETE FROM pending_call_signals WHERE expires_at <= NOW()');
            if (type === 'CALL_HANGUP') {
                await db.query(
                    'DELETE FROM pending_call_signals WHERE sender_user_id = ? AND call_key = ? AND target_user_id IN (?)',
                    [Number(senderId), callKey, uniqueTargets]
                );
                return;
            }

            if (!['CALL_INVITE', 'CALL_OFFER', 'CALL_ICE', 'CALL_RELAY_TRACK'].includes(type)) return;
            const offlineTargets = uniqueTargets.filter((userId) => !isUserOnline(userId));
            if (offlineTargets.length === 0) return;

            for (const targetUserId of offlineTargets) {
                const payload = {
                    ...data,
                    senderId: Number(senderId),
                    targetIds: uniqueTargets,
                };
                await db.query(
                    `INSERT INTO pending_call_signals
                     (target_user_id, sender_user_id, call_key, signal_type, payload_json, expires_at)
                     VALUES (?, ?, ?, ?, ?, DATE_ADD(NOW(), INTERVAL ? SECOND))`,
                    [targetUserId, Number(senderId), callKey, type, JSON.stringify(payload), SIGNAL_TTL_SECONDS]
                );
            }
        } catch (error) {
            console.warn('Offline call queue write failed:', error.message);
        }
    };

    const deliverPendingCallSignals = async (userId, socket) => {
        const normalizedUserId = Number(userId);
        if (!normalizedUserId || !socket) return;
        try {
            await db.query('DELETE FROM pending_call_signals WHERE expires_at <= NOW()');
            const [rows] = await db.query(
                `SELECT id, signal_type, payload_json
                 FROM pending_call_signals
                 WHERE target_user_id = ? AND expires_at > NOW()
                 ORDER BY id ASC LIMIT 250`,
                [normalizedUserId]
            );
            if (rows.length === 0) return;

            const deliveredIds = [];
            for (const row of rows) {
                if (socket.readyState !== 1) break;
                try {
                    socket.send(JSON.stringify({
                        type: row.signal_type,
                        data: JSON.parse(row.payload_json),
                    }));
                    deliveredIds.push(row.id);
                } catch {
                    break;
                }
            }
            if (deliveredIds.length > 0) {
                await db.query('DELETE FROM pending_call_signals WHERE id IN (?)', [deliveredIds]);
            }
        } catch (error) {
            console.warn('Offline call queue delivery failed:', error.message);
        }
    };

    return { queueOfflineCallSignal, deliverPendingCallSignals };
};

module.exports = {
    ensureOfflineCallSchema,
    registerOfflineCallQueue,
};
