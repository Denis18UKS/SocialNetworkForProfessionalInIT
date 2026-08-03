import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import { spawn } from 'node:child_process';
import path from 'node:path';

const SOCKET_PATH = process.env.COMPILER_SOCKET || '/run/socialbird-compiler/runner.sock';
const IMAGE = process.env.COMPILER_SANDBOX_IMAGE || 'socialbird/compiler-sandbox:latest';
const DOCKER_BIN = process.env.DOCKER_BIN || '/usr/bin/docker';
const JOB_TIMEOUT_MS = Number(process.env.COMPILER_JOB_TIMEOUT_MS || 10000);
const MAX_CODE_BYTES = Number(process.env.COMPILER_MAX_CODE_BYTES || 200000);
const MAX_REQUEST_BYTES = MAX_CODE_BYTES + 16384;
const MAX_CONCURRENT = Math.max(1, Number(process.env.COMPILER_MAX_CONCURRENT || 2));
const MAX_QUEUE = Math.max(0, Number(process.env.COMPILER_MAX_QUEUE || 20));
const MEMORY_LIMIT = process.env.COMPILER_MEMORY_LIMIT || '256m';
const CPU_LIMIT = process.env.COMPILER_CPU_LIMIT || '0.75';
const PIDS_LIMIT = process.env.COMPILER_PIDS_LIMIT || '64';
const MAX_OUTPUT_BYTES = Number(process.env.COMPILER_MAX_OUTPUT_BYTES || 131072);
const STEP_TIMEOUT_MS = Math.max(1000, JOB_TIMEOUT_MS - 1500);
const DOCKER_RUNTIME = String(process.env.COMPILER_DOCKER_RUNTIME || '').trim();

const supportedLanguages = new Set([
  'java', 'csharp', 'cpp', 'lua', 'python', 'php', 'javascript', 'nodejs', 'react',
]);

let activeJobs = 0;
const pendingJobs = [];

const jsonResponse = (res, statusCode, payload) => {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  });
  res.end(body);
};

const acquireSlot = () => new Promise((resolve, reject) => {
  if (activeJobs < MAX_CONCURRENT) {
    activeJobs += 1;
    resolve();
    return;
  }

  if (pendingJobs.length >= MAX_QUEUE) {
    reject(Object.assign(new Error('Очередь компилятора переполнена.'), { statusCode: 429 }));
    return;
  }

  pendingJobs.push({ resolve, reject });
});

const releaseSlot = () => {
  const next = pendingJobs.shift();
  if (next) {
    next.resolve();
    return;
  }
  activeJobs = Math.max(0, activeJobs - 1);
};

const readJsonBody = (req) => new Promise((resolve, reject) => {
  const chunks = [];
  let size = 0;

  req.on('data', (chunk) => {
    size += chunk.length;
    if (size > MAX_REQUEST_BYTES) {
      reject(Object.assign(new Error('Запрос слишком большой.'), { statusCode: 413 }));
      req.destroy();
      return;
    }
    chunks.push(chunk);
  });

  req.on('end', () => {
    try {
      resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
    } catch {
      reject(Object.assign(new Error('Некорректный JSON.'), { statusCode: 400 }));
    }
  });

  req.on('error', reject);
});

const killContainer = (containerName) => {
  const killer = spawn(DOCKER_BIN, ['rm', '--force', containerName], {
    stdio: 'ignore',
    windowsHide: true,
  });
  killer.unref();
};

const dockerArgs = (containerName) => {
  const args = [
    'run', '--rm', '--name', containerName,
    '--network', 'none',
    '--read-only',
    '--tmpfs', '/workspace:rw,exec,nosuid,nodev,size=32m,mode=1777',
    '--tmpfs', '/tmp:rw,noexec,nosuid,nodev,size=16m,mode=1777',
    '--cap-drop', 'ALL',
    '--security-opt', 'no-new-privileges=true',
    '--pids-limit', PIDS_LIMIT,
    '--memory', MEMORY_LIMIT,
    '--memory-swap', MEMORY_LIMIT,
    '--cpus', CPU_LIMIT,
    '--ulimit', 'nofile=64:64',
    '--ulimit', 'nproc=64:64',
    '--ulimit', 'core=0:0',
    '--ulimit', 'fsize=16777216:16777216',
    '--user', '65532:65532',
    '--workdir', '/workspace',
    '--hostname', 'socialbird-sandbox',
    '--ipc', 'none',
    '--env', `SANDBOX_STEP_TIMEOUT_MS=${STEP_TIMEOUT_MS}`,
    '--env', `SANDBOX_MAX_OUTPUT_BYTES=${MAX_OUTPUT_BYTES}`,
    '--pull', 'never',
  ];

  if (DOCKER_RUNTIME) args.push('--runtime', DOCKER_RUNTIME);
  args.push('-i', IMAGE);
  return args;
};

