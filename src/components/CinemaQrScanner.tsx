import { useEffect, useRef, useState } from "react";
import { Camera, QrCode, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

type CinemaQrScannerProps = {
  open: boolean;
  onClose: () => void;
  onDetected: (path: string) => void;
};

type BarcodeResult = { rawValue?: string };
type BarcodeDetectorInstance = { detect: (source: HTMLVideoElement) => Promise<BarcodeResult[]> };
type BarcodeDetectorConstructor = new (options?: { formats?: string[] }) => BarcodeDetectorInstance;

const api = "http://localhost:5000";

const parseCinemaInvite = (rawValue: string) => {
  const raw = String(rawValue || "").trim();
  if (!raw) return null;

  let url: URL;
  try {
    url = new URL(raw, window.location.origin);
  } catch {
    return null;
  }

  const match = /^\/c-party\/room\/(\d+)\/?$/.exec(url.pathname);
  if (!match) return null;

  const invite = String(url.searchParams.get("invite") || "").trim();
  if (invite && !/^[a-zA-Z0-9_-]{16,160}$/.test(invite)) return null;

  return `/c-party/room/${match[1]}${invite ? `?invite=${encodeURIComponent(invite)}` : ""}`;
};

// SOCIALBIRD_CPARTY_QR_FALLBACK_V2: local-plus-server
const CinemaQrScanner = ({ open, onClose, onDetected }: CinemaQrScannerProps) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const onDetectedRef = useRef(onDetected);
  const [manualValue, setManualValue] = useState("");
  const [error, setError] = useState("");
  const [starting, setStarting] = useState(false);
  const [serverFallback, setServerFallback] = useState(false);

  onDetectedRef.current = onDetected;

  useEffect(() => {
    if (!open) return;

    let stream: MediaStream | null = null;
    let timer = 0;
    let cancelled = false;
    let scanBusy = false;
    let detected = false;
    let lastServerScan = 0;
    let detector: BarcodeDetectorInstance | null = null;

    const stop = () => {
      if (timer) window.clearInterval(timer);
      timer = 0;
      stream?.getTracks().forEach((track) => track.stop());
      stream = null;
      if (videoRef.current) videoRef.current.srcObject = null;
    };

    const finish = (rawValue: string) => {
      if (detected || cancelled) return false;
      const path = parseCinemaInvite(rawValue);
      if (!path) return false;
      detected = true;
      stop();
      onDetectedRef.current(path);
      return true;
    };

    const frameBlob = async (video: HTMLVideoElement) => {
      const canvas = canvasRef.current;
      if (!canvas || !video.videoWidth || !video.videoHeight) return null;
      const scale = Math.min(1, 900 / video.videoWidth);
      canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
      canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
      const context = canvas.getContext("2d", { willReadFrequently: false });
      if (!context) return null;
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      return new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.76));
    };

    const scanOnServer = async (video: HTMLVideoElement) => {
      const blob = await frameBlob(video);
      if (!blob || blob.size <= 0 || blob.size > 2 * 1024 * 1024) return false;
      const token = localStorage.getItem("token") || "";
      try {
        const response = await fetch(`${api}/cinema/qr/decode`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "image/jpeg",
          },
          body: blob,
          cache: "no-store",
        });
        if (response.status === 422) return false;
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          if (response.status === 503 && !detector) {
            setError(data?.message || "Резервный QR-декодер на сервере временно недоступен.");
          }
          return false;
        }
        return finish(String(data?.rawValue || ""));
      } catch {
        return false;
      }
    };

    const start = async () => {
      setError("");
      setStarting(true);
      setServerFallback(false);
      try {
        if (!navigator.mediaDevices?.getUserMedia) {
          throw new Error("Камера недоступна в текущем режиме приложения.");
        }

        const Detector = (window as typeof window & { BarcodeDetector?: BarcodeDetectorConstructor }).BarcodeDetector;
        if (Detector) {
          try {
            detector = new Detector({ formats: ["qr_code"] });
          } catch {
            detector = null;
          }
        }
        setServerFallback(!detector);

        stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } },
        });
        if (cancelled) {
          stop();
          return;
        }

        const video = videoRef.current;
        if (!video) return;
        video.srcObject = stream;
        await video.play();

        timer = window.setInterval(async () => {
          const currentVideo = videoRef.current;
          if (scanBusy || cancelled || detected || !currentVideo || currentVideo.readyState < 2) return;
          scanBusy = true;
          try {
            if (detector) {
              try {
                const results = await detector.detect(currentVideo);
                if (results.some((item) => finish(item.rawValue || ""))) return;
              } catch {
                // Keep scanning and use the server fallback below.
              }
            }

            const now = Date.now();
            if (now - lastServerScan >= 650) {
              lastServerScan = now;
              setServerFallback(true);
              await scanOnServer(currentVideo);
            }
          } finally {
            scanBusy = false;
          }
        }, 260);
      } catch (scanError) {
        setError(scanError instanceof Error ? scanError.message : "Не удалось открыть камеру для QR-сканирования.");
        stop();
      } finally {
        setStarting(false);
      }
    };

    void start();
    return () => {
      cancelled = true;
      stop();
    };
  }, [open]);

  const joinManual = () => {
    const path = parseCinemaInvite(manualValue);
    if (!path) {
      setError("Это не ссылка приглашения C-Party.");
      return;
    }
    onDetected(path);
  };

  if (!open) return null;

  return (
    <Card className="border-primary/30">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
        <CardTitle className="flex items-center gap-2 text-base"><QrCode className="h-4 w-4" />Сканер QR C-Party</CardTitle>
        <Button type="button" variant="ghost" size="icon" onClick={onClose} aria-label="Закрыть сканер"><X className="h-4 w-4" /></Button>
      </CardHeader>
      <CardContent className="grid gap-4 lg:grid-cols-[minmax(0,520px)_1fr]">
        <div className="relative aspect-video overflow-hidden rounded-xl bg-black">
          <video ref={videoRef} muted playsInline className="h-full w-full object-cover" />
          <canvas ref={canvasRef} className="hidden" aria-hidden="true" />
          <div className="pointer-events-none absolute inset-[16%] rounded-2xl border-2 border-white/90 shadow-[0_0_0_999px_rgba(0,0,0,.38)]" />
          <div className="pointer-events-none absolute bottom-3 left-0 right-0 text-center text-xs text-white/90">
            {starting ? "Открываем камеру…" : serverFallback ? "Распознаём QR локально и через сервер…" : "Наведите камеру на QR приглашения"}
          </div>
        </div>
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-sm font-medium"><Camera className="h-4 w-4" />Автоматическое подключение</div>
          <p className="text-sm text-muted-foreground">После распознавания SocialBIRD сам откроет приватную или публичную комнату вместе с invite-токеном. На устройствах без системного BarcodeDetector используется резервное распознавание на сервере.</p>
          {error && <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">{error}</div>}
          <div className="space-y-2">
            <div className="text-xs text-muted-foreground">Также можно вставить ссылку приглашения:</div>
            <div className="flex gap-2">
              <Input value={manualValue} onChange={(event) => setManualValue(event.target.value)} placeholder="https://socialbird.ru/c-party/room/..." />
              <Button type="button" onClick={joinManual}>Войти</Button>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

export default CinemaQrScanner;
