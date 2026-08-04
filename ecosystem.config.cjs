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
      env_file: "/etc/socialbird/backend.env",
      env: {
        NODE_ENV: "production",
      },
      error_file: "/var/log/socialbird/api-error.log",
      out_file: "/var/log/socialbird/api-output.log",
      merge_logs: true,
      kill_timeout: 10000,
      listen_timeout: 10000,
    },
  ],
};
