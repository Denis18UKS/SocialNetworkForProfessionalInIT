import fs from 'node:fs';

const replaceRequired = (source, from, to, label) => {
  if (!source.includes(from)) throw new Error(`C-Party format normalization patch failed: ${label}`);
  return source.replace(from, to);
};

const patchBackend = () => {
  const file = 'backend/admin-cinema-library.js';
  let source = fs.readFileSync(file, 'utf8');
  const marker = '// CPARTY_FORMAT_NORMALIZATION_V1';
  if (source.includes(marker)) return;

  source = replaceRequired(
    source,
    "const express = require('express');",
    "const express = require('express');\nconst { spawn } = require('child_process');\n\n// CPARTY_FORMAT_NORMALIZATION_V1",
    'backend child process import',
  );

  source = replaceRequired(
    source,
    "  const uploadsRoot = path.join(__dirname, 'uploads', 'cinema_chunks');\n  const mediaRoot = path.join(__dirname, 'uploads', 'cinema_media');",
    "  const uploadsRoot = path.join(__dirname, 'uploads', 'cinema_chunks');\n  const mediaRoot = path.join(__dirname, 'uploads', 'cinema_media');\n  const incomingRoot = path.join(mediaRoot, '.incoming');\n  const jobsRoot = path.join(mediaRoot, '.jobs');\n  const transcodeWorker = path.join(__dirname, 'cinema-transcode-worker.js');",
    'backend media roots',
  );

  source = replaceRequired(
    source,
    "        await fs.promises.mkdir(uploadsRoot, { recursive: true });\n        await fs.promises.mkdir(mediaRoot, { recursive: true });",
    "        await fs.promises.mkdir(uploadsRoot, { recursive: true });\n        await fs.promises.mkdir(mediaRoot, { recursive: true });\n        await fs.promises.mkdir(incomingRoot, { recursive: true });\n        await fs.promises.mkdir(jobsRoot, { recursive: true });",
    'backend job directories',
  );

  const titleRouteAnchor = "\n  app.get('/admin/desktop/cinema/titles', verifyDesktopAdmin, async (req, res) => {";
  const statusRoute = `\n  app.get('/admin/desktop/cinema/transcode/:jobId', async (req, res) => {\n    await ensureSchema();\n    const jobId = String(req.params.jobId || '');\n    if (!/^[0-9a-f-]{36}$/i.test(jobId)) return res.status(404).json({ message: 'Задание конвертации не найдено.' });\n    const jobFile = path.join(jobsRoot, \`\${jobId}.json\`);\n    let job;\n    try { job = JSON.parse(await fs.promises.readFile(jobFile, 'utf8')); }\n    catch { return res.status(404).json({ message: 'Задание конвертации не найдено.' }); }\n    const supplied = String(req.query.key || '');\n    const expected = String(job.key || '');\n    if (!supplied || !expected || supplied.length !== expected.length) return res.status(403).json({ message: 'Недействительный ключ задания.' });\n    const left = Buffer.from(supplied);\n    const right = Buffer.from(expected);\n    if (left.length !== right.length || !crypto.timingSafeEqual(left, right)) return res.status(403).json({ message: 'Недействительный ключ задания.' });\n    const { key, sourcePath, ...safeJob } = job;\n    res.json(safeJob);\n  });\n`;
  source = replaceRequired(source, titleRouteAnchor, `${statusRoute}${titleRouteAnchor}`, 'backend transcode status route');

  const oldComplete = `  app.post('/admin/desktop/cinema/uploads/:uploadId/complete', verifyDesktopAdmin, async (req, res) => {\n    await ensureSchema();\n    const uploadId = String(req.params.uploadId);\n    const [rows] = await db.query('SELECT * FROM cinema_upload_sessions WHERE upload_id = ? AND user_id = ? LIMIT 1', [uploadId, Number(req.desktopAdmin.id)]);\n    if (!rows.length) return res.status(404).json({ message: 'Сессия загрузки не найдена.' });\n    const session = rows[0];\n    const extension = path.extname(session.original_name).slice(0, 20);\n    const finalName = \`\${crypto.randomUUID()}\${extension}\`;\n    const finalPath = path.join(mediaRoot, finalName);\n    const output = fs.createWriteStream(finalPath, { flags: 'wx' });\n    let written = 0;\n    try {\n      for (let index = 0; index < Number(session.total_chunks); index += 1) {\n        const chunk = await fs.promises.readFile(path.join(uploadsRoot, uploadId, \`\${index}.part\`));\n        written += chunk.length;\n        if (!output.write(chunk)) await new Promise((resolve) => output.once('drain', resolve));\n      }\n      await new Promise((resolve, reject) => { output.end(resolve); output.on('error', reject); });\n      if (written !== Number(session.file_size)) throw new Error('Uploaded size mismatch');\n    } catch {\n      output.destroy();\n      await fs.promises.rm(finalPath, { force: true }).catch(() => undefined);\n      return res.status(409).json({ message: 'Не все части видео загружены. Повторите загрузку.' });\n    }\n    await fs.promises.rm(path.join(uploadsRoot, uploadId), { recursive: true, force: true });\n    await db.query('DELETE FROM cinema_upload_sessions WHERE upload_id = ?', [uploadId]);\n    res.json({\n      complete: true,\n      mediaUrl: \`/cinema/media/\${finalName}\`,\n      fileName: session.original_name,\n      fileSize: Number(session.file_size),\n      mimeType: session.mime_type,\n      recompressed: false,\n    });\n  });`;

  const newComplete = `  app.post('/admin/desktop/cinema/uploads/:uploadId/complete', verifyDesktopAdmin, async (req, res) => {\n    await ensureSchema();\n    const uploadId = String(req.params.uploadId);\n    const [rows] = await db.query('SELECT * FROM cinema_upload_sessions WHERE upload_id = ? AND user_id = ? LIMIT 1', [uploadId, Number(req.desktopAdmin.id)]);\n    if (!rows.length) return res.status(404).json({ message: 'Сессия загрузки не найдена.' });\n    const session = rows[0];\n    const extension = path.extname(session.original_name).toLowerCase().replace(/[^.a-z0-9]/g, '').slice(0, 20) || '.video';\n    const incomingName = \`\${crypto.randomUUID()}\${extension}\`;\n    const incomingPath = path.join(incomingRoot, incomingName);\n    const output = fs.createWriteStream(incomingPath, { flags: 'wx' });\n    let written = 0;\n    try {\n      for (let index = 0; index < Number(session.total_chunks); index += 1) {\n        const chunk = await fs.promises.readFile(path.join(uploadsRoot, uploadId, \`\${index}.part\`));\n        written += chunk.length;\n        if (!output.write(chunk)) await new Promise((resolve) => output.once('drain', resolve));\n      }\n      await new Promise((resolve, reject) => { output.end(resolve); output.on('error', reject); });\n      if (written !== Number(session.file_size)) throw new Error('Uploaded size mismatch');\n    } catch {\n      output.destroy();\n      await fs.promises.rm(incomingPath, { force: true }).catch(() => undefined);\n      return res.status(409).json({ message: 'Не все части видео загружены. Повторите загрузку.' });\n    }\n\n    await fs.promises.rm(path.join(uploadsRoot, uploadId), { recursive: true, force: true });\n    await db.query('DELETE FROM cinema_upload_sessions WHERE upload_id = ?', [uploadId]);\n\n    const jobId = crypto.randomUUID();\n    const jobKey = crypto.randomBytes(24).toString('hex');\n    const jobFile = path.join(jobsRoot, \`\${jobId}.json\`);\n    await fs.promises.writeFile(jobFile, JSON.stringify({\n      jobId,\n      key: jobKey,\n      status: 'queued',\n      stage: 'queued',\n      complete: false,\n      sourcePath: incomingPath,\n      originalName: session.original_name,\n      originalMimeType: session.mime_type,\n      originalFileSize: Number(session.file_size),\n      createdAt: new Date().toISOString(),\n      updatedAt: new Date().toISOString(),\n    }), 'utf8');\n\n    try {\n      const child = spawn(process.execPath, [transcodeWorker, jobFile, incomingPath, mediaRoot], {\n        detached: true,\n        stdio: 'ignore',\n        cwd: __dirname,\n        env: process.env,\n      });\n      child.unref();\n    } catch (error) {\n      await fs.promises.rm(incomingPath, { force: true }).catch(() => undefined);\n      await fs.promises.rm(jobFile, { force: true }).catch(() => undefined);\n      return res.status(500).json({ message: \`Не удалось запустить обработку видео: \${error.message}\` });\n    }\n\n    res.status(202).json({\n      complete: false,\n      processing: true,\n      jobId,\n      jobKey,\n      statusUrl: \`/admin/desktop/cinema/transcode/\${jobId}\`,\n      fileName: session.original_name,\n      fileSize: Number(session.file_size),\n      mimeType: session.mime_type,\n    });\n  });`;
  source = replaceRequired(source, oldComplete, newComplete, 'backend upload completion');

  fs.writeFileSync(file, source, 'utf8');
};

