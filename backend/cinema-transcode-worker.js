const fs = require('fs');
const path = require('path');
const { execFile, spawn } = require('child_process');

const [jobFile, sourcePath, mediaRoot] = process.argv.slice(2);
if (!jobFile || !sourcePath || !mediaRoot) process.exit(2);

const execFileAsync = (command, args, options = {}) => new Promise((resolve, reject) => {
  execFile(command, args, { maxBuffer: 8 * 1024 * 1024, ...options }, (error, stdout, stderr) => {
    if (error) {
      error.stderr = stderr;
      return reject(error);
    }
    resolve({ stdout, stderr });
  });
});

const writeStatus = async (patch) => {
  let current = {};
  try { current = JSON.parse(await fs.promises.readFile(jobFile, 'utf8')); } catch {}
  const next = { ...current, ...patch, updatedAt: new Date().toISOString() };
  const tmp = `${jobFile}.${process.pid}.tmp`;
  await fs.promises.writeFile(tmp, JSON.stringify(next), 'utf8');
  await fs.promises.rename(tmp, jobFile);
  return next;
};

const runFfmpeg = (args) => new Promise((resolve, reject) => {
  const child = spawn('ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'] });
  let stderr = '';
  child.stderr.on('data', (chunk) => {
    stderr += chunk.toString();
    if (stderr.length > 2 * 1024 * 1024) stderr = stderr.slice(-1024 * 1024);
  });
  child.once('error', reject);
  child.once('exit', (code, signal) => {
    if (code === 0) return resolve();
    const error = new Error(`ffmpeg failed with code ${code ?? 'null'}${signal ? ` (${signal})` : ''}`);
    error.stderr = stderr;
    reject(error);
  });
});

const normalizedExt = (value) => path.extname(String(value || '')).toLowerCase();
const compatibleMp4Audio = (audio) => !audio || audio.codec_name === 'aac';
const compatibleH264PixelFormat = (video) => ['yuv420p', 'yuvj420p'].includes(String(video?.pix_fmt || '').toLowerCase());
const safeTargetName = (value) => {
  const name = path.basename(String(value || ''));
  return /^[a-zA-Z0-9._-]+\.mp4$/i.test(name) ? name : null;
};

const main = async () => {
  const initial = JSON.parse(await fs.promises.readFile(jobFile, 'utf8'));
  const targetName = safeTargetName(initial.targetName);
  if (!targetName) throw new Error('Некорректное имя целевого MP4-файла.');
  const finalPath = path.join(mediaRoot, targetName);
  await writeStatus({ status: 'processing', stage: 'probe', complete: false, error: null });

  const { stdout } = await execFileAsync('ffprobe', [
    '-v', 'error',
    '-show_entries', 'format=format_name,duration:stream=codec_type,codec_name,pix_fmt',
    '-of', 'json',
    sourcePath,
  ]);
  const probe = JSON.parse(stdout || '{}');
  const streams = Array.isArray(probe.streams) ? probe.streams : [];
  const video = streams.find((stream) => stream.codec_type === 'video');
  const audio = streams.find((stream) => stream.codec_type === 'audio');
  if (!video?.codec_name) throw new Error('Видео-поток не найден или формат не поддерживается FFmpeg.');

  const sourceExt = normalizedExt(initial.originalName || sourcePath);
  const browserH264 = video.codec_name === 'h264' && compatibleH264PixelFormat(video);
  const directMp4 = sourceExt === '.mp4' && browserH264 && compatibleMp4Audio(audio);

  let recompressed = false;
  let videoRecompressed = false;
  let audioRecompressed = false;
  let remuxed = false;
  let conversionMode = 'none';

  if (directMp4) {
    await writeStatus({ status: 'processing', stage: 'finalize', conversionMode: 'none' });
    await fs.promises.rm(finalPath, { force: true }).catch(() => undefined);
    await fs.promises.rename(sourcePath, finalPath);
  } else {
    const tempPath = path.join(mediaRoot, `.${targetName}.${process.pid}.tmp.mp4`);
    const canCopyVideo = browserH264;
    const canCopyAudio = compatibleMp4Audio(audio);
    videoRecompressed = !canCopyVideo;
    audioRecompressed = Boolean(audio) && !canCopyAudio;
    recompressed = videoRecompressed || audioRecompressed;
    remuxed = canCopyVideo && canCopyAudio;
    conversionMode = remuxed ? 'remux' : (canCopyVideo ? 'audio-transcode' : 'transcode');
    await writeStatus({ status: 'processing', stage: conversionMode, conversionMode });

    const args = [
      '-hide_banner', '-loglevel', 'warning', '-nostdin', '-y',
      '-i', sourcePath,
      '-map', '0:v:0', '-map', '0:a:0?',
      '-sn',
    ];

    if (canCopyVideo) {
      args.push('-c:v', 'copy');
    } else {
      args.push('-c:v', 'libx264', '-preset', String(process.env.CINEMA_FFMPEG_PRESET || 'veryfast'), '-crf', String(process.env.CINEMA_FFMPEG_CRF || '20'), '-pix_fmt', 'yuv420p');
    }

    if (audio) {
      if (canCopyAudio) args.push('-c:a', 'copy');
      else args.push('-c:a', 'aac', '-b:a', String(process.env.CINEMA_FFMPEG_AUDIO_BITRATE || '192k'));
    }

    args.push('-movflags', '+faststart', '-max_muxing_queue_size', '2048', tempPath);
    try {
      await runFfmpeg(args);
      await fs.promises.rm(finalPath, { force: true }).catch(() => undefined);
      await fs.promises.rename(tempPath, finalPath);
      await fs.promises.rm(sourcePath, { force: true });
    } catch (error) {
      await fs.promises.rm(tempPath, { force: true }).catch(() => undefined);
      throw error;
    }
  }

  const stat = await fs.promises.stat(finalPath);
  await writeStatus({
    status: 'ready',
    stage: 'ready',
    complete: true,
    mediaUrl: `/cinema/media/${targetName}`,
    fileName: initial.originalName,
    fileSize: Number(stat.size),
    mimeType: 'video/mp4',
    recompressed,
    videoRecompressed,
    audioRecompressed,
    remuxed,
    conversionMode,
    sourceVideoCodec: video.codec_name,
    sourcePixelFormat: video.pix_fmt || null,
    sourceAudioCodec: audio?.codec_name || null,
    finishedAt: new Date().toISOString(),
  });
};

main().catch(async (error) => {
  const message = String(error?.stderr || error?.message || error || 'Неизвестная ошибка FFmpeg').trim().slice(-4000);
  try {
    await writeStatus({
      status: 'error',
      stage: 'error',
      complete: false,
      error: message,
      finishedAt: new Date().toISOString(),
    });
  } catch {}
  process.exitCode = 1;
});
