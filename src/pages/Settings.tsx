import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { AppSettings, ThemeMode, readSettings, writeSettings } from "@/lib/settings";
import { useI18n } from "@/lib/i18n";

const applyTheme = (theme: ThemeMode) => {
  const root = document.documentElement;
  const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  root.classList.toggle("dark", theme === "dark" || (theme === "system" && prefersDark));
};

const Settings = () => {
  const [settings, setSettings] = useState<AppSettings>(readSettings);
  const { t } = useI18n();

  useEffect(() => {
    applyTheme(settings.theme);
    writeSettings(settings);
  }, [settings]);

  const update = (patch: Partial<AppSettings>) => {
    setSettings((current) => ({ ...current, ...patch }));
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 p-4">
      <div className="mx-auto max-w-3xl">
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
      </div>
    </div>
  );
};

export default Settings;
