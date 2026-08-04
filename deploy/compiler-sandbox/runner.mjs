import fs from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';

const WORKSPACE = '/workspace';
const MAX_OUTPUT_BYTES = Number(process.env.SANDBOX_MAX_OUTPUT_BYTES || 131072);
const STEP_TIMEOUT_MS = Number(process.env.SANDBOX_STEP_TIMEOUT_MS || 7000);

const languageConfig = {
  java: { label: 'Java', filename: 'Main.java' },
  csharp: { label: 'C#', filename: 'Program.cs' },
  cpp: { label: 'C++', filename: 'main.cpp' },
  lua: { label: 'Lua', filename: 'main.lua' },
  python: { label: 'Python', filename: 'main.py' },
  php: { label: 'PHP', filename: 'main.php' },
  javascript: { label: 'JavaScript', filename: 'main.js' },
  nodejs: { label: 'Node.js', filename: 'app.js' },
  react: { label: 'React', filename: 'App.jsx' },
};

const readStdin = async () => {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
};

const clip = (value) => {
  const buffer = Buffer.from(value || '', 'utf8');
  if (buffer.length <= MAX_OUTPUT_BYTES) return buffer.toString('utf8');
  return `${buffer.subarray(0, MAX_OUTPUT_BYTES).toString('utf8')}\n[вывод обрезан: превышен лимит]`;
};

