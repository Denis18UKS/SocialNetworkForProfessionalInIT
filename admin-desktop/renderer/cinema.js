const api = window.socialBirdAdmin;
const root = document.getElementById('cinema-app');

const state = {
  titles: [],
  selected: null,
  query: '',
  type: '',
  mode: 'browse',
  draft: null,
  movieFile: null,
  episodeFile: null,
  episodeDraft: { seasonNumber: 1, episodeNumber: 1, episodeTitle: '', durationMinutes: '' },
  busy: false,
  error: '',
  notice: '',
  upload: null,
};

const esc = (value) => String(value ?? '')
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#039;');

const formatBytes = (value) => {
  const bytes = Number(value || 0);
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 Б';
  const units = ['Б', 'КБ', 'МБ', 'ГБ', 'ТБ'];
  let size = bytes;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return `${size >= 100 || unit === 0 ? size.toFixed(0) : size.toFixed(1)} ${units[unit]}`;
};

const errorText = (error) => error?.message || String(error || 'Неизвестная ошибка');
const messageBlock = () => `${state.error ? `<div class="error">${esc(state.error)}</div>` : ''}${state.notice ? `<div class="success">${esc(state.notice)}</div>` : ''}`;
const typeLabel = (type) => type === 'series' ? 'Сериал' : 'Фильм';

function defaultTitleDraft(contentType) {
  return {
    id: null,
    title: '',
    description: '',
    posterUrl: '',
    mediaUrl: '',
    contentType: contentType === 'series' ? 'series' : 'movie',
    genres: '',
    releaseYear: '',
    releaseEndYear: '',
    durationMinutes: '',
    country: '',
    ageRating: '',
    isPublic: true,
  };
}

function updateUploadProgress() {
  const bar = document.getElementById('cinema-upload-progress-bar');
  const label = document.getElementById('cinema-upload-progress-label');
  if (!bar || !label) return;
  const percent = Math.max(0, Math.min(100, Number(state.upload?.percent || 0)));
  bar.value = percent;
  if (!state.upload) {
    label.textContent = '';
    return;
  }
  label.textContent = `${state.upload.name || 'Видео'} — ${percent}% · ${formatBytes(state.upload.loaded)} / ${formatBytes(state.upload.total)}`;
}

api.onCinemaUploadProgress((payload) => {
  state.upload = payload;
  updateUploadProgress();
});

async function refreshTitles() {
  state.busy = true;
  state.error = '';
  try {
    const data = await api.getCinemaTitles({ q: state.query, type: state.type });
    state.titles = Array.isArray(data?.titles) ? data.titles : [];
  } catch (error) {
    state.error = errorText(error);
  } finally {
    state.busy = false;
    render();
  }
}

async function openTitle(id) {
  state.busy = true;
  state.error = '';
  try {
    state.selected = await api.getCinemaTitle(id);
    state.mode = 'browse';
    state.movieFile = null;
    state.episodeFile = null;
    const episodes = Array.isArray(state.selected?.episodes) ? state.selected.episodes : [];
    const last = episodes[episodes.length - 1];
    state.episodeDraft = {
      seasonNumber: Number(last?.season_number || 1),
      episodeNumber: last ? Number(last.episode_number || 0) + 1 : 1,
      episodeTitle: '',
      durationMinutes: '',
    };
  } catch (error) {
    state.error = errorText(error);
  } finally {
    state.busy = false;
    render();
  }
}

function startNew(contentType) {
  state.mode = 'form';
  state.selected = null;
  state.draft = defaultTitleDraft(contentType);
  state.movieFile = null;
  state.error = '';
  state.notice = '';
  render();
}

function startEdit() {
  const item = state.selected;
  if (!item) return;
  state.mode = 'form';
  state.draft = {
    id: Number(item.id),
    title: item.title || '',
    description: item.description || '',
    posterUrl: item.poster_url || '',
    mediaUrl: item.media_url || '',
    contentType: item.content_type === 'series' ? 'series' : 'movie',
    genres: item.genres || '',
    releaseYear: item.release_year || '',
    releaseEndYear: item.release_end_year || '',
    durationMinutes: item.duration_minutes || '',
    country: item.country || '',
    ageRating: item.age_rating || '',
    isPublic: Boolean(item.is_public),
  };
  state.movieFile = null;
  state.error = '';
  state.notice = '';
  render();
}

