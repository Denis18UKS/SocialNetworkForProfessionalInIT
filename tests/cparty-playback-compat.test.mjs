import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { parseSingleByteRange } = require('../backend/cinema-range.js');
const { buildCompatibilityPlan } = require('../backend/cinema-media-compat.js');

test('suffix byte ranges return the tail of the file', () => {
  assert.deepEqual(parseSingleByteRange('bytes=-500', 1000), { start: 500, end: 999, length: 500 });
});

test('open-ended byte ranges extend to EOF', () => {
  assert.deepEqual(parseSingleByteRange('bytes=750-', 1000), { start: 750, end: 999, length: 250 });
});

test('invalid byte ranges are rejected', () => {
  assert.equal(parseSingleByteRange('bytes=-0', 1000), false);
  assert.equal(parseSingleByteRange('bytes=1000-', 1000), false);
  assert.equal(parseSingleByteRange('bytes=0-1,4-5', 1000), false);
});

test('browser-compatible H264/AAC is remuxed without re-encoding', () => {
  const plan = buildCompatibilityPlan({
    streams: [
      { codec_type: 'video', codec_name: 'h264', pix_fmt: 'yuv420p' },
      { codec_type: 'audio', codec_name: 'aac' },
    ],
  });
  assert.equal(plan.videoCodec, 'copy');
  assert.equal(plan.audioCodec, 'copy');
  assert.equal(plan.recompressed, false);
});

test('unsupported video codec is converted to H264 while compatible AAC is copied', () => {
  const plan = buildCompatibilityPlan({
    streams: [
      { codec_type: 'video', codec_name: 'hevc', pix_fmt: 'yuv420p10le' },
      { codec_type: 'audio', codec_name: 'aac' },
    ],
  });
  assert.equal(plan.videoCodec, 'libx264');
  assert.equal(plan.audioCodec, 'copy');
  assert.equal(plan.recompressed, true);
});

test('unsupported audio is converted to AAC without touching compatible H264 video', () => {
  const plan = buildCompatibilityPlan({
    streams: [
      { codec_type: 'video', codec_name: 'h264', pix_fmt: 'yuv420p' },
      { codec_type: 'audio', codec_name: 'ac3' },
    ],
  });
  assert.equal(plan.videoCodec, 'copy');
  assert.equal(plan.audioCodec, 'aac');
  assert.equal(plan.recompressed, true);
});
