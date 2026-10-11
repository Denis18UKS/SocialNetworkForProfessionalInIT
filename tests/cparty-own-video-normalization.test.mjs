import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { planCinemaMediaConversion } = require('../backend/cinema-media-codecs.js');
const stream = (codec_type, codec_name, pix_fmt) => ({ codec_type, codec_name, pix_fmt });

test('compatible H.264/AAC MP4 stays untouched', () => {
  const plan = planCinemaMediaConversion({ originalName: 'movie.mp4', streams: [stream('video', 'h264', 'yuv420p'), stream('audio', 'aac')] });
  assert.equal(plan.directMp4, true);
  assert.equal(plan.conversionMode, 'none');
  assert.equal(plan.recompressed, false);
});

test('H.264/AAC MKV is remuxed to MP4 without re-encoding', () => {
  const plan = planCinemaMediaConversion({ originalName: 'movie.mkv', streams: [stream('video', 'h264', 'yuv420p'), stream('audio', 'aac')] });
  assert.equal(plan.directMp4, false);
  assert.equal(plan.conversionMode, 'remux');
  assert.equal(plan.recompressed, false);
});

test('HEVC and AC3 are converted to browser-compatible H.264/AAC', () => {
  const plan = planCinemaMediaConversion({ originalName: 'movie.mkv', streams: [stream('video', 'hevc', 'yuv420p10le'), stream('audio', 'ac3')] });
  assert.equal(plan.conversionMode, 'transcode');
  assert.equal(plan.videoRecompressed, true);
  assert.equal(plan.audioRecompressed, true);
  assert.equal(plan.recompressed, true);
});

test('H.264 with incompatible audio keeps video and transcodes only audio', () => {
  const plan = planCinemaMediaConversion({ originalName: 'movie.mp4', streams: [stream('video', 'h264', 'yuv420p'), stream('audio', 'ac3')] });
  assert.equal(plan.conversionMode, 'audio-transcode');
  assert.equal(plan.videoRecompressed, false);
  assert.equal(plan.audioRecompressed, true);
});

test('missing video stream fails with a useful error', () => {
  assert.throws(() => planCinemaMediaConversion({ originalName: 'empty.mp4', streams: [stream('audio', 'aac')] }), /Видео-поток не найден/);
});

test('C-Party own-video upload completes asynchronously and polls codec status', async () => {
  const [server, uploader, party] = await Promise.all([
    readFile(new URL('../backend/socialbird-final-platform.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/lib/cinema-upload.ts', import.meta.url), 'utf8'),
    readFile(new URL('../src/pages/CinemaParty.tsx', import.meta.url), 'utf8'),
  ]);
  assert.match(server, /SOCIALBIRD_CPARTY_OWN_VIDEO_NORMALIZATION_V1: async-codec-normalization/);
  assert.match(server, /app\.get\('\/cinema\/uploads\/transcode\/:jobId', auth/);
  assert.match(server, /status\(202\)\.json/);
  assert.match(uploader, /finalResult\.processing/);
  assert.match(uploader, /statusUrl/);
  assert.match(uploader, /onProgress\?\.\(96, "processing"\)/);
  assert.match(party, /Подготовка видео для браузера/);
});