const runContainer = (payload) => new Promise((resolve, reject) => {
  const containerName = `socialbird-compiler-${crypto.randomUUID().replaceAll('-', '').slice(0, 20)}`;
  const child = spawn(DOCKER_BIN, dockerArgs(containerName), {
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
    env: {
      PATH: process.env.PATH || '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
      HOME: process.env.HOME || '/var/lib/socialbird-compiler',
      DOCKER_HOST: process.env.DOCKER_HOST || 'unix:///var/run/docker.sock',
      DOCKER_CONFIG: process.env.DOCKER_CONFIG || '/run/socialbird-compiler/docker',
    },
  });

  let stdout = Buffer.alloc(0);
  let stderr = Buffer.alloc(0);
  let settled = false;
  const maxRunnerOutput = MAX_OUTPUT_BYTES * 3 + 65536;

  const append = (current, chunk) => {
    if (current.length >= maxRunnerOutput) return current;
    return Buffer.concat([current, Buffer.from(chunk).subarray(0, maxRunnerOutput - current.length)]);
  };

  child.stdout.on('data', (chunk) => { stdout = append(stdout, chunk); });
  child.stderr.on('data', (chunk) => { stderr = append(stderr, chunk); });

  const timer = setTimeout(() => {
    if (settled) return;
    settled = true;
    child.kill('SIGKILL');
    killContainer(containerName);
    resolve({
      success: false,
      stdout: '',
      stderr: `Выполнение остановлено: превышен общий лимит ${JOB_TIMEOUT_MS / 1000} сек.`,
      diagnostics: ['Код выполнялся слишком долго и был остановлен песочницей.'],
      friendlyDiagnostics: ['Проверьте бесконечные циклы или ожидание ввода.'],
      steps: [],
      sandboxed: true,
    });
  }, JOB_TIMEOUT_MS);

  child.on('error', (error) => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    reject(new Error(error.code === 'ENOENT'
      ? 'Docker не найден на сервере компилятора.'
      : `Не удалось запустить песочницу: ${error.message}`));
  });

  child.on('close', (code) => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);

    const raw = stdout.toString('utf8').trim();
    try {
      const result = JSON.parse(raw);
      if (code !== 0 && result.success !== false) result.success = false;
      if (stderr.length > 0) {
        result.stderr = [result.stderr, stderr.toString('utf8').trim()].filter(Boolean).join('\n');
      }
      resolve(result);
    } catch {
      reject(new Error(`Песочница вернула некорректный ответ.${stderr.length ? ` ${stderr.toString('utf8').trim()}` : ''}`));
    }
  });

  child.stdin.end(JSON.stringify({ language: payload.language, code: payload.code }));
});

const validatePayload = (payload) => {
  if (!payload || typeof payload !== 'object') throw Object.assign(new Error('Пустой запрос.'), { statusCode: 400 });
  if (!supportedLanguages.has(payload.language)) throw Object.assign(new Error('Неподдерживаемый язык.'), { statusCode: 400 });
  if (typeof payload.code !== 'string' || payload.code.trim().length === 0) throw Object.assign(new Error('Код пустой.'), { statusCode: 400 });
  if (Buffer.byteLength(payload.code, 'utf8') > MAX_CODE_BYTES) throw Object.assign(new Error(`Код слишком большой. Максимум ${MAX_CODE_BYTES} байт.`), { statusCode: 413 });
};

const server = http.createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/health') {
    jsonResponse(res, 200, {
      ok: true,
      activeJobs,
      queuedJobs: pendingJobs.length,
      maxConcurrent: MAX_CONCURRENT,
      image: IMAGE,
    });
    return;
  }

  if (req.method !== 'POST' || req.url !== '/run') {
    jsonResponse(res, 404, { message: 'Not found' });
    return;
  }

  let acquired = false;
  try {
    const payload = await readJsonBody(req);
    validatePayload(payload);
    await acquireSlot();
    acquired = true;
    const result = await runContainer(payload);
    jsonResponse(res, 200, result);
  } catch (error) {
    jsonResponse(res, error.statusCode || 500, {
      success: false,
      stdout: '',
      stderr: error.message || 'Ошибка сервера песочницы.',
      diagnostics: ['Не удалось выполнить код в изолированной среде.'],
      friendlyDiagnostics: [error.statusCode === 429 ? 'Компилятор занят. Повторите запуск немного позже.' : 'Песочница временно недоступна.'],
      steps: [],
      sandboxed: true,
    });
  } finally {
    if (acquired) releaseSlot();
  }
});

const socketDirectory = path.dirname(SOCKET_PATH);
fs.mkdirSync(socketDirectory, { recursive: true, mode: 0o750 });
if (process.env.DOCKER_CONFIG) {
  fs.mkdirSync(process.env.DOCKER_CONFIG, { recursive: true, mode: 0o700 });
}
try { fs.unlinkSync(SOCKET_PATH); } catch (error) { if (error.code !== 'ENOENT') throw error; }

server.listen(SOCKET_PATH, () => {
  fs.chmodSync(SOCKET_PATH, 0o660);
  console.log(`SocialBIRD compiler runner listening on ${SOCKET_PATH}`);
});

const shutdown = () => {
  server.close(() => {
    try { fs.unlinkSync(SOCKET_PATH); } catch {}
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 5000).unref();
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
