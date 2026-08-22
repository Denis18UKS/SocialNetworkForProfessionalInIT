import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const deployDirectory = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(deployDirectory, '..');

const patchFile = (relativePath, transform) => {
  const filePath = path.join(root, relativePath);
  const before = fs.readFileSync(filePath, 'utf8');
  const after = transform(before);
  if (after !== before) {
    fs.writeFileSync(filePath, after, 'utf8');
    console.log(`Applied mail recovery fixes: ${relativePath}`);
  }
};

patchFile('backend/server.js', (input) => {
  let source = input;
  if (!source.includes("require('./password-recovery')")) {
    source = source.replace(
      "const { runSandboxedCompilerJob } = require('./compiler-client');",
      "const { runSandboxedCompilerJob } = require('./compiler-client');\nconst { registerPasswordRecoveryRoutes } = require('./password-recovery');",
    );
  }

  if (!source.includes('MAIL_RECOVERY: secure-reset-routes')) {
    const resetRoute = /app\.post\('\/password-reset\/request'[\s\S]*?\n\}\);\n\n\/\/ Маршрут для получения списка пользователей/;
    if (!resetRoute.test(source)) {
      throw new Error('Mail recovery fix failed: password reset route not found');
    }
    source = source.replace(
      resetRoute,
      `// MAIL_RECOVERY: secure-reset-routes\nregisterPasswordRecoveryRoutes({ app, db, transporter, bcrypt, crypto });\n\n// Маршрут для получения списка пользователей`,
    );
  }
  return source;
});

patchFile('src/pages/Login.tsx', (input) => {
  let source = input;
  if (!source.includes('@/components/PasswordRecovery')) {
    source = source.replace(
      'import { motion } from "framer-motion";',
      'import { motion } from "framer-motion";\nimport PasswordRecovery from "@/components/PasswordRecovery";',
    );
  }

  if (!source.includes('MAIL_RECOVERY: two-step-ui')) {
    const resetUi = /\{showPasswordReset && \(\s*<form[\s\S]*?<\/form>\s*\)\}/;
    if (!resetUi.test(source)) {
      throw new Error('Mail recovery fix failed: password reset UI not found');
    }
    source = source.replace(
      resetUi,
      `{showPasswordReset && (\n                <div data-mail-recovery="two-step" className="MAIL_RECOVERY: two-step-ui">\n                  <PasswordRecovery />\n                </div>\n              )}`,
    );
  }
  return source;
});

patchFile('deploy/install.sh', (input) => {
  let source = input;

  if (!source.includes('# MAIL_RECOVERY: preserve-existing-mail-settings')) {
    const marker = 'cat > "$BACKEND_ENV" <<ENV';
    if (!source.includes(marker)) throw new Error('Mail recovery fix failed: backend env marker not found');
    const preserveLines = [
      '# MAIL_RECOVERY: preserve-existing-mail-settings',
      'read_existing_env_value() {',
      '  local key="$1"',
      '  if [[ -f "$BACKEND_ENV" ]]; then',
      '    grep -m1 -E "^${key}=" "$BACKEND_ENV" | cut -d= -f2- || true',
      '  fi',
      '}',
      'EXISTING_SMTP_HOST="$(read_existing_env_value SMTP_HOST)"',
      'EXISTING_SMTP_PORT="$(read_existing_env_value SMTP_PORT)"',
      'EXISTING_SMTP_SECURE="$(read_existing_env_value SMTP_SECURE)"',
      'EXISTING_SMTP_USER="$(read_existing_env_value SMTP_USER)"',
      'EXISTING_SMTP_PASSWORD="$(read_existing_env_value SMTP_PASSWORD)"',
      'EXISTING_SMTP_FROM="$(read_existing_env_value SMTP_FROM)"',
      'EXISTING_OWNER_ADMIN_EMAIL="$(read_existing_env_value OWNER_ADMIN_EMAIL)"',
      '',
      marker,
    ];
    source = source.replace(marker, preserveLines.join('\n'));
  }

  source = source
    .replace(/^SMTP_HOST=.*$/m, 'SMTP_HOST=${EXISTING_SMTP_HOST}')
    .replace(/^SMTP_PORT=.*$/m, 'SMTP_PORT=${EXISTING_SMTP_PORT:-465}')
    .replace(/^SMTP_SECURE=.*$/m, 'SMTP_SECURE=${EXISTING_SMTP_SECURE:-true}')
    .replace(/^SMTP_USER=.*$/m, 'SMTP_USER=${EXISTING_SMTP_USER}')
    .replace(/^SMTP_PASSWORD=.*$/m, 'SMTP_PASSWORD=${EXISTING_SMTP_PASSWORD}')
    .replace(/^SMTP_FROM=.*$/m, 'SMTP_FROM=${EXISTING_SMTP_FROM}');

  if (!/^OWNER_ADMIN_EMAIL=/m.test(source)) {
    source = source.replace(
      'SMTP_FROM=${EXISTING_SMTP_FROM}',
      'SMTP_FROM=${EXISTING_SMTP_FROM}\nOWNER_ADMIN_EMAIL=${EXISTING_OWNER_ADMIN_EMAIL}',
    );
  }

  if (!source.includes('apply-mail-recovery-fixes.mjs')) {
    const preferredMarker = 'sudo -u "$APP_USER" node "${APP_DIRECTORY}/deploy/apply-call-video-mount-fix.mjs"';
    const fallbackMarker = 'sudo -u "$APP_USER" node "${APP_DIRECTORY}/deploy/harden-source.mjs"';
    const mailCall = 'sudo -u "$APP_USER" node "${APP_DIRECTORY}/deploy/apply-mail-recovery-fixes.mjs"';

    if (source.includes(preferredMarker)) {
      source = source.replace(preferredMarker, `${preferredMarker}\n${mailCall}`);
    } else if (source.includes(fallbackMarker)) {
      source = source.replace(fallbackMarker, `${mailCall}\n${fallbackMarker}`);
    } else {
      console.warn('Mail recovery installer hook skipped: no known source-patch marker found');
    }
  }
  return source;
});

console.log('Mail recovery fixes are current.');
