import { spawnSync } from 'node:child_process';

const image = process.env.COMPILER_SANDBOX_IMAGE || 'socialbird/compiler-sandbox:latest';
const tests = [
  ['python', 'print("python-ok")', 'python-ok'],
  ['javascript', 'console.log("javascript-ok")', 'javascript-ok'],
  ['nodejs', 'console.log("nodejs-ok")', 'nodejs-ok'],
  ['cpp', '#include <iostream>\nint main(){std::cout << "cpp-ok";}', 'cpp-ok'],
  ['java', 'public class Main { public static void main(String[] args) { System.out.print("java-ok"); } }', 'java-ok'],
  ['csharp', 'using System; class Program { static void Main() { Console.Write("csharp-ok"); } }', 'csharp-ok'],
  ['lua', 'print("lua-ok")', 'lua-ok'],
  ['php', '<?php echo "php-ok"; ?>', 'php-ok'],
  ['react', 'export default function App(){ return <main>react-ok</main>; }', 'react-ok'],
];

for (const [language, code, expected] of tests) {
  const result = spawnSync('docker', [
    'run', '--rm',
    '--network', 'none',
    '--read-only',
    '--tmpfs', '/workspace:rw,exec,nosuid,nodev,size=32m,mode=1777',
    '--tmpfs', '/tmp:rw,noexec,nosuid,nodev,size=16m,mode=1777',
    '--cap-drop', 'ALL',
    '--security-opt', 'no-new-privileges=true',
    '--pids-limit', '64',
    '--memory', '256m',
    '--memory-swap', '256m',
    '--cpus', '0.75',
    '--ulimit', 'nofile=64:64',
    '--ulimit', 'nproc=64:64',
    '--ulimit', 'core=0:0',
    '--ulimit', 'fsize=16777216:16777216',
    '--user', '65532:65532',
    '--workdir', '/workspace',
    '--ipc', 'none',
    '-i', image,
  ], {
    input: JSON.stringify({ language, code }),
    encoding: 'utf8',
    timeout: 30000,
    maxBuffer: 1024 * 1024,
  });

  if (result.error) throw result.error;
  let payload;
  try {
    payload = JSON.parse(result.stdout);
  } catch {
    throw new Error(`${language}: invalid sandbox JSON: ${result.stdout}\n${result.stderr}`);
  }

  if (!payload.success || !String(payload.stdout || '').includes(expected)) {
    throw new Error(`${language}: smoke test failed: ${JSON.stringify(payload)}\n${result.stderr}`);
  }
  console.log(`${language}: ok`);
}
