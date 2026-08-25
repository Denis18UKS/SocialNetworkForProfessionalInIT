import fs from 'node:fs';

const replaceRequired = (source, from, to, label) => {
  if (!source.includes(from)) throw new Error(`C-Party existing media normalization patch failed: ${label}`);
  return source.replace(from, to);
};

const patchBackend = () => {
  const file = 'backend/admin-cinema-library.js';
  let source = fs.readFileSync(file, 'utf8');
  const marker = '// CPARTY_EXISTING_NORMALIZE_V1';
  if (source.includes(marker)) return;

  const anchor = "  app.get('/admin/desktop/cinema/transcode/:jobId', async (req, res) => {";
  const route = `  // CPARTY_EXISTING_NORMALIZE_V1\n  app.post('/admin/desktop/cinema/normalize-existing', verifyDesktopAdmin, async (req, res) => {\n    await ensureSchema();\n    const mediaUrl = String(req.body?.mediaUrl || '');\n    const match = /^\\/cinema\\/media\\/([a-zA-Z0-9._-]+)$/.exec(mediaUrl);\n    if (!match) return res.status(400).json({ message: 'Можно подготовить только видео, загруженное в локальную библиотеку C-Party.' });\n    const fileName = path.basename(match[1]);\n    const sourceFile = path.join(mediaRoot, fileName);\n    let stat;\n    try { stat = await fs.promises.stat(sourceFile); }\n    catch { return res.status(404).json({ message: 'Исходный видеофайл не найден на сервере.' }); }\n    if (!stat.isFile()) return res.status(404).json({ message: 'Исходный видеофайл не найден на сервере.' });\n\n    const extension = path.extname(fileName).toLowerCase().replace(/[^.a-z0-9]/g, '').slice(0, 20) || '.video';\n    const incomingPath = path.join(incomingRoot, \`\${crypto.randomUUID()}\${extension}\`);\n    try {\n      await fs.promises.link(sourceFile, incomingPath);\n    } catch (error) {\n      return res.status(500).json({ message: \`Не удалось подготовить существующий файл к обработке: \${error.message}\` });\n    }\n\n    const jobId = crypto.randomUUID();\n    const jobKey = crypto.randomBytes(24).toString('hex');\n    const jobFile = path.join(jobsRoot, \`\${jobId}.json\`);\n    await fs.promises.writeFile(jobFile, JSON.stringify({\n      jobId,\n      key: jobKey,\n      status: 'queued',\n      stage: 'queued',\n      complete: false,\n      sourcePath: incomingPath,\n      originalName: fileName,\n      originalMimeType: null,\n      originalFileSize: Number(stat.size),\n      createdAt: new Date().toISOString(),\n      updatedAt: new Date().toISOString(),\n    }), 'utf8');\n\n    try {\n      const child = spawn(process.execPath, [transcodeWorker, jobFile, incomingPath, mediaRoot], {\n        detached: true,\n        stdio: 'ignore',\n        cwd: __dirname,\n        env: process.env,\n      });\n      child.unref();\n    } catch (error) {\n      await fs.promises.rm(incomingPath, { force: true }).catch(() => undefined);\n      await fs.promises.rm(jobFile, { force: true }).catch(() => undefined);\n      return res.status(500).json({ message: \`Не удалось запустить обработку видео: \${error.message}\` });\n    }\n\n    res.status(202).json({ processing: true, complete: false, jobId, jobKey, statusUrl: \`/admin/desktop/cinema/transcode/\${jobId}\` });\n  });\n\n`;
  source = replaceRequired(source, anchor, `${route}${anchor}`, 'backend normalize-existing route');
  fs.writeFileSync(file, source, 'utf8');
};

