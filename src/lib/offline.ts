// SOCIALBIRD_OFFLINE_V1: client-bootstrap

type OfflineWindow = Window & {
  __socialbirdOfflineInstalled?: boolean;
};

const BANNER_ID = 'socialbird-offline-banner';

const ensureBanner = () => {
  let banner = document.getElementById(BANNER_ID) as HTMLDivElement | null;
  if (banner) return banner;

  banner = document.createElement('div');
  banner.id = BANNER_ID;
  banner.setAttribute('role', 'status');
  banner.setAttribute('aria-live', 'polite');
  banner.textContent = 'Офлайн-режим: показываем сохранённые данные. Изменения, которым нужен сервер, станут доступны после подключения.';
  Object.assign(banner.style, {
    position: 'fixed',
    left: '50%',
    bottom: 'calc(0.75rem + env(safe-area-inset-bottom))',
    transform: 'translateX(-50%)',
    zIndex: '2147483000',
    maxWidth: 'min(680px, calc(100vw - 24px))',
    padding: '10px 14px',
    borderRadius: '12px',
    background: 'rgba(17,24,39,.96)',
    color: '#fff',
    border: '1px solid rgba(255,255,255,.16)',
    boxShadow: '0 14px 40px rgba(0,0,0,.35)',
    font: '500 13px/1.35 system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif',
    textAlign: 'center',
    display: 'none',
  });
  document.body.appendChild(banner);
  return banner;
};

const renderConnectivity = () => {
  const banner = ensureBanner();
  banner.style.display = navigator.onLine ? 'none' : 'block';
  document.documentElement.dataset.socialbirdNetwork = navigator.onLine ? 'online' : 'offline';
  window.dispatchEvent(new CustomEvent('socialbird-network-state', { detail: { online: navigator.onLine } }));
};

export const installOfflineSupport = () => {
  const offlineWindow = window as OfflineWindow;
  if (offlineWindow.__socialbirdOfflineInstalled) return;
  offlineWindow.__socialbirdOfflineInstalled = true;

  const start = () => {
    renderConnectivity();
    window.addEventListener('online', renderConnectivity);
    window.addEventListener('offline', renderConnectivity);
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();

  if ('serviceWorker' in navigator && window.isSecureContext) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js', { scope: '/' })
        .then((registration) => {
          if (registration.waiting) registration.waiting.postMessage({ type: 'SKIP_WAITING' });
          registration.addEventListener('updatefound', () => {
            const worker = registration.installing;
            worker?.addEventListener('statechange', () => {
              if (worker.state === 'installed' && navigator.serviceWorker.controller) {
                worker.postMessage({ type: 'SKIP_WAITING' });
              }
            });
          });
        })
        .catch(() => undefined);
    }, { once: true });
  }
};
