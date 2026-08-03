import { spawnSync } from 'node:child_process';

const image = process.env.COMPILER_SANDBOX_IMAGE || 'socialbird/compiler-sandbox:latest';

const dockerArgs = [
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
];

const runSandbox = (language, code, timeout = 30000) => {
  const result = spawnSync('docker', dockerArgs, {
    input: JSON.stringify({ language, code }),
    encoding: 'utf8',
    timeout,
    maxBuffer: 1024 * 1024,
  });

  if (result.error) throw result.error;
  try {
    return JSON.parse(result.stdout);
  } catch {
    throw new Error(`${language}: invalid sandbox JSON: ${result.stdout}\n${result.stderr}`);
  }
};

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
  const payload = runSandbox(language, code);
  if (!payload.success || !String(payload.stdout || '').includes(expected)) {
    throw new Error(`${language}: smoke test failed: ${JSON.stringify(payload)}`);
  }
  console.log(`${language}: ok`);
}

const networkProbe = runSandbox('python', `
import socket
try:
    socket.create_connection(("1.1.1.1", 53), timeout=0.5)
    print("network-open")
except Exception:
    print("network-blocked")
`);
if (!networkProbe.success || !String(networkProbe.stdout).includes('network-blocked')) {
  throw new Error(`network isolation failed: ${JSON.stringify(networkProbe)}`);
}
console.log('network isolation: ok');

const filesystemProbe = runSandbox('python', `
try:
    open("/etc/socialbird-sandbox-test", "w").write("bad")
    print("root-write-open")
except OSError:
    print("root-write-blocked")
`);
if (!filesystemProbe.success || !String(filesystemProbe.stdout).includes('root-write-blocked')) {
  throw new Error(`read-only root filesystem failed: ${JSON.stringify(filesystemProbe)}`);
}
console.log('read-only root filesystem: ok');

const secretProbe = runSandbox('nodejs', `
const forbidden = ["DB_PASSWORD", "JWT_SECRET", "SMTP_PASSWORD", "GITHUB_PERSONAL_ACCESS_TOKEN"];
console.log(forbidden.some((name) => process.env[name]) ? "secrets-exposed" : "secrets-blocked");
`);
if (!secretProbe.success || !String(secretProbe.stdout).includes('secrets-blocked')) {
  throw new Error(`secret environment isolation failed: ${JSON.stringify(secretProbe)}`);
}
console.log('secret environment isolation: ok');

const timeoutProbe = runSandbox('python', 'while True:\n    pass', 30000);
if (timeoutProbe.success || !timeoutProbe.steps?.some((step) => step.timedOut)) {
  throw new Error(`execution timeout failed: ${JSON.stringify(timeoutProbe)}`);
}
console.log('execution timeout: ok');
