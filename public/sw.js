self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: 'IT-BIRD', body: event.data ? event.data.text() : '' };
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

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  const notification = event.notification;
  const action = event.action;
  const data = notification.data || {};
  notification.close();

  if (action === 'dismiss') return;

  const targetUrl = new URL(data.url || '/', self.location.origin).href;
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const existing = windows.find((client) => client.url.startsWith(self.location.origin));
    if (existing) {
      if ('navigate' in existing) await existing.navigate(targetUrl).catch(() => undefined);
      await existing.focus();
      existing.postMessage({ type: 'ITBIRD_PUSH_CALL_OPEN', call: data.call || null });
      return;
    }
    const opened = await self.clients.openWindow(targetUrl);
    if (opened) opened.postMessage({ type: 'ITBIRD_PUSH_CALL_OPEN', call: data.call || null });
  })());
});

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