const patchMain = () => {
  const file = 'admin-desktop/main.cjs';
  let source = fs.readFileSync(file, 'utf8');
  const marker = '// CPARTY_EXISTING_NORMALIZE_V1';
  if (source.includes(marker)) return;

  const anchor = "ipcMain.handle('admin:cinema-delete-episode', (_event, id) => request(`/admin/desktop/cinema/episodes/${Number(id)}`, {\n  method: 'DELETE', token: requireDesktopSession(),\n}));\n";
  const handler = `${anchor}\n// CPARTY_EXISTING_NORMALIZE_V1\nipcMain.handle('admin:cinema-normalize-existing', async (event, payload) => {\n  const token = requireDesktopSession();\n  const mediaUrl = String(payload?.mediaUrl || '');\n  const displayName = String(payload?.name || 'Видео');\n  let status = await request('/admin/desktop/cinema/normalize-existing', {\n    method: 'POST', token, timeoutMs: 30000, body: { mediaUrl },\n  });\n  event.sender.send('admin:cinema-upload-progress', { name: displayName, loaded: 0, total: 0, percent: 96, phase: 'processing', message: 'Проверяем кодеки существующего видео…' });\n  while (status?.processing && status?.jobId && status?.jobKey) {\n    await sleep(CINEMA_TRANSCODE_POLL_MS);\n    const next = await request(\`/admin/desktop/cinema/transcode/\${encodeURIComponent(status.jobId)}?key=\${encodeURIComponent(status.jobKey)}\`, { timeoutMs: 30000 });\n    if (next?.status === 'error') throw new Error(\`FFmpeg не смог подготовить видео: \${next.error || 'неизвестная ошибка'}\`);\n    if (next?.status === 'ready' && next?.mediaUrl) {\n      event.sender.send('admin:cinema-upload-progress', { name: displayName, loaded: 0, total: 0, percent: 100, complete: true, phase: 'complete', message: 'Видео подготовлено для браузерного плеера.' });\n      return next;\n    }\n    const phaseText = next?.stage === 'remux'\n      ? 'Перекладываем видео в MP4 без потери качества…'\n      : next?.stage === 'audio-transcode'\n        ? 'Конвертируем звук в AAC…'\n        : next?.stage === 'transcode'\n          ? 'Конвертируем видео в MP4 (H.264 + AAC)…'\n          : 'Проверяем кодеки существующего видео…';\n    event.sender.send('admin:cinema-upload-progress', { name: displayName, loaded: 0, total: 0, percent: 98, phase: next?.stage || 'processing', message: phaseText });\n  }\n  throw new Error('Сервер не создал задание обработки видео.');\n});\n`;
  source = replaceRequired(source, anchor, handler, 'desktop existing normalization handler');
  fs.writeFileSync(file, source, 'utf8');
};

const patchPreload = () => {
  const file = 'admin-desktop/preload.cjs';
  let source = fs.readFileSync(file, 'utf8');
  if (source.includes('normalizeExistingCinemaVideo')) return;
  source = replaceRequired(
    source,
    "  uploadCinemaVideo: (fileId) => ipcRenderer.invoke('admin:cinema-upload-video', fileId),",
    "  uploadCinemaVideo: (fileId) => ipcRenderer.invoke('admin:cinema-upload-video', fileId),\n  normalizeExistingCinemaVideo: (payload) => ipcRenderer.invoke('admin:cinema-normalize-existing', payload),",
    'preload API',
  );
  fs.writeFileSync(file, source, 'utf8');
};

