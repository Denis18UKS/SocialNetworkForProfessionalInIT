const path = require('path');

// Browser-compatible MP4 can be passed through untouched. H.264/AAC in another
// container is remuxed; incompatible codecs are normalized through FFmpeg.
const planCinemaMediaConversion = ({ originalName, streams = [] }) => {
  const sourceExt = path.extname(String(originalName || '')).toLowerCase();
  const video = streams.find((stream) => stream.codec_type === 'video');
  const audio = streams.find((stream) => stream.codec_type === 'audio');
  if (!video?.codec_name) throw new Error('Видео-поток не найден или формат не поддерживается FFmpeg.');

  const pixelFormat = String(video.pix_fmt || '').toLowerCase();
  const browserH264 = video.codec_name === 'h264' && ['yuv420p', 'yuvj420p'].includes(pixelFormat);
  const compatibleAudio = !audio || audio.codec_name === 'aac';
  const directMp4 = sourceExt === '.mp4' && browserH264 && compatibleAudio;
  const canCopyVideo = browserH264;
  const canCopyAudio = compatibleAudio;
  const videoRecompressed = !canCopyVideo;
  const audioRecompressed = Boolean(audio) && !canCopyAudio;
  const recompressed = videoRecompressed || audioRecompressed;
  const remuxed = !directMp4 && canCopyVideo && canCopyAudio;
  const conversionMode = directMp4 ? 'none' : remuxed ? 'remux' : (canCopyVideo ? 'audio-transcode' : 'transcode');

  return { video, audio, directMp4, canCopyVideo, canCopyAudio, videoRecompressed, audioRecompressed, recompressed, remuxed, conversionMode };
};

module.exports = { planCinemaMediaConversion };
