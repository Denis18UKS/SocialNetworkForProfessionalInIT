import { createRoot } from 'react-dom/client'
import App from './App.tsx'
import './index.css'
import { readSettings, resolveAppLanguage } from './lib/settings.ts'
import { installNetworkUrlRewrite } from './lib/network.ts'
import { installOfflineSupport } from './lib/offline.ts'

installNetworkUrlRewrite();
installOfflineSupport();

const settings = readSettings();
const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
document.documentElement.classList.toggle(
  "dark",
  settings.theme === "dark" || (settings.theme === "system" && prefersDark)
);
document.documentElement.lang = resolveAppLanguage(settings.appLanguage);

createRoot(document.getElementById("root")!).render(<App />);
