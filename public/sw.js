/* SOCIALBIRD_OFFLINE_V1: shell-and-private-api-cache */
const OFFLINE_VERSION = 'socialbird-offline-v1';
const SHELL_CACHE = `${OFFLINE_VERSION}-shell`;
const STATIC_CACHE = `${OFFLINE_VERSION}-static`;
const API_CACHE = `${OFFLINE_VERSION}-api`;
const CORE = ['/', '/index.html', '/manifest.webmanifest', '/favicon.ico'];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL_CACHE);
    await Promise.all(CORE.map(async (url) => {
      try { await cache.add(new Request(url, { cache: 'reload' })); } catch {}
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keep = new Set([SHELL_CACHE, STATIC_CACHE, API_CACHE]);
    for (const key of await caches.keys()) {
      if (key.startsWith('socialbird-offline-') && !keep.has(key)) await caches.delete(key);
    }
    await self.clients.claim();
  })());
});

const sha256 = async (value) => {
  const bytes = new TextEncoder().encode(value || 'anonymous');
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest)).slice(0, 12).map((b) => b.toString(16).padStart(2, '0')).join('');
};

const privateApiCacheKey = async (request) => {
  const auth = request.headers.get('authorization') || 'anonymous';
  const tokenKey = await sha256(auth);
  const url = new URL(request.url);
  return new Request(`${self.location.origin}/__socialbird_offline_api__/${tokenKey}/${encodeURIComponent(`${url.pathname}${url.search}`)}`);
};

const isStaticAsset = (url, request) => {
  if (url.pathname.startsWith('/assets/')) return true;
  return ['script', 'style', 'font', 'image', 'manifest'].includes(request.destination || '');
};

const isLargeOrStreamingMedia = (url, request) => {
  if (request.headers.has('range')) return true;
  if (['video', 'audio'].includes(request.destination || '')) return true;
  return /\/cinema\/(?:stream|media|upload)|\/uploads\//i.test(url.pathname);
};

const offlineJson = () => new Response(JSON.stringify({
  offline: true,
  message: 'Нет подключения к серверу. Для этого раздела ещё нет сохранённой офлайн-копии.',
}), {
  status: 503,
  headers: { 'Content-Type': 'application/json; charset=utf-8', 'X-SocialBIRD-Offline': 'miss' },
});

const networkFirstNavigation = async (request) => {
  const shell = await caches.open(SHELL_CACHE);
  try {
    const response = await fetch(request);
    if (response.ok) {
      await shell.put('/index.html', response.clone()).catch(() => undefined);
      await shell.put('/', response.clone()).catch(() => undefined);
    }
    return response;
  } catch {
    return (await shell.match('/index.html')) || (await shell.match('/')) || new Response('SocialBIRD offline', { status: 503 });
  }
};

const cacheFirstStatic = async (request) => {
  const cache = await caches.open(STATIC_CACHE);
  const cached = await cache.match(request);
  if (cached) {
    fetch(request).then((response) => {
      if (response.ok) cache.put(request, response.clone()).catch(() => undefined);
    }).catch(() => undefined);
    return cached;
  }
  const response = await fetch(request);
  if (response.ok) await cache.put(request, response.clone()).catch(() => undefined);
  return response;
};

const networkFirstPrivateGet = async (request) => {
  const cache = await caches.open(API_CACHE);
  const key = await privateApiCacheKey(request);
  try {
    const response = await fetch(request);
    const contentType = response.headers.get('content-type') || '';
    if (response.ok && (contentType.includes('application/json') || contentType.includes('text/'))) {
      await cache.put(key, response.clone()).catch(() => undefined);
    }
    return response;
  } catch {
    const cached = await cache.match(key);
    if (!cached) return offlineJson();
    const headers = new Headers(cached.headers);
    headers.set('X-SocialBIRD-Offline', 'hit');
    return new Response(await cached.clone().arrayBuffer(), {
      status: cached.status,
      statusText: cached.statusText,
      headers,
    });
  }
};

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(networkFirstNavigation(request));
    return;
  }
  if (isLargeOrStreamingMedia(url, request)) return;
  if (isStaticAsset(url, request)) {
    event.respondWith(cacheFirstStatic(request));
    return;
  }
  event.respondWith(networkFirstPrivateGet(request));
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') void self.skipWaiting();
});

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: 'IT-BIRD', body: event.data ? event.data.text() : '' };
  }

  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const visible = windows.find((client) => client.visibilityState === 'visible' && client.focused !== false);
    if (visible && data.type === 'incoming-call') {
      visible.postMessage({ type: 'ITBIRD_PUSH_CALL_VISIBLE', action: 'open', call: data.call || null });
      return;
    }

    const title = data.title || 'IT-BIRD';
    const options = {
      body: data.body || 'Новое уведомление',
      icon: '/favicon.ico',
      badge: '/favicon.ico',
      tag: data.tag || 'itbird-notification',
      renotify: true,
      requireInteraction: data.type === 'incoming-call',
      silent: false,
      vibrate: data.type === 'incoming-call' ? [700, 250, 700, 250, 900] : [250],
      data: {
        url: data.url || '/',
        type: data.type || 'notification',
        call: data.call || null,
      },
      actions: data.type === 'incoming-call'
        ? [
            { action: 'answer', title: 'Ответить' },
            { action: 'dismiss', title: 'Отклонить' },
          ]
        : [],
    };

    await self.registration.showNotification(title, options);
  })());
});

self.addEventListener('notificationclick', (event) => {
  const notification = event.notification;
  const action = event.action;
  const data = notification.data || {};
  notification.close();
  if (action === 'dismiss') return;

  const callAction = action === 'answer' ? 'answer' : 'open';
  const targetUrl = new URL(data.url || '/', self.location.origin).href;
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const existing = windows.find((client) => client.url.startsWith(self.location.origin));
    if (existing) {
      if ('navigate' in existing) await existing.navigate(targetUrl).catch(() => undefined);
      await existing.focus();
      existing.postMessage({ type: 'ITBIRD_PUSH_CALL_OPEN', action: callAction, call: data.call || null });
      return;
    }
    const opened = await self.clients.openWindow(targetUrl);
    if (opened) opened.postMessage({ type: 'ITBIRD_PUSH_CALL_OPEN', action: callAction, call: data.call || null });
  })());
});
