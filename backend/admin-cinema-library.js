const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const jwt = require('jsonwebtoken');
const express = require('express');

const CHUNK_BYTES = 8 * 1024 * 1024;
const MAX_UPLOAD_BYTES = 16 * 1024 * 1024 * 1024;
const DISK_RESERVE_BYTES = 512 * 1024 * 1024;
const safeName = (value) => path.basename(String(value || 'video')).replace(/[\u0000-\u001f<>:"/\\|?*]/g, '_').trim().slice(0, 180) || 'video';
const toMysqlDate = (date) => date.toISOString().slice(0, 19).replace('T', ' ');

const registerAdminCinemaLibrary = ({ app, db }) => {
  const jwtSecret = String(process.env.JWT_SECRET || '');
  if (!jwtSecret) throw new Error('JWT_SECRET is required for Admin Cinema Library');

  const uploadsRoot = path.join(__dirname, 'uploads', 'cinema_chunks');
  const mediaRoot = path.join(__dirname, 'uploads', 'cinema_media');
  const rawChunk = express.raw({ type: 'application/octet-stream', limit: CHUNK_BYTES + 1024 * 1024 });
  let schemaPromise = null;

  const ensureSchema = async () => {
    if (!schemaPromise) {
      schemaPromise = (async () => {
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
        await fs.promises.mkdir(uploadsRoot, { recursive: true });
        await fs.promises.mkdir(mediaRoot, { recursive: true });
      })().catch((error) => {
        schemaPromise = null;
        throw error;
      });
    }
    return schemaPromise;
  };

  const verifyDesktopAdmin = async (req, res, next) => {
    const token = String(req.header('Authorization') || '').replace(/^Bearer\s+/i, '').trim();
    if (!token) return res.status(401).json({ message: 'Требуется desktop-сессия администратора.' });
    try {
      const decoded = jwt.verify(token, jwtSecret);
      if (decoded.scope !== 'admin-desktop' || decoded.role !== 'admin') return res.status(403).json({ message: 'Недостаточно прав.' });
      const [rows] = await db.query('SELECT id, role, isBlocked FROM users WHERE id = ? LIMIT 1', [decoded.id]);
      if (!rows.length || String(rows[0].role) !== 'admin' || String(rows[0].isBlocked || '') === 'заблокирован') {
        return res.status(403).json({ message: 'Права администратора отозваны.' });
      }
      req.desktopAdmin = rows[0];
      next();
    } catch {
      return res.status(401).json({ message: 'Desktop-сессия недействительна или истекла.' });
    }
  };

  const normalizeTitleBody = (body = {}) => ({
    title: String(body.title || '').trim().slice(0, 255),
    description: String(body.description || '').trim().slice(0, 20000) || null,
    posterUrl: String(body.posterUrl || '').trim().slice(0, 600) || null,
    mediaUrl: String(body.mediaUrl || '').trim().slice(0, 700) || null,
    contentType: body.contentType === 'series' ? 'series' : 'movie',
    genres: String(body.genres || '').trim().slice(0, 500) || null,
    releaseYear: Number(body.releaseYear) || null,
    releaseEndYear: Number(body.releaseEndYear) || null,
    durationMinutes: Number(body.durationMinutes) || null,
    country: String(body.country || '').trim().slice(0, 120) || null,
    ageRating: String(body.ageRating || '').trim().slice(0, 40) || null,
    isPublic: body.isPublic === false ? 0 : 1,
  });

  app.get('/admin/desktop/cinema/titles', verifyDesktopAdmin, async (req, res) => {
    await ensureSchema();
    const q = String(req.query.q || '').trim();
    const type = ['movie', 'series'].includes(String(req.query.type || '')) ? String(req.query.type) : '';
    const [rows] = await db.query(`SELECT t.*, COUNT(e.id) AS episode_count
      FROM cinema_titles t LEFT JOIN cinema_episodes e ON e.title_id = t.id
      WHERE (? = '' OR t.title LIKE ?) AND (? = '' OR t.content_type = ?)
      GROUP BY t.id ORDER BY t.created_at DESC LIMIT 500`, [q, `%${q}%`, type, type]);
    res.json({ titles: rows });
  });

  app.get('/admin/desktop/cinema/titles/:id', verifyDesktopAdmin, async (req, res) => {
    await ensureSchema();
    const [rows] = await db.query('SELECT * FROM cinema_titles WHERE id = ? LIMIT 1', [Number(req.params.id)]);
    if (!rows.length) return res.status(404).json({ message: 'Фильм или сериал не найден.' });
    const [episodes] = await db.query('SELECT * FROM cinema_episodes WHERE title_id = ? ORDER BY season_number, episode_number', [Number(req.params.id)]);
    res.json({ ...rows[0], episodes });
  });

  app.post('/admin/desktop/cinema/titles', verifyDesktopAdmin, async (req, res) => {
    await ensureSchema();
    const item = normalizeTitleBody(req.body);
    if (!item.title) return res.status(400).json({ message: 'Введите название.' });
    const [result] = await db.query(`INSERT INTO cinema_titles
      (title, description, poster_url, media_url, content_type, genres, release_year, release_end_year, duration_minutes, country, age_rating, created_by, is_public)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
      item.title, item.description, item.posterUrl, item.mediaUrl, item.contentType, item.genres,
      item.releaseYear, item.releaseEndYear, item.durationMinutes, item.country, item.ageRating,
      Number(req.desktopAdmin.id), item.isPublic,
    ]);
    res.status(201).json({ id: result.insertId, ...item });
  });

  app.patch('/admin/desktop/cinema/titles/:id', verifyDesktopAdmin, async (req, res) => {
    await ensureSchema();
    const id = Number(req.params.id);
    const item = normalizeTitleBody(req.body);
    if (!item.title) return res.status(400).json({ message: 'Введите название.' });
    const [result] = await db.query(`UPDATE cinema_titles SET
      title = ?, description = ?, poster_url = ?, media_url = ?, content_type = ?, genres = ?, release_year = ?,
      release_end_year = ?, duration_minutes = ?, country = ?, age_rating = ?, is_public = ? WHERE id = ?`, [
      item.title, item.description, item.posterUrl, item.mediaUrl, item.contentType, item.genres, item.releaseYear,
      item.releaseEndYear, item.durationMinutes, item.country, item.ageRating, item.isPublic, id,
    ]);
    if (!result.affectedRows) return res.status(404).json({ message: 'Фильм или сериал не найден.' });
    res.json({ updated: true, id });
  });

  app.delete('/admin/desktop/cinema/titles/:id', verifyDesktopAdmin, async (req, res) => {
    await ensureSchema();
    const [result] = await db.query('DELETE FROM cinema_titles WHERE id = ?', [Number(req.params.id)]);
    if (!result.affectedRows) return res.status(404).json({ message: 'Фильм или сериал не найден.' });
    res.json({ deleted: true });
  });

  app.post('/admin/desktop/cinema/titles/:id/episodes', verifyDesktopAdmin, async (req, res) => {
    await ensureSchema();
    const titleId = Number(req.params.id);
    const seasonNumber = Math.max(1, Number(req.body?.seasonNumber) || 1);
    const episodeNumber = Math.max(1, Number(req.body?.episodeNumber) || 1);
    const episodeTitle = String(req.body?.episodeTitle || '').trim().slice(0, 255) || null;
    const mediaUrl = String(req.body?.mediaUrl || '').trim().slice(0, 700) || null;
    const durationMinutes = Number(req.body?.durationMinutes) || null;
    const [titles] = await db.query("SELECT id, content_type FROM cinema_titles WHERE id = ? LIMIT 1", [titleId]);
    if (!titles.length) return res.status(404).json({ message: 'Сериал не найден.' });
    if (titles[0].content_type !== 'series') return res.status(409).json({ message: 'Серии можно добавлять только к сериалу.' });
    if (!mediaUrl) return res.status(400).json({ message: 'Сначала загрузите видео серии.' });
    try {
      const [result] = await db.query(`INSERT INTO cinema_episodes
        (title_id, season_number, episode_number, episode_title, media_url, duration_minutes)
        VALUES (?, ?, ?, ?, ?, ?)`, [titleId, seasonNumber, episodeNumber, episodeTitle, mediaUrl, durationMinutes]);
      res.status(201).json({ id: result.insertId, titleId, seasonNumber, episodeNumber, episodeTitle, mediaUrl, durationMinutes });
    } catch (error) {
      if (error?.code === 'ER_DUP_ENTRY') return res.status(409).json({ message: `Сезон ${seasonNumber}, серия ${episodeNumber} уже существует.` });
      throw error;
    }
  });

  app.patch('/admin/desktop/cinema/episodes/:id', verifyDesktopAdmin, async (req, res) => {
    await ensureSchema();
    const id = Number(req.params.id);
    const seasonNumber = Math.max(1, Number(req.body?.seasonNumber) || 1);
    const episodeNumber = Math.max(1, Number(req.body?.episodeNumber) || 1);
    const episodeTitle = String(req.body?.episodeTitle || '').trim().slice(0, 255) || null;
    const mediaUrl = String(req.body?.mediaUrl || '').trim().slice(0, 700) || null;
    const durationMinutes = Number(req.body?.durationMinutes) || null;
    try {
      const [result] = await db.query(`UPDATE cinema_episodes SET season_number = ?, episode_number = ?, episode_title = ?, media_url = ?, duration_minutes = ? WHERE id = ?`, [
        seasonNumber, episodeNumber, episodeTitle, mediaUrl, durationMinutes, id,
      ]);
      if (!result.affectedRows) return res.status(404).json({ message: 'Серия не найдена.' });
      res.json({ updated: true, id });
    } catch (error) {
      if (error?.code === 'ER_DUP_ENTRY') return res.status(409).json({ message: 'Серия с таким номером уже существует.' });
      throw error;
    }
  });

  app.delete('/admin/desktop/cinema/episodes/:id', verifyDesktopAdmin, async (req, res) => {
    await ensureSchema();
    const [result] = await db.query('DELETE FROM cinema_episodes WHERE id = ?', [Number(req.params.id)]);
    if (!result.affectedRows) return res.status(404).json({ message: 'Серия не найдена.' });
    res.json({ deleted: true });
  });

  app.post('/admin/desktop/cinema/uploads', verifyDesktopAdmin, async (req, res) => {
    await ensureSchema();
    const fileSize = Number(req.body?.fileSize || 0);
    const fileName = safeName(req.body?.fileName);
    const mimeType = String(req.body?.mimeType || 'application/octet-stream').slice(0, 255);
    if (!Number.isSafeInteger(fileSize) || fileSize <= 0 || fileSize > MAX_UPLOAD_BYTES) {
      return res.status(413).json({ message: 'Видео слишком большое.', maxBytes: MAX_UPLOAD_BYTES });
    }
    try {
      const disk = await fs.promises.statfs(mediaRoot);
      const freeBytes = Number(disk.bavail) * Number(disk.bsize);
      const requiredBytes = fileSize * 2 + DISK_RESERVE_BYTES;
      if (requiredBytes > freeBytes) {
        return res.status(507).json({
          message: 'На сервере недостаточно свободного места для безопасной загрузки этого видео.',
          freeBytes,
          requiredBytes,
          reserveBytes: DISK_RESERVE_BYTES,
        });
      }
    } catch {}
    const uploadId = crypto.randomUUID();
    const totalChunks = Math.ceil(fileSize / CHUNK_BYTES);
    await fs.promises.mkdir(path.join(uploadsRoot, uploadId), { recursive: true });
    await db.query(`INSERT INTO cinema_upload_sessions
      (upload_id, user_id, original_name, mime_type, file_size, chunk_size, total_chunks, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, [uploadId, Number(req.desktopAdmin.id), fileName, mimeType, fileSize, CHUNK_BYTES, totalChunks, toMysqlDate(new Date(Date.now() + 24 * 60 * 60 * 1000))]);
    res.status(201).json({ uploadId, chunkSize: CHUNK_BYTES, totalChunks, maxBytes: MAX_UPLOAD_BYTES, preservesOriginalBytes: true });
  });

  app.put('/admin/desktop/cinema/uploads/:uploadId/chunks/:index', verifyDesktopAdmin, rawChunk, async (req, res) => {
    await ensureSchema();
    const uploadId = String(req.params.uploadId);
    const index = Number(req.params.index);
    const [rows] = await db.query('SELECT * FROM cinema_upload_sessions WHERE upload_id = ? AND user_id = ? LIMIT 1', [uploadId, Number(req.desktopAdmin.id)]);
    if (!rows.length) return res.status(404).json({ message: 'Сессия загрузки не найдена.' });
    const session = rows[0];
    if (!Number.isInteger(index) || index < 0 || index >= Number(session.total_chunks)) return res.status(400).json({ message: 'Некорректный номер части.' });
    if (!Buffer.isBuffer(req.body) || req.body.length <= 0 || req.body.length > Number(session.chunk_size)) return res.status(400).json({ message: 'Некорректная часть файла.' });
    await fs.promises.writeFile(path.join(uploadsRoot, uploadId, `${index}.part`), req.body, { flag: 'w' });
    await db.query('UPDATE cinema_upload_sessions SET updated_at = CURRENT_TIMESTAMP WHERE upload_id = ?', [uploadId]);
    res.json({ received: true, index, bytes: req.body.length });
  });

  app.post('/admin/desktop/cinema/uploads/:uploadId/complete', verifyDesktopAdmin, async (req, res) => {
    await ensureSchema();
    const uploadId = String(req.params.uploadId);
    const [rows] = await db.query('SELECT * FROM cinema_upload_sessions WHERE upload_id = ? AND user_id = ? LIMIT 1', [uploadId, Number(req.desktopAdmin.id)]);
    if (!rows.length) return res.status(404).json({ message: 'Сессия загрузки не найдена.' });
    const session = rows[0];
    const extension = path.extname(session.original_name).slice(0, 20);
    const finalName = `${crypto.randomUUID()}${extension}`;
    const finalPath = path.join(mediaRoot, finalName);
    const output = fs.createWriteStream(finalPath, { flags: 'wx' });
    let written = 0;
    try {
      for (let index = 0; index < Number(session.total_chunks); index += 1) {
        const chunk = await fs.promises.readFile(path.join(uploadsRoot, uploadId, `${index}.part`));
        written += chunk.length;
        if (!output.write(chunk)) await new Promise((resolve) => output.once('drain', resolve));
      }
      await new Promise((resolve, reject) => { output.end(resolve); output.on('error', reject); });
      if (written !== Number(session.file_size)) throw new Error('Uploaded size mismatch');
    } catch {
      output.destroy();
      await fs.promises.rm(finalPath, { force: true }).catch(() => undefined);
      return res.status(409).json({ message: 'Не все части видео загружены. Повторите загрузку.' });
    }
    await fs.promises.rm(path.join(uploadsRoot, uploadId), { recursive: true, force: true });
    await db.query('DELETE FROM cinema_upload_sessions WHERE upload_id = ?', [uploadId]);
    res.json({
      complete: true,
      mediaUrl: `/cinema/media/${finalName}`,
      fileName: session.original_name,
      fileSize: Number(session.file_size),
      mimeType: session.mime_type,
      recompressed: false,
    });
  });
};

module.exports = { registerAdminCinemaLibrary };
