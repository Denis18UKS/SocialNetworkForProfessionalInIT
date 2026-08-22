import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const dist = path.join(root, 'dist');
const indexPath = path.join(dist, 'index.html');

if (!fs.existsSync(indexPath)) {
  throw new Error('dist/index.html not found. Run Vite build first.');
}

const SITE_ORIGIN = 'https://socialbird.31.207.74.138.nip.io';
const base = fs.readFileSync(indexPath, 'utf8');

const routes = [
  {
    path: '/',
    title: 'SocialBIRD — социальная сеть для IT-специалистов',
    description: 'SocialBIRD — социальная сеть для программистов и IT-специалистов: профессиональное общение, посты, чаты, голосовые и видеозвонки, IT-хакатоны и онлайн-компилятор.',
    heading: 'SocialBIRD — социальная сеть для IT-специалистов',
    summary: 'Профессиональная социальная сеть для разработчиков: общение, чаты, звонки, форум, хакатоны и инструменты для программирования.',
  },
  {
    path: '/xakatons',
    title: 'IT-хакатоны — SocialBIRD',
    description: 'Актуальные IT-хакатоны, соревнования и мероприятия для разработчиков в SocialBIRD.',
    heading: 'IT-хакатоны в SocialBIRD',
    summary: 'Хакатоны и IT-мероприятия для разработчиков и команд.',
  },
  {
    path: '/compiler',
    title: 'Онлайн-компилятор для разработчиков — SocialBIRD',
    description: 'Запускайте код прямо в браузере в изолированной среде SocialBIRD. Онлайн-компилятор для популярных языков программирования.',
    heading: 'Онлайн-компилятор SocialBIRD',
    summary: 'Запуск кода популярных языков программирования прямо в браузере в изолированной среде.',
  },
  {
    path: '/forum',
    title: 'Форум разработчиков — SocialBIRD',
    description: 'Форум SocialBIRD: вопросы, ответы и профессиональные обсуждения для IT-специалистов.',
    heading: 'Форум разработчиков SocialBIRD',
    summary: 'Вопросы, ответы и профессиональные обсуждения IT-сообщества.',
  },
  {
    path: '/android-app',
    title: 'SocialBIRD для Android — скачать приложение',
    description: 'Скачайте официальное Android-приложение SocialBIRD: чаты, звонки, уведомления, камера, микрофон и системная демонстрация экрана.',
    heading: 'SocialBIRD для Android',
    summary: 'Официальное Android-приложение SocialBIRD с тем же аккаунтом, чатами, звонками и системной демонстрацией экрана.',
  },
];

const escapeHtml = (value) => value
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;');

const replaceOrInsertMeta = (html, attribute, key, value) => {
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`<meta\\s+[^>]*${attribute}=["']${escapedKey}["'][^>]*>`, 'i');
  const tag = `<meta ${attribute}="${key}" content="${escapeHtml(value)}" />`;
  if (pattern.test(html)) return html.replace(pattern, tag);
  return html.replace('</head>', `    ${tag}\n  </head>`);
};

const replaceCanonical = (html, canonical) => {
  const tag = `<link rel="canonical" href="${canonical}" />`;
  const pattern = /<link\s+[^>]*rel=["']canonical["'][^>]*>/i;
  if (pattern.test(html)) return html.replace(pattern, tag);
  return html.replace('</head>', `    ${tag}\n  </head>`);
};

for (const route of routes) {
  const canonical = `${SITE_ORIGIN}${route.path === '/' ? '/' : route.path}`;
  let html = base.replace(/<title>[\s\S]*?<\/title>/i, `<title>${escapeHtml(route.title)}</title>`);
  html = replaceOrInsertMeta(html, 'name', 'description', route.description);
  html = replaceOrInsertMeta(html, 'name', 'robots', 'index,follow,max-image-preview:large,max-snippet:-1,max-video-preview:-1');
  html = replaceOrInsertMeta(html, 'name', 'googlebot', 'index,follow,max-image-preview:large,max-snippet:-1,max-video-preview:-1');
  html = replaceOrInsertMeta(html, 'property', 'og:title', route.title);
  html = replaceOrInsertMeta(html, 'property', 'og:description', route.description);
  html = replaceOrInsertMeta(html, 'property', 'og:url', canonical);
  html = replaceOrInsertMeta(html, 'property', 'og:type', 'website');
  html = replaceOrInsertMeta(html, 'property', 'og:site_name', 'SocialBIRD');
  html = replaceOrInsertMeta(html, 'name', 'twitter:card', 'summary');
  html = replaceOrInsertMeta(html, 'name', 'twitter:title', route.title);
  html = replaceOrInsertMeta(html, 'name', 'twitter:description', route.description);
  html = replaceCanonical(html, canonical);

  const fallback = `<noscript><main style="max-width:960px;margin:40px auto;padding:24px;font-family:system-ui,sans-serif"><h1>${escapeHtml(route.heading)}</h1><p>${escapeHtml(route.summary)}</p><p><a href="${SITE_ORIGIN}/">SocialBIRD</a></p></main></noscript>`;
  html = html.replace('<div id="root"></div>', `${fallback}\n    <div id="root"></div>`);

  if (route.path === '/') {
    fs.writeFileSync(indexPath, html, 'utf8');
    continue;
  }

  const directory = path.join(dist, route.path.slice(1));
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, 'index.html'), html, 'utf8');
}

for (const required of ['robots.txt', 'sitemap.xml']) {
  const file = path.join(dist, required);
  if (!fs.existsSync(file)) throw new Error(`${required} was not copied to dist`);
}

console.log('SEO static route HTML, robots.txt and sitemap.xml are ready.');
