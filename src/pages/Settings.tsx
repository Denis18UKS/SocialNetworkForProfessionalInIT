import { useEffect, useRef, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { AppSettings, ThemeMode, readSettings, writeSettings } from "@/lib/settings";
import { useI18n } from "@/lib/i18n";

const applyTheme = (theme: ThemeMode) => {
  const root = document.documentElement;
  const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  root.classList.toggle("dark", theme === "dark" || (theme === "system" && prefersDark));
};

const Settings = () => {
  const [settings, setSettings] = useState<AppSettings>(readSettings);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [isMicTesting, setIsMicTesting] = useState(false);
  const [micLevel, setMicLevel] = useState(0);
  const micTestRef = useRef<{
    context: AudioContext;
    stream: MediaStream;
    monitor: HTMLAudioElement;
    frameId: number;
  } | null>(null);
  const { t } = useI18n();

  useEffect(() => {
    applyTheme(settings.theme);
    writeSettings(settings);
  }, [settings]);

  const update = (patch: Partial<AppSettings>) => {
    setSettings((current) => ({ ...current, ...patch }));
  };

  const loadDevices = async () => {
    if (!navigator.mediaDevices?.enumerateDevices) return;

    try {
      let list = await navigator.mediaDevices.enumerateDevices();
      const hasLabels = list.some((device) => device.label);

      if (!hasLabels) {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true }).catch(async () => (
          navigator.mediaDevices.getUserMedia({ audio: true })
        ));
        stream.getTracks().forEach((track) => track.stop());
        list = await navigator.mediaDevices.enumerateDevices();
      }

      setDevices(list);
    } catch {
      const list = await navigator.mediaDevices.enumerateDevices().catch(() => []);
      setDevices(list);
    }
  };

  useEffect(() => {
    loadDevices();
    navigator.mediaDevices?.addEventListener?.("devicechange", loadDevices);
    return () => {
      navigator.mediaDevices?.removeEventListener?.("devicechange", loadDevices);
      stopMicrophoneTest();
    };
  }, []);

  const stopMicrophoneTest = () => {
    if (!micTestRef.current) return;
    cancelAnimationFrame(micTestRef.current.frameId);
    micTestRef.current.monitor.pause();
    micTestRef.current.monitor.srcObject = null;
    micTestRef.current.stream.getTracks().forEach((track) => track.stop());
    micTestRef.current.context.close().catch(() => undefined);
    micTestRef.current = null;
    window.dispatchEvent(new CustomEvent("itbird-microphone-test-stop"));
    setIsMicTesting(false);
    setMicLevel(0);
  };

  const startMicrophoneTest = async () => {
    if (isMicTesting) {
      stopMicrophoneTest();
      return;
    }

    try {
      window.dispatchEvent(new CustomEvent("itbird-microphone-test-start"));
      const useNoiseSuppression = settings.noiseSuppressionMode === "krisp";
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          ...(settings.microphoneDeviceId ? { deviceId: { exact: settings.microphoneDeviceId } } : {}),
          echoCancellation: useNoiseSuppression,
          noiseSuppression: useNoiseSuppression,
          autoGainControl: useNoiseSuppression,
        },
      });
      const AudioContextClass =
        window.AudioContext ||
        (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioContextClass) return;

      const context = new AudioContextClass();
      if (context.state === "suspended") await context.resume().catch(() => undefined);
      const analyser = context.createAnalyser();
      analyser.fftSize = 256;
      context.createMediaStreamSource(stream).connect(analyser);
      const data = new Uint8Array(analyser.frequencyBinCount);
      const monitor = new Audio();
      monitor.autoplay = true;
      monitor.muted = false;
      monitor.srcObject = stream;
      const outputId = settings.audioOutputDeviceId;
      if (outputId && "setSinkId" in monitor) {
        await (monitor as HTMLAudioElement & { setSinkId: (sinkId: string) => Promise<void> })
          .setSinkId(outputId)
          .catch(() => undefined);
      }
      await monitor.play().catch(() => undefined);

      const tick = () => {
        analyser.getByteFrequencyData(data);
        const average = data.reduce((sum, value) => sum + value, 0) / data.length;
        setMicLevel(Math.min(100, Math.round((average / 120) * 100)));
        const frameId = requestAnimationFrame(tick);
        if (micTestRef.current) micTestRef.current.frameId = frameId;
      };

      const frameId = requestAnimationFrame(tick);
      micTestRef.current = { context, stream, monitor, frameId };
      setIsMicTesting(true);
    } catch {
      window.dispatchEvent(new CustomEvent("itbird-microphone-test-stop"));
      setIsMicTesting(false);
      setMicLevel(0);
    }
  };

  const microphones = devices.filter((device) => device.kind === "audioinput");
  const outputs = devices.filter((device) => device.kind === "audiooutput");
  const cameras = devices.filter((device) => device.kind === "videoinput");

  return (
    <div className="min-h-full bg-gray-50 p-0 dark:bg-gray-900 sm:p-2 lg:p-4">
      <div className="mx-auto max-w-3xl space-y-4">
        <Card>
          <CardHeader>
            <CardTitle>{t("settings")}</CardTitle>
            <CardDescription>{t("settingsDescription")}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="space-y-2">
              <Label>{t("theme")}</Label>
              <Select value={settings.theme} onValueChange={(value) => update({ theme: value as AppSettings["theme"] })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="system">{t("system")}</SelectItem>
                  <SelectItem value="light">{t("light")}</SelectItem>
                  <SelectItem value="dark">{t("dark")}</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>{t("appLanguage")}</Label>
              <Select value={settings.appLanguage} onValueChange={(value) => update({ appLanguage: value as AppSettings["appLanguage"] })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ru">{t("russian")}</SelectItem>
                  <SelectItem value="en">{t("english")}</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center justify-between gap-4 rounded-md border p-4">
              <div>
                <Label>{t("autoTranslate")}</Label>
                <p className="text-sm text-muted-foreground">{t("autoTranslateHint")}</p>
              </div>
              <Switch
                checked={settings.autoTranslate}
                onCheckedChange={(checked) => update({ autoTranslate: checked })}
              />
            </div>

            <div className="space-y-2">
              <Label>{t("translateLanguage")}</Label>
              <Select
                value={settings.translateLanguage}
                disabled={!settings.autoTranslate}
                onValueChange={(value) => update({ translateLanguage: value as AppSettings["translateLanguage"] })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ru">{t("russian")}</SelectItem>
                  <SelectItem value="en">English</SelectItem>
                  <SelectItem value="de">Deutsch</SelectItem>
                  <SelectItem value="fr">Francais</SelectItem>
                  <SelectItem value="es">Espanol</SelectItem>
                  <SelectItem value="zh">Chinese</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t("callDevices")}</CardTitle>
            <CardDescription>{t("callDevicesDescription")}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <p className="text-sm text-muted-foreground">{t("devicesAccessHint")}</p>

            <div className="space-y-2">
              <Label>{t("microphone")}</Label>
              <Select
                value={settings.microphoneDeviceId || "default"}
                onValueChange={(value) => update({ microphoneDeviceId: value === "default" ? undefined : value })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="default">{t("defaultDevice")}</SelectItem>
                  {microphones.map((device, index) => (
                    <SelectItem key={device.deviceId} value={device.deviceId}>
                      {device.label || `${t("microphone")} ${index + 1}`}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <Label>{t("microphoneLevel")}</Label>
                <Button type="button" variant="outline" size="sm" onClick={startMicrophoneTest}>
                  {isMicTesting ? t("stopTest") : t("testMicrophone")}
                </Button>
              </div>
              <Progress value={micLevel} />
              <p className="text-xs text-muted-foreground">{t("microphoneMonitorHint")}</p>
            </div>

            <div className="space-y-2">
              <Label>{t("noiseSuppression")}</Label>
              <Select
                value={settings.noiseSuppressionMode || "off"}
                onValueChange={(value) => update({ noiseSuppressionMode: value as AppSettings["noiseSuppressionMode"] })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="off">{t("noiseSuppressionOff")}</SelectItem>
                  <SelectItem value="krisp">{t("noiseSuppressionKrisp")}</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">{t("krispHint")}</p>
            </div>

            <div className="space-y-2">
              <Label>{t("headphones")}</Label>
              <Select
                value={settings.audioOutputDeviceId || "default"}
                onValueChange={(value) => update({ audioOutputDeviceId: value === "default" ? undefined : value })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="default">{t("defaultDevice")}</SelectItem>
                  {outputs.map((device, index) => (
                    <SelectItem key={device.deviceId} value={device.deviceId}>
                      {device.label || `${t("headphones")} ${index + 1}`}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>{t("webcam")}</Label>
              <Select
                value={settings.cameraDeviceId || "none"}
                onValueChange={(value) => update({ cameraDeviceId: value === "none" ? undefined : value })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">{t("noCamera")}</SelectItem>
                  {cameras.map((device, index) => (
                    <SelectItem key={device.deviceId} value={device.deviceId}>
                      {device.label || `${t("webcam")} ${index + 1}`}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default Settings;
