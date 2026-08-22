import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const patch = (relativePath, transform) => {
  const filePath = path.join(root, relativePath);
  const before = fs.readFileSync(filePath, 'utf8');
  const after = transform(before);
  if (after !== before) {
    fs.writeFileSync(filePath, after, 'utf8');
    console.log(`Applied SEO fix: ${relativePath}`);
  } else {
    console.log(`SEO fix already current: ${relativePath}`);
  }
};

patch('src/pages/Index.tsx', (source) => {
  if (source.includes('SEO_HOME_INTRO')) return source;
  const marker = '      <div className="mx-auto max-w-7xl space-y-8 sm:space-y-10 lg:space-y-12">';
  if (!source.includes(marker)) throw new Error('SEO fix failed: home content marker not found');

  const intro = `${marker}\n        {/* SEO_HOME_INTRO: visible, useful landing copy for people and search engines. */}\n        <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-700 dark:bg-gray-900 sm:p-7">\n          <div className="max-w-4xl space-y-3">\n            <h1 className="text-3xl font-extrabold tracking-tight text-gray-950 dark:text-white sm:text-4xl">\n              SocialBIRD — социальная сеть для IT-специалистов\n            </h1>\n            <p className="text-base leading-7 text-gray-600 dark:text-gray-300 sm:text-lg">\n              Общайтесь с разработчиками, находите единомышленников, ведите профессиональные обсуждения,\n              используйте личные и групповые чаты, голосовые и видеозвонки, следите за IT-хакатонами и\n              запускайте код в онлайн-компиляторе SocialBIRD.\n            </p>\n            <nav aria-label="Популярные разделы SocialBIRD" className="flex flex-wrap gap-x-4 gap-y-2 text-sm font-medium">\n              <a className="text-primary hover:underline" href="/forum">Форум разработчиков</a>\n              <a className="text-primary hover:underline" href="/xakatons">IT-хакатоны</a>\n              <a className="text-primary hover:underline" href="/compiler">Онлайн-компилятор</a>\n              <a className="text-primary hover:underline" href="/android-app">Приложение для Android</a>\n            </nav>\n          </div>\n        </section>`;

  return source.replace(marker, intro);
});

console.log('SocialBIRD SEO source fixes are current.');
