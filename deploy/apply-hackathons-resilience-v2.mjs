import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const deployDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(deployDir, '..');
const serverPath = path.join(root, 'backend/server.js');
let source = fs.readFileSync(serverPath, 'utf8');

const marker = 'APP_FIX: hackathons-resilient-v2';
if (source.includes(marker)) {
  console.log('Hackathons resilience v2 is already applied.');
  process.exit(0);
}

const replaceRequired = (search, replacement, label) => {
  if (!source.includes(search)) {
    throw new Error(`Hackathons resilience v2 patch failed: ${label}`);
  }
  source = source.replace(search, replacement);
};

replaceRequired(
`    // APP_FIX: hackathons-safe-browser
    let browser = null;

    try {
        browser = await puppeteer.launch({
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox'],
        });
        const page = await browser.newPage();
        await page.goto('https://hackathons.pro/', { waitUntil: 'networkidle2', timeout: 60000 });

        await page.evaluate(async () => {
            const distance = 100;
            const delay = 100;
            while (document.body.scrollHeight > window.scrollY + window.innerHeight) {
                window.scrollBy(0, distance);
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        });

        await page.evaluate(() => {
            const images = Array.from(document.querySelectorAll('img'));
            return Promise.all(images.map(img => {
                if (img.complete) return Promise.resolve();
                return new Promise(resolve => img.onload = resolve);
            }));
        });`,
`    // APP_FIX: hackathons-resilient-v2
    // Tilda feeds may keep analytics/network requests open. Wait for the feed itself,
    // bound lazy-load scrolling, and never block the API on every image finishing.
    let browser = null;

    try {
        browser = await puppeteer.launch({
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
        });
        const page = await browser.newPage();
        page.setDefaultNavigationTimeout(30000);
        await page.goto('https://hackathons.pro/', { waitUntil: 'domcontentloaded', timeout: 30000 });
        await page.waitForSelector('.js-feed-post', { timeout: 20000 });

        await page.evaluate(async () => {
            const distance = 500;
            const delay = 120;
            const maxScrollSteps = 40;
            let scrollSteps = 0;
            let stableBottomChecks = 0;
            let previousHeight = document.body.scrollHeight;

            while (scrollSteps < maxScrollSteps) {
                window.scrollBy(0, distance);
                scrollSteps += 1;
                await new Promise(resolve => setTimeout(resolve, delay));

                const currentHeight = document.body.scrollHeight;
                const reachedBottom = window.scrollY + window.innerHeight >= currentHeight - 2;
                if (reachedBottom && currentHeight === previousHeight) {
                    stableBottomChecks += 1;
                    if (stableBottomChecks >= 2) break;
                } else {
                    stableBottomChecks = 0;
                }
                previousHeight = currentHeight;
            }
        });`,
  'replace fragile navigation/scroll/image wait',
);

replaceRequired(
`        if (!htmlContent) {
            res.status(404).json({ message: 'Блок с хакатонами не найден.' });
        } else {
            const sourceSignature = crypto`,
`        if (hackathonItems.length === 0) {
            throw new Error('HACKATHON_FEED_EMPTY');
        }

        {
            const sourceSignature = crypto`,
  'allow item response without optional feed wrapper HTML',
);

replaceRequired(
`        const browserUnavailable = /Could not find Chrome|Failed to launch|browser executable/i.test(String(err?.message || err));
        res.status(browserUnavailable ? 503 : 500).json({
            message: browserUnavailable
                ? 'Сервис хакатонов временно недоступен: браузер-парсер не установлен.'
                : 'Ошибка при загрузке данных',
            code: browserUnavailable ? 'HACKATHON_BROWSER_UNAVAILABLE' : 'HACKATHON_FETCH_FAILED',
        });`,
`        res.status(503).json({
            message: 'Сервис хакатонов временно недоступен. Попробуйте ещё раз через минуту.',
            code: 'HACKATHON_UPSTREAM_UNAVAILABLE',
        });`,
  'return controlled upstream-unavailable response instead of generic 500',
);

fs.writeFileSync(serverPath, source, 'utf8');

const routeStart = source.indexOf("app.get('/hackathons'");
const routeEnd = source.indexOf('// Получение репозиториев пользователя', routeStart);
const route = source.slice(routeStart, routeEnd);

const checks = [
  [route.includes(marker), 'resilience marker'],
  [route.includes("waitUntil: 'domcontentloaded'"), 'DOM-content navigation'],
  [route.includes("waitForSelector('.js-feed-post'"), 'feed selector wait'],
  [route.includes('maxScrollSteps'), 'bounded scrolling'],
  [!route.includes('networkidle2'), 'no global network-idle dependency'],
  [!route.includes('Promise.all(images.map'), 'no indefinite all-image wait'],
  [route.includes('HACKATHON_UPSTREAM_UNAVAILABLE'), 'controlled upstream error'],
];

for (const [ok, label] of checks) {
  if (!ok) throw new Error(`Hackathons resilience v2 verification failed: ${label}`);
}

console.log('Hackathons resilience v2 applied successfully.');
