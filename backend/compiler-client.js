const http = require('http');

const socketPath = process.env.COMPILER_SOCKET || '/run/socialbird-compiler/runner.sock';
const requestTimeoutMs = Number(process.env.COMPILER_REQUEST_TIMEOUT_MS || 12000);
const maxCodeBytes = Number(process.env.COMPILER_MAX_CODE_BYTES || 200000);
const maxRunsPerMinute = Number(process.env.COMPILER_RUNS_PER_MINUTE || 10);
const maxActivePerUser = Number(process.env.COMPILER_MAX_ACTIVE_PER_USER || 1);
const supportedLanguages = new Set([
    'java', 'csharp', 'cpp', 'lua', 'python', 'php', 'javascript', 'nodejs', 'react',
]);

const userWindows = new Map();
const activeByUser = new Map();

const cleanRateWindows = () => {
    const cutoff = Date.now() - 120000;
    for (const [userId, state] of userWindows.entries()) {
        if (state.windowStartedAt < cutoff) userWindows.delete(userId);
    }
};
setInterval(cleanRateWindows, 60000).unref();

const consumeRateLimit = (userId) => {
    const normalizedUserId = String(userId || 'anonymous');
    const now = Date.now();
    const current = userWindows.get(normalizedUserId);

    if (!current || now - current.windowStartedAt >= 60000) {
        userWindows.set(normalizedUserId, { windowStartedAt: now, count: 1 });
        return;
    }

    if (current.count >= maxRunsPerMinute) {
        const retryAfterMs = Math.max(1000, 60000 - (now - current.windowStartedAt));
        const error = new Error(`Слишком много запусков. Повторите через ${Math.ceil(retryAfterMs / 1000)} сек.`);
        error.statusCode = 429;
        error.retryAfterSeconds = Math.ceil(retryAfterMs / 1000);
        throw error;
    }

    current.count += 1;
};

const validateInput = ({ language, code }) => {
    if (!supportedLanguages.has(language)) {
        const error = new Error('Неподдерживаемый язык.');
        error.statusCode = 400;
        throw error;
    }
    if (typeof code !== 'string' || code.trim().length === 0) {
        const error = new Error('Код пустой.');
        error.statusCode = 400;
        throw error;
    }
    if (Buffer.byteLength(code, 'utf8') > maxCodeBytes) {
        const error = new Error(`Код слишком большой. Максимум ${Math.floor(maxCodeBytes / 1000)} КБ.`);
        error.statusCode = 413;
        throw error;
    }
};

const requestRunner = (payload) => new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    const request = http.request({
        socketPath,
        path: '/run',
        method: 'POST',
        headers: {
            'Content-Type': 'application/json; charset=utf-8',
            'Content-Length': Buffer.byteLength(body),
        },
        timeout: requestTimeoutMs,
    }, (response) => {
        const chunks = [];
        let size = 0;
        const maxResponseBytes = 1024 * 1024;

        response.on('data', (chunk) => {
            size += chunk.length;
            if (size > maxResponseBytes) {
                request.destroy(new Error('Ответ песочницы превышает допустимый размер.'));
                return;
            }
            chunks.push(chunk);
        });

        response.on('end', () => {
            const raw = Buffer.concat(chunks).toString('utf8');
            let result;
            try {
                result = JSON.parse(raw);
            } catch {
                reject(new Error('Песочница вернула некорректный JSON.'));
                return;
            }

            if ((response.statusCode || 500) >= 400) {
                const error = new Error(result.stderr || result.message || 'Песочница отклонила запуск.');
                error.statusCode = response.statusCode;
                error.compilerResult = result;
                reject(error);
                return;
            }

            resolve(result);
        });
    });

    request.on('timeout', () => request.destroy(new Error('Сервис песочницы не ответил вовремя.')));
    request.on('error', (error) => {
        if (error.code === 'ENOENT' || error.code === 'ECONNREFUSED') {
            reject(new Error('Изолированный сервис компилятора не запущен.'));
            return;
        }
        reject(error);
    });

    request.end(body);
});

const runSandboxedCompilerJob = async ({ language, code, userId }) => {
    validateInput({ language, code });
    consumeRateLimit(userId);

    const key = String(userId || 'anonymous');
    const active = activeByUser.get(key) || 0;
    if (active >= maxActivePerUser) {
        const error = new Error('У вас уже выполняется код. Дождитесь завершения текущего запуска.');
        error.statusCode = 429;
        throw error;
    }

    activeByUser.set(key, active + 1);
    try {
        return await requestRunner({ language, code, userId: key });
    } finally {
        const remaining = (activeByUser.get(key) || 1) - 1;
        if (remaining <= 0) activeByUser.delete(key);
        else activeByUser.set(key, remaining);
    }
};

module.exports = {
    runSandboxedCompilerJob,
};