const patchAdminDesktop = () => {
  const file = 'admin-desktop/main.cjs';
  let source = fs.readFileSync(file, 'utf8');
  const marker = '// CPARTY_FORMAT_NORMALIZATION_V1';
  if (source.includes(marker)) return;

  source = replaceRequired(
    source,
    "const CINEMA_UPLOAD_RETRIES = 3;",
    "const CINEMA_UPLOAD_RETRIES = 3;\nconst CINEMA_TRANSCODE_POLL_MS = 2000;\n// CPARTY_FORMAT_NORMALIZATION_V1",
    'desktop marker',
  );

  source = replaceRequired(
    source,
    `const mimeFromName = (name) => {\n  const ext = path.extname(String(name || '')).toLowerCase();\n  if (ext === '.webm') return 'video/webm';\n  if (ext === '.mov') return 'video/quicktime';\n  if (ext === '.mkv') return 'video/x-matroska';\n  if (ext === '.m4v') return 'video/x-m4v';\n  if (ext === '.avi') return 'video/x-msvideo';\n  return 'video/mp4';\n};`,
    `const mimeFromName = (name) => {\n  const ext = path.extname(String(name || '')).toLowerCase();\n  if (ext === '.webm') return 'video/webm';\n  if (ext === '.mov') return 'video/quicktime';\n  if (ext === '.mkv') return 'video/x-matroska';\n  if (ext === '.m4v') return 'video/x-m4v';\n  if (ext === '.avi') return 'video/x-msvideo';\n  if (ext === '.wmv') return 'video/x-ms-wmv';\n  if (ext === '.flv') return 'video/x-flv';\n  if (['.mpg', '.mpeg'].includes(ext)) return 'video/mpeg';\n  if (['.ts', '.m2ts'].includes(ext)) return 'video/mp2t';\n  if (ext === '.3gp') return 'video/3gpp';\n  if (ext === '.ogv') return 'video/ogg';\n  return 'video/mp4';\n};`,
    'desktop mime support',
  );

  source = replaceRequired(
    source,
    "      { name: 'Видео', extensions: ['mp4', 'webm', 'mov', 'mkv', 'm4v', 'avi'] },",
    "      { name: 'Видео', extensions: ['mp4', 'webm', 'mov', 'mkv', 'm4v', 'avi', 'wmv', 'flv', 'mpg', 'mpeg', 'ts', 'm2ts', '3gp', 'ogv'] },",
    'desktop file picker formats',
  );

  const oldFinish = `  const completed = await request(\`/admin/desktop/cinema/uploads/\${encodeURIComponent(started.uploadId)}/complete\`, {\n    method: 'POST', token, timeoutMs: 120000, body: {},\n  });\n  pickedCinemaFiles.delete(String(fileId));\n  event.sender.send('admin:cinema-upload-progress', {\n    fileId: String(fileId), name: record.name, loaded: record.size, total: record.size, percent: 100, complete: true,\n  });\n  return completed;`;

  const newFinish = `  let completed = await request(\`/admin/desktop/cinema/uploads/\${encodeURIComponent(started.uploadId)}/complete\`, {\n    method: 'POST', token, timeoutMs: 120000, body: {},\n  });\n\n  if (completed?.processing && completed?.jobId && completed?.jobKey) {\n    event.sender.send('admin:cinema-upload-progress', {\n      fileId: String(fileId), name: record.name, loaded: record.size, total: record.size, percent: 96,\n      phase: 'processing', message: 'Проверяем формат и готовим видео для браузера…',\n    });\n    while (true) {\n      await sleep(CINEMA_TRANSCODE_POLL_MS);\n      const status = await request(\`/admin/desktop/cinema/transcode/\${encodeURIComponent(completed.jobId)}?key=\${encodeURIComponent(completed.jobKey)}\`, {\n        timeoutMs: 30000,\n      });\n      if (status?.status === 'error') {\n        throw new Error(\`FFmpeg не смог подготовить видео: \${status.error || 'неизвестная ошибка'}\`);\n      }\n      if (status?.status === 'ready' && status?.mediaUrl) {\n        completed = status;\n        break;\n      }\n      const phaseText = status?.stage === 'probe'\n        ? 'Проверяем кодеки…'\n        : status?.stage === 'remux'\n          ? 'Перекладываем видео в MP4 без потери качества…'\n          : status?.stage === 'audio-transcode'\n            ? 'Видео совместимо; конвертируем звук в AAC…'\n            : status?.stage === 'transcode'\n              ? 'Конвертируем видео в MP4 (H.264 + AAC)…'\n              : 'Готовим видео для браузера…';\n      event.sender.send('admin:cinema-upload-progress', {\n        fileId: String(fileId), name: record.name, loaded: record.size, total: record.size, percent: 98,\n        phase: status?.stage || 'processing', message: phaseText,\n      });\n    }\n  }\n\n  pickedCinemaFiles.delete(String(fileId));\n  event.sender.send('admin:cinema-upload-progress', {\n    fileId: String(fileId), name: record.name, loaded: record.size, total: record.size, percent: 100, complete: true,\n    phase: 'complete', message: completed?.recompressed ? 'Видео готово: MP4 (H.264 + AAC).' : completed?.remuxed ? 'Видео готово: MP4 без пережатия.' : 'Видео готово.',\n  });\n  return completed;`;
  source = replaceRequired(source, oldFinish, newFinish, 'desktop async conversion polling');
  fs.writeFileSync(file, source, 'utf8');
};

