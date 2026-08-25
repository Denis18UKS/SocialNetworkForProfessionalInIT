import fs from 'node:fs';

const replaceRequired = (source, from, to, label) => {
  if (!source.includes(from)) throw new Error(`C-Party unrestricted storage patch failed: ${label}`);
  return source.replace(from, to);
};

const patchAdminCinema = () => {
  const file = 'backend/admin-cinema-library.js';
  let source = fs.readFileSync(file, 'utf8');
  const marker = '// CPARTY_UNRESTRICTED_STORAGE_V1';
  if (!source.includes(marker)) {
    source = replaceRequired(
      source,
      "const MAX_UPLOAD_BYTES = 16 * 1024 * 1024 * 1024;\nconst DISK_RESERVE_BYTES = 512 * 1024 * 1024;",
      `const MAX_UPLOAD_BYTES = Number(process.env.CINEMA_MAX_UPLOAD_BYTES || Number.MAX_SAFE_INTEGER);\nconst DISK_RESERVE_BYTES = Number(process.env.CINEMA_DISK_RESERVE_BYTES || 0);\n${marker}`,
      'admin upload constants',
    );
    source = replaceRequired(
      source,
      '      const requiredBytes = fileSize * 2 + DISK_RESERVE_BYTES;',
      '      const requiredBytes = Math.max(0, DISK_RESERVE_BYTES);',
      'admin disk reserve check',
    );
  }
  fs.writeFileSync(file, source, 'utf8');
};

const patchUserCinema = () => {
  const file = 'backend/socialbird-final-platform.js';
  let source = fs.readFileSync(file, 'utf8');
  const marker = '// CPARTY_UNRESTRICTED_STORAGE_V1';
  if (!source.includes(marker)) {
    source = replaceRequired(
      source,
      'const CINEMA_MAX_UPLOAD_BYTES = 16 * 1024 * 1024 * 1024;',
      `const CINEMA_MAX_UPLOAD_BYTES = Number(process.env.CINEMA_MAX_UPLOAD_BYTES || Number.MAX_SAFE_INTEGER);\n${marker}`,
      'user upload max size',
    );
  }
  fs.writeFileSync(file, source, 'utf8');
};

patchAdminCinema();
patchUserCinema();
console.log('C-Party storage limits are unrestricted by default; optional limits are controlled by CINEMA_MAX_UPLOAD_BYTES and CINEMA_DISK_RESERVE_BYTES.');
