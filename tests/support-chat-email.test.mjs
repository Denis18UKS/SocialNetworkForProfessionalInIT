import test from 'node:test';
import assert from 'node:assert/strict';

import { splitChatText, shouldSendChatOnKeyDown } from '../src/lib/chat-text.mjs';
import notificationPreferences from '../backend/notification-preferences.js';

const { normalizeEmailNotificationsEnabled } = notificationPreferences;

test('chat text keeps line breaks and separates http/https links safely', () => {
  const parts = splitChatText('Первая строка\nhttps://socialbird.ru/test?q=1\nПоследняя строка');

  assert.deepEqual(parts, [
    { type: 'text', value: 'Первая строка\n' },
    { type: 'link', value: 'https://socialbird.ru/test?q=1' },
    { type: 'text', value: '\nПоследняя строка' },
  ]);
});

test('chat text does not turn javascript pseudo-links into anchors', () => {
  const parts = splitChatText('javascript:alert(1) и https://example.com');
  assert.equal(parts.filter((part) => part.type === 'link').length, 1);
  assert.equal(parts.find((part) => part.type === 'link')?.value, 'https://example.com');
});

test('desktop Enter sends while Shift+Enter keeps a newline', () => {
  assert.equal(shouldSendChatOnKeyDown({ key: 'Enter', shiftKey: false, coarsePointer: false }), true);
  assert.equal(shouldSendChatOnKeyDown({ key: 'Enter', shiftKey: true, coarsePointer: false }), false);
});

test('mobile/touch Enter keeps a newline instead of sending', () => {
  assert.equal(shouldSendChatOnKeyDown({ key: 'Enter', shiftKey: false, coarsePointer: true }), false);
});

test('email notification preference defaults to enabled and accepts explicit off', () => {
  assert.equal(normalizeEmailNotificationsEnabled(undefined, true), true);
  assert.equal(normalizeEmailNotificationsEnabled(true, false), true);
  assert.equal(normalizeEmailNotificationsEnabled(false, true), false);
  assert.equal(normalizeEmailNotificationsEnabled(1, false), true);
  assert.equal(normalizeEmailNotificationsEnabled(0, true), false);
});
