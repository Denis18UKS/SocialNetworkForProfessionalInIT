export type ThemeMode = "light" | "dark" | "system";
export type AppLanguage = "ru" | "en";
export type TranslateLanguage = "ru" | "en" | "de" | "fr" | "es" | "zh";
export type NoiseSuppressionMode = "off" | "krisp";

export interface AppSettings {
  theme: ThemeMode;
  appLanguage: AppLanguage;
  autoTranslate: boolean;
  translateLanguage: TranslateLanguage;
  microphoneDeviceId?: string;
  audioOutputDeviceId?: string;
  cameraDeviceId?: string;
  noiseSuppressionMode?: NoiseSuppressionMode;
}

export const defaultSettings: AppSettings = {
  theme: "system",
  appLanguage: "ru",
  autoTranslate: false,
  translateLanguage: "ru",
  noiseSuppressionMode: "off",
};

export const settingsStorageKey = "itbird-settings";

export const readSettings = (): AppSettings => {
  try {
    const raw = localStorage.getItem(settingsStorageKey);
    return raw ? { ...defaultSettings, ...JSON.parse(raw) } : defaultSettings;
  } catch {
    return defaultSettings;
  }
};

export const writeSettings = (settings: AppSettings) => {
  localStorage.setItem(settingsStorageKey, JSON.stringify(settings));
  window.dispatchEvent(new CustomEvent("itbird-settings-change", { detail: settings }));
};

export const getWsUrl = () => {
  const protocol = window.location.protocol === "https:" ? "wss" : "ws";
  return `${protocol}://${window.location.hostname}:5000`;
};
