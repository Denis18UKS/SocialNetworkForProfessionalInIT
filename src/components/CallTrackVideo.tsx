import { useEffect, useRef } from "react";

type Props = {
  track: MediaStreamTrack;
  className?: string;
  muted?: boolean;
};

const CallTrackVideo = ({ track, className = "", muted = true }: Props) => {
  const ref = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    video.srcObject = new MediaStream([track]);
    void video.play().catch(() => undefined);
    return () => {
      if (video.srcObject) video.srcObject = null;
    };
  }, [track]);

  return <video ref={ref} autoPlay playsInline muted={muted} className={className} />;
};

export default CallTrackVideo;
