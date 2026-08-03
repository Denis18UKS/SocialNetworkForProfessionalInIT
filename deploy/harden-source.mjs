import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const deployDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(deployDirectory, "..");
const backendDirectory = path.join(repositoryRoot, "backend");
const sourcePath = path.join(backendDirectory, "server.js");
const inPlace = process.argv.includes("--in-place");
const outputPath = inPlace
  ? sourcePath
  : path.join(backendDirectory, "server.production.js");

let source = fs.readFileSync(sourcePath, "utf8");
const initialSource = source;

const replaceRequired = (label, pattern, replacement) => {
  const updated = source.replace(pattern, replacement);
  if (updated === source) {
    throw new Error(`Production hardening failed: pattern not found for ${label}`);
  }
  source = updated;
};

if (!source.includes("PRODUCTION_HARDENING: smtp-from-environment")) {
  replaceRequired(
    "SMTP configuration",
    /\/\/ Настройка транспорта для Mail\.ru[\s\S]*?transporter\.verify\(\(error, success\) => \{[\s\S]*?\n\}\);\r?\n/,
    `// PRODUCTION_HARDENING: smtp-from-environment\nconst smtpConfigured = Boolean(\n    process.env.SMTP_HOST &&\n    process.env.SMTP_PORT &&\n    process.env.SMTP_USER &&\n    process.env.SMTP_PASSWORD\n);\n\nconst transporter = smtpConfigured\n    ? nodemailer.createTransport({\n        host: process.env.SMTP_HOST,\n        port: Number(process.env.SMTP_PORT),\n        secure: String(process.env.SMTP_SECURE || 'true').toLowerCase() === 'true',\n        auth: {\n            user: process.env.SMTP_USER,\n            pass: process.env.SMTP_PASSWORD,\n        },\n    })\n    : null;\n\nif (transporter) {\n    transporter.verify((error) => {\n        if (error) {\n            console.error('SMTP connection error:', error.message);\n        } else {\n            console.log('SMTP server is ready');\n        }\n    });\n} else {\n    console.warn('SMTP is disabled: configure SMTP_* variables to enable email notifications');\n}\n`
  );

  replaceRequired(
    "SMTP send guard",
    /\s+await transporter\.sendMail\(\{/,
    `\n        if (!transporter) return;\n\n        await transporter.sendMail({`
  );

  source = source.replace(
    /from:\s*['"](?:\\?"IT-BIRD\\?"|IT-BIRD)[^,]*,/,
    `from: process.env.SMTP_FROM || process.env.SMTP_USER,`
  );
}

if (!source.includes("PRODUCTION_HARDENING: upload-limits")) {
  replaceRequired(
    "upload file name sanitization",
    /cb\(null, Date\.now\(\) \+ '-' \+ file\.originalname\);/,
    `const safeOriginalName = path\n            .basename(file.originalname)\n            .replace(/[^\\p{L}\\p{N}._ -]/gu, '_')\n            .slice(0, 180);\n        cb(null, Date.now() + '-' + safeOriginalName);`
  );

  replaceRequired(
    "upload size limits",
    /const upload = multer\(\{ storage \}\);/,
    `// PRODUCTION_HARDENING: upload-limits\nconst upload = multer({\n    storage,\n    limits: {\n        fileSize: Number(process.env.MAX_UPLOAD_BYTES || 25 * 1024 * 1024),\n        files: 1,\n    },\n});`
  );
}

if (!source.includes("PRODUCTION_HARDENING: websocket-heartbeat")) {
  replaceRequired(
    "WebSocket server options",
    /const wss = new WebSocket\.Server\(\{ server \}\);/,
    `const wss = new WebSocket.Server({\n    server,\n    maxPayload: Number(process.env.WS_MAX_PAYLOAD_BYTES || 1024 * 1024),\n});\n\n// PRODUCTION_HARDENING: websocket-heartbeat\nwss.on('connection', (socket) => {\n    socket.isAlive = true;\n    socket.on('pong', () => {\n        socket.isAlive = true;\n    });\n});\n\nconst websocketHeartbeat = setInterval(() => {\n    wss.clients.forEach((socket) => {\n        if (socket.isAlive === false) {\n            socket.terminate();\n            return;\n        }\n\n        socket.isAlive = false;\n        socket.ping();\n    });\n}, Number(process.env.WS_HEARTBEAT_MS || 30000));\n\nserver.on('close', () => clearInterval(websocketHeartbeat));`
  );
}

if (!source.includes("PRODUCTION_HARDENING: authenticated-targeted-notifications")) {
  replaceRequired(
    "WebSocket notification routing",
    /\/\/ WebSocket уведомление\r?\nconst notifyClients = \(notification\) => \{[\s\S]*?\r?\n\};/,
    `// WebSocket уведомление\n// PRODUCTION_HARDENING: authenticated-targeted-notifications\nconst notifyClients = (notification) => {\n    const data = notification?.data || {};\n    const targetValues = [\n        ...(Array.isArray(data.targetIds) ? data.targetIds : []),\n        ...(Array.isArray(data.recipientIds) ? data.recipientIds : []),\n        ...(Array.isArray(data.memberIds) ? data.memberIds : []),\n        data.recipientId,\n        data.blockerId,\n        data.blockedId,\n    ];\n    const targetIds = new Set(targetValues.map(Number).filter(Number.isFinite));\n    const hasExplicitTargets = targetIds.size > 0;\n    const serializedNotification = JSON.stringify(notification);\n\n    wss.clients.forEach((client) => {\n        if (client.readyState !== WebSocket.OPEN || !client.userId) return;\n        if (hasExplicitTargets && !targetIds.has(Number(client.userId))) return;\n        client.send(serializedNotification);\n    });\n};`
  );
}

if (!source.includes("PRODUCTION_HARDENING: restricted-cors")) {
  replaceRequired(
    "CORS policy",
    /\/\/ Разрешаем CORS для всех доменов\r?\napp\.use\(cors\(\{[\s\S]*?\r?\n\}\)\);/,
    `// PRODUCTION_HARDENING: restricted-cors\nconst allowedOrigins = String(process.env.FRONTEND_URLS || process.env.FRONTEND_URL || '')\n    .split(',')\n    .map((origin) => origin.trim().replace(/\\\/$/, ''))\n    .filter(Boolean);\n\napp.use(cors({\n    origin(origin, callback) {\n        if (!origin || allowedOrigins.includes(origin.replace(/\\\/$/, ''))) {\n            callback(null, true);\n            return;\n        }\n        callback(new Error('Origin is not allowed by CORS'));\n    },\n    optionsSuccessStatus: 204,\n    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],\n    allowedHeaders: ['Content-Type', 'Authorization'],\n    credentials: false,\n}));`
  );
}

source = source.replace(
  /app\.use\(express\.json\(\)\); \/\/ Для обработки JSON-запросов/,
  `app.use(express.json({ limit: process.env.JSON_BODY_LIMIT || '2mb' })); // PRODUCTION_HARDENING: request-limit`
);

if (!source.includes("PRODUCTION_HARDENING: database-pool")) {
  replaceRequired(
    "database pool configuration",
    /const db = mysql\.createPool\(\{\r?\n\s*host: process\.env\.DB_HOST,\r?\n\s*user: process\.env\.DB_USER,\r?\n\s*password: process\.env\.DB_PASSWORD,\r?\n\s*database: process\.env\.DB_NAME,\r?\n\}\);/,
    `// PRODUCTION_HARDENING: database-pool\nconst db = mysql.createPool({\n    host: process.env.DB_HOST || '127.0.0.1',\n    port: Number(process.env.DB_PORT || 3306),\n    user: process.env.DB_USER,\n    password: process.env.DB_PASSWORD,\n    database: process.env.DB_NAME,\n    waitForConnections: true,\n    connectionLimit: Number(process.env.DB_CONNECTION_LIMIT || 10),\n    queueLimit: 0,\n    charset: 'utf8mb4',\n});`
  );
}

source = source.replace(
  /ensureSchema\(\);/,
  `ensureSchema().catch((error) => {\n    console.error('Database schema initialization failed:', error);\n    process.exitCode = 1;\n});`
);

if (!source.includes("PRODUCTION_HARDENING: compiler-disabled-by-default")) {
  replaceRequired(
    "compiler safety switch",
    /app\.post\('\/compiler\/run', verifyToken, async \(req, res\) => \{\r?\n/,
    `app.post('/compiler/run', verifyToken, async (req, res) => {\n    // PRODUCTION_HARDENING: compiler-disabled-by-default\n    if (String(process.env.ENABLE_COMPILER || 'false').toLowerCase() !== 'true') {\n        return res.status(503).json({\n            message: 'Онлайн-компилятор временно отключен до запуска изолированной песочницы.',\n        });\n    }\n`
  );
}

source = source.replace(
  /puppeteer\.launch\(\{ headless: true \}\)/g,
  `puppeteer.launch({\n        headless: true,\n        args: ['--no-sandbox', '--disable-setuid-sandbox'],\n    })`
);

if (!source.includes("PRODUCTION_HARDENING: configurable-listen-address")) {
  replaceRequired(
    "server listen address",
    /\/\/ Старт сервера\r?\nserver\.listen\(5000, \(\) => \{\r?\n\s*console\.log\('Server is running on port 5000'\);\r?\n\}\);/,
    `// Старт сервера\n// PRODUCTION_HARDENING: configurable-listen-address\nconst port = Number(process.env.PORT || 5000);\nconst host = process.env.HOST || '127.0.0.1';\nserver.listen(port, host, () => {\n    console.log(\`Server is running on http://\${host}:\${port}\`);\n});`
  );
}

if (/pass:\s*['"][^'"]+['"]/.test(source)) {
  throw new Error("Production hardening refused to write a backend with a hard-coded password");
}

fs.writeFileSync(outputPath, source, "utf8");

const changed = source !== initialSource;
console.log(`${inPlace ? "Hardened" : "Prepared"} backend: ${path.relative(repositoryRoot, outputPath)}`);
console.log(`Source changed: ${changed ? "yes" : "no"}`);