const patchRenderer = () => {
  const file = 'admin-desktop/renderer/cinema.js';
  let source = fs.readFileSync(file, 'utf8');
  const marker = '// CPARTY_EXISTING_NORMALIZE_V1';
  if (source.includes(marker)) return;

  source = replaceRequired(
    source,
    "const typeLabel = (type) => type === 'series' ? 'Сериал' : 'Фильм';",
    "const typeLabel = (type) => type === 'series' ? 'Сериал' : 'Фильм';\n// CPARTY_EXISTING_NORMALIZE_V1\nconst needsBrowserNormalization = (url) => /\\.(avi|mkv|mov|m4v|wmv|flv|mpg|mpeg|ts|m2ts|3gp|ogv)(?:$|[?#])/i.test(String(url || ''));",
    'renderer format predicate',
  );

  const deleteTitleAnchor = "async function deleteSelectedTitle() {";
  const normalizeFunctions = `async function normalizeSelectedMovie() {\n  const item = state.selected;\n  if (!item?.media_url) return;\n  state.busy = true;\n  state.error = '';\n  state.notice = '';\n  state.upload = { name: item.title || 'Видео', loaded: 0, total: 0, percent: 96, message: 'Запускаем обработку видео…' };\n  render();\n  try {\n    const normalized = await api.normalizeExistingCinemaVideo({ mediaUrl: item.media_url, name: item.title || 'Видео' });\n    await api.updateCinemaTitle({\n      id: Number(item.id),\n      data: {\n        title: item.title || '', description: item.description || '', posterUrl: item.poster_url || '', mediaUrl: normalized.mediaUrl,\n        contentType: item.content_type === 'series' ? 'series' : 'movie', genres: item.genres || '', releaseYear: item.release_year || '',\n        releaseEndYear: item.release_end_year || '', durationMinutes: item.duration_minutes || '', country: item.country || '',\n        ageRating: item.age_rating || '', isPublic: Boolean(item.is_public),\n      },\n    });\n    state.selected = await api.getCinemaTitle(Number(item.id));\n    state.notice = normalized.recompressed ? 'Видео конвертировано в MP4 (H.264 + AAC).' : normalized.remuxed ? 'Видео подготовлено как MP4 без пережатия.' : 'Видео подготовлено для плеера.';\n    state.upload = null;\n  } catch (error) {\n    state.error = errorText(error);\n  } finally {\n    state.busy = false;\n    render();\n  }\n}\n\nasync function normalizeEpisode(id) {\n  const item = state.selected;\n  const episode = Array.isArray(item?.episodes) ? item.episodes.find((entry) => Number(entry.id) === Number(id)) : null;\n  if (!episode?.media_url) return;\n  state.busy = true;\n  state.error = '';\n  state.notice = '';\n  state.upload = { name: episode.episode_title || \`Серия \${episode.episode_number}\`, loaded: 0, total: 0, percent: 96, message: 'Запускаем обработку серии…' };\n  render();\n  try {\n    const normalized = await api.normalizeExistingCinemaVideo({ mediaUrl: episode.media_url, name: episode.episode_title || \`Серия \${episode.episode_number}\` });\n    await api.updateCinemaEpisode({\n      id: Number(episode.id),\n      data: { seasonNumber: episode.season_number, episodeNumber: episode.episode_number, episodeTitle: episode.episode_title || '', mediaUrl: normalized.mediaUrl, durationMinutes: episode.duration_minutes || '' },\n    });\n    state.selected = await api.getCinemaTitle(Number(item.id));\n    state.notice = 'Видео серии подготовлено для браузерного плеера.';\n    state.upload = null;\n  } catch (error) {\n    state.error = errorText(error);\n  } finally {\n    state.busy = false;\n    render();\n  }\n}\n\n`;
  source = replaceRequired(source, deleteTitleAnchor, `${normalizeFunctions}${deleteTitleAnchor}`, 'renderer normalization functions');

  source = replaceRequired(
    source,
    '<div class="actions"><button id="title-edit" class="secondary" type="button">Редактировать</button><button id="title-delete" class="danger" type="button">Удалить</button></div>',
    '<div class="actions">${item.content_type === \'movie\' && needsBrowserNormalization(item.media_url) ? \'<button id="title-normalize" class="primary" type="button">Подготовить видео для плеера</button>\' : \'\'}<button id="title-edit" class="secondary" type="button">Редактировать</button><button id="title-delete" class="danger" type="button">Удалить</button></div>',
    'renderer movie normalize button',
  );

  source = replaceRequired(
    source,
    '      ${messageBlock()}\n      <div class="cinema-meta-grid">',
    '      ${messageBlock()}\n      ${state.upload ? `<div class="cinema-upload-box"><div><strong>Обработка видео</strong></div><div class="cinema-progress"><progress id="cinema-upload-progress-bar" max="100" value="${Number(state.upload?.percent || 0)}"></progress><span id="cinema-upload-progress-label"></span></div></div>` : \'\'}\n      <div class="cinema-meta-grid">',
    'renderer selected progress',
  );

  source = replaceRequired(
    source,
    '<td><button class="danger small episode-delete" data-id="${esc(episode.id)}" type="button">Удалить</button></td>',
    '<td><div class="actions">${needsBrowserNormalization(episode.media_url) ? `<button class="secondary small episode-normalize" data-id="${esc(episode.id)}" type="button">Подготовить</button>` : \'\'}<button class="danger small episode-delete" data-id="${esc(episode.id)}" type="button">Удалить</button></div></td>',
    'renderer episode normalize button',
  );

  source = replaceRequired(
    source,
    "  document.getElementById('title-delete')?.addEventListener('click', deleteSelectedTitle);",
    "  document.getElementById('title-delete')?.addEventListener('click', deleteSelectedTitle);\n  document.getElementById('title-normalize')?.addEventListener('click', normalizeSelectedMovie);",
    'renderer movie normalize binding',
  );

  source = replaceRequired(
    source,
    "  document.querySelectorAll('.episode-delete').forEach((button) => button.addEventListener('click', () => deleteEpisode(Number(button.dataset.id))));",
    "  document.querySelectorAll('.episode-delete').forEach((button) => button.addEventListener('click', () => deleteEpisode(Number(button.dataset.id))));\n  document.querySelectorAll('.episode-normalize').forEach((button) => button.addEventListener('click', () => normalizeEpisode(Number(button.dataset.id))));",
    'renderer episode normalize binding',
  );

  fs.writeFileSync(file, source, 'utf8');
};

patchBackend();
patchMain();
patchPreload();
patchRenderer();
console.log('Existing C-Party library videos can now be normalized in place without re-uploading the source file.');
