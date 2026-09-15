import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const serverSource = fs.readFileSync(new URL('../backend/server.js', import.meta.url), 'utf8');
const routeStart = serverSource.indexOf("app.get('/hackathons'");
const routeEnd = serverSource.indexOf('// Получение репозиториев пользователя', routeStart);

assert.notEqual(routeStart, -1, 'hackathons route must exist');
assert.notEqual(routeEnd, -1, 'hackathons route end marker must exist');

const hackathonsRoute = serverSource.slice(routeStart, routeEnd);

test('hackathons parser waits for the feed instead of global network idle', () => {
  assert.match(hackathonsRoute, /APP_FIX: hackathons-resilient-v2/);
  assert.match(hackathonsRoute, /waitUntil:\s*['"]domcontentloaded['"]/);
  assert.match(hackathonsRoute, /waitForSelector\(['"]\.js-feed-post['"]/);
  assert.doesNotMatch(hackathonsRoute, /networkidle2/);
});

test('hackathons parser cannot scroll forever or wait forever for images', () => {
  assert.match(hackathonsRoute, /maxScrollSteps/);
  assert.match(hackathonsRoute, /scrollSteps\s*<\s*maxScrollSteps/);
  assert.doesNotMatch(hackathonsRoute, /Promise\.all\(images\.map/);
});

test('hackathons upstream failures do not surface as generic 500 responses', () => {
  assert.match(hackathonsRoute, /HACKATHON_UPSTREAM_UNAVAILABLE/);
  assert.doesNotMatch(hackathonsRoute, /browserUnavailable\s*\?\s*503\s*:\s*500/);
});