const patchRenderer = () => {
  const file = 'admin-desktop/renderer/cinema.js';
  let source = fs.readFileSync(file, 'utf8');
  if (!source.includes('Видео сохраняется без перекодирования. Для сериала видео добавляется отдельно к каждой серии.')) return;
  source = source.replace(
    "  label.textContent = `${state.upload.name || 'Видео'} — ${percent}% · ${formatBytes(state.upload.loaded)} / ${formatBytes(state.upload.total)}`;",
    "  label.textContent = state.upload.message || `${state.upload.name || 'Видео'} — ${percent}% · ${formatBytes(state.upload.loaded)} / ${formatBytes(state.upload.total)}`;",
  );
  source = source.replace(
    'Видео сохраняется без перекодирования. Для сериала видео добавляется отдельно к каждой серии.',
    'MP4/WebM с совместимыми кодеками сохраняются без пережатия. AVI, MKV, MOV, WMV и другие форматы автоматически приводятся к браузерному MP4 (H.264 + AAC). Для сериала видео добавляется отдельно к каждой серии.',
  );
  fs.writeFileSync(file, source, 'utf8');
};

patchBackend();
patchAdminDesktop();
patchRenderer();
console.log('C-Party video format normalization is current: FFprobe detection, MP4 remux/transcode and desktop polling.');
