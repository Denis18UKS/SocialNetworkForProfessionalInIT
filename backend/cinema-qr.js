const { execFile } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);

const registerCinemaQr = ({ app, db, verifyToken }) => {
    app.get('/cinema/rooms/:id/qr.svg', verifyToken, async (req, res) => {
        const userId = Number(req.user?.id || req.userId || req.user?.userId || 0);
        const roomId = Number(req.params.id);
        const [rows] = await db.query('SELECT id, owner_id, invite_token FROM cinema_rooms WHERE id = ? AND is_active = 1 LIMIT 1', [roomId]);
        if (!rows.length) return res.status(404).json({ message: 'Комната не найдена.' });
        const room = rows[0];
        if (Number(room.owner_id) !== userId) return res.status(403).json({ message: 'QR-код приглашения доступен только создателю комнаты.' });
        const site = String(process.env.FRONTEND_URL || 'https://socialbird.ru').split(',')[0].replace(/\/$/, '');
        const inviteUrl = `${site}/c-party/room/${room.id}?invite=${room.invite_token}`;
        try {
            const { stdout } = await execFileAsync('qrencode', ['-t', 'SVG', '-m', '2', '-s', '6', '-o', '-', inviteUrl], { maxBuffer: 2 * 1024 * 1024 });
            res.type('image/svg+xml').setHeader('Cache-Control', 'no-store');
            res.send(stdout);
        } catch (error) {
            console.error('Cinema QR generation failed:', error.message);
            res.status(503).json({ message: 'Генератор QR-кода временно недоступен.' });
        }
    });
};

module.exports = { registerCinemaQr };