function readTitleForm() {
  return {
    id: state.draft?.id || null,
    title: document.getElementById('title-name')?.value.trim() || '',
    description: document.getElementById('title-description')?.value.trim() || '',
    posterUrl: document.getElementById('title-poster')?.value.trim() || '',
    mediaUrl: state.draft?.mediaUrl || '',
    contentType: document.getElementById('title-type')?.value === 'series' ? 'series' : 'movie',
    genres: document.getElementById('title-genres')?.value.trim() || '',
    releaseYear: document.getElementById('title-year')?.value || '',
    releaseEndYear: document.getElementById('title-end-year')?.value || '',
    durationMinutes: document.getElementById('title-duration')?.value || '',
    country: document.getElementById('title-country')?.value.trim() || '',
    ageRating: document.getElementById('title-rating')?.value.trim() || '',
    isPublic: Boolean(document.getElementById('title-public')?.checked),
  };
}

async function pickMovieFile() {
  state.draft = readTitleForm();
  try {
    const file = await api.pickCinemaVideo();
    if (file) state.movieFile = file;
    render();
  } catch (error) {
    state.error = errorText(error);
    render();
  }
}

async function uploadSelectedFile(file) {
  if (!file?.fileId) throw new Error('Сначала выберите видеофайл.');
  state.upload = { name: file.name, loaded: 0, total: file.size, percent: 0 };
  updateUploadProgress();
  try {
    return await api.uploadCinemaVideo(file.fileId);
  } finally {
    updateUploadProgress();
  }
}

async function saveTitle(event) {
  event.preventDefault();
  state.draft = readTitleForm();
  if (!state.draft.title) {
    state.error = 'Введите название.';
    render();
    return;
  }
  state.busy = true;
  state.error = '';
  state.notice = '';
  render();
  try {
    let mediaUrl = state.draft.mediaUrl || '';
    if (state.draft.contentType === 'movie' && state.movieFile) {
      const uploaded = await uploadSelectedFile(state.movieFile);
      mediaUrl = uploaded.mediaUrl;
    }
    const payload = { ...state.draft, mediaUrl };
    let id = state.draft.id;
    if (id) {
      await api.updateCinemaTitle({ id, data: payload });
      state.notice = 'Карточка обновлена.';
    } else {
      const created = await api.createCinemaTitle(payload);
      id = Number(created.id);
      state.notice = state.draft.contentType === 'series' ? 'Сериал добавлен в библиотеку.' : 'Фильм добавлен в библиотеку.';
    }
    state.movieFile = null;
    state.upload = null;
    const list = await api.getCinemaTitles({ q: state.query, type: state.type });
    state.titles = Array.isArray(list?.titles) ? list.titles : [];
    state.selected = await api.getCinemaTitle(id);
    state.mode = 'browse';
  } catch (error) {
    state.error = errorText(error);
  } finally {
    state.busy = false;
    render();
  }
}

async function deleteSelectedTitle() {
  if (!state.selected) return;
  if (!window.confirm(`Удалить «${state.selected.title}» из библиотеки C-Party? Серии тоже будут удалены.`)) return;
  state.busy = true;
  state.error = '';
  try {
    await api.deleteCinemaTitle(Number(state.selected.id));
    state.selected = null;
    state.notice = 'Карточка удалена из библиотеки.';
    const list = await api.getCinemaTitles({ q: state.query, type: state.type });
    state.titles = Array.isArray(list?.titles) ? list.titles : [];
  } catch (error) {
    state.error = errorText(error);
  } finally {
    state.busy = false;
    render();
  }
}

function readEpisodeForm() {
  return {
    seasonNumber: Math.max(1, Number(document.getElementById('episode-season')?.value || 1)),
    episodeNumber: Math.max(1, Number(document.getElementById('episode-number')?.value || 1)),
    episodeTitle: document.getElementById('episode-title')?.value.trim() || '',
    durationMinutes: document.getElementById('episode-duration')?.value || '',
  };
}

async function pickEpisodeFile() {
  state.episodeDraft = readEpisodeForm();
  try {
    const file = await api.pickCinemaVideo();
    if (file) state.episodeFile = file;
    render();
  } catch (error) {
    state.error = errorText(error);
    render();
  }
}

