export type SpeakingMonitorOptions = {
  threshold?: number;
  holdMs?: number;
};

const AudioContextClass = () =>
  window.AudioContext
  || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;

export const createReliableSpeakingMonitor = (
  stream: MediaStream,
  onSpeakingChange: (speaking: boolean) => void,
  options: SpeakingMonitorOptions = {},
) => {
  const track = stream.getAudioTracks()[0];
  const Context = AudioContextClass();
  if (!track || !Context) {
    onSpeakingChange(false);
    return () => undefined;
  }

  const context = new Context();
  const source = context.createMediaStreamSource(new MediaStream([track]));
  const analyser = context.createAnalyser();
  analyser.fftSize = 512;
  analyser.smoothingTimeConstant = 0.65;
  source.connect(analyser);

  const samples = new Uint8Array(analyser.fftSize);
  const threshold = options.threshold ?? 0.025;
  const holdMs = options.holdMs ?? 320;
  let lastAbove = 0;
  let current = false;
  let frame = 0;
  let stopped = false;

  const setState = (next: boolean) => {
    if (next === current) return;
    current = next;
    onSpeakingChange(next);
  };

  const resume = () => {
    if (!stopped && context.state === "suspended") void context.resume().catch(() => undefined);
  };

  const update = () => {
    if (stopped) return;
    if (context.state === "running") {
      analyser.getByteTimeDomainData(samples);
      let energy = 0;
      for (let index = 0; index < samples.length; index += 1) {
        const normalized = (samples[index] - 128) / 128;
        energy += normalized * normalized;
      }
      const rms = Math.sqrt(energy / samples.length);
      const now = performance.now();
      const live = track.readyState === "live" && track.enabled && !track.muted;
      if (live && rms >= threshold) lastAbove = now;
      setState(live && now - lastAbove <= holdMs);
    } else {
      setState(false);
    }
    frame = window.requestAnimationFrame(update);
  };

  const silent = () => setState(false);
  const resumeVisible = () => {
    if (document.visibilityState === "visible") resume();
  };

  track.addEventListener("ended", silent);
  track.addEventListener("mute", silent);
  track.addEventListener("unmute", resume);
  document.addEventListener("visibilitychange", resumeVisible);
  window.addEventListener("pointerdown", resume, { passive: true });
  window.addEventListener("touchend", resume, { passive: true });
  window.addEventListener("focus", resume);
  const resumeTimer = window.setInterval(resume, 1200);

  resume();
  frame = window.requestAnimationFrame(update);

  return () => {
    stopped = true;
    window.clearInterval(resumeTimer);
    window.cancelAnimationFrame(frame);
    track.removeEventListener("ended", silent);
    track.removeEventListener("mute", silent);
    track.removeEventListener("unmute", resume);
    document.removeEventListener("visibilitychange", resumeVisible);
    window.removeEventListener("pointerdown", resume);
    window.removeEventListener("touchend", resume);
    window.removeEventListener("focus", resume);
    try { source.disconnect(); } catch {}
    try { analyser.disconnect(); } catch {}
    void context.close().catch(() => undefined);
    setState(false);
  };
};
