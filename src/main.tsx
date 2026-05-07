import { createRoot } from 'react-dom/client'
import App from './App.tsx'
import './index.css'
import { readSettings } from './lib/settings.ts'

const settings = readSettings();
const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
document.documentElement.classList.toggle(
  "dark",
  settings.theme === "dark" || (settings.theme === "system" && prefersDark)
);

createRoot(document.getElementById("root")!).render(<App />);