async function addEpisode(event) {
  event.preventDefault();
  if (!state.selected || state.selected.content_type !== 'series') return;
  state.episodeDraft = readEpisodeForm();
  if (!state.episodeFile) {
    state.error = 'Выберите видео серии.';
    render();
    return;
  }
  state.busy = true;
  state.error = '';
  state.notice = '';
  render();
  try {
    const uploaded = await uploadSelectedFile(state.episodeFile);
    await api.addCinemaEpisode({
      titleId: Number(state.selected.id),
      data: { ...state.episodeDraft, mediaUrl: uploaded.mediaUrl },
    });
    state.selected = await api.getCinemaTitle(Number(state.selected.id));
    const episodes = Array.isArray(state.selected.episodes) ? state.selected.episodes : [];
    const last = episodes[episodes.length - 1];
    state.episodeDraft = {
      seasonNumber: Number(last?.season_number || state.episodeDraft.seasonNumber || 1),
      episodeNumber: Number(last?.episode_number || 0) + 1,
      episodeTitle: '',
      durationMinutes: '',
    };
    state.episodeFile = null;
    state.upload = null;
    state.notice = 'Серия добавлена в библиотеку.';
    const list = await api.getCinemaTitles({ q: state.query, type: state.type });
    state.titles = Array.isArray(list?.titles) ? list.titles : [];
  } catch (error) {
    state.error = errorText(error);
  } finally {
    state.busy = false;
    render();
  }
}

async function deleteEpisode(id) {
  if (!window.confirm('Удалить эту серию из библиотеки?')) return;
  state.busy = true;
  state.error = '';
  try {
    await api.deleteCinemaEpisode(Number(id));
    state.selected = await api.getCinemaTitle(Number(state.selected.id));
    state.notice = 'Серия удалена.';
    const list = await api.getCinemaTitles({ q: state.query, type: state.type });
    state.titles = Array.isArray(list?.titles) ? list.titles : [];
  } catch (error) {
    state.error = errorText(error);
  } finally {
    state.busy = false;
    render();
  }
}

function renderTitleForm() {
  const d = state.draft || defaultTitleDraft('movie');
  const editing = Boolean(d.id);
  const movie = d.contentType !== 'series';
  return `
    <section class="cinema-panel cinema-editor">
      <div class="cinema-section-head">
        <div>
          <h2>${editing ? 'Редактирование' : 'Новая карточка'} · ${typeLabel(d.contentType)}</h2>
          <div class="subtle">Видео сохраняется без перекодирования. Для сериала видео добавляется отдельно к каждой серии.</div>
        </div>
        <button id="title-cancel" class="secondary" type="button">Отмена</button>
      </div>
      ${messageBlock()}
      <form id="title-form" class="cinema-form">
        <div class="cinema-grid-2">
          <div class="field"><label>Тип</label><select id="title-type" ${editing ? 'disabled' : ''}><option value="movie" ${movie ? 'selected' : ''}>Фильм</option><option value="series" ${!movie ? 'selected' : ''}>Сериал</option></select></div>
          <div class="field"><label>Название *</label><input id="title-name" maxlength="255" value="${esc(d.title)}" required /></div>
        </div>
        <div class="field"><label>Описание</label><textarea id="title-description" rows="5">${esc(d.description)}</textarea></div>
        <div class="cinema-grid-2">
          <div class="field"><label>Постер — URL</label><input id="title-poster" value="${esc(d.posterUrl)}" placeholder="https://..." /></div>
          <div class="field"><label>Жанры</label><input id="title-genres" value="${esc(d.genres)}" placeholder="Фантастика, драма" /></div>
        </div>
        <div class="cinema-grid-4">
          <div class="field"><label>Год начала</label><input id="title-year" type="number" min="1880" max="2200" value="${esc(d.releaseYear)}" /></div>
          <div class="field"><label>Год окончания</label><input id="title-end-year" type="number" min="1880" max="2200" value="${esc(d.releaseEndYear)}" /></div>
          <div class="field"><label>Длительность, мин.</label><input id="title-duration" type="number" min="1" value="${esc(d.durationMinutes)}" /></div>
          <div class="field"><label>Возрастной рейтинг</label><input id="title-rating" value="${esc(d.ageRating)}" placeholder="16+" /></div>
        </div>
        <div class="cinema-grid-2">
          <div class="field"><label>Страна</label><input id="title-country" value="${esc(d.country)}" /></div>
          <label class="cinema-checkbox"><input id="title-public" type="checkbox" ${d.isPublic ? 'checked' : ''} /> Показывать в общей библиотеке C-Party</label>
        </div>
        ${movie ? `
          <div class="cinema-upload-box">
            <div><strong>Видео фильма</strong><div class="subtle">${d.mediaUrl ? 'Видео уже загружено. Можно выбрать файл для замены.' : 'Для нового фильма выберите видеофайл.'}</div></div>
            <div class="actions">
              <button id="movie-pick" class="secondary" type="button">Выбрать видео</button>
              ${state.movieFile ? `<span class="file-chip">${esc(state.movieFile.name)} · ${formatBytes(state.movieFile.size)}</span>` : ''}
            </div>
            <div class="cinema-progress"><progress id="cinema-upload-progress-bar" max="100" value="${Number(state.upload?.percent || 0)}"></progress><span id="cinema-upload-progress-label"></span></div>
          </div>` : ''}
        <div class="actions cinema-submit-row">
          <button class="primary" type="submit" ${state.busy ? 'disabled' : ''}>${state.busy ? 'Сохранение…' : editing ? 'Сохранить изменения' : 'Добавить в библиотеку'}</button>
        </div>
      </form>
    </section>`;
}

