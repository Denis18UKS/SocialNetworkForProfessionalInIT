const crypto = require('crypto');
const express = require('express');
const fs = require('fs');
const os = require('os');
const path = require('path');
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

    // SOCIALBIRD_CPARTY_QR_FALLBACK_V2: server-decode
    app.post('/cinema/qr/decode', verifyToken, express.raw({ type: ['image/jpeg', 'image/png', 'image/webp'], limit: '2mb' }), async (req, res) => {
        const contentType = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
        const extension = contentType === 'image/png' ? 'png' : contentType === 'image/webp' ? 'webp' : 'jpg';
        const image = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
        if (!image.length) return res.status(400).json({ message: 'Пустой кадр QR-сканера.' });
        if (image.length > 2 * 1024 * 1024) return res.status(413).json({ message: 'Кадр QR-сканера слишком большой.' });

        const tempFile = path.join(os.tmpdir(), `socialbird-qr-${crypto.randomUUID()}.${extension}`);
        try {
            await fs.promises.writeFile(tempFile, image, { flag: 'wx' });
            const { stdout } = await execFileAsync('zbarimg', ['--quiet', '--raw', tempFile], {
                timeout: 3500,
                maxBuffer: 256 * 1024,
                windowsHide: true,
            });
            const rawValue = String(stdout || '').split(/\r?\n/).map((line) => line.trim()).find(Boolean) || '';
            if (!rawValue) return res.status(422).json({ message: 'QR-код в кадре не найден.' });
            res.setHeader('Cache-Control', 'no-store');
            return res.json({ rawValue });
        } catch (error) {
            if (error?.code === 'ENOENT') {
                return res.status(503).json({ message: 'Серверный QR-декодер не установлен.' });
            }
            const stderr = String(error?.stderr || '');
            if (Number(error?.code) === 4 || /scanned 0 barcode/i.test(stderr) || /not found/i.test(stderr)) {
                return res.status(422).json({ message: 'QR-код в кадре не найден.' });
            }
            console.warn('Cinema QR decode failed:', error?.message || error);
            return res.status(422).json({ message: 'QR-код в кадре не найден.' });
        } finally {
            fs.promises.unlink(tempFile).catch(() => undefined);
        }
    });
};

module.exports = { registerCinemaQr };
