const fs = require('fs');
const path = require('path');

const safeFileName = (value) => path.basename(String(value || '')).replace(/[^a-zA-Z0-9._-]/g, '');

const registerCinemaStream = ({ app, db }) => {
    const mediaRoot = path.join(__dirname, 'uploads', 'cinema_media');

    app.get('/cinema/stream/:roomId', async (req, res) => {
        const roomId = Number(req.params.roomId);
        if (!roomId) return res.status(400).end();
        const [rows] = await db.query(`SELECT r.id, r.visibility, r.invite_token, r.media_url,
                COALESCE(e.media_url, t.media_url, r.media_url) AS resolved_media_url
            FROM cinema_rooms r
            LEFT JOIN cinema_titles t ON t.id = r.title_id
            LEFT JOIN cinema_episodes e ON e.id = r.episode_id
            WHERE r.id = ? AND r.is_active = 1 LIMIT 1`, [roomId]);
        if (!rows.length) return res.status(404).end();
        const room = rows[0];
        if (room.visibility === 'private' && String(req.query.invite || '') !== String(room.invite_token || '')) return res.status(403).end();

        const mediaUrl = String(room.resolved_media_url || '');
        if (!mediaUrl) return res.status(404).end();
        if (/^https?:\/\//i.test(mediaUrl)) return res.redirect(302, mediaUrl);
        const match = /^\/cinema\/media\/([^/?#]+)/.exec(mediaUrl);
        if (!match) return res.status(404).end();
        const fileName = safeFileName(match[1]);
        const filePath = path.join(mediaRoot, fileName);
        let stat;
        try { stat = await fs.promises.stat(filePath); } catch { return res.status(404).end(); }

        const lower = fileName.toLowerCase();
        const contentType = lower.endsWith('.webm') ? 'video/webm'
            : lower.endsWith('.mov') ? 'video/quicktime'
            : lower.endsWith('.mkv') ? 'video/x-matroska'
            : lower.endsWith('.avi') ? 'video/x-msvideo'
            : 'video/mp4';
        res.setHeader('Accept-Ranges', 'bytes');
        res.setHeader('Content-Type', contentType);
        res.setHeader('Cache-Control', room.visibility === 'private' ? 'private, no-store' : 'private, max-age=60');

        const range = req.headers.range;
        if (!range) {
            res.setHeader('Content-Length', stat.size);
            return fs.createReadStream(filePath).pipe(res);
        }
        const rangeMatch = /^bytes=(\d*)-(\d*)$/.exec(String(range));
        if (!rangeMatch) {
            res.status(416);
            res.setHeader('Content-Range', `bytes */${stat.size}`);
            return res.end();
        }
        const start = rangeMatch[1] ? Number(rangeMatch[1]) : 0;
        const end = rangeMatch[2] ? Math.min(Number(rangeMatch[2]), stat.size - 1) : stat.size - 1;
        if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= stat.size) {
            res.status(416);
            res.setHeader('Content-Range', `bytes */${stat.size}`);
            return res.end();
        }
        res.status(206);
        res.setHeader('Content-Range', `bytes ${start}-${end}/${stat.size}`);
        res.setHeader('Content-Length', end - start + 1);
        fs.createReadStream(filePath, { start, end }).pipe(res);
    });
};

module.exports = { registerCinemaStream };
