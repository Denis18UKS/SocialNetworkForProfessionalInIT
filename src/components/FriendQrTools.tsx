import { useEffect, useRef, useState } from "react";
import { Camera, ImagePlus, QrCode, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { apiUrl } from "@/lib/settings";

const extractFriendToken = (payload: string) => {
  const value = String(payload || "").trim();
  if (!value) return "";
  try {
    const url = new URL(value, window.location.origin);
    const match = url.pathname.match(/\/friend-qr\/([^/?#]+)/i);
    if (match?.[1]) return decodeURIComponent(match[1]);
  } catch {
    // Raw token fallback below.
  }
  return /^[A-Za-z0-9_-]{20,128}$/.test(value) ? value : "";
};

const FriendQrTools = () => {
  const { toast } = useToast();
  const [myQrOpen, setMyQrOpen] = useState(false);
  const [scanOpen, setScanOpen] = useState(false);
  const [qrToken, setQrToken] = useState("");
  const [qrPayload, setQrPayload] = useState("");
  const [qrLoading, setQrLoading] = useState(false);
  const [scanLoading, setScanLoading] = useState(false);
  const [cameraError, setCameraError] = useState("");
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const scanTimerRef = useRef<number | null>(null);
  const scanBusyRef = useRef(false);

  const authHeaders = () => {
    const token = localStorage.getItem("token");
    return token ? { Authorization: `Bearer ${token}` } : {};
  };

  const stopScanner = () => {
    if (scanTimerRef.current !== null) {
      window.clearInterval(scanTimerRef.current);
      scanTimerRef.current = null;
    }
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    scanBusyRef.current = false;
  };

  useEffect(() => () => stopScanner(), []);

  const generateQr = async () => {
    setQrLoading(true);
    try {
      const response = await fetch(apiUrl("/friend-qr/token"), {
        method: "POST",
        headers: authHeaders(),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.message || "Не удалось создать QR-код");
      setQrToken(data.token || "");
      setQrPayload(data.payload || "");
      setMyQrOpen(true);
    } catch (error) {
      toast({
        title: "QR-код",
        description: error instanceof Error ? error.message : "Не удалось создать QR-код",
        variant: "destructive",
      });
    } finally {
      setQrLoading(false);
    }
  };

  const addByPayload = async (payload: string) => {
    const token = extractFriendToken(payload);
    if (!token) throw new Error("Это не QR-код добавления в друзья SocialBIRD");
    const response = await fetch(apiUrl("/friend-qr/add"), {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify({ token }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.message || "Не удалось добавить пользователя");
    stopScanner();
    setScanOpen(false);
    toast({
      title: data.status === "accepted" ? "Готово" : "Заявка отправлена",
      description: data.message || "Пользователь найден по QR-коду",
    });
  };

  const decodeBlobOnServer = async (blob: Blob) => {
    const form = new FormData();
    form.append("image", blob, "friend-qr.jpg");
    const response = await fetch(apiUrl("/friend-qr/scan"), {
      method: "POST",
      headers: authHeaders(),
      body: form,
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (data.code === "QR_NOT_FOUND") return "";
      throw new Error(data.message || "Не удалось распознать QR-код");
    }
    return String(data.payload || "");
  };

  const captureFrame = async () => {
    const video = videoRef.current;
    if (!video || video.readyState < 2 || !video.videoWidth || !video.videoHeight) return "";
    const maxWidth = 960;
    const scale = Math.min(1, maxWidth / video.videoWidth);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
    canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
    canvas.getContext("2d")?.drawImage(video, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.86));
    return blob ? decodeBlobOnServer(blob) : "";
  };

  const detectWithBrowser = async () => {
    const Detector = (window as typeof window & {
      BarcodeDetector?: new (options?: { formats?: string[] }) => {
        detect: (source: CanvasImageSource) => Promise<Array<{ rawValue?: string }>>;
      };
    }).BarcodeDetector;
    if (!Detector || !videoRef.current) return "";
    try {
      const detector = new Detector({ formats: ["qr_code"] });
      const codes = await detector.detect(videoRef.current);
      return String(codes[0]?.rawValue || "");
    } catch {
      return "";
    }
  };

  const scanOnce = async () => {
    if (scanBusyRef.current) return;
    scanBusyRef.current = true;
    try {
      const nativePayload = await detectWithBrowser();
      const payload = nativePayload || await captureFrame();
      if (payload) await addByPayload(payload);
    } catch (error) {
      stopScanner();
      setScanOpen(false);
      toast({
        title: "QR-код",
        description: error instanceof Error ? error.message : "Не удалось обработать QR-код",
        variant: "destructive",
      });
    } finally {
      scanBusyRef.current = false;
    }
  };

  const startScanner = async () => {
    setCameraError("");
    setScanLoading(true);
    setScanOpen(true);
    try {
      stopScanner();
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      });
      streamRef.current = stream;
      await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => undefined);
      }
      scanTimerRef.current = window.setInterval(() => { void scanOnce(); }, 900);
    } catch (error) {
      setCameraError(
        error instanceof DOMException && error.name === "NotAllowedError"
          ? "Браузер не дал доступ к камере. Разрешите камеру для SocialBIRD или выберите фотографию QR-кода."
          : "Не удалось открыть камеру. Можно выбрать фотографию или скриншот QR-кода.",
      );
    } finally {
      setScanLoading(false);
    }
  };

  const scanFile = async (file?: File | null) => {
    if (!file) return;
    setScanLoading(true);
    try {
      const payload = await decodeBlobOnServer(file);
      if (!payload) throw new Error("QR-код на изображении не найден");
      await addByPayload(payload);
    } catch (error) {
      toast({
        title: "QR-код",
        description: error instanceof Error ? error.message : "Не удалось распознать QR-код",
        variant: "destructive",
      });
    } finally {
      setScanLoading(false);
    }
  };

  return (
    <>
      <div className="grid w-full grid-cols-1 gap-2 sm:flex sm:w-auto sm:flex-wrap">
        <Button type="button" variant="outline" className="w-full gap-2 sm:w-auto" onClick={generateQr} disabled={qrLoading}>
          <QrCode className="h-4 w-4" />
          {qrLoading ? "Создаём..." : "Мой QR-код"}
        </Button>
        <Button type="button" variant="outline" className="w-full gap-2 sm:w-auto" onClick={startScanner}>
          <Camera className="h-4 w-4" />
          Скан QR-кода
        </Button>
      </div>

      <Dialog open={myQrOpen} onOpenChange={setMyQrOpen}>
        <DialogContent className="w-[min(420px,calc(100vw-20px))] rounded-2xl">
          <DialogHeader>
            <DialogTitle>Мой QR-код для добавления в друзья</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col items-center gap-4 text-center">
            {qrToken && (
              <img
                src={apiUrl(`/friend-qr/image/${encodeURIComponent(qrToken)}.svg`)}
                alt="QR-код для добавления в друзья"
                className="aspect-square w-[min(290px,78vw)] rounded-2xl border bg-white p-3"
              />
            )}
            <p className="text-xs text-muted-foreground">
              Покажите этот код другому человеку. Код одноразовый и действует 10 минут.
            </p>
            {qrPayload && <Input readOnly value={qrPayload} className="text-xs" />}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={scanOpen}
        onOpenChange={(open) => {
          setScanOpen(open);
          if (!open) stopScanner();
        }}
      >
        <DialogContent className="w-[min(520px,calc(100vw-16px))] rounded-2xl p-3 sm:p-6">
          <DialogHeader>
            <DialogTitle className="flex items-center justify-between gap-3">
              <span>Сканировать QR-код</span>
              <Button type="button" variant="ghost" size="icon" className="h-7 w-7" onClick={() => setScanOpen(false)}>
                <X className="h-4 w-4" />
              </Button>
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="relative aspect-[4/3] w-full overflow-hidden rounded-xl bg-black">
              <video ref={videoRef} autoPlay muted playsInline className="h-full w-full object-cover" />
              <div className="pointer-events-none absolute inset-[14%] rounded-2xl border-2 border-white/75 shadow-[0_0_0_999px_rgba(0,0,0,0.22)]" />
            </div>
            {cameraError && <p className="text-sm text-amber-600 dark:text-amber-300">{cameraError}</p>}
            <p className="text-xs text-muted-foreground">Наведите камеру на QR-код SocialBIRD. Сканирование выполняется автоматически.</p>
            <label className="block">
              <Input
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                onChange={(event) => { void scanFile(event.target.files?.[0]); event.currentTarget.value = ""; }}
              />
              <Button type="button" variant="outline" className="w-full gap-2" asChild disabled={scanLoading}>
                <span><ImagePlus className="h-4 w-4" />{scanLoading ? "Распознаём..." : "Выбрать фото / скриншот"}</span>
              </Button>
            </label>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
};

export default FriendQrTools;
