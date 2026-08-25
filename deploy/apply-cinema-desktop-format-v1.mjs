import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const runDesktopOnly = async (sourceFile) => {
  const sourcePath = path.resolve(sourceFile);
  let source = fs.readFileSync(sourcePath, 'utf8');
  if (!source.includes('patchBackend();')) {
    throw new Error(`Desktop-only C-Party patch wrapper: patchBackend() call not found in ${sourceFile}`);
  }

  source = source.replace('patchBackend();', '// Desktop-only build: backend patch intentionally skipped.');

  const tempPath = path.join(
    path.dirname(sourcePath),
    `.${path.basename(sourcePath, '.mjs')}.desktop-${process.pid}-${Date.now()}.mjs`,
  );

  fs.writeFileSync(tempPath, source, 'utf8');
  try {
    await import(`${pathToFileURL(tempPath).href}?desktop=${Date.now()}`);
  } finally {
    fs.rmSync(tempPath, { force: true });
  }
};

await runDesktopOnly('deploy/apply-cinema-format-normalization-v1.mjs');
await runDesktopOnly('deploy/apply-cinema-existing-normalize-v1.mjs');

console.log('C-Party desktop-only video format patches applied without touching backend sources.');