const runStep = (command, args, options = {}) => new Promise((resolve) => {
  const timeoutMs = options.timeoutMs || STEP_TIMEOUT_MS;
  const child = spawn(command, args, {
    cwd: WORKSPACE,
    env: {
      PATH: process.env.PATH,
      HOME: '/tmp',
      TMPDIR: '/tmp',
      LANG: 'C.UTF-8',
      LC_ALL: 'C.UTF-8',
      JAVA_TOOL_OPTIONS: '-Djava.io.tmpdir=/tmp -XX:MaxRAMPercentage=60',
      NODE_OPTIONS: '--max-old-space-size=128',
      PYTHONIOENCODING: 'utf-8',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let stdout = Buffer.alloc(0);
  let stderr = Buffer.alloc(0);
  let finished = false;
  let outputLimited = false;

  const collect = (current, chunk) => {
    if (current.length >= MAX_OUTPUT_BYTES) {
      outputLimited = true;
      return current;
    }
    const remaining = MAX_OUTPUT_BYTES - current.length;
    if (chunk.length > remaining) outputLimited = true;
    return Buffer.concat([current, chunk.subarray(0, remaining)]);
  };

  child.stdout.on('data', (chunk) => {
    stdout = collect(stdout, Buffer.from(chunk));
    if (outputLimited) child.kill('SIGKILL');
  });
  child.stderr.on('data', (chunk) => {
    stderr = collect(stderr, Buffer.from(chunk));
    if (outputLimited) child.kill('SIGKILL');
  });

  const timer = setTimeout(() => {
    if (finished) return;
    finished = true;
    child.kill('SIGKILL');
    resolve({
      command: [command, ...args].join(' '),
      stdout: clip(stdout.toString('utf8')),
      stderr: clip(`${stderr.toString('utf8')}\nВыполнение остановлено: превышен лимит ${timeoutMs / 1000} сек.`),
      exitCode: null,
      timedOut: true,
    });
  }, timeoutMs);

  child.on('error', (error) => {
    if (finished) return;
    finished = true;
    clearTimeout(timer);
    resolve({
      command: [command, ...args].join(' '),
      stdout: clip(stdout.toString('utf8')),
      stderr: clip(error.message),
      exitCode: null,
      missingTool: error.code === 'ENOENT',
    });
  });

  child.on('close', (code, signal) => {
    if (finished) return;
    finished = true;
    clearTimeout(timer);
    resolve({
      command: [command, ...args].join(' '),
      stdout: clip(stdout.toString('utf8')),
      stderr: clip(`${stderr.toString('utf8')}${outputLimited ? '\nВывод остановлен: превышен лимит.' : ''}${signal ? `\nПроцесс завершён сигналом ${signal}.` : ''}`),
      exitCode: code,
      outputLimited,
    });
  });
});

const buildDiagnostics = (steps, label) => {
  const diagnostics = [];
  for (const step of steps) {
    if (step.missingTool) diagnostics.push(step.stderr);
    else if (step.timedOut) diagnostics.push('Код выполнялся слишком долго. Проверьте бесконечные циклы или ожидание ввода.');
    else if (step.outputLimited) diagnostics.push('Программа создала слишком много вывода, поэтому выполнение остановлено.');
    else if (step.exitCode !== 0) diagnostics.push(`${label}: команда завершилась с кодом ${step.exitCode}.`);
  }
  if (diagnostics.length === 0) diagnostics.push('Критичных ошибок не найдено.');
  return diagnostics;
};

const buildFriendlyDiagnostics = (steps, label) => {
  const failed = steps.find((step) => step.missingTool || step.timedOut || step.outputLimited || step.exitCode !== 0);
  if (!failed) return ['Код выглядит рабочим: компилятор не сообщил о критичных ошибках.'];
  if (failed.timedOut) return ['Код выполнялся слишком долго. Частая причина: бесконечный цикл или ожидание ввода.'];
  if (failed.outputLimited) return ['Программа печатает слишком много текста. Уменьшите количество вывода или проверьте цикл.'];
  if (failed.missingTool) return [`В изолированной среде не найден инструмент для ${label}.`];

  const text = `${failed.stderr || ''}\n${failed.stdout || ''}`;
  const lineMatch = text.match(/(?:line|строка|:)(\d+)/i) || text.match(/\((\d+),\d+\)/);
  const lineHint = lineMatch?.[1] ? ` Примерное место: строка ${lineMatch[1]}.` : '';
  if (/syntax|expected|unexpected|parse|синтак/i.test(text)) return [`Похоже на синтаксическую ошибку.${lineHint}`];
  if (/not defined|undefined|cannot find|не найден|undeclared|nameerror/i.test(text)) return [`Используется неизвестное имя, класс, функция или импорт.${lineHint}`];
  if (/type|cannot convert|incompatible|тип/i.test(text)) return [`Проверьте типы значений и возвращаемые данные.${lineHint}`];
  if (/permission|access|denied|read-only/i.test(text)) return ['Изолированная среда запретила доступ к файлу, устройству или системной функции.'];
  return [`Код не запустился. Точный ответ компилятора находится в техническом логе.${lineHint}`];
};

const execute = async ({ language, code }) => {
  const config = languageConfig[language];
  if (!config) throw new Error('Неподдерживаемый язык');
  await fs.writeFile(path.join(WORKSPACE, config.filename), code, { encoding: 'utf8', mode: 0o600 });
  const steps = [];

  if (language === 'java') {
    steps.push(await runStep('javac', ['-encoding', 'UTF-8', config.filename]));
    if (steps[0].exitCode === 0) steps.push(await runStep('java', ['-Xms16m', '-Xmx128m', '-cp', WORKSPACE, 'Main']));
  } else if (language === 'csharp') {
    steps.push(await runStep('mcs', ['-nologo', '-out:Program.exe', config.filename]));
    if (steps[0].exitCode === 0) steps.push(await runStep('mono', ['Program.exe']));
  } else if (language === 'cpp') {
    steps.push(await runStep('g++', [config.filename, '-std=c++17', '-O0', '-pipe', '-o', 'main']));
    if (steps[0].exitCode === 0) steps.push(await runStep('./main', []));
  } else if (language === 'lua') {
    steps.push(await runStep('lua5.4', [config.filename]));
  } else if (language === 'python') {
    steps.push(await runStep('python3', ['-I', '-B', config.filename]));
  } else if (language === 'javascript' || language === 'nodejs') {
    steps.push(await runStep('node', [config.filename]));
  } else if (language === 'php') {
    steps.push(await runStep('php', ['-n', config.filename]));
  } else if (language === 'react') {
    steps.push(await runStep('esbuild', [config.filename, '--loader:.jsx=jsx', '--jsx=automatic', '--format=esm', '--target=es2020', '--log-level=warning', '--outfile=compiled.js']));
    if (steps[0].exitCode === 0) {
      const transformed = await fs.readFile(path.join(WORKSPACE, 'compiled.js'), 'utf8');
      steps[0].stdout = clip(transformed);
    }
  }

  const failed = steps.some((step) => step.exitCode !== 0 || step.timedOut || step.missingTool || step.outputLimited);
  return {
    success: !failed,
    stdout: clip(steps.map((step) => step.stdout).filter(Boolean).join('\n')),
    stderr: clip(steps.map((step) => step.stderr).filter(Boolean).join('\n')),
    diagnostics: buildDiagnostics(steps, config.label),
    friendlyDiagnostics: buildFriendlyDiagnostics(steps, config.label),
    steps,
    sandboxed: true,
  };
};

try {
  const input = JSON.parse(await readStdin());
  const result = await execute(input);
  process.stdout.write(JSON.stringify(result));
} catch (error) {
  process.stdout.write(JSON.stringify({
    success: false,
    stdout: '',
    stderr: error instanceof Error ? error.message : String(error),
    diagnostics: ['Изолированная среда не смогла обработать код.'],
    friendlyDiagnostics: ['Запуск не состоялся из-за внутренней ошибки песочницы.'],
    steps: [],
    sandboxed: true,
  }));
  process.exitCode = 1;
}
