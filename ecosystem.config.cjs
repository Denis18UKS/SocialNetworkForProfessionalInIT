const fs = require("fs");

const parseEnvFile = (filePath) => {
  const env = {};
  if (!fs.existsSync(filePath)) return env;

  for (const rawLine of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const separator = line.indexOf("=");
    if (separator <= 0) continue;

    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    env[key] = value;
  }

  return env;
};

const backendEnv = parseEnvFile("/etc/socialbird/backend.env");

module.exports = {
  apps: [
    {
      name: "socialbird-api",
      cwd: "/opt/socialbird/current/backend",
      script: "server.production.js",
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      watch: false,
      max_memory_restart: "768M",
      time: true,
      env: {
        ...backendEnv,
        NODE_ENV: "production",
        HOME: "/var/lib/socialbird",
        PUPPETEER_CACHE_DIR: "/var/lib/socialbird/.cache/puppeteer",
      },
      error_file: "/var/log/socialbird/api-error.log",
      out_file: "/var/log/socialbird/api-output.log",
      merge_logs: true,
      kill_timeout: 10000,
      listen_timeout: 10000,
    },
  ],
};