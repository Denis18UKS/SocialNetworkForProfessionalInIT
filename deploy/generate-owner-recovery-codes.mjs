import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ENV_PATH = '/etc/socialbird/backend.env';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const requireFromBackend = createRequire(path.join(root, 'backend', 'package.json'));
const mysql = requireFromBackend('mysql2/promise');
const bcrypt = requireFromBackend('bcrypt');

const parseEnv = (text) => Object.fromEntries(
  text.split(/\r?\n/)
    .filter((line) => line && !line.trim().startsWith('#') && line.includes('='))
    .map((line) => {
      const index = line.indexOf('=');
      return [line.slice(0, index).trim(), line.slice(index + 1).trim()];
    })
);

const setEnvValue = (text, key, value) => {
  const lines = text.split(/\r?\n/);
  let found = false;
  const updated = lines.map((line) => {
    if (line.startsWith(`${key}=`)) {
      found = true;
      return `${key}=${value}`;
    }
    return line;
  });
  if (!found) updated.push(`${key}=${value}`);
  return updated.join('\n').replace(/\n+$/, '') + '\n';
};

if (typeof process.getuid === 'function' && process.getuid() !== 0) {
  console.error('Run this script as root so it can read /etc/socialbird/backend.env.');
  process.exit(1);
}

const ownerEmail = String(process.argv[2] || '').trim().toLowerCase();
if (!ownerEmail || !ownerEmail.includes('@')) {
  console.error('Usage: node deploy/generate-owner-recovery-codes.mjs owner@example.com');
  process.exit(1);
}

if (!fs.existsSync(ENV_PATH)) {
  console.error(`${ENV_PATH} not found.`);
  process.exit(1);
}

const envText = fs.readFileSync(ENV_PATH, 'utf8');
const env = parseEnv(envText);
const connection = await mysql.createConnection({
  host: env.DB_HOST || '127.0.0.1',
  port: Number(env.DB_PORT || 3306),
  user: env.DB_USER,
  password: env.DB_PASSWORD,
  database: env.DB_NAME,
});

try {
  const [users] = await connection.query(
    "SELECT id, username, email, role FROM users WHERE LOWER(email) = ? AND role = 'admin' LIMIT 1",
    [ownerEmail],
  );
  if (users.length === 0) {
    throw new Error('No administrator account found with that email.');
  }
  const user = users[0];

  await connection.query(`CREATE TABLE IF NOT EXISTS owner_recovery_codes (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    code_hash VARCHAR(255) NOT NULL,
    used_at DATETIME NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_owner_recovery_user (user_id, used_at)
  )`);

  await connection.beginTransaction();
  try {
    await connection.query('DELETE FROM owner_recovery_codes WHERE user_id = ? AND used_at IS NULL', [user.id]);

    const plainCodes = [];
    for (let index = 0; index < 8; index += 1) {
      const raw = crypto.randomBytes(10).toString('hex').toUpperCase();
      const grouped = raw.match(/.{1,4}/g).join('-');
      const code = `SB-${grouped}`;
      plainCodes.push(code);
      const hash = await bcrypt.hash(code, 12);
      await connection.query(
        'INSERT INTO owner_recovery_codes (user_id, code_hash) VALUES (?, ?)',
        [user.id, hash],
      );
    }

    await connection.commit();

    const updatedEnv = setEnvValue(envText, 'OWNER_ADMIN_EMAIL', ownerEmail);
    fs.writeFileSync(ENV_PATH, updatedEnv, { mode: 0o640 });
    fs.chmodSync(ENV_PATH, 0o640);

    console.log('');
    console.log(`Owner recovery enabled for admin: ${user.username}`);
    console.log('SAVE THESE CODES OFFLINE. They are shown only now; the database stores only bcrypt hashes.');
    console.log('Each code works once. Generating a new set invalidates all unused codes from the previous set.');
    console.log('');
    plainCodes.forEach((code, index) => console.log(`${String(index + 1).padStart(2, '0')}. ${code}`));
    console.log('');
    console.log('Restart socialbird-api after generating codes so OWNER_ADMIN_EMAIL is loaded.');
  } catch (error) {
    await connection.rollback();
    throw error;
  }
} finally {
  await connection.end();
}
