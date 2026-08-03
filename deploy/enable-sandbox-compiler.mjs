import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const deployDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(deployDirectory, '..');
const backendDirectory = path.join(repositoryRoot, 'backend');
const inPlace = process.argv.includes('--in-place');
const targetPath = path.join(backendDirectory, inPlace ? 'server.js' : 'server.production.js');

if (!fs.existsSync(targetPath)) {
  throw new Error(`Compiler sandbox patch target does not exist: ${targetPath}`);
}

let source = fs.readFileSync(targetPath, 'utf8');
const initialSource = source;

const replaceRequired = (label, pattern, replacement) => {
  const updated = source.replace(pattern, replacement);
  if (updated === source) throw new Error(`Compiler sandbox patch failed: ${label}`);
  source = updated;
};

if (!source.includes('PRODUCTION_HARDENING: isolated-compiler-client')) {
  source = source.replace(/^const os = require\('os'\);\r?\n/m, '');
  source = source.replace(/^const \{ spawn \} = require\('child_process'\);\r?\n/m, '');
  source = source.replace(/\r?\nlet esbuild = null;[\s\S]*?\r?\n\}\r?\n\r?\nconst storage =/, '\nconst storage =');
  replaceRequired(
    'isolated compiler client import',
    /const crypto = require\('crypto'\);\r?\n/,
    `const crypto = require('crypto');\n// PRODUCTION_HARDENING: isolated-compiler-client\nconst { runSandboxedCompilerJob } = require('./compiler-client');\n`,
  );
}

source = source.replace(
  /\r?\nconst runProcess = \(command, args, cwd, timeoutMs = 8000\)[\s\S]*?\r?\n};\r?\n\r?\n\/\/ Middleware для проверки токена/,
  '\n// Untrusted code is executed only by the isolated compiler runner.\n\n// Middleware для проверки токена',
);

const sandboxCompilerRoute = `// PRODUCTION_HARDENING: sandboxed-compiler-route\napp.post('/compiler/run', verifyToken, async (req, res) => {\n    if (String(process.env.ENABLE_COMPILER || 'false').toLowerCase() !== 'true') {\n        return res.status(503).json({\n            success: false,\n            stdout: '',\n            stderr: 'Изолированный компилятор отключен в конфигурации сервера.',\n            diagnostics: ['Компилятор временно недоступен.'],\n            friendlyDiagnostics: ['Администратор ещё не включил безопасную песочницу.'],\n            steps: [],\n            sandboxed: true,\n        });\n    }\n\n    const { language, code } = req.body;\n\n    try {\n        const result = await runSandboxedCompilerJob({\n            language,\n            code,\n            userId: req.user.id,\n        });\n        res.status(200).json(result);\n    } catch (error) {\n        console.error('Ошибка изолированного онлайн-компилятора:', error.message);\n        if (error.retryAfterSeconds) {\n            res.setHeader('Retry-After', String(error.retryAfterSeconds));\n        }\n        if (error.compilerResult) {\n            return res.status(error.statusCode || 500).json(error.compilerResult);\n        }\n        res.status(error.statusCode || 500).json({\n            success: false,\n            stdout: '',\n            stderr: error.message,\n            diagnostics: ['Сервер не смог выполнить код в изолированной среде.'],\n            friendlyDiagnostics: [error.statusCode === 429\n                ? error.message\n                : 'Безопасная песочница временно недоступна.'],\n            steps: [],\n            sandboxed: true,\n        });\n    }\n});`;

if (!source.includes('PRODUCTION_HARDENING: sandboxed-compiler-route')) {
  replaceRequired(
    'sandboxed compiler route',
    /app\.post\('\/compiler\/run', verifyToken, async \(req, res\) => \{[\s\S]*?\r?\n\}\);(?=\r?\n\r?\napp\.post\('\/code\/open-vscode')/,
    sandboxCompilerRoute,
  );
}

// The generic hardener may add a temporary safety guard before this script runs.
// Once the isolated route exists, retain only its structured ENABLE_COMPILER check.
source = source.replace(
  /\r?\n\s*\/\/ PRODUCTION_HARDENING: compiler-disabled-by-default\r?\n\s*if \(String\(process\.env\.ENABLE_COMPILER \|\| 'false'\)\.toLowerCase\(\) !== 'true'\) \{\r?\n\s*return res\.status\(503\)\.json\(\{\r?\n\s*message: 'Онлайн-компилятор временно отключен до запуска изолированной песочницы\.',\r?\n\s*\}\);\r?\n\s*\}(?=\r?\n\s*if \(String\(process\.env\.ENABLE_COMPILER)/,
  '',
);

if (source.includes("runProcess('python'")) {
  throw new Error('Legacy host-side compiler implementation is still reachable in the backend source.');
}
if (!source.includes("runSandboxedCompilerJob")) {
  throw new Error('Sandbox compiler client was not installed.');
}
if (source.includes('PRODUCTION_HARDENING: compiler-disabled-by-default')) {
  throw new Error('Legacy compiler guard remained after installing the isolated route.');
}

fs.writeFileSync(targetPath, source, 'utf8');
console.log(`${inPlace ? 'Patched' : 'Prepared'} isolated compiler in ${path.relative(repositoryRoot, targetPath)}`);
console.log(`Source changed: ${source !== initialSource ? 'yes' : 'no'}`);