function renderSelected() {
  const item = state.selected;
  if (!item) {
    return `<section class="cinema-panel cinema-empty-detail"><div><h2>Выберите фильм или сериал</h2><p class="muted">Слева находится библиотека C-Party. Можно создать новую карточку или открыть существующую.</p></div></section>`;
  }
  const episodes = Array.isArray(item.episodes) ? item.episodes : [];
  return `
    <section class="cinema-panel cinema-editor">
      <div class="cinema-section-head">
        <div>
          <div class="badge ${item.content_type === 'series' ? '' : 'good'}">${typeLabel(item.content_type)}</div>
          <h2>${esc(item.title)}</h2>
          <div class="subtle">${item.release_year ? esc(item.release_year) : 'Год не указан'}${item.release_end_year ? `–${esc(item.release_end_year)}` : ''} · ${esc(item.country || 'Страна не указана')}</div>
        </div>
        <div class="actions"><button id="title-edit" class="secondary" type="button">Редактировать</button><button id="title-delete" class="danger" type="button">Удалить</button></div>
      </div>
      ${messageBlock()}
      <div class="cinema-meta-grid">
        <div><span>Жанры</span><strong>${esc(item.genres || '—')}</strong></div>
        <div><span>Рейтинг</span><strong>${esc(item.age_rating || '—')}</strong></div>
        <div><span>Длительность</span><strong>${item.duration_minutes ? `${esc(item.duration_minutes)} мин.` : '—'}</strong></div>
        <div><span>Публикация</span><strong>${item.is_public ? 'В библиотеке' : 'Скрыто'}</strong></div>
      </div>
      <div class="cinema-description">${esc(item.description || 'Описание не заполнено.')}</div>
      <div class="cinema-paths">
        <div><span>Постер:</span> ${esc(item.poster_url || 'не задан')}</div>
        ${item.content_type === 'movie' ? `<div><span>Видео:</span> ${item.media_url ? 'загружено' : 'не загружено'}</div>` : ''}
      </div>
      ${item.content_type === 'series' ? renderEpisodes(item, episodes) : ''}
    </section>`;
}

function renderEpisodes(item, episodes) {
  const rows = episodes.map((episode) => `
    <tr>
      <td>${esc(episode.season_number)}</td>
      <td>${esc(episode.episode_number)}</td>
      <td><strong>${esc(episode.episode_title || `Серия ${episode.episode_number}`)}</strong></td>
      <td>${episode.duration_minutes ? `${esc(episode.duration_minutes)} мин.` : '—'}</td>
      <td><span class="badge good">Видео загружено</span></td>
      <td><button class="danger small episode-delete" data-id="${esc(episode.id)}" type="button">Удалить</button></td>
    </tr>`).join('');
  const e = state.episodeDraft;
  return `
    <div class="cinema-episodes">
      <div class="cinema-section-head"><div><h3>Сезоны и серии</h3><div class="subtle">Всего серий: ${episodes.length}</div></div></div>
      <div class="table-wrap"><table class="table cinema-episode-table"><thead><tr><th>Сезон</th><th>Серия</th><th>Название</th><th>Длина</th><th>Видео</th><th></th></tr></thead><tbody>${rows || '<tr><td colspan="6" class="empty">Серий пока нет</td></tr>'}</tbody></table></div>
      <form id="episode-form" class="cinema-episode-form">
        <h3>Добавить серию</h3>
        <div class="cinema-grid-4">
          <div class="field"><label>Сезон</label><input id="episode-season" type="number" min="1" value="${esc(e.seasonNumber)}" required /></div>
          <div class="field"><label>Серия</label><input id="episode-number" type="number" min="1" value="${esc(e.episodeNumber)}" required /></div>
          <div class="field cinema-span-2"><label>Название серии</label><input id="episode-title" value="${esc(e.episodeTitle)}" /></div>
          <div class="field"><label>Длительность, мин.</label><input id="episode-duration" type="number" min="1" value="${esc(e.durationMinutes)}" /></div>
        </div>
        <div class="cinema-upload-box">
          <div><strong>Видео серии</strong><div class="subtle">Каждая серия хранит свой исходный видеофайл.</div></div>
          <div class="actions"><button id="episode-pick" class="secondary" type="button">Выбрать видео серии</button>${state.episodeFile ? `<span class="file-chip">${esc(state.episodeFile.name)} · ${formatBytes(state.episodeFile.size)}</span>` : ''}</div>
          <div class="cinema-progress"><progress id="cinema-upload-progress-bar" max="100" value="${Number(state.upload?.percent || 0)}"></progress><span id="cinema-upload-progress-label"></span></div>
        </div>
        <button class="primary" type="submit" ${state.busy ? 'disabled' : ''}>${state.busy ? 'Загрузка…' : 'Загрузить и добавить серию'}</button>
      </form>
    </div>`;
}

