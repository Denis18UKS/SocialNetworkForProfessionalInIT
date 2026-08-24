import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mainPath = path.join(root, 'android-app/app/src/main/java/io/itbird/socialbird/MainActivity.java');
let source = fs.readFileSync(mainPath, 'utf8');

if (!source.includes('public int getVersionCode()')) {
  const marker = `        @JavascriptInterface\n        public String getVersion() {\n            return BuildConfig.VERSION_NAME;\n        }`;
  const replacement = `${marker}\n\n        // ANDROID_UPDATE_AWARENESS: expose-version-code\n        @JavascriptInterface\n        public int getVersionCode() {\n            return BuildConfig.VERSION_CODE;\n        }`;
  if (!source.includes(marker)) throw new Error('Android update awareness patch failed: getVersion marker not found');
  source = source.replace(marker, replacement);
}

if (!source.includes('ANDROID_UPDATE_AWARENESS: expose-version-code')) {
  throw new Error('Android update awareness verification failed');
}

fs.writeFileSync(mainPath, source, 'utf8');
console.log('Android update-awareness bridge is current.');
