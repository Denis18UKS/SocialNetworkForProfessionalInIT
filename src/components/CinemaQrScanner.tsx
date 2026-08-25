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

const CinemaQrScanner = ({ open, onClose, onDetected }: CinemaQrScannerProps) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [manualValue, setManualValue] = useState("");
  const [error, setError] = useState("");
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    if (!open) return;

    let stream: MediaStream | null = null;
    let timer = 0;
    let cancelled = false;
    let scanBusy = false;

    const stop = () => {
      if (timer) window.clearInterval(timer);
      stream?.getTracks().forEach((track) => track.stop());
      if (videoRef.current) videoRef.current.srcObject = null;
    };

    const start = async () => {
      setError("");
      setStarting(true);
      try {
        const Detector = (window as typeof window & { BarcodeDetector?: BarcodeDetectorConstructor }).BarcodeDetector;
        if (!Detector) {
          throw new Error("На этом устройстве системный QR-сканер браузера недоступен. Можно вставить ссылку приглашения вручную ниже.");
        }
        if (!navigator.mediaDevices?.getUserMedia) {
          throw new Error("Камера недоступна в текущем режиме приложения.");
        }

        const detector = new Detector({ formats: ["qr_code"] });
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
          if (scanBusy || cancelled || !videoRef.current || videoRef.current.readyState < 2) return;
          scanBusy = true;
          try {
            const results = await detector.detect(videoRef.current);
            const path = results.map((item) => parseCinemaInvite(item.rawValue || "")).find(Boolean);
            if (path) {
              stop();
              onDetected(path);
            }
          } catch {
            // A single failed frame should not stop the scanner.
          } finally {
            scanBusy = false;
          }
        }, 280);
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
  }, [open, onDetected]);

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
          <div className="pointer-events-none absolute inset-[16%] rounded-2xl border-2 border-white/90 shadow-[0_0_0_999px_rgba(0,0,0,.38)]" />
          <div className="pointer-events-none absolute bottom-3 left-0 right-0 text-center text-xs text-white/90">
            {starting ? "Открываем камеру…" : "Наведите камеру на QR приглашения"}
          </div>
        </div>
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-sm font-medium"><Camera className="h-4 w-4" />Автоматическое подключение</div>
          <p className="text-sm text-muted-foreground">После распознавания SocialBIRD сам откроет нужную комнату и передаст invite-токен. Если требуется повторный вход, после авторизации вы автоматически вернётесь в комнату.</p>
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
