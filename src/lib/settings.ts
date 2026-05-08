export type ThemeMode = "light" | "dark" | "system";
export type AppLanguage = "ru" | "en";
export type TranslateLanguage = "ru" | "en" | "de" | "fr" | "es" | "zh";
export type NoiseSuppressionMode = "off" | "krisp";

export interface AppSettings {
  theme: ThemeMode;
  appLanguage: AppLanguage;
  autoTranslate: boolean;
  translateLanguage: TranslateLanguage;
  transcriptionEnabled: boolean;
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
  transcriptionEnabled: false,
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

export const getApiBaseUrl = () => {
  const configuredUrl = import.meta.env.VITE_API_URL;
  if (configuredUrl) return configuredUrl.replace(/\/$/, "");

  const protocol = window.location.protocol === "https:" ? "https" : "http";
  return `${protocol}://${window.location.hostname}:5000`;
};

export const rewriteLocalhostApiUrl = (url: string) =>
  url.replace(/^http:\/\/localhost:5000/i, getApiBaseUrl());

export const apiUrl = (path: string) => {
  if (/^https?:\/\//i.test(path)) return rewriteLocalhostApiUrl(path);
  return `${getApiBaseUrl()}${path.startsWith("/") ? path : `/${path}`}`;
};

export const assetUrl = (path?: string | null) => {
  if (!path) return "";
  if (/^https?:\/\//i.test(path)) return rewriteLocalhostApiUrl(path);
  return apiUrl(path);
};

export const getWsUrl = () => {
  const protocol = window.location.protocol === "https:" ? "wss" : "ws";
  const apiBaseUrl = getApiBaseUrl();
  try {
    const parsed = new URL(apiBaseUrl);
    return `${protocol}://${parsed.host}`;
  } catch {
    return `${protocol}://${window.location.hostname}:5000`;
  }
};