function renderCatalog() {
  const cards = state.titles.map((item) => `
    <button class="cinema-card ${Number(state.selected?.id) === Number(item.id) ? 'active' : ''}" data-title-id="${esc(item.id)}" type="button">
      <div class="cinema-card-top"><span class="badge ${item.content_type === 'movie' ? 'good' : ''}">${typeLabel(item.content_type)}</span><span class="subtle">#${esc(item.id)}</span></div>
      <strong>${esc(item.title)}</strong>
      <span class="subtle">${item.release_year || 'год —'}${item.content_type === 'series' ? ` · ${Number(item.episode_count || 0)} сер.` : ''}</span>
    </button>`).join('');
  return `
    <aside class="cinema-panel cinema-catalog">
      <form id="cinema-search" class="cinema-search">
        <input id="cinema-query" class="search" value="${esc(state.query)}" placeholder="Поиск по названию" />
        <select id="cinema-type"><option value="" ${!state.type ? 'selected' : ''}>Все</option><option value="movie" ${state.type === 'movie' ? 'selected' : ''}>Фильмы</option><option value="series" ${state.type === 'series' ? 'selected' : ''}>Сериалы</option></select>
        <button class="secondary" type="submit">Найти</button>
      </form>
      <div class="cinema-create-row"><button id="new-movie" class="primary" type="button">+ Фильм</button><button id="new-series" class="primary" type="button">+ Сериал</button></div>
      <div class="cinema-card-list">${cards || '<div class="empty">Библиотека пуста</div>'}</div>
    </aside>`;
}

function render() {
  root.innerHTML = `
    <div class="cinema-shell">
      <header class="cinema-header">
        <div><div class="cinema-brand">C-Party Library Manager</div><div class="subtle">SocialBIRD Admin · фильмы, сериалы и серии</div></div>
        <div class="actions"><span class="badge good">Исходное качество видео</span><button id="cinema-refresh" class="secondary" type="button" ${state.busy ? 'disabled' : ''}>Обновить</button></div>
      </header>
      <main class="cinema-workspace">
        ${renderCatalog()}
        ${state.mode === 'form' ? renderTitleForm() : renderSelected()}
      </main>
    </div>`;
  bindEvents();
  updateUploadProgress();
}

function bindEvents() {
  document.getElementById('cinema-refresh')?.addEventListener('click', refreshTitles);
  document.getElementById('cinema-search')?.addEventListener('submit', (event) => {
    event.preventDefault();
    state.query = document.getElementById('cinema-query').value.trim();
    state.type = document.getElementById('cinema-type').value;
    refreshTitles();
  });
  document.getElementById('new-movie')?.addEventListener('click', () => startNew('movie'));
  document.getElementById('new-series')?.addEventListener('click', () => startNew('series'));
  document.querySelectorAll('[data-title-id]').forEach((button) => button.addEventListener('click', () => openTitle(Number(button.dataset.titleId))));

  document.getElementById('title-cancel')?.addEventListener('click', () => {
    state.mode = 'browse';
    state.draft = null;
    state.movieFile = null;
    state.upload = null;
    render();
  });
  document.getElementById('title-form')?.addEventListener('submit', saveTitle);
  document.getElementById('movie-pick')?.addEventListener('click', pickMovieFile);
  document.getElementById('title-type')?.addEventListener('change', () => {
    state.draft = readTitleForm();
    state.draft.contentType = document.getElementById('title-type').value === 'series' ? 'series' : 'movie';
    state.movieFile = null;
    state.upload = null;
    render();
  });
  document.getElementById('title-edit')?.addEventListener('click', startEdit);
  document.getElementById('title-delete')?.addEventListener('click', deleteSelectedTitle);

  document.getElementById('episode-pick')?.addEventListener('click', pickEpisodeFile);
  document.getElementById('episode-form')?.addEventListener('submit', addEpisode);
  document.querySelectorAll('.episode-delete').forEach((button) => button.addEventListener('click', () => deleteEpisode(Number(button.dataset.id))));
}

refreshTitles();
