import { useEffect, useRef, useState } from "react";
import { Pause, Play } from "lucide-react";
import { Button } from "@/components/ui/button";

type VoiceMessageBubbleProps = {
  src: string;
  transcript?: string;
  revealed: boolean;
  onToggleTranscript: () => void;
  onMissingTranscript: () => void;
};

const waveform = [10, 18, 12, 24, 15, 30, 14, 22, 34, 18, 27, 13, 20, 32, 16, 26, 12, 22, 30, 18, 24, 13, 20, 28];

const formatTime = (seconds: number) => {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const minutes = Math.floor(seconds / 60);
  const rest = Math.floor(seconds % 60).toString().padStart(2, "0");
  return `${minutes}:${rest}`;
};

const VoiceMessageBubble = ({ src, transcript, revealed, onToggleTranscript, onMissingTranscript }: VoiceMessageBubbleProps) => {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const handleTime = () => setCurrentTime(audio.currentTime);
    const handleMeta = () => setDuration(audio.duration || 0);
    const handleEnded = () => setIsPlaying(false);

    audio.addEventListener("timeupdate", handleTime);
    audio.addEventListener("loadedmetadata", handleMeta);
    audio.addEventListener("ended", handleEnded);
    return () => {
      audio.removeEventListener("timeupdate", handleTime);
      audio.removeEventListener("loadedmetadata", handleMeta);
      audio.removeEventListener("ended", handleEnded);
    };
  }, []);

  const togglePlay = async () => {
    const audio = audioRef.current;
    if (!audio) return;

    if (audio.paused) {
      await audio.play().catch(() => undefined);
      setIsPlaying(true);
    } else {
      audio.pause();
      setIsPlaying(false);
    }
  };

  const progress = duration ? Math.min(1, currentTime / duration) : 0;
  const activeBars = Math.floor(progress * waveform.length);

  return (
    <div className="mt-2 w-full min-w-0 max-w-full overflow-hidden rounded-2xl bg-[#8064c8] px-2.5 py-2 text-white shadow-sm sm:w-[300px] sm:max-w-[76vw] sm:px-3">
      <audio ref={audioRef} src={src} preload="metadata" className="hidden" />
      <div className="flex min-w-0 max-w-full items-center gap-2 sm:gap-3">
        <button
          type="button"
          onClick={togglePlay}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white text-[#8064c8] transition hover:bg-white/90 sm:h-12 sm:w-12"
          aria-label={isPlaying ? "Пауза" : "Воспроизвести"}
        >
          {isPlaying ? <Pause className="h-6 w-6 fill-current" /> : <Play className="ml-0.5 h-6 w-6 fill-current" />}
        </button>

        <div className="min-w-0 flex-1">
          <div className="flex h-8 min-w-0 items-center gap-0.5 overflow-hidden">
            {waveform.map((height, index) => (
              <span
                key={`${height}-${index}`}
                className={`w-0.5 shrink-0 rounded-full sm:w-1 ${index <= activeBars ? "bg-white" : "bg-white/35"}`}
                style={{ height }}
              />
            ))}
          </div>
          <div className="mt-0.5 flex items-center justify-between text-xs font-semibold text-white/90">
            <span>{formatTime(currentTime)}</span>
            <span>{formatTime(duration)}</span>
          </div>
        </div>
      </div>

      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="mt-2 h-7 w-full min-w-0 px-2 text-xs font-semibold text-white hover:bg-white/15 hover:text-white"
        onClick={() => (transcript ? onToggleTranscript() : onMissingTranscript())}
      >
        {revealed ? "Скрыть расшифровку" : "Расшифровать как текст"}
      </Button>

      {revealed && transcript && (
        <div className="mt-2 rounded-lg bg-black/10 p-2 text-sm leading-relaxed text-white">
          {transcript}
        </div>
      )}
    </div>
  );
};

export default VoiceMessageBubble;
