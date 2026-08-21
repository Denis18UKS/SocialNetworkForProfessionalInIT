const express = require("express");
const mysql = require("mysql2/promise"); // Используем промис-совместимую версию
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const cors = require("cors");
require("dotenv").config();

const puppeteer = require("puppeteer");
const axios = require("axios");
const app = express();
const http = require('http');
const githubRoutes = require('./routes/github');
const multer = require('multer');
const path = require('path');
const fs = require('fs'); // Добавляем модуль для работы с файловой системой
const crypto = require('crypto');
// PRODUCTION_HARDENING: isolated-compiler-client
const { runSandboxedCompilerJob } = require('./compiler-client');

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        let destinationPath;
        if (req.url.includes('/avatars')) {
            destinationPath = 'uploads/avatars';
        } else if (req.url.includes('/news')) {
            destinationPath = 'uploads/news';
        } else if (req.url.includes('/posts')) {
            destinationPath = 'uploads/posts';
        } else if (req.url.includes('/chat_files')) {
            destinationPath = 'uploads/chat_files';
        } else {
            destinationPath = 'uploads'; // Default destination
        }
        cb(null, destinationPath);
    },
    filename: (req, file, cb) => {
        const safeOriginalName = path
            .basename(file.originalname)
            .replace(/[^\p{L}\p{N}._ -]/gu, '_')
            .slice(0, 180);
        cb(null, Date.now() + '-' + safeOriginalName);
    }
});


// Настройка почты
const nodemailer = require('nodemailer');

// PRODUCTION_HARDENING: smtp-from-environment
const smtpConfigured = Boolean(
    process.env.SMTP_HOST &&
    process.env.SMTP_PORT &&
    process.env.SMTP_USER &&
    process.env.SMTP_PASSWORD
);

const transporter = smtpConfigured
    ? nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: Number(process.env.SMTP_PORT),
        secure: String(process.env.SMTP_SECURE || 'true').toLowerCase() === 'true',
        auth: {
            user: process.env.SMTP_USER,
            pass: process.env.SMTP_PASSWORD,
        },
    })
    : null;

if (transporter) {
    transporter.verify((error) => {
        if (error) {
            console.error('SMTP connection error:', error.message);
        } else {
            console.log('SMTP server is ready');
        }
    });
} else {
    console.warn('SMTP is disabled: configure SMTP_* variables to enable email notifications');
}

// PRODUCTION_HARDENING: upload-limits
const upload = multer({
    storage,
    limits: {
        fileSize: Number(process.env.MAX_UPLOAD_BYTES || 100 * 1024 * 1024),
        files: 1,
    },
});

const uploadChatMedia = (req, res, next) => {
    upload.single('media')(req, res, (error) => {
        if (!error) return next();
        if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
            return res.status(413).json({
                message: 'Файл слишком большой. Максимальный размер — 100 МБ.',
                code: 'FILE_TOO_LARGE',
            });
        }
        console.error('Chat upload middleware error:', error);
        return res.status(400).json({
            message: 'Не удалось принять файл. Проверьте файл и повторите попытку.',
            code: error?.code || 'UPLOAD_ERROR',
        });
    });
};

const WebSocket = require('ws');
const server = http.createServer(app);
const wss = new WebSocket.Server({
    server,
    maxPayload: Number(process.env.WS_MAX_PAYLOAD_BYTES || 1024 * 1024),
});

// PRODUCTION_HARDENING: websocket-heartbeat
wss.on('connection', (socket) => {
    socket.isAlive = true;
    socket.on('pong', () => {
        socket.isAlive = true;
    });
});

const websocketHeartbeat = setInterval(() => {
    wss.clients.forEach((socket) => {
        if (socket.isAlive === false) {
            socket.terminate();
            return;
        }

        socket.isAlive = false;
        socket.ping();
    });
}, Number(process.env.WS_HEARTBEAT_MS || 30000));

server.on('close', () => clearInterval(websocketHeartbeat));
const onlineUsers = new Map();
const newsCache = {
    items: null,
    fetchedAt: 0,
    sourceSignature: null,
};
const NEWS_CACHE_TTL_MS = 15 * 60 * 1000;

const addOnlineSocket = (userId, ws) => {
    const normalizedUserId = Number(userId);
    if (!onlineUsers.has(normalizedUserId)) {
        onlineUsers.set(normalizedUserId, new Set());
    }
    onlineUsers.get(normalizedUserId).add(ws);
    ws.userId = normalizedUserId;
};

const removeOnlineSocket = (ws) => {
    if (!ws.userId || !onlineUsers.has(ws.userId)) return null;
    const sockets = onlineUsers.get(ws.userId);
    sockets.delete(ws);
    if (sockets.size === 0) {
        onlineUsers.delete(ws.userId);
        return ws.userId;
    }
    return null;
};

const getOnlineUserIds = () => Array.from(onlineUsers.keys());
const isUserOnline = (userId) => onlineUsers.has(Number(userId));

wss.on('connection', (ws) => {
    console.log('WebSocket client connected');

    ws.on('message', (message) => {
        try {
            const payload = JSON.parse(message);
            if (payload.type === 'AUTH' && payload.token) {
                const decoded = jwt.verify(payload.token, process.env.JWT_SECRET);
                addOnlineSocket(decoded.id, ws);
                ws.send(JSON.stringify({ type: 'ONLINE_USERS', data: { userIds: getOnlineUserIds() } }));
                notifyClients({
                    type: 'USER_PRESENCE',
                    data: { userId: decoded.id, status: 'online', userIds: getOnlineUserIds() }
                });
                return;
            }

            if (payload.type?.startsWith('CALL_') && ws.userId) {
                const targetIds = Array.isArray(payload.targetIds)
                    ? payload.targetIds.map(Number).filter(Boolean)
                    : [];
                if (targetIds.length === 0) return;

                notifyClients({
                    type: payload.type,
                    data: {
                        ...payload.data,
                        senderId: Number(ws.userId),
                        targetIds,
                    },
                });
            }
        } catch (error) {
            console.error('WebSocket message error:', error.message);
        }
    });

    ws.on('close', () => {
        console.log('WebSocket client disconnected');
        const offlineUserId = removeOnlineSocket(ws);
        if (offlineUserId) {
            notifyClients({
                type: 'USER_PRESENCE',
                data: { userId: offlineUserId, status: 'offline', userIds: getOnlineUserIds() }
            });
        }
    });
});

// WebSocket уведомление
// PRODUCTION_HARDENING: authenticated-targeted-notifications
const notifyClients = (notification) => {
    const data = notification?.data || {};
    const targetValues = [
        ...(Array.isArray(data.targetIds) ? data.targetIds : []),
        ...(Array.isArray(data.recipientIds) ? data.recipientIds : []),
        ...(Array.isArray(data.memberIds) ? data.memberIds : []),
        data.recipientId,
        data.blockerId,
        data.blockedId,
    ];
    const targetIds = new Set(targetValues.map(Number).filter(Number.isFinite));
    const hasExplicitTargets = targetIds.size > 0;
    const serializedNotification = JSON.stringify(notification);

    wss.clients.forEach((client) => {
        if (client.readyState !== WebSocket.OPEN || !client.userId) return;
        if (hasExplicitTargets && !targetIds.has(Number(client.userId))) return;
        client.send(serializedNotification);
    });
};

const getChatParticipants = async (chatId) => {
    const [rows] = await db.query(
        'SELECT user_id_1, user_id_2 FROM chats WHERE id = ?',
        [chatId]
    );

    if (rows.length === 0) return null;
    return [rows[0].user_id_1, rows[0].user_id_2];
};

const isChatParticipant = (participants, userId) => {
    const normalizedUserId = Number(userId);
    return Array.isArray(participants) && participants.some((id) => Number(id) === normalizedUserId);
};

const hasUserBlockBetween = async (firstUserId, secondUserId) => {
    const [blocks] = await db.query(
        `SELECT 1 FROM user_blacklist
        WHERE (blocker_id = ? AND blocked_id = ?)
           OR (blocker_id = ? AND blocked_id = ?)
        LIMIT 1`,
        [firstUserId, secondUserId, secondUserId, firstUserId]
    );

    return blocks.length > 0;
};

const normalizeUserTag = (value) => {
    if (value === undefined || value === null) return null;
    const normalized = String(value).trim().replace(/^@+/, '').toLowerCase();
    return normalized || null;
};

const isValidUserTag = (value) => !value || /^[a-z0-9_]{3,32}$/.test(value);

const extractMentionTags = (text = '') => {
    const tags = new Set();
    const regex = /@([a-zA-Z0-9_]{3,32})/g;
    let match;

    while ((match = regex.exec(text))) {
        const tag = normalizeUserTag(match[1]);
        if (tag && tag !== 'everyone') tags.add(tag);
    }

    return Array.from(tags);
};

const sendOfflineEmailNotification = async (userId, subject, text) => {
    if (isUserOnline(userId)) return;

    try {
        const [users] = await db.query('SELECT email, username FROM users WHERE id = ?', [userId]);
        if (users.length === 0 || !users[0].email) return;
        if (!transporter) return;

        await transporter.sendMail({
            from: process.env.SMTP_FROM || process.env.SMTP_USER,
            to: users[0].email,
            subject,
            text: `Здравствуйте, ${users[0].username}!\n\n${text}\n\nIT-BIRD`,
        });
    } catch (error) {
        console.error('Offline email notification error:', error.message);
    }
};

const notifyOfflineUsersByEmail = async (userIds, subject, text) => {
    await Promise.all(
        Array.from(new Set(userIds.map(Number).filter(Boolean))).map((userId) =>
            sendOfflineEmailNotification(userId, subject, text)
        )
    );
};

const resolveGroupMentionRecipients = async (chatId, message, senderId) => {
    if (!message) return [];

    const [members] = await db.query(
        `SELECT u.id, u.username, u.user_tag
        FROM group_chat_members gcm
        JOIN users u ON u.id = gcm.user_id
        WHERE gcm.group_chat_id = ? AND u.id != ?`,
        [chatId, senderId]
    );

    if (/@everyone\b/i.test(message)) {
        return members.map((member) => member.id);
    }

    const tags = extractMentionTags(message);
    if (tags.length === 0) return [];

    return members
        .filter((member) => member.user_tag && tags.includes(String(member.user_tag).toLowerCase()))
        .map((member) => member.id);
};

const getBlockStatusBetween = async (currentUserId, otherUserId) => {
    const [blocks] = await db.query(
        `SELECT blocker_id, blocked_id FROM user_blacklist
        WHERE (blocker_id = ? AND blocked_id = ?)
           OR (blocker_id = ? AND blocked_id = ?)`,
        [currentUserId, otherUserId, otherUserId, currentUserId]
    );

    return {
        blocked: blocks.some((block) => Number(block.blocker_id) === Number(currentUserId)),
        blockedBy: blocks.some((block) => Number(block.blocked_id) === Number(currentUserId)),
    };
};

app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use('/uploads/news', express.static(path.join(__dirname, 'uploads', 'news')));
app.use('/uploads/posts', express.static(path.join(__dirname, 'uploads', 'posts')));
app.use('/uploads/chat_files', express.static(path.join(__dirname, 'uploads', 'chat_files')));

app.use('/github', githubRoutes);

// Устанавливаем заголовок Content-Type с кодировкой UTF-8
app.use((req, res, next) => {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    next();
});

// Логирование запросов
app.use((err, req, res, next) => {
    console.log(`Request URL: ${req.url}`);  // Логируем путь запроса
    next();
    console.error(err.stack);
    res.status(500).json({ message: 'Ошибка сервера' });
});

// PRODUCTION_HARDENING: restricted-cors
const allowedOrigins = String(process.env.FRONTEND_URLS || process.env.FRONTEND_URL || '')
    .split(',')
    .map((origin) => origin.trim().replace(/\/$/, ''))
    .filter(Boolean);

app.use(cors({
    origin(origin, callback) {
        if (!origin || allowedOrigins.includes(origin.replace(/\/$/, ''))) {
            callback(null, true);
            return;
        }
        callback(new Error('Origin is not allowed by CORS'));
    },
    optionsSuccessStatus: 204,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: false,
}));

app.use(express.json({ limit: process.env.JSON_BODY_LIMIT || '2mb' })); // PRODUCTION_HARDENING: request-limit

// Подключение к базе данных с использованием промисов
// PRODUCTION_HARDENING: database-pool
const db = mysql.createPool({
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    waitForConnections: true,
    connectionLimit: Number(process.env.DB_CONNECTION_LIMIT || 10),
    queueLimit: 0,
    charset: 'utf8mb4',
});

const addColumnIfMissing = async (table, column, definition) => {
    try {
        await db.query(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    } catch (error) {
        if (!['ER_DUP_FIELDNAME', 'ER_DUP_KEYNAME'].includes(error.code)) {
            console.warn(`Не удалось добавить колонку ${table}.${column}:`, error.message);
        }
    }
};

const addIndexIfMissing = async (table, indexName, definition) => {
    try {
        const [indexes] = await db.query(`SHOW INDEX FROM ${table} WHERE Key_name = ?`, [indexName]);
        if (indexes.length === 0) {
            await db.query(`ALTER TABLE ${table} ADD ${definition}`);
        }
    } catch (error) {
        if (!['ER_DUP_KEYNAME', 'ER_DUP_ENTRY'].includes(error.code)) {
            console.warn(`Не удалось добавить индекс ${table}.${indexName}:`, error.message);
        }
    }
};

const cleanupDuplicateUserTags = async () => {
    const [duplicates] = await db.query(`
        SELECT user_tag
        FROM users
        WHERE user_tag IS NOT NULL AND user_tag != ''
        GROUP BY user_tag
        HAVING COUNT(*) > 1
    `);

    for (const duplicate of duplicates) {
        const [users] = await db.query(
            'SELECT id FROM users WHERE user_tag = ? ORDER BY id ASC',
            [duplicate.user_tag]
        );
        const duplicateIds = users.slice(1).map((user) => user.id);
        if (duplicateIds.length > 0) {
            await db.query('UPDATE users SET user_tag = NULL WHERE id IN (?)', [duplicateIds]);
        }
    }
};

const ensureSchema = async () => {
    await addColumnIfMissing('users', 'gitlab_username', 'VARCHAR(255) NULL');
    await addColumnIfMissing('users', 'user_tag', 'VARCHAR(32) NULL');
    await cleanupDuplicateUserTags();
    await addIndexIfMissing('users', 'unique_user_tag', 'UNIQUE KEY unique_user_tag (user_tag)');
    await addColumnIfMissing('repositories', 'provider', "VARCHAR(20) NOT NULL DEFAULT 'github'");
    await addColumnIfMissing('repositories', 'language', 'VARCHAR(100) NULL');
    await addColumnIfMissing('repositories', 'stargazers_count', 'INT NOT NULL DEFAULT 0');
    await addColumnIfMissing('repositories', 'forks_count', 'INT NOT NULL DEFAULT 0');
    await addColumnIfMissing('repositories', 'repo_external_id', 'VARCHAR(255) NULL');
    await addColumnIfMissing('messages', 'is_pinned', 'BOOLEAN NOT NULL DEFAULT FALSE');
    await addColumnIfMissing('messages', 'pinned_at', 'DATETIME NULL');
    await addColumnIfMissing('messages', 'pinned_by', 'INT NULL');
    await addColumnIfMissing('messages', 'file_name', 'VARCHAR(255) NULL');
    await addColumnIfMissing('messages', 'file_size', 'BIGINT NULL');
    await addColumnIfMissing('posts', 'attachment_url', 'VARCHAR(500) NULL');
    await addColumnIfMissing('posts', 'attachment_name', 'VARCHAR(255) NULL');
    await addColumnIfMissing('posts', 'attachment_size', 'BIGINT NULL');
    await addColumnIfMissing('posts', 'attachment_type', 'VARCHAR(255) NULL');
    await addColumnIfMissing('posts', 'code_content', 'LONGTEXT NULL');
    await addColumnIfMissing('posts', 'code_language', 'VARCHAR(50) NULL');
    await addColumnIfMissing('group_chat_messages', 'is_pinned', 'BOOLEAN NOT NULL DEFAULT FALSE');
    await addColumnIfMissing('group_chat_messages', 'pinned_at', 'DATETIME NULL');
    await addColumnIfMissing('group_chat_messages', 'pinned_by', 'INT NULL');

    await db.query(`CREATE TABLE IF NOT EXISTS github_repo_branches (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        repo_name VARCHAR(255) NOT NULL,
        branch_name VARCHAR(255) NOT NULL,
        is_default BOOLEAN NOT NULL DEFAULT FALSE,
        last_synced DATETIME NOT NULL,
        UNIQUE KEY unique_cached_branch (user_id, repo_name, branch_name)
    )`);

    await db.query(`CREATE TABLE IF NOT EXISTS github_repo_commits (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        repo_name VARCHAR(255) NOT NULL,
        branch_name VARCHAR(255) NOT NULL,
        sha VARCHAR(80) NOT NULL,
        message TEXT NULL,
        author_name VARCHAR(255) NULL,
        author_avatar VARCHAR(500) NULL,
        commit_date DATETIME NULL,
        html_url VARCHAR(500) NULL,
        last_synced DATETIME NOT NULL,
        UNIQUE KEY unique_cached_commit (user_id, repo_name, branch_name, sha)
    )`);

    await db.query(`CREATE TABLE IF NOT EXISTS github_repo_files (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        repo_name VARCHAR(255) NOT NULL,
        branch_name VARCHAR(255) NOT NULL,
        path_key VARCHAR(500) NOT NULL,
        file_path VARCHAR(500) NOT NULL,
        file_name VARCHAR(255) NOT NULL,
        file_type VARCHAR(20) NOT NULL,
        download_url VARCHAR(1000) NULL,
        html_url VARCHAR(1000) NULL,
        last_synced DATETIME NOT NULL,
        UNIQUE KEY unique_cached_file (user_id, repo_name(191), branch_name(191), path_key(191), file_path(191))
    )`);

    await db.query(`CREATE TABLE IF NOT EXISTS user_blacklist (
        id INT AUTO_INCREMENT PRIMARY KEY,
        blocker_id INT NOT NULL,
        blocked_id INT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY unique_user_block (blocker_id, blocked_id)
    )`);

    await db.query(`CREATE TABLE IF NOT EXISTS chat_clears (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        chat_id INT NOT NULL,
        cleared_at DATETIME NOT NULL,
        UNIQUE KEY unique_chat_clear (user_id, chat_id)
    )`);

    await db.query(`CREATE TABLE IF NOT EXISTS group_chat_clears (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        group_chat_id INT NOT NULL,
        cleared_at DATETIME NOT NULL,
        UNIQUE KEY unique_group_chat_clear (user_id, group_chat_id)
    )`);

    await db.query(`CREATE TABLE IF NOT EXISTS message_pins (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        message_id INT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY unique_message_pin (user_id, message_id)
    )`);

    await db.query(`CREATE TABLE IF NOT EXISTS group_message_pins (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        message_id INT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY unique_group_message_pin (user_id, message_id)
    )`);
};

ensureSchema().catch((error) => {
    console.error('Database schema initialization failed:', error);
    process.exitCode = 1;
});

const githubHeaders = process.env.GITHUB_PERSONAL_ACCESS_TOKEN
    ? { Authorization: `token ${process.env.GITHUB_PERSONAL_ACCESS_TOKEN}` }
    : {};

const gitlabHeaders = process.env.GITLAB_PERSONAL_ACCESS_TOKEN
    ? { 'PRIVATE-TOKEN': process.env.GITLAB_PERSONAL_ACCESS_TOKEN }
    : {};

const normalizeRepo = (repo, provider) => ({
    provider,
    externalId: String(repo.id || repo.node_id || repo.name),
    name: repo.name || repo.path || repo.path_with_namespace,
    html_url: repo.html_url || repo.web_url,
    language: repo.language || null,
    stargazers_count: Number(repo.stargazers_count ?? repo.watchers_count ?? repo.star_count ?? 0),
    forks_count: Number(repo.forks_count ?? repo.forks ?? 0),
});

const fetchPaginatedRepos = async (provider, username) => {
    const repos = [];
    let page = 1;
    const perPage = 100;

    while (true) {
        const url = provider === 'gitlab'
            ? `https://gitlab.com/api/v4/users/${encodeURIComponent(username)}/projects?per_page=${perPage}&page=${page}&simple=true&order_by=updated_at`
            : `https://api.github.com/users/${encodeURIComponent(username)}/repos?per_page=${perPage}&page=${page}&sort=updated`;

        const { data } = await axios.get(url, {
            headers: provider === 'gitlab' ? gitlabHeaders : githubHeaders,
        });

        if (!Array.isArray(data) || data.length === 0) break;
        repos.push(...data.map((repo) => normalizeRepo(repo, provider)).filter((repo) => repo.name && repo.html_url));
        if (data.length < perPage) break;
        page += 1;
    }

    return repos;
};

const saveRepositories = async (userId, provider, repositories) => {
    const lastSynced = new Date();
    await db.query('DELETE FROM repositories WHERE user_id = ? AND provider = ?', [userId, provider]);

    for (const repo of repositories) {
        await db.query(
            `INSERT INTO repositories 
            (user_id, repo_name, repo_url, last_synced, provider, language, stargazers_count, forks_count, repo_external_id)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                userId,
                repo.name,
                repo.html_url,
                lastSynced,
                provider,
                repo.language,
                repo.stargazers_count,
                repo.forks_count,
                repo.externalId,
            ]
        );
    }
};

const getCachedRepositories = async (userId, provider) => {
    const [repos] = await db.query(
        `SELECT repo_name AS name, repo_url AS html_url, provider, language, stargazers_count, forks_count
        FROM repositories WHERE user_id = ? AND provider = ?
        ORDER BY stargazers_count DESC, repo_name ASC`,
        [userId, provider]
    );
    return repos;
};

const getRepositoriesForUser = async (userId, provider, username, options = {}) => {
    const { forceRefresh = false, failOnRefreshError = false } = options;
    let cached = await getCachedRepositories(userId, provider);
    if (!username) return [];

    const shouldRefresh = forceRefresh || cached.length === 0;

    if (!shouldRefresh) return cached;

    try {
        const fresh = await fetchPaginatedRepos(provider, username);
        await saveRepositories(userId, provider, fresh);
        cached = await getCachedRepositories(userId, provider);
    } catch (error) {
        console.error(`Ошибка получения ${provider} репозиториев:`, error.message);
        if (forceRefresh && failOnRefreshError) {
            const status = error.response?.status;
            const rateLimitRemaining = error.response?.headers?.['x-ratelimit-remaining'];
            const rateLimitReset = error.response?.headers?.['x-ratelimit-reset'];
            const resetDate = rateLimitReset
                ? new Date(Number(rateLimitReset) * 1000).toLocaleString('ru-RU')
                : null;

            if (status === 403 && rateLimitRemaining === '0') {
                const suffix = resetDate ? ` Лимит обновится: ${resetDate}.` : '';
                throw new Error(`GitHub API временно недоступен: превышен лимит запросов.${suffix}`);
            }

            throw new Error(`Не удалось обновить ${provider === 'github' ? 'GitHub' : 'GitLab'} репозитории`);
        }
    }

    return cached;
};

const getUserForGithubUsername = async (githubUsername) => {
    const [users] = await db.query(
        'SELECT id, github_username FROM users WHERE github_username = ? LIMIT 1',
        [githubUsername]
    );
    return users[0] || null;
};

const normalizeGithubBranch = (branch) => ({
    name: branch.name,
    commit: branch.commit || null,
    protected: Boolean(branch.protected),
});

const getCachedGithubBranches = async (userId, repoName) => {
    const [branches] = await db.query(
        `SELECT branch_name AS name
        FROM github_repo_branches
        WHERE user_id = ? AND repo_name = ?
        ORDER BY is_default DESC, branch_name ASC`,
        [userId, repoName]
    );
    return branches;
};

const saveGithubBranches = async (userId, repoName, branches, defaultBranch = null) => {
    const lastSynced = new Date();
    await db.query('DELETE FROM github_repo_branches WHERE user_id = ? AND repo_name = ?', [userId, repoName]);

    for (const branch of branches) {
        await db.query(
            `INSERT INTO github_repo_branches (user_id, repo_name, branch_name, is_default, last_synced)
            VALUES (?, ?, ?, ?, ?)`,
            [userId, repoName, branch.name, branch.name === defaultBranch, lastSynced]
        );
    }
};

const getGithubBranchesForRepo = async (userId, githubUsername, repoName, options = {}) => {
    const { forceRefresh = false } = options;
    const cached = await getCachedGithubBranches(userId, repoName);
    if (!forceRefresh && cached.length > 0) return cached;

    const [{ data: branches }, { data: repo }] = await Promise.all([
        axios.get(`https://api.github.com/repos/${encodeURIComponent(githubUsername)}/${encodeURIComponent(repoName)}/branches`, { headers: githubHeaders }),
        axios.get(`https://api.github.com/repos/${encodeURIComponent(githubUsername)}/${encodeURIComponent(repoName)}`, { headers: githubHeaders }),
    ]);
    const normalized = Array.isArray(branches) ? branches.map(normalizeGithubBranch) : [];
    await saveGithubBranches(userId, repoName, normalized, repo.default_branch);
    return getCachedGithubBranches(userId, repoName);
};

const normalizeGithubCommit = (commit) => ({
    sha: commit.sha,
    message: commit.commit?.message || '',
    author_name: commit.commit?.author?.name || commit.author?.login || null,
    author_avatar: commit.author?.avatar_url || null,
    commit_date: commit.commit?.author?.date ? new Date(commit.commit.author.date) : null,
    html_url: commit.html_url || null,
});

const getCachedGithubCommits = async (userId, repoName, branch) => {
    const [commits] = await db.query(
        `SELECT sha, message, author_name, author_avatar, commit_date, html_url
        FROM github_repo_commits
        WHERE user_id = ? AND repo_name = ? AND branch_name = ?
        ORDER BY commit_date DESC, id DESC
        LIMIT 100`,
        [userId, repoName, branch]
    );

    return commits.map((commit) => ({
        sha: commit.sha,
        html_url: commit.html_url,
        commit: {
            message: commit.message,
            author: {
                name: commit.author_name,
                date: commit.commit_date,
            },
        },
        author: commit.author_avatar ? { avatar_url: commit.author_avatar } : null,
    }));
};

const saveGithubCommits = async (userId, repoName, branch, commits) => {
    const lastSynced = new Date();
    await db.query(
        'DELETE FROM github_repo_commits WHERE user_id = ? AND repo_name = ? AND branch_name = ?',
        [userId, repoName, branch]
    );

    for (const commit of commits) {
        const normalized = normalizeGithubCommit(commit);
        await db.query(
            `INSERT INTO github_repo_commits
            (user_id, repo_name, branch_name, sha, message, author_name, author_avatar, commit_date, html_url, last_synced)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                userId,
                repoName,
                branch,
                normalized.sha,
                normalized.message,
                normalized.author_name,
                normalized.author_avatar,
                normalized.commit_date,
                normalized.html_url,
                lastSynced,
            ]
        );
    }
};

const getGithubCommitsForRepo = async (userId, githubUsername, repoName, branch, options = {}) => {
    const { forceRefresh = false } = options;
    const cached = await getCachedGithubCommits(userId, repoName, branch);
    if (!forceRefresh && cached.length > 0) return cached;

    const { data } = await axios.get(
        `https://api.github.com/repos/${encodeURIComponent(githubUsername)}/${encodeURIComponent(repoName)}/commits?sha=${encodeURIComponent(branch)}&per_page=100`,
        { headers: githubHeaders }
    );
    const commits = Array.isArray(data) ? data : [];
    await saveGithubCommits(userId, repoName, branch, commits);
    return getCachedGithubCommits(userId, repoName, branch);
};

const normalizeGithubFile = (file) => ({
    name: file.name,
    path: file.path,
    type: file.type,
    download_url: file.download_url || null,
    html_url: file.html_url || null,
});

const getCachedGithubFiles = async (userId, repoName, branch, pathKey) => {
    const [files] = await db.query(
        `SELECT file_name AS name, file_path AS path, file_type AS type, download_url, html_url
        FROM github_repo_files
        WHERE user_id = ? AND repo_name = ? AND branch_name = ? AND path_key = ?
        ORDER BY file_type ASC, file_name ASC`,
        [userId, repoName, branch, pathKey]
    );
    return files;
};

const saveGithubFiles = async (userId, repoName, branch, pathKey, files) => {
    const lastSynced = new Date();
    await db.query(
        'DELETE FROM github_repo_files WHERE user_id = ? AND repo_name = ? AND branch_name = ? AND path_key = ?',
        [userId, repoName, branch, pathKey]
    );

    for (const file of files) {
        const normalized = normalizeGithubFile(file);
        await db.query(
            `INSERT INTO github_repo_files
            (user_id, repo_name, branch_name, path_key, file_path, file_name, file_type, download_url, html_url, last_synced)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                userId,
                repoName,
                branch,
                pathKey,
                normalized.path,
                normalized.name,
                normalized.type,
                normalized.download_url,
                normalized.html_url,
                lastSynced,
            ]
        );
    }
};

const getGithubFilesForRepo = async (userId, githubUsername, repoName, branch, pathKey = '', options = {}) => {
    const { forceRefresh = false } = options;
    const normalizedPath = pathKey || '';
    const cached = await getCachedGithubFiles(userId, repoName, branch, normalizedPath);
    if (!forceRefresh && cached.length > 0) return cached;

    const urlPath = normalizedPath ? `/${normalizedPath.split('/').map(encodeURIComponent).join('/')}` : '';
    const { data } = await axios.get(
        `https://api.github.com/repos/${encodeURIComponent(githubUsername)}/${encodeURIComponent(repoName)}/contents${urlPath}?ref=${encodeURIComponent(branch)}`,
        { headers: githubHeaders }
    );
    const files = Array.isArray(data) ? data : [data];
    await saveGithubFiles(userId, repoName, branch, normalizedPath, files);
    return getCachedGithubFiles(userId, repoName, branch, normalizedPath);
};

const clearGithubDetailsCache = async (userId) => {
    await Promise.all([
        db.query('DELETE FROM github_repo_branches WHERE user_id = ?', [userId]),
        db.query('DELETE FROM github_repo_commits WHERE user_id = ?', [userId]),
        db.query('DELETE FROM github_repo_files WHERE user_id = ?', [userId]),
    ]);
};

// Вспомогательная функция для генерации токена
const generateToken = (user) => {
    return jwt.sign({ id: user.id, email: user.email }, process.env.JWT_SECRET, {
        expiresIn: process.env.JWT_EXPIRES,
    });
};

const compilerLanguages = {
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

const compilerExtensions = {
    java: 'java',
    csharp: 'cs',
    cpp: 'cpp',
    lua: 'lua',
    python: 'py',
    php: 'php',
    javascript: 'js',
    nodejs: 'js',
    react: 'jsx',
};

// Untrusted code is executed only by the isolated compiler runner.

// Middleware для проверки токена
const verifyToken = (req, res, next) => {
    const token = req.header('Authorization')?.replace('Bearer ', '');
    if (!token) {
        return res.status(401).json({ message: 'Токен не предоставлен' });
    }

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        console.log('Decoded user:', decoded); // Логируем декодированный токен
        req.user = decoded;
        next();
    } catch (error) {
        console.error('Ошибка токена:', error);
        return res.status(401).json({ message: 'Неверный токен' });
    }
};

const verifyAdmin = (req, res, next) => {
    console.log('User role:', req.user.role); // Логируем роль пользователя
    if (!req.user || req.user.role !== 'admin') {
        return res.status(403).json({ message: 'Доступ запрещен. Вы не администратор.' });
    }
    next();
};

// PRODUCTION_HARDENING: sandboxed-compiler-route
app.post('/compiler/run', verifyToken, async (req, res) => {
    if (String(process.env.ENABLE_COMPILER || 'false').toLowerCase() !== 'true') {
        return res.status(503).json({
            success: false,
            stdout: '',
            stderr: 'Изолированный компилятор отключен в конфигурации сервера.',
            diagnostics: ['Компилятор временно недоступен.'],
            friendlyDiagnostics: ['Администратор ещё не включил безопасную песочницу.'],
            steps: [],
            sandboxed: true,
        });
    }

    const { language, code } = req.body;

    try {
        const result = await runSandboxedCompilerJob({
            language,
            code,
            userId: req.user.id,
        });
        res.status(200).json(result);
    } catch (error) {
        console.error('Ошибка изолированного онлайн-компилятора:', error.message);
        if (error.retryAfterSeconds) {
            res.setHeader('Retry-After', String(error.retryAfterSeconds));
        }
        if (error.compilerResult) {
            return res.status(error.statusCode || 500).json(error.compilerResult);
        }
        res.status(error.statusCode || 500).json({
            success: false,
            stdout: '',
            stderr: error.message,
            diagnostics: ['Сервер не смог выполнить код в изолированной среде.'],
            friendlyDiagnostics: [error.statusCode === 429
                ? error.message
                : 'Безопасная песочница временно недоступна.'],
            steps: [],
            sandboxed: true,
        });
    }
});

app.post('/code/open-vscode', verifyToken, async (req, res) => {
    const { language, code, source } = req.body;
    const normalizedLanguage = compilerLanguages[language] ? language : 'javascript';

    if (typeof code !== 'string' || code.trim().length === 0) {
        return res.status(400).json({ message: 'Код пустой' });
    }

    if (Buffer.byteLength(code, 'utf8') > 200000) {
        return res.status(400).json({ message: 'Код слишком большой. Максимум 200 КБ.' });
    }

    try {
        const codeDir = path.join(__dirname, 'uploads', 'code');
        await fs.promises.mkdir(codeDir, { recursive: true });

        const extension = compilerExtensions[normalizedLanguage] || 'txt';
        const safeSource = String(source || 'itbird-code').replace(/[^a-z0-9_-]/gi, '-').slice(0, 40);
        const filename = `${Date.now()}-${safeSource}.${extension}`;
        const filePath = path.join(codeDir, filename);

        await fs.promises.writeFile(filePath, code, 'utf8');

        const normalizedPath = filePath.replace(/\\/g, '/');
        res.json({
            filePath,
            vscodeUrl: `vscode://file/${encodeURI(normalizedPath)}`,
        });
    } catch (error) {
        console.error('Open VS Code file error:', error);
        res.status(500).json({ message: 'Не удалось подготовить файл для VS Code' });
    }
});

// Регистрация пользователя
app.post('/register', async (req, res) => {
    const { username, email, password, github_username, gitlab_username } = req.body;
    const userTag = normalizeUserTag(req.body.user_tag);

    if (!username || !email || !password) {
        return res.status(400).json({ message: 'Поля username, email и password обязательны!' });
    }

    if (!isValidUserTag(userTag)) {
        return res.status(400).json({ message: '@username должен быть от 3 до 32 символов: латиница, цифры и _' });
    }

    try {
        // Проверка на существующего пользователя с таким email
        const [existingUserEmail] = await db.query('SELECT id FROM users WHERE email = ?', [email]);
        const [existingUserGitHub] = github_username
            ? await db.query('SELECT id FROM users WHERE github_username = ?', [github_username])
            : [[]];
        const [existingUserTag] = userTag
            ? await db.query('SELECT id FROM users WHERE user_tag = ?', [userTag])
            : [[]];
        if (existingUserEmail.length > 0) {
            return res.status(400).json({ message: 'Пользователь с таким email уже существует!' });
        } else if (existingUserGitHub.length > 0) {
            return res.status(400).json({ message: 'Пользователь с таким GitHub Username уже существует!' });
        } else if (existingUserTag.length > 0) {
            return res.status(400).json({ message: 'Этот @username уже занят!' });
        }

        // Хеширование пароля
        const hashedPassword = await bcrypt.hash(password, 10);

        // Вставка нового пользователя в базу данных
        const [result] = await db.query(
            'INSERT INTO users (username, email, password, github_username, gitlab_username, user_tag, avatar) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [username, email, hashedPassword, github_username || null, gitlab_username || github_username || null, userTag, '/uploads/avatar-default.png']
        );

        // Получаем репозитории с GitHub, если github_username передан
        let repositories = [];
        if (github_username) {
            repositories = await fetchRepositories(github_username); // Получаем репозитории с GitHub
        }

        // Сохраняем репозитории в базу данных
        const lastSynced = new Date().toISOString().slice(0, 19).replace('T', ' ');

        for (const repo of repositories) {
            console.log('Сохраняем репозиторий:', repo);  // Логирование каждого репозитория
            await db.query(
                'INSERT INTO repositories (user_id, repo_name, repo_url, last_synced) VALUES (?, ?, ?, ?)',
                [result.insertId, repo.name, repo.html_url, lastSynced]
            );
        }
        if (gitlab_username || github_username) {
            const gitlabRepos = await fetchPaginatedRepos('gitlab', gitlab_username || github_username).catch(() => []);
            await saveRepositories(result.insertId, 'gitlab', gitlabRepos);
        }
        // Генерация JWT токена
        const token = generateToken({ id: result.insertId, username, email });

        res.status(201).json({ message: 'Пользователь успешно зарегистрирован!', token });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Ошибка сервера при регистрации' });
    }
});

// Функция для получения репозиториев с GitHub
const fetchRepositories = async (githubUsername) => {
    try {
        return await fetchPaginatedRepos('github', githubUsername);
    } catch (error) {
        console.error('Ошибка при получении репозиториев с GitHub:', error.message);
        return [];
    }
};

// Авторизация
app.post('/login', async (req, res) => {
    const { emailOrUsername, password } = req.body;

    if (!emailOrUsername || !password) {
        return res.status(400).json({ message: 'Поля Почта/Логин и Пароль обязательны!' });
    }

    try {
        // Пытаемся найти пользователя либо по email, либо по username
        const normalizedTag = normalizeUserTag(emailOrUsername);
        const [users] = await db.query(
            'SELECT id, email, username, role, password, isBlocked, github_username, gitlab_username, user_tag FROM users WHERE email = ? OR username = ? OR user_tag = ?',
            [emailOrUsername, emailOrUsername, normalizedTag]
        );

        if (users.length === 0) {
            return res.status(400).json({ message: 'Пользователь не найден!' });
        }

        if (users[0].isBlocked === 'заблокирован') {
            return res.status(403).json({ message: 'Ваш аккаунт заблокирован!' });
        }

        const validPassword = await bcrypt.compare(password, users[0].password);
        if (!validPassword) {
            return res.status(400).json({ message: 'Неверный пароль!' });
        }

        const token = jwt.sign(
            {
                id: users[0].id,
                email: users[0].email,
                username: users[0].username,
                user_tag: users[0].user_tag,
                role: users[0].role || 'user',
            },
            process.env.JWT_SECRET,
            { expiresIn: process.env.JWT_EXPIRES }
        );

        // Обновляем репозитории при входе в аккаунт (синхронизация данных)
        const githubUsername = users[0].github_username;
        if (githubUsername) {
            const [existingRepos] = await db.query(
                'SELECT * FROM repositories WHERE user_id = ? ORDER BY last_synced DESC LIMIT 1',
                [users[0].id]
            );

            const repositories = await fetchPaginatedRepos('github', githubUsername);
            await saveRepositories(users[0].id, 'github', repositories);
        }

        if (users[0].gitlab_username) {
            const repositories = await fetchPaginatedRepos('gitlab', users[0].gitlab_username).catch(() => []);
            await saveRepositories(users[0].id, 'gitlab', repositories);
        }

        res.json({
            token,
            user: {
                id: users[0].id,
                username: users[0].username,
                user_tag: users[0].user_tag,
                github_username: users[0].github_username,
                gitlab_username: users[0].gitlab_username,
                role: users[0].role || 'user',
            },
        });

    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Ошибка на сервере' });
    }
});

app.post('/password-reset/request', async (req, res) => {
    const { email } = req.body;

    if (!email) {
        return res.status(400).json({ message: 'Укажите почту' });
    }

    try {
        const [users] = await db.query(
            'SELECT id, email, username FROM users WHERE email = ?',
            [email]
        );

        if (users.length === 0) {
            return res.status(404).json({ message: 'Пользователь с такой почтой не найден' });
        }

        const temporaryPassword = crypto.randomInt(100000, 1000000).toString();
        const hashedPassword = await bcrypt.hash(temporaryPassword, 10);

        await db.query(
            'UPDATE users SET password = ? WHERE id = ?',
            [hashedPassword, users[0].id]
        );

        await transporter.sendMail({
            from: '"IT-BIRD" <den4ik200518@mail.ru>',
            to: users[0].email,
            subject: 'Восстановление пароля IT-BIRD',
            text: `Ваш временный пароль: ${temporaryPassword}`,
            html: `
                <div style="font-family: Arial, sans-serif; line-height: 1.5;">
                    <h2>Восстановление пароля IT-BIRD</h2>
                    <p>Здравствуйте, ${users[0].username}.</p>
                    <p>Ваш временный пароль:</p>
                    <p style="font-size: 24px; font-weight: bold; letter-spacing: 4px;">${temporaryPassword}</p>
                    <p>Используйте этот код как пароль для входа в аккаунт.</p>
                </div>
            `,
        });

        res.json({ message: 'Временный пароль отправлен на почту' });
    } catch (error) {
        console.error('Password reset error:', error);
        res.status(500).json({ message: 'Не удалось отправить временный пароль' });
    }
});

// Маршрут для получения списка пользователей
app.get("/users", async (req, res) => {
    const token = req.headers.authorization?.split(" ")[1];
    if (!token) {
        return res.status(401).json({ message: "Необходима авторизация" });
    }

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const userId = decoded.id;

        const [users] = await db.query(
            "SELECT id, username, user_tag, github_username, avatar, skills FROM users WHERE id != ? ",
            [userId]
        );
        // APP_FIX: friendship-status-bidirectional
        const [friendships] = await db.query(
            `SELECT
                CASE WHEN f.user_id = ? THEN f.friend_id ELSE f.user_id END AS other_user_id,
                f.status
             FROM friends f
             WHERE f.user_id = ? OR f.friend_id = ?`,
            [userId, userId, userId]
        );

        const friendshipByUserId = new Map(
            friendships.map((friendship) => [Number(friendship.other_user_id), friendship.status])
        );

        const usersWithStatus = users.map((user) => ({
            ...user,
            friendshipStatus: friendshipByUserId.get(Number(user.id)) || 'none',
        }));

        res.json(usersWithStatus);

    } catch (error) {
        console.error("Ошибка при получении пользователей:", error);
        res.status(500).json({ message: "Ошибка сервера" });
    }
});

// Получение локальной копии репозиториев пользователя
app.get("/profile/repositories", verifyToken, async (req, res) => {
    const userId = req.user.id;
    const provider = req.query.provider || 'github';
    const forceRefresh = req.query.refresh === '1' || req.query.refresh === 'true';
    try {
        const [users] = await db.query(
            'SELECT github_username, gitlab_username FROM users WHERE id = ?',
            [userId]
        );
        if (users.length === 0) return res.status(404).json({ message: 'Пользователь не найден' });

        const username = provider === 'gitlab'
            ? (users[0].gitlab_username || users[0].github_username)
            : users[0].github_username;
        if (forceRefresh && provider === 'github') {
            await clearGithubDetailsCache(userId);
        }
        const repos = await getRepositoriesForUser(userId, provider, username, {
            forceRefresh,
            failOnRefreshError: forceRefresh && provider === 'github',
        });
        res.json({ repositories: repos });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Ошибка при получении репозиториев из БД" });
    }
});

app.get('/github/repos/:username/:repoName/branches', async (req, res) => {
    const { username, repoName } = req.params;
    const forceRefresh = req.query.refresh === '1' || req.query.refresh === 'true';

    try {
        const user = await getUserForGithubUsername(username);
        if (!user) return res.status(404).json({ message: 'Пользователь с таким GitHub username не найден' });

        const branches = await getGithubBranchesForRepo(user.id, username, repoName, { forceRefresh });
        res.json(branches);
    } catch (error) {
        console.error('Ошибка при получении веток GitHub:', error.message);
        res.status(500).json({ message: 'Не удалось получить ветки репозитория' });
    }
});

app.get('/github/repos/:username/:repoName/commits', async (req, res) => {
    const { username, repoName } = req.params;
    const branch = String(req.query.sha || req.query.branch || 'main');
    const forceRefresh = req.query.refresh === '1' || req.query.refresh === 'true';

    try {
        const user = await getUserForGithubUsername(username);
        if (!user) return res.status(404).json({ message: 'Пользователь с таким GitHub username не найден' });

        const commits = await getGithubCommitsForRepo(user.id, username, repoName, branch, { forceRefresh });
        res.json(commits);
    } catch (error) {
        console.error('Ошибка при получении коммитов GitHub:', error.message);
        res.status(500).json({ message: 'Не удалось получить коммиты репозитория' });
    }
});

const handleGithubContentsRequest = async (req, res) => {
    const { username, repoName } = req.params;
    const filePath = req.params[0] || '';
    const branch = String(req.query.ref || req.query.branch || 'main');
    const forceRefresh = req.query.refresh === '1' || req.query.refresh === 'true';

    try {
        const user = await getUserForGithubUsername(username);
        if (!user) return res.status(404).json({ message: 'Пользователь с таким GitHub username не найден' });

        const files = await getGithubFilesForRepo(user.id, username, repoName, branch, filePath, { forceRefresh });
        res.json(files);
    } catch (error) {
        console.error('Ошибка при получении файлов GitHub:', error.message);
        res.status(500).json({ message: 'Не удалось получить файлы репозитория' });
    }
};

app.get('/github/repos/:username/:repoName/contents', handleGithubContentsRequest);
app.get('/github/repos/:username/:repoName/contents/*', handleGithubContentsRequest);


// Маршрут для получения профиля текущего пользователя
app.get('/profile', verifyToken, async (req, res) => {
    const { id } = req.user;

    try {
        const [user] = await db.query(
            'SELECT id, username, email, github_username, gitlab_username, user_tag, avatar, skills FROM users WHERE id = ?',
            [id]
        );

        if (user.length === 0) {
            return res.status(404).json({ message: 'Пользователь не найден' });
        }

        const profile = user[0];
        const forceRefresh = req.query.refresh === '1' || req.query.refresh === 'true';
        if (forceRefresh) {
            await clearGithubDetailsCache(profile.id);
        }
        const githubRepositories = await getRepositoriesForUser(profile.id, 'github', profile.github_username, {
            forceRefresh,
            failOnRefreshError: forceRefresh,
        });
        const gitlabRepositories = await getRepositoriesForUser(profile.id, 'gitlab', profile.gitlab_username || profile.github_username, { forceRefresh });

        res.status(200).json({
            user: profile,
            repositories: githubRepositories,
            githubRepositories,
            gitlabRepositories,
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Ошибка при получении профиля' });
    }
});

// Обновление профиля пользователя
app.put('/profile/update', verifyToken, upload.single('avatar'), async (req, res) => {
    const { id } = req.user;
    const { username, github_username, gitlab_username, skills, email, currentPassword, newPassword } = req.body;
    const userTag = normalizeUserTag(req.body.user_tag);
    const avatar = req.file ? `/uploads/${req.file.filename}` : null;

    try {
        if (!isValidUserTag(userTag)) {
            return res.status(400).json({ message: '@username должен быть от 3 до 32 символов: латиница, цифры и _' });
        }

        if (newPassword) {
            if (!currentPassword) {
                return res.status(400).json({ message: 'Укажите текущий пароль' });
            }
            if (String(newPassword).length < 6) {
                return res.status(400).json({ message: 'Новый пароль должен быть не короче 6 символов' });
            }

            const [users] = await db.query('SELECT password FROM users WHERE id = ?', [id]);
            if (users.length === 0) {
                return res.status(404).json({ message: 'Пользователь не найден' });
            }

            const isCurrentPasswordValid = await bcrypt.compare(currentPassword, users[0].password);
            if (!isCurrentPasswordValid) {
                return res.status(400).json({ message: 'Текущий пароль указан неверно' });
            }
        }

        if (github_username !== undefined) {
            const [existingUser] = await db.query(
                'SELECT id FROM users WHERE github_username = ? AND id != ?',
                [github_username, id]
            );
            if (existingUser.length > 0) {
                return res.status(400).json({ message: 'Этот GitHub username уже используется другим пользователем' });
            }
        }
        if (gitlab_username !== undefined) {
            const [existingUser] = await db.query(
                'SELECT id FROM users WHERE gitlab_username = ? AND id != ?',
                [gitlab_username, id]
            );
            if (gitlab_username && existingUser.length > 0) {
                return res.status(400).json({ message: 'Этот GitLab username уже используется другим пользователем' });
            }
        }
        if (req.body.user_tag !== undefined && userTag) {
            const [existingUser] = await db.query(
                'SELECT id FROM users WHERE user_tag = ? AND id != ?',
                [userTag, id]
            );
            if (existingUser.length > 0) {
                return res.status(400).json({ message: 'Этот @username уже занят другим пользователем' });
            }
        }

        const updateFields = [];
        const values = [];

        if (username) updateFields.push('username = ?'), values.push(username);
        if (github_username !== undefined) updateFields.push('github_username = ?'), values.push(github_username.trim() === '' ? null : github_username);
        if (gitlab_username !== undefined) updateFields.push('gitlab_username = ?'), values.push(gitlab_username.trim() === '' ? null : gitlab_username);
        if (req.body.user_tag !== undefined) updateFields.push('user_tag = ?'), values.push(userTag);
        if (skills) updateFields.push('skills = ?'), values.push(skills);
        if (email) updateFields.push('email = ?'), values.push(email);
        if (avatar) updateFields.push('avatar = ?'), values.push(avatar);
        if (newPassword) {
            const hashedPassword = await bcrypt.hash(newPassword, 10);
            updateFields.push('password = ?');
            values.push(hashedPassword);
        }

        values.push(id);

        if (updateFields.length > 0) {
            await db.query(`UPDATE users SET ${updateFields.join(', ')} WHERE id = ?`, values);
        }

        res.status(200).json({ message: 'Профиль успешно обновлен' });
    } catch (error) {
        console.error('Ошибка обновления профиля:', error);
        res.status(500).json({ message: 'Ошибка сервера' });
    }
});

// Удаление аватара пользователя
app.delete('/profile/avatar', verifyToken, async (req, res) => {
    const { id } = req.user;

    try {
        // Получаем текущего пользователя
        const [user] = await db.query('SELECT avatar FROM users WHERE id = ?', [id]);
        if (user.length === 0) {
            return res.status(404).json({ message: 'Пользователь не найден' });
        }

        const avatarPath = user[0].avatar ? path.join(__dirname, user[0].avatar) : null;

        if (avatarPath && fs.existsSync(avatarPath)) {
            // Удаляем файл аватара
            fs.unlinkSync(avatarPath);
        }

        // Обновляем запись в базе данных
        await db.query('UPDATE users SET avatar = NULL WHERE id = ?', [id]);

        res.status(200).json({ message: 'Аватар удален успешно' });
    } catch (error) {
        console.error('Ошибка при удалении аватара:', error);
        res.status(500).json({ message: 'Ошибка при удалении аватара' });
    }
});

app.get('/blacklist', verifyToken, async (req, res) => {
    const userId = req.user.id;

    try {
        const [users] = await db.query(
            `SELECT u.id, u.username, u.avatar, u.email, ub.created_at AS blocked_at
            FROM user_blacklist ub
            JOIN users u ON u.id = ub.blocked_id
            WHERE ub.blocker_id = ?
            ORDER BY ub.created_at DESC`,
            [userId]
        );

        res.json(users);
    } catch (error) {
        console.error('Blacklist list error:', error);
        res.status(500).json({ message: 'Ошибка загрузки черного списка' });
    }
});

// Маршрут для получения профиля другого пользователя
app.get('/users/:username', verifyToken, async (req, res) => {
    const { username } = req.params;
    const decodedUsername = decodeURIComponent(username); // Декодируем имя пользователя

    try {
        // Находим пользователя в базе данных
        const [user] = await db.query(
            'SELECT id, username, email, github_username, gitlab_username, user_tag, avatar, skills FROM users WHERE username = ?',
            [decodedUsername]
        );

        if (user.length === 0) {
            return res.status(404).json({ message: 'Пользователь не найден' });
        }

        const profile = user[0];
        const forceRefresh = req.query.refresh === '1' || req.query.refresh === 'true';
        const githubRepositories = await getRepositoriesForUser(profile.id, 'github', profile.github_username, { forceRefresh });
        const gitlabRepositories = await getRepositoriesForUser(profile.id, 'gitlab', profile.gitlab_username || profile.github_username, { forceRefresh });

        res.status(200).json({
            user: profile,
            repositories: githubRepositories,
            githubRepositories,
            gitlabRepositories,
        });
    } catch (err) {
        console.error('Ошибка в обработке запроса:', err);
        res.status(500).json({ message: 'Ошибка при получении профиля' });
    }
});




// Получение списка всех пользователей
app.get('/all-users', verifyToken, async (req, res) => {
    try {
        const [users] = await db.query('SELECT id, username, email, github_username, avatar, skills FROM users');
        res.status(200).json(users);
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Ошибка сервера при получении пользователей' });
    }
});

// Создания заявки в друзья
app.post("/add-friend", async (req, res) => {
    const token = req.headers.authorization?.split(" ")[1];
    if (!token) {
        return res.status(401).json({ message: "Необходима авторизация" });
    }

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const userId = decoded.id;
        const { friendId } = req.body;

        if (!friendId) {
            return res.status(400).json({ message: "Не указан ID друга" });
        }

        // Проверяем, нет ли уже заявки или дружбы
        const [existing] = await db.query(
            "SELECT * FROM friends WHERE (user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?)",
            [userId, friendId, friendId, userId]
        );

        if (existing.length > 0) {
            return res.status(400).json({ message: "Заявка уже отправлена или дружба уже установлена" });
        }

        // Создаём заявку
        await db.query("INSERT INTO friends (user_id, friend_id, status) VALUES (?, ?, 'pending')", [userId, friendId]);

        const [senderRows] = await db.query(
            'SELECT id, username, avatar FROM users WHERE id = ?',
            [userId]
        );

        notifyClients({
            type: 'FRIEND_REQUEST_CREATED',
            data: {
                recipientId: friendId,
                request: {
                    user_id: userId,
                    friend_id: friendId,
                    status: 'pending',
                    user_name: senderRows[0]?.username || 'Пользователь',
                    avatar: senderRows[0]?.avatar || null,
                    created_at: new Date().toISOString(),
                }
            }
        });

        res.json({ message: "Заявка отправлена" });

    } catch (error) {
        console.error("Ошибка при отправке заявки в друзья:", error);
        res.status(500).json({ message: "Ошибка сервера" });
    }
});


// Получение списка друзей
app.get("/friends", async (req, res) => {
    const token = req.headers.authorization?.split(" ")[1];
    if (!token) {
        return res.status(401).json({ message: "Необходима авторизация" });
    }

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const userId = decoded.id;

        // Получаем друзей в обе стороны (и тех, кого добавил userId, и тех, кто добавил userId)
        const [friends] = await db.query(
            `SELECT u.id, u.username, u.avatar 
            FROM users u 
            JOIN friends f ON (u.id = f.friend_id AND f.user_id = ?) 
                OR (u.id = f.user_id AND f.friend_id = ?) 
            WHERE f.status = 'accepted'`,
            [userId, userId]
        );

        res.json(friends);
    } catch (error) {
        console.error("Ошибка при получении списка друзей:", error);
        res.status(500).json({ message: "Ошибка сервера" });
    }
});

// APP_FIX: remove-friend-route
app.delete('/friends/:friendId', verifyToken, async (req, res) => {
    const userId = Number(req.user.id);
    const friendId = Number(req.params.friendId);

    if (!friendId || friendId === userId) {
        return res.status(400).json({ message: 'Некорректный пользователь' });
    }

    try {
        const [result] = await db.query(
            `DELETE FROM friends
             WHERE status = 'accepted'
               AND ((user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?))`,
            [userId, friendId, friendId, userId]
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({ message: 'Дружба не найдена' });
        }

        notifyClients({
            type: 'FRIENDSHIP_CHANGED',
            data: { targetIds: [userId, friendId], userId, friendId, status: 'none' },
        });
        res.json({ message: 'Пользователь удален из друзей', friendshipStatus: 'none' });
    } catch (error) {
        console.error('Ошибка при удалении из друзей:', error);
        res.status(500).json({ message: 'Ошибка сервера' });
    }
});

// Получение заявки в друзья
app.get('/friend-requests', async (req, res) => {
    const token = req.headers.authorization?.split(" ")[1];
    if (!token) {
        return res.status(401).json({ message: "Необходима авторизация" });
    }

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const userId = decoded.id;

        // Получаем только заявки на добавление в друзья (статус "pending")
        const [requests] = await db.query(
            `SELECT 
                f.user_id, f.friend_id, f.status,
                u1.username AS user_name, u2.avatar AS avatar, u2.username AS friend_name
            FROM friends f
            JOIN users u1 ON f.user_id = u1.id
            JOIN users u2 ON f.friend_id = u2.id
            WHERE f.friend_id = ? AND f.status = 'pending'`,
            [userId]
        );



        res.json(requests);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});


// Принятие заявки в друзья
app.patch("/friend-requests/accept/:friendId", async (req, res) => {
    const token = req.headers.authorization?.split(" ")[1];
    if (!token) {
        return res.status(401).json({ message: "Необходима авторизация" });
    }

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const userId = decoded.id;
        const friendId = req.params.friendId;

        if (!friendId) {
            return res.status(400).json({ message: "Не указан ID друга" });
        }

        // Обновляем статус на "accepted"
        const [result] = await db.query(
            "UPDATE friends SET status = 'accepted' WHERE status = 'pending' AND ((user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?))",
            [userId, friendId, friendId, userId]
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({ message: "Заявка не найдена" });
        }

        // APP_FIX: friend-accept-notification
        notifyClients({
            type: 'FRIENDSHIP_CHANGED',
            data: {
                targetIds: [Number(userId), Number(friendId)],
                userId: Number(userId),
                friendId: Number(friendId),
                status: 'accepted',
            },
        });

        res.json({ message: "Заявка принята", friendshipStatus: 'accepted' });

    } catch (error) {
        console.error("Ошибка при принятии заявки:", error);
        res.status(500).json({ message: "Ошибка сервера" });
    }
});

// Отклонение заявки в друзья
app.patch("/friend-requests/reject/:friendId", async (req, res) => {
    const token = req.headers.authorization?.split(" ")[1];
    if (!token) {
        return res.status(401).json({ message: "Необходима авторизация" });
    }

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const userId = decoded.id;
        const friendId = req.params.friendId;

        if (!friendId) {
            return res.status(400).json({ message: "Не указан ID друга" });
        }

        // Удаляем запись о заявке
        const [result] = await db.query(
            "DELETE FROM friends WHERE user_id = ? AND friend_id = ? OR user_id = ? AND friend_id = ?",
            [userId, friendId, friendId, userId]
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({ message: "Заявка не найдена" });
        }

        res.json({ message: "Заявка отклонена" });

    } catch (error) {
        console.error("Ошибка при отклонении заявки:", error);
        res.status(500).json({ message: "Ошибка сервера" });
    }
});

// Получение чата
app.get('/chats', verifyToken, async (req, res) => {
    const { id } = req.user;
    try {
        const [chats] = await db.query(
            `SELECT c.id, u1.username AS user1, u2.username AS user2, c.created_at
            FROM chats c
            JOIN users u1 ON c.user_id_1 = u1.id
            JOIN users u2 ON c.user_id_2 = u2.id
            WHERE c.user_id_1 = ? OR c.user_id_2 = ?`,
            [id, id]
        );
        res.json(chats);
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Ошибка при получении чатов' });
    }
});

app.get('/chats/:chatId', verifyToken, async (req, res) => {
    const { chatId } = req.params;
    const userId = req.user.id;

    try {
        const participants = await getChatParticipants(chatId);
        if (!participants || !isChatParticipant(participants, userId)) {
            return res.status(403).json({ message: 'Нет доступа к этому чату' });
        }

        const otherUserId = participants.find((id) => Number(id) !== Number(userId));
        const [users] = await db.query(
            'SELECT id, username, user_tag, avatar FROM users WHERE id = ?',
            [otherUserId]
        );

        if (users.length === 0) {
            return res.status(404).json({ message: 'Собеседник не найден' });
        }

        res.json({ id: Number(chatId), user: users[0] });
    } catch (err) {
        console.error('Chat details error:', err);
        res.status(500).json({ message: 'Ошибка при получении чата' });
    }
});

// Создание сообщения
app.get('/blacklist/:userId/status', verifyToken, async (req, res) => {
    const blockerId = req.user.id;
    const otherUserId = Number(req.params.userId);

    try {
        const status = await getBlockStatusBetween(blockerId, otherUserId);
        res.json(status);
    } catch (error) {
        console.error('Blacklist status error:', error);
        res.status(500).json({ message: 'Ошибка проверки черного списка' });
    }
});

app.post('/blacklist/:userId', verifyToken, async (req, res) => {
    const blockerId = req.user.id;
    const blockedId = Number(req.params.userId);

    if (!blockedId || blockerId === blockedId) {
        return res.status(400).json({ message: 'Некорректный пользователь' });
    }

    try {
        await db.query(
            'INSERT IGNORE INTO user_blacklist (blocker_id, blocked_id) VALUES (?, ?)',
            [blockerId, blockedId]
        );
        notifyClients({ type: 'USER_BLOCKED', data: { blockerId, blockedId } });
        res.status(201).json({ blocked: true });
    } catch (error) {
        console.error('Blacklist add error:', error);
        res.status(500).json({ message: 'Ошибка добавления в черный список' });
    }
});

app.delete('/blacklist/:userId', verifyToken, async (req, res) => {
    const blockerId = req.user.id;
    const blockedId = Number(req.params.userId);

    try {
        await db.query(
            'DELETE FROM user_blacklist WHERE blocker_id = ? AND blocked_id = ?',
            [blockerId, blockedId]
        );
        notifyClients({ type: 'USER_UNBLOCKED', data: { blockerId, blockedId } });
        res.json({ blocked: false });
    } catch (error) {
        console.error('Blacklist remove error:', error);
        res.status(500).json({ message: 'Ошибка удаления из черного списка' });
    }
});

app.post('/messages', verifyToken, async (req, res) => {
    const { chatId, message } = req.body;
    const { id: userId } = req.user;  // Получаем ID текущего пользователя

    console.log({ chatId, message });

    // Проверяем, что chatId не пустые
    if (!chatId) {
        return res.status(400).json({ message: "chatId отсутствуют" });
    }

    try {
        const participants = await getChatParticipants(chatId);
        if (!participants || !isChatParticipant(participants, userId)) {
            return res.status(403).json({ message: 'Нет доступа к этому чату' });
        }

        const recipientId = participants.find((id) => Number(id) !== Number(userId));
        if (recipientId) {
            const blockStatus = await getBlockStatusBetween(userId, recipientId);
            if (blockStatus.blockedBy) {
                return res.status(403).json({ message: 'Вы не можете написать: пользователь ограничил круг лиц' });
            }
            if (blockStatus.blocked) {
                return res.status(403).json({ message: 'Вы добавили пользователя в черный список' });
            }
        }

        // Обработка медиафайлов, если они есть
        let mediaUrl = null;
        if (req.files && req.files.media) {
            // Сохраняем файл и получаем URL (реализуйте сохранение файла)
            const media = req.files.media;
            mediaUrl = `/uploads/${media.name}`;  // Путь к файлу
            // Сохраните файл в нужную папку на сервере
            await media.mv(`./uploads/${media.name}`);
        }

        // Сохраняем сообщение в базе данных
        const [result] = await db.query(
            `INSERT INTO messages (chat_id, user_id, message, media) VALUES (?, ?, ?, ?)`,
            [chatId, userId, message, mediaUrl]
        );

        // Получаем данные о только что добавленном сообщении
        const [newMessage] = await db.query(
            `SELECT m.id, m.chat_id, m.user_id, m.message, m.created_at, u.username
            FROM messages m
            JOIN users u ON m.user_id = u.id
            WHERE m.id = ?`,
            [result.insertId]
        );

        const recipientIds = participants.filter((id) => Number(id) !== Number(userId));

        notifyClients({ type: 'NEW_MESSAGE', data: { ...newMessage[0], recipientIds } });
        await notifyOfflineUsersByEmail(
            recipientIds,
            'Новое личное сообщение в IT-BIRD',
            `${newMessage[0].username}: ${message || 'Вам отправили файл'}`
        );

        res.status(200).json(newMessage[0]);  // Возвращаем добавленное сообщение
    } catch (error) {
        console.error('Ошибка при добавлении сообщения:', error);
        res.status(500).json({ message: "Ошибка сервера" });
    }
});

//Сообщения в чате
app.get('/messages/:chatId', verifyToken, async (req, res) => {
    const { chatId } = req.params;
    const userId = req.user.id;
    try {
        const participants = await getChatParticipants(chatId);
        if (!participants || !isChatParticipant(participants, userId)) {
            return res.status(403).json({ message: 'Нет доступа к этому чату' });
        }

        const [messages] = await db.query(
            `SELECT m.*, u.username, IF(mp.id IS NULL, 0, 1) AS self_pinned
            FROM messages m
            JOIN users u ON m.user_id = u.id
            LEFT JOIN chat_clears cc ON cc.chat_id = m.chat_id AND cc.user_id = ?
            LEFT JOIN message_pins mp ON mp.message_id = m.id AND mp.user_id = ?
            WHERE m.chat_id = ?
              AND (cc.cleared_at IS NULL OR m.created_at > cc.cleared_at)
            ORDER BY (m.is_pinned OR self_pinned) DESC, m.pinned_at DESC, mp.created_at DESC, m.created_at`,
            [userId, userId, chatId]
        );
        console.log(messages); // Логирование сообщений
        res.json(messages);
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Ошибка при получении сообщений' });
    }
});

//Создание чата
app.post('/chats', verifyToken, async (req, res) => {
    const { userId2 } = req.body;
    const { id: userId1 } = req.user;

    try {
        const [existingChat] = await db.query(
            'SELECT * FROM chats WHERE (user_id_1 = ? AND user_id_2 = ?) OR (user_id_1 = ? AND user_id_2 = ?)',
            [userId1, userId2, userId2, userId1]
        );

        if (existingChat.length > 0) {
            return res.status(200).json(existingChat[0]);
        }

        const [result] = await db.query(
            'INSERT INTO chats (user_id_1, user_id_2) VALUES (?, ?)',
            [userId1, userId2]
        );

        res.status(201).json({ id: result.insertId });
    } catch (err) {
        console.error('Ошибка при создании чата:', err);
        res.status(500).json({ message: 'Ошибка при создании чата' });
    }
});

// Удаление сообщения (неполностью)
app.put('/messages/:messageId', verifyToken, async (req, res) => {
    const { messageId } = req.params;
    const userId = req.user.id;
    const { message } = req.body;

    try {
        // Проверяем, что сообщение принадлежит пользователю
        const [messageData] = await db.query(
            'SELECT * FROM messages WHERE id = ? AND user_id = ?',
            [messageId, userId]
        );

        if (messageData.length === 0) {
            return res.status(403).json({ message: 'Нет прав на изменение этого сообщения' });
        }

        // Обновляем сообщение
        await db.query(
            'UPDATE messages SET message = ?, media = NULL, is_deleted = TRUE, file_name = NULL, file_path = NULL, file_size = NULL WHERE id = ?',
            [message, messageId]
        );

        // Получаем обновленное сообщение
        const [updatedMessage] = await db.query(
            'SELECT * FROM messages WHERE id = ?',
            [messageId]
        );

        // Уведомляем клиентов об обновлении сообщения
        notifyClients({
            type: 'UPDATE_MESSAGE',
            data: {
                ...updatedMessage[0],
                chatId: messageData[0].chat_id
            }
        });

        res.status(200).json(updatedMessage[0]);
    } catch (error) {
        console.error('Ошибка при обновлении сообщения:', error);
        res.status(500).json({ message: 'Ошибка при обновлении сообщения' });
    }
});

// Добавление загрузки файлов
app.post('/messages/upload', verifyToken, uploadChatMedia, async (req, res) => {
    console.log("Полученные данные:", req.body);
    const chatId = Number(req.body.chatId) || null;

    if (!chatId) {
        return res.status(400).json({ message: "Ошибка: chatId не указан" });
    }

    const userId = req.user.id;
    const file = req.file;

    if (!file) {
        return res.status(400).json({ message: "Файл не прикреплён" });
    }

    // Формируем путь к файлу
    const mediaUrl = `/uploads/${path.basename(file.path)}`;

    try {
        const participants = await getChatParticipants(chatId);
        if (!participants || !isChatParticipant(participants, userId)) {
            return res.status(403).json({ message: 'Нет доступа к этому чату' });
        }

        const recipientId = participants.find((id) => Number(id) !== Number(userId));
        if (recipientId) {
            const blockStatus = await getBlockStatusBetween(userId, recipientId);
            if (blockStatus.blockedBy) {
                return res.status(403).json({ message: 'Вы не можете написать: пользователь ограничил круг лиц' });
            }
            if (blockStatus.blocked) {
                return res.status(403).json({ message: 'Вы добавили пользователя в черный список' });
            }
        }

        // Добавляем информацию о файле в базу данных (сообщение может быть пустым)
        const [result] = await db.query(
            `INSERT INTO messages (chat_id, user_id, message, media, file_name, file_size) VALUES (?, ?, ?, ?, ?, ?)`,
            [chatId, userId, '', mediaUrl, file.originalname, file.size]
        );

        const [userRows] = await db.query('SELECT username FROM users WHERE id = ?', [userId]);

        const recipientIds = participants.filter((id) => Number(id) !== Number(userId));

        const newMessage = {
            id: result.insertId,
            chat_id: chatId,
            user_id: userId,
            message: '',
            username: userRows[0].username,
            media: mediaUrl,
            file_name: file.originalname,
            file_path: mediaUrl,
            file_size: file.size,
            file_type: file.mimetype,
            created_at: new Date(),
            read: false,
            recipientIds,
        };

        notifyClients({ type: 'NEW_MESSAGE', data: newMessage });
        await notifyOfflineUsersByEmail(
            recipientIds,
            'Новый файл в личном чате IT-BIRD',
            `${newMessage.username} отправил файл: ${file.originalname}`
        );

        res.status(201).json(newMessage);
    } catch (error) {
        console.error('Ошибка при загрузке файла:', error);
        res.status(500).json({ message: 'Ошибка при загрузке файла' });
    }
});

// Полное удаление сообщения
app.delete('/messages/:messageId', verifyToken, async (req, res) => {
    const { messageId } = req.params;
    const userId = req.user.id;

    try {
        // Проверяем, что сообщение принадлежит пользователю
        const [messageData] = await db.query(
            'SELECT * FROM messages WHERE id = ? AND user_id = ?',
            [messageId, userId]
        );

        if (messageData.length === 0) {
            return res.status(403).json({ message: 'Нет прав на удаление этого сообщения' });
        }

        // Полностью удаляем сообщение
        await db.query('DELETE FROM messages WHERE id = ?', [messageId]);

        // Уведомляем клиентов об удалении сообщения
        notifyClients({
            type: 'DELETE_MESSAGE',
            data: {
                messageId: parseInt(messageId),
                chatId: messageData[0].chat_id
            }
        });

        res.status(200).json({ message: 'Сообщение удалено' });
    } catch (error) {
        console.error('Ошибка при удалении сообщения:', error);
        res.status(500).json({ message: 'Ошибка при удалении сообщения' });
    }
});

// Групповые чаты

// Создание группового чата
app.post('/group-chats', verifyToken, async (req, res) => {
    const { name, description, memberIds } = req.body;
    const creatorId = req.user.id;

    if (!name || !memberIds || !Array.isArray(memberIds)) {
        return res.status(400).json({ message: 'Необходимо указать название чата и участников' });
    }

    try {
        // Проверяем, что все участники являются друзьями создателя
        const [friends] = await db.query(
            `SELECT friend_id FROM friends 
            WHERE user_id = ? AND friend_id IN (?) AND status = 'accepted'`,
            [creatorId, memberIds]
        );

        // Создаем групповой чат
        const [chatResult] = await db.query(
            `INSERT INTO group_chats (name, description, creator_id) VALUES (?, ?, ?)`,
            [name, description, creatorId]
        );

        const groupChatId = chatResult.insertId;

        // Добавляем создателя как админа
        await db.query(
            `INSERT INTO group_chat_members (group_chat_id, user_id, role) VALUES (?, ?, 'admin')`,
            [groupChatId, creatorId]
        );

        // Добавляем участников
        const memberValues = memberIds.map(userId => [groupChatId, userId]);
        await db.query(
            `INSERT INTO group_chat_members (group_chat_id, user_id) VALUES ?`,
            [memberValues]
        );

        // Получаем данные о созданном чате
        const [groupChat] = await db.query(
            `SELECT gc.*, u.username as creator_username 
            FROM group_chats gc
            JOIN users u ON gc.creator_id = u.id
            WHERE gc.id = ?`,
            [groupChatId]
        );

        notifyClients({
            type: 'NEW_GROUP_CHAT',
            data: {
                chat: groupChat[0],
                memberIds: [creatorId, ...memberIds],
            }
        });

        res.status(201).json(groupChat[0]);
    } catch (error) {
        console.error('Ошибка при создании группового чата:', error);
        res.status(500).json({ message: 'Ошибка при создании группового чата' });
    }
});

// Получение групповых чатов пользователя
app.get('/group-chats', verifyToken, async (req, res) => {
    const userId = req.user.id;

    try {
        const [groupChats] = await db.query(
            `SELECT gc.*, u.username as creator_username 
            FROM group_chat_members gcm
            JOIN group_chats gc ON gcm.group_chat_id = gc.id
            JOIN users u ON gc.creator_id = u.id
            WHERE gcm.user_id = ?`,
            [userId]
        );

        res.json(groupChats);
    } catch (error) {
        console.error('Ошибка при получении групповых чатов:', error);
        res.status(500).json({ message: 'Ошибка при получении групповых чатов' });
    }
});

// Получение участников группового чата
app.get('/group-chats/:chatId/members', verifyToken, async (req, res) => {
    const { chatId } = req.params;
    const userId = req.user.id;

    try {
        // Проверяем, что пользователь является участником чата
        const [isMember] = await db.query(
            `SELECT 1 FROM group_chat_members 
            WHERE group_chat_id = ? AND user_id = ?`,
            [chatId, userId]
        );

        if (isMember.length === 0) {
            return res.status(403).json({ message: 'Вы не участник этого чата' });
        }

        const [members] = await db.query(
            `SELECT u.id, u.username, u.user_tag, u.avatar, gcm.role, gcm.joined_at
            FROM group_chat_members gcm
            JOIN users u ON gcm.user_id = u.id
            WHERE gcm.group_chat_id = ?`,
            [chatId]
        );

        res.json(members);
    } catch (error) {
        console.error('Ошибка при получении участников чата:', error);
        res.status(500).json({ message: 'Ошибка при получении участников чата' });
    }
});

// Добавление участников в групповой чат
app.post('/group-chats/:chatId/members', verifyToken, async (req, res) => {
    const { chatId } = req.params;
    const { memberIds } = req.body;
    const userId = req.user.id;

    if (!memberIds || !Array.isArray(memberIds)) {
        return res.status(400).json({ message: 'Необходимо указать участников' });
    }

    try {
        // Проверяем, что пользователь является создателем чата
        const [isCreator] = await db.query(
            `SELECT 1 FROM group_chats 
            WHERE id = ? AND creator_id = ?`,
            [chatId, userId]
        );

        if (isCreator.length === 0) {
            return res.status(403).json({ message: 'Только создатель может добавлять участников' });
        }

        // Проверяем, что все добавляемые пользователи являются друзьями
        const [friends] = await db.query(
            `(SELECT friend_id as id FROM friends 
             WHERE user_id = ? AND friend_id IN (?) AND status = 'accepted')
            UNION
            (SELECT user_id as id FROM friends 
             WHERE friend_id = ? AND user_id IN (?) AND status = 'accepted')`,
            [userId, memberIds, userId, memberIds]
        );

        // Проверка количества
        const friendIds = friends.map(f => f.id);
        const invalidIds = memberIds.filter(id => !friendIds.includes(id));
        
        if (invalidIds.length > 0) {
            return res.status(400).json({ 
                message: `Эти пользователи не являются друзьями: ${invalidIds.join(', ')}`
            });
        }

        // if (friends.length !== memberIds.length) {
        //     return res.status(400).json({ message: 'Не все указанные пользователи являются вашими друзьями' });
        // }

        // Проверяем, что пользователи еще не в чате
        const [existingMembers] = await db.query(
            `SELECT user_id FROM group_chat_members 
            WHERE group_chat_id = ? AND user_id IN (?)`,
            [chatId, memberIds]
        );

        if (existingMembers.length > 0) {
            return res.status(400).json({ message: 'Некоторые пользователи уже в чате' });
        }

        // Добавляем участников
        const memberValues = memberIds.map(memberId => [chatId, memberId]);
        await db.query(
            `INSERT INTO group_chat_members (group_chat_id, user_id) VALUES ?`,
            [memberValues]
        );

        const [groupChat] = await db.query(
            `SELECT gc.*, u.username as creator_username
            FROM group_chats gc
            JOIN users u ON gc.creator_id = u.id
            WHERE gc.id = ?`,
            [chatId]
        );

        // Отправляем уведомления новым участникам
        notifyClients({
            type: 'NEW_GROUP_MEMBER',
            data: {
                chatId: parseInt(chatId),
                memberIds,
                chat: groupChat[0]
            }
        });

        res.status(201).json({ message: 'Участники успешно добавлены' });
    } catch (error) {
        console.error('Ошибка добавления участников:', error);
        res.status(500).json({ message: 'Ошибка при добавлении участников' });
    }
});

app.delete('/group-chats/:chatId', verifyToken, async (req, res) => {
    const { chatId } = req.params;
    const userId = req.user.id;

    try {
        const [chatRows] = await db.query('SELECT * FROM group_chats WHERE id = ? AND creator_id = ?', [chatId, userId]);
        if (chatRows.length === 0) {
            return res.status(403).json({ message: 'Только создатель может удалить группу' });
        }

        const [memberRows] = await db.query('SELECT user_id FROM group_chat_members WHERE group_chat_id = ?', [chatId]);
        const memberIds = memberRows.map((member) => member.user_id);

        await db.query('DELETE FROM group_chat_clears WHERE group_chat_id = ?', [chatId]);
        await db.query('DELETE FROM group_chat_messages WHERE group_chat_id = ?', [chatId]);
        await db.query('DELETE FROM group_chat_members WHERE group_chat_id = ?', [chatId]);
        await db.query('DELETE FROM group_chats WHERE id = ?', [chatId]);

        notifyClients({ type: 'GROUP_CHAT_DELETED', data: { chatId: Number(chatId), memberIds } });
        res.json({ message: 'Группа удалена' });
    } catch (error) {
        console.error('Delete group chat error:', error);
        res.status(500).json({ message: 'Ошибка удаления группы' });
    }
});

app.delete('/group-chats/:chatId/leave', verifyToken, async (req, res) => {
    const { chatId } = req.params;
    const userId = req.user.id;

    try {
        const [chatRows] = await db.query('SELECT creator_id FROM group_chats WHERE id = ?', [chatId]);
        if (chatRows.length === 0) return res.status(404).json({ message: 'Группа не найдена' });
        if (Number(chatRows[0].creator_id) === Number(userId)) {
            return res.status(400).json({ message: 'Создатель может удалить группу целиком' });
        }

        const [memberRows] = await db.query('SELECT 1 FROM group_chat_members WHERE group_chat_id = ? AND user_id = ?', [chatId, userId]);
        if (memberRows.length === 0) return res.status(403).json({ message: 'Вы не участник этой группы' });

        await db.query('DELETE FROM group_chat_members WHERE group_chat_id = ? AND user_id = ?', [chatId, userId]);
        await db.query('DELETE FROM group_chat_clears WHERE group_chat_id = ? AND user_id = ?', [chatId, userId]);

        notifyClients({ type: 'GROUP_MEMBER_REMOVED', data: { chatId: Number(chatId), memberId: userId, left: true } });
        res.json({ message: 'Вы вышли из группы' });
    } catch (error) {
        console.error('Leave group chat error:', error);
        res.status(500).json({ message: 'Ошибка выхода из группы' });
    }
});

app.delete('/group-chats/:chatId/members/:memberId', verifyToken, async (req, res) => {
    const { chatId, memberId } = req.params;
    const userId = req.user.id;

    try {
        const [chatRows] = await db.query('SELECT creator_id FROM group_chats WHERE id = ?', [chatId]);
        if (chatRows.length === 0) return res.status(404).json({ message: 'Группа не найдена' });
        if (Number(chatRows[0].creator_id) !== Number(userId)) {
            return res.status(403).json({ message: 'Только создатель может исключать участников' });
        }
        if (Number(memberId) === Number(userId)) {
            return res.status(400).json({ message: 'Создатель не может исключить себя' });
        }

        await db.query('DELETE FROM group_chat_members WHERE group_chat_id = ? AND user_id = ?', [chatId, memberId]);
        await db.query('DELETE FROM group_chat_clears WHERE group_chat_id = ? AND user_id = ?', [chatId, memberId]);

        notifyClients({ type: 'GROUP_MEMBER_REMOVED', data: { chatId: Number(chatId), memberId: Number(memberId), kicked: true } });
        res.json({ message: 'Участник исключен' });
    } catch (error) {
        console.error('Remove group member error:', error);
        res.status(500).json({ message: 'Ошибка исключения участника' });
    }
});

app.post('/group-chats/:chatId/clear', verifyToken, async (req, res) => {
    const { chatId } = req.params;
    const userId = req.user.id;

    try {
        const [isMember] = await db.query(
            'SELECT 1 FROM group_chat_members WHERE group_chat_id = ? AND user_id = ?',
            [chatId, userId]
        );
        if (isMember.length === 0) {
            return res.status(403).json({ message: 'Вы не участник этой группы' });
        }

        await db.query(
            `INSERT INTO group_chat_clears (user_id, group_chat_id, cleared_at)
            VALUES (?, ?, NOW())
            ON DUPLICATE KEY UPDATE cleared_at = NOW()`,
            [userId, chatId]
        );

        res.json({ message: 'Групповой чат очищен' });
    } catch (error) {
        console.error('Clear group chat error:', error);
        res.status(500).json({ message: 'Ошибка очистки группового чата' });
    }
});

// Отправка сообщения в групповой чат
app.post('/group-chats/:chatId/messages', verifyToken, async (req, res) => {
    const { chatId } = req.params;
    const { message } = req.body;
    const userId = req.user.id;

    try {
        // Проверяем, что пользователь является участником чата
        const [isMember] = await db.query(
            `SELECT 1 FROM group_chat_members 
            WHERE group_chat_id = ? AND user_id = ?`,
            [chatId, userId]
        );

        if (isMember.length === 0) {
            return res.status(403).json({ message: 'Вы не участник этого чата' });
        }

        // Сохраняем сообщение
        const [result] = await db.query(
            `INSERT INTO group_chat_messages (group_chat_id, user_id, message) 
            VALUES (?, ?, ?)`,
            [chatId, userId, message]
        );

        // Получаем данные о сообщении
        const [newMessage] = await db.query(
            `SELECT gcm.*, u.username 
            FROM group_chat_messages gcm
            JOIN users u ON gcm.user_id = u.id
            WHERE gcm.id = ?`,
            [result.insertId]
        );

        const [members] = await db.query(
            `SELECT user_id FROM group_chat_members WHERE group_chat_id = ? AND user_id != ?`,
            [chatId, userId]
        );
        const recipientIds = members.map((member) => member.user_id);
        const mentionRecipientIds = await resolveGroupMentionRecipients(chatId, message, userId);

        // Отправляем уведомление другим участникам
        notifyClients({
            type: 'NEW_GROUP_MESSAGE',
            data: { ...newMessage[0], recipientIds, mentionRecipientIds }
        });

        if (mentionRecipientIds.length > 0) {
            notifyClients({
                type: 'GROUP_MENTION',
                data: {
                    ...newMessage[0],
                    recipientIds: mentionRecipientIds,
                    mentionEveryone: /@everyone\b/i.test(message),
                }
            });
            await notifyOfflineUsersByEmail(
                mentionRecipientIds,
                /@everyone\b/i.test(message) ? 'Вас упомянули через @everyone в IT-BIRD' : 'Вас упомянули в IT-BIRD',
                `${newMessage[0].username} упомянул вас в групповом чате: ${message}`
            );
        }

        res.status(201).json(newMessage[0]);
    } catch (error) {
        console.error('Ошибка при отправке сообщения:', error);
        res.status(500).json({ message: 'Ошибка при отправке сообщения' });
    }
});

// Получение сообщений группового чата
app.get('/group-chats/:chatId/messages', verifyToken, async (req, res) => {
    const { chatId } = req.params;
    const userId = req.user.id;

    try {
        // Проверяем, что пользователь является участником чата
        const [isMember] = await db.query(
            `SELECT 1 FROM group_chat_members 
            WHERE group_chat_id = ? AND user_id = ?`,
            [chatId, userId]
        );

        if (isMember.length === 0) {
            return res.status(403).json({ message: 'Вы не участник этого чата' });
        }

        const [messages] = await db.query(
            `SELECT gcm.*, u.username, u.avatar, IF(gmp.id IS NULL, 0, 1) AS self_pinned
            FROM group_chat_messages gcm
            JOIN users u ON gcm.user_id = u.id
            LEFT JOIN group_chat_clears gcc ON gcc.group_chat_id = gcm.group_chat_id AND gcc.user_id = ?
            LEFT JOIN group_message_pins gmp ON gmp.message_id = gcm.id AND gmp.user_id = ?
            WHERE gcm.group_chat_id = ?
              AND (gcc.cleared_at IS NULL OR gcm.created_at > gcc.cleared_at)
            ORDER BY (gcm.is_pinned OR self_pinned) DESC, gcm.pinned_at DESC, gmp.created_at DESC, gcm.created_at`,
            [userId, userId, chatId]
        );

        res.json(messages);
    } catch (error) {
        console.error('Ошибка при получении сообщений:', error);
        res.status(500).json({ message: 'Ошибка при получении сообщений' });
    }
});

app.patch('/group-messages/:messageId/pin', verifyToken, async (req, res) => {
    const { messageId } = req.params;
    const userId = req.user.id;

    try {
        const [rows] = await db.query('SELECT * FROM group_chat_messages WHERE id = ?', [messageId]);
        if (rows.length === 0) return res.status(404).json({ message: 'Сообщение не найдено' });

        const [isMember] = await db.query(
            'SELECT 1 FROM group_chat_members WHERE group_chat_id = ? AND user_id = ?',
            [rows[0].group_chat_id, userId]
        );
        if (isMember.length === 0) return res.status(403).json({ message: 'Вы не участник этой группы' });

        await db.query(
            'UPDATE group_chat_messages SET is_pinned = TRUE, pinned_at = NOW(), pinned_by = ? WHERE id = ?',
            [userId, messageId]
        );
        const [updated] = await db.query(
            'SELECT gcm.*, u.username, u.avatar FROM group_chat_messages gcm JOIN users u ON gcm.user_id = u.id WHERE gcm.id = ?',
            [messageId]
        );
        notifyClients({ type: 'PIN_GROUP_MESSAGE', data: updated[0] });
        res.json(updated[0]);
    } catch (error) {
        console.error('Pin group message error:', error);
        res.status(500).json({ message: 'Ошибка закрепления сообщения' });
    }
});

app.patch('/group-messages/:messageId/pin-self', verifyToken, async (req, res) => {
    const { messageId } = req.params;
    const userId = req.user.id;

    try {
        const [rows] = await db.query('SELECT * FROM group_chat_messages WHERE id = ?', [messageId]);
        if (rows.length === 0) return res.status(404).json({ message: 'Сообщение не найдено' });

        const [isMember] = await db.query(
            'SELECT 1 FROM group_chat_members WHERE group_chat_id = ? AND user_id = ?',
            [rows[0].group_chat_id, userId]
        );
        if (isMember.length === 0) return res.status(403).json({ message: 'Вы не участник этой группы' });

        await db.query(
            'INSERT IGNORE INTO group_message_pins (user_id, message_id) VALUES (?, ?)',
            [userId, messageId]
        );

        const [updated] = await db.query(
            `SELECT gcm.*, u.username, u.avatar, IF(gmp.id IS NULL, 0, 1) AS self_pinned
            FROM group_chat_messages gcm
            JOIN users u ON gcm.user_id = u.id
            LEFT JOIN group_message_pins gmp ON gmp.message_id = gcm.id AND gmp.user_id = ?
            WHERE gcm.id = ?`,
            [userId, messageId]
        );
        res.json(updated[0]);
    } catch (error) {
        console.error('Pin group message for self error:', error);
        res.status(500).json({ message: 'Ошибка закрепления сообщения' });
    }
});

app.patch('/group-messages/:messageId/unpin', verifyToken, async (req, res) => {
    const { messageId } = req.params;
    const userId = req.user.id;

    try {
        const [rows] = await db.query('SELECT * FROM group_chat_messages WHERE id = ?', [messageId]);
        if (rows.length === 0) return res.status(404).json({ message: 'Сообщение не найдено' });

        const [isMember] = await db.query(
            'SELECT 1 FROM group_chat_members WHERE group_chat_id = ? AND user_id = ?',
            [rows[0].group_chat_id, userId]
        );
        if (isMember.length === 0) return res.status(403).json({ message: 'Вы не участник этой группы' });

        await db.query(
            'UPDATE group_chat_messages SET is_pinned = FALSE, pinned_at = NULL, pinned_by = NULL WHERE id = ?',
            [messageId]
        );
        const [updated] = await db.query(
            'SELECT gcm.*, u.username, u.avatar FROM group_chat_messages gcm JOIN users u ON gcm.user_id = u.id WHERE gcm.id = ?',
            [messageId]
        );
        notifyClients({ type: 'PIN_GROUP_MESSAGE', data: updated[0] });
        res.json(updated[0]);
    } catch (error) {
        console.error('Unpin group message error:', error);
        res.status(500).json({ message: 'Ошибка открепления сообщения' });
    }
});

app.patch('/group-messages/:messageId/unpin-self', verifyToken, async (req, res) => {
    const { messageId } = req.params;
    const userId = req.user.id;

    try {
        const [rows] = await db.query('SELECT * FROM group_chat_messages WHERE id = ?', [messageId]);
        if (rows.length === 0) return res.status(404).json({ message: 'Сообщение не найдено' });

        const [isMember] = await db.query(
            'SELECT 1 FROM group_chat_members WHERE group_chat_id = ? AND user_id = ?',
            [rows[0].group_chat_id, userId]
        );
        if (isMember.length === 0) return res.status(403).json({ message: 'Вы не участник этой группы' });

        await db.query(
            'DELETE FROM group_message_pins WHERE user_id = ? AND message_id = ?',
            [userId, messageId]
        );

        const [updated] = await db.query(
            `SELECT gcm.*, u.username, u.avatar, IF(gmp.id IS NULL, 0, 1) AS self_pinned
            FROM group_chat_messages gcm
            JOIN users u ON gcm.user_id = u.id
            LEFT JOIN group_message_pins gmp ON gmp.message_id = gcm.id AND gmp.user_id = ?
            WHERE gcm.id = ?`,
            [userId, messageId]
        );
        res.json(updated[0]);
    } catch (error) {
        console.error('Unpin group message for self error:', error);
        res.status(500).json({ message: 'Ошибка открепления сообщения' });
    }
});

// Загрузка файлов в групповой чат
app.post('/group-chats/:chatId/upload', verifyToken, upload.single('media'), async (req, res) => {
    const { chatId } = req.params;
    const userId = req.user.id;
    const file = req.file;
    const messageText = (req.body.message || '').trim();

    if (!file) {
        return res.status(400).json({ message: "Файл не прикреплён" });
    }

    try {
        // Проверяем, что пользователь является участником чата
        const [isMember] = await db.query(
            `SELECT 1 FROM group_chat_members 
            WHERE group_chat_id = ? AND user_id = ?`,
            [chatId, userId]
        );

        if (isMember.length === 0) {
            return res.status(403).json({ message: 'Вы не участник этого чата' });
        }

        // Формируем путь к файлу
        const mediaUrl = `/uploads/${path.basename(file.path)}`;

        // Добавляем информацию о файле в базу данных
        const [result] = await db.query(
            `INSERT INTO group_chat_messages 
            (group_chat_id, user_id, message, media, file_name, file_size) 
            VALUES (?, ?, ?, ?, ?, ?)`,
            [chatId, userId, messageText, mediaUrl, file.originalname, file.size]
        );

        const [userRows] = await db.query('SELECT username FROM users WHERE id = ?', [userId]);

        const [members] = await db.query(
            `SELECT user_id FROM group_chat_members WHERE group_chat_id = ? AND user_id != ?`,
            [chatId, userId]
        );
        const recipientIds = members.map((member) => member.user_id);

        const newMessage = {
            id: result.insertId,
            group_chat_id: parseInt(chatId),
            user_id: userId,
            message: messageText,
            username: userRows[0].username,
            media: mediaUrl,
            file_name: file.originalname,
            file_path: mediaUrl,
            file_size: file.size,
            created_at: new Date(),
            recipientIds,
            mentionRecipientIds,
        };

        // Отправляем уведомление другим участникам
        notifyClients({
            type: 'NEW_GROUP_MESSAGE',
            data: newMessage
        });

        if (mentionRecipientIds.length > 0) {
            notifyClients({
                type: 'GROUP_MENTION',
                data: {
                    ...newMessage,
                    recipientIds: mentionRecipientIds,
                    mentionEveryone: /@everyone\b/i.test(messageText),
                }
            });
            await notifyOfflineUsersByEmail(
                mentionRecipientIds,
                /@everyone\b/i.test(messageText) ? 'Вас упомянули через @everyone в IT-BIRD' : 'Вас упомянули в IT-BIRD',
                `${newMessage.username} упомянул вас в групповом чате: ${messageText || file.originalname}`
            );
        }

        res.status(201).json(newMessage);
    } catch (error) {
        console.error('Ошибка при загрузке файла:', error);
        res.status(500).json({ message: 'Ошибка при загрузке файла' });
    }
});

// Удаление сообщения
app.put('/group-messages/:messageId', verifyToken, async (req, res) => {
    const { messageId } = req.params;
    const userId = req.user.id;
    const { message } = req.body;

    try {
        // 1. Проверяем, что сообщение существует и принадлежит пользователю
        const [messageRow] = await db.query(
            `SELECT * FROM group_chat_messages 
            WHERE id = ? AND user_id = ?`,
            [messageId, userId]
        );

        if (messageRow.length === 0) {
            return res.status(404).json({
                message: 'Сообщение не найдено или у вас нет прав на его изменение'
            });
        }

        // 2. Обновляем сообщение
        await db.query(
            `UPDATE group_chat_messages 
            SET message = ?, media = NULL, is_deleted = TRUE 
            WHERE id = ?`,
            [message, messageId]
        );

        // 3. Отправляем уведомление другим участникам чата
        notifyClients({
            type: 'UPDATE_GROUP_MESSAGE',
            data: {
                messageId: parseInt(messageId),
                newMessage: message,
                groupChatId: messageRow[0].group_chat_id
            }
        });

        res.status(200).json({ message: 'Сообщение успешно обновлено' });
    } catch (error) {
        console.error('Ошибка при обновлении сообщения:', error);
        res.status(500).json({ message: 'Ошибка при обновлении сообщения' });
    }
});

// Удаление сообщения из группового чата
app.delete('/group-messages/:messageId', verifyToken, async (req, res) => {
    const { messageId } = req.params;
    const userId = req.user.id;

    try {
        // 1. Проверяем, что сообщение существует и принадлежит пользователю
        const [message] = await db.query(
            `SELECT * FROM group_chat_messages 
            WHERE id = ? AND user_id = ?`,
            [messageId, userId]
        );

        if (message.length === 0) {
            return res.status(404).json({
                message: 'Сообщение не найдено или у вас нет прав на его удаление'
            });
        }

        // 2. Удаляем сообщение
        await db.query(
            `DELETE FROM group_chat_messages WHERE id = ?`,
            [messageId]
        );

        // 3. Отправляем уведомление другим участникам чата
        notifyClients({
            type: 'GROUP_MESSAGE_DELETED',
            data: {
                messageId: parseInt(messageId),
                groupChatId: message[0].group_chat_id
            }
        });

        res.status(200).json({ message: 'Сообщение успешно удалено' });
    } catch (error) {
        console.error('Ошибка при удалении сообщения:', error);
        res.status(500).json({ message: 'Ошибка при удалении сообщения' });
    }
});

app.post('/translate', verifyToken, async (req, res) => {
    const { text, target, transcription } = req.body;
    if (!text || !target) {
        return res.status(400).json({ message: 'text и target обязательны' });
    }

    try {
        const { data } = await axios.get('https://translate.googleapis.com/translate_a/single', {
            params: {
                client: 'gtx',
                sl: 'auto',
                tl: target,
                dt: transcription ? ['t', 'rm'] : 't',
                q: text,
            },
        });

        const translated = Array.isArray(data?.[0])
            ? data[0].map((part) => part[0]).join('')
            : text;
        const reading = transcription && Array.isArray(data?.[0])
            ? data[0]
                .map((part) => {
                    if (typeof part?.[3] === 'string') return part[3];
                    if (typeof part?.[2] === 'string' && part[2] !== text) return part[2];
                    return '';
                })
                .filter(Boolean)
                .join(' ')
                .trim()
            : '';

        res.json({ translated, transcription: transcription ? (reading || translated) : null });
    } catch (error) {
        console.error('Ошибка перевода:', error.message);
        res.status(502).json({ message: 'Не удалось перевести сообщение' });
    }
});

app.post('/chats/:chatId/clear', verifyToken, async (req, res) => {
    const { chatId } = req.params;
    const userId = req.user.id;

    try {
        const participants = await getChatParticipants(chatId);
        if (!participants || !isChatParticipant(participants, userId)) {
            return res.status(403).json({ message: 'Нет доступа к этому чату' });
        }

        await db.query(
            `INSERT INTO chat_clears (user_id, chat_id, cleared_at)
            VALUES (?, ?, NOW())
            ON DUPLICATE KEY UPDATE cleared_at = NOW()`,
            [userId, chatId]
        );

        res.json({ message: 'Чат очищен' });
    } catch (error) {
        console.error('Clear chat error:', error);
        res.status(500).json({ message: 'Ошибка очистки чата' });
    }
});

app.delete('/chats/:chatId/messages', verifyToken, async (req, res) => {
    const { chatId } = req.params;
    const userId = req.user.id;

    try {
        const participants = await getChatParticipants(chatId);
        if (!participants || !isChatParticipant(participants, userId)) {
            return res.status(403).json({ message: 'Нет доступа к этому чату' });
        }

        await db.query(
            `DELETE mp FROM message_pins mp
            JOIN messages m ON m.id = mp.message_id
            WHERE m.chat_id = ?`,
            [chatId]
        );
        await db.query('DELETE FROM chat_clears WHERE chat_id = ?', [chatId]);
        await db.query('DELETE FROM messages WHERE chat_id = ?', [chatId]);

        notifyClients({
            type: 'CLEAR_CHAT',
            data: {
                chatId: Number(chatId),
                clearedBy: userId,
                recipientIds: participants.filter((id) => Number(id) !== Number(userId)),
            },
        });

        res.json({ message: 'Чат очищен для всех' });
    } catch (error) {
        console.error('Clear chat for everyone error:', error);
        res.status(500).json({ message: 'Ошибка очистки чата для всех' });
    }
});

app.patch('/messages/:messageId/pin', verifyToken, async (req, res) => {
    const { messageId } = req.params;
    const userId = req.user.id;

    try {
        const [rows] = await db.query('SELECT * FROM messages WHERE id = ?', [messageId]);
        if (rows.length === 0) return res.status(404).json({ message: 'Сообщение не найдено' });

        const participants = await getChatParticipants(rows[0].chat_id);
        if (!participants || !isChatParticipant(participants, userId)) {
            return res.status(403).json({ message: 'Нет доступа к этому чату' });
        }

        await db.query(
            'UPDATE messages SET is_pinned = TRUE, pinned_at = NOW(), pinned_by = ? WHERE id = ?',
            [userId, messageId]
        );
        const [updated] = await db.query('SELECT m.*, u.username FROM messages m JOIN users u ON m.user_id = u.id WHERE m.id = ?', [messageId]);
        notifyClients({ type: 'PIN_MESSAGE', data: updated[0] });
        res.json(updated[0]);
    } catch (error) {
        console.error('Pin message error:', error);
        res.status(500).json({ message: 'Ошибка закрепления сообщения' });
    }
});

app.patch('/messages/:messageId/pin-self', verifyToken, async (req, res) => {
    const { messageId } = req.params;
    const userId = req.user.id;

    try {
        const [rows] = await db.query('SELECT * FROM messages WHERE id = ?', [messageId]);
        if (rows.length === 0) return res.status(404).json({ message: 'Сообщение не найдено' });

        const participants = await getChatParticipants(rows[0].chat_id);
        if (!participants || !isChatParticipant(participants, userId)) {
            return res.status(403).json({ message: 'Нет доступа к этому чату' });
        }

        await db.query(
            'INSERT IGNORE INTO message_pins (user_id, message_id) VALUES (?, ?)',
            [userId, messageId]
        );

        const [updated] = await db.query(
            `SELECT m.*, u.username, IF(mp.id IS NULL, 0, 1) AS self_pinned
            FROM messages m
            JOIN users u ON m.user_id = u.id
            LEFT JOIN message_pins mp ON mp.message_id = m.id AND mp.user_id = ?
            WHERE m.id = ?`,
            [userId, messageId]
        );
        res.json(updated[0]);
    } catch (error) {
        console.error('Pin message for self error:', error);
        res.status(500).json({ message: 'Ошибка закрепления сообщения' });
    }
});

app.patch('/messages/:messageId/unpin', verifyToken, async (req, res) => {
    const { messageId } = req.params;
    const userId = req.user.id;

    try {
        const [rows] = await db.query('SELECT * FROM messages WHERE id = ?', [messageId]);
        if (rows.length === 0) return res.status(404).json({ message: 'Сообщение не найдено' });

        const participants = await getChatParticipants(rows[0].chat_id);
        if (!participants || !isChatParticipant(participants, userId)) {
            return res.status(403).json({ message: 'Нет доступа к этому чату' });
        }

        await db.query(
            'UPDATE messages SET is_pinned = FALSE, pinned_at = NULL, pinned_by = NULL WHERE id = ?',
            [messageId]
        );
        const [updated] = await db.query('SELECT m.*, u.username FROM messages m JOIN users u ON m.user_id = u.id WHERE m.id = ?', [messageId]);
        notifyClients({ type: 'PIN_MESSAGE', data: updated[0] });
        res.json(updated[0]);
    } catch (error) {
        console.error('Unpin message error:', error);
        res.status(500).json({ message: 'Ошибка открепления сообщения' });
    }
});

app.patch('/messages/:messageId/unpin-self', verifyToken, async (req, res) => {
    const { messageId } = req.params;
    const userId = req.user.id;

    try {
        const [rows] = await db.query('SELECT * FROM messages WHERE id = ?', [messageId]);
        if (rows.length === 0) return res.status(404).json({ message: 'Сообщение не найдено' });

        const participants = await getChatParticipants(rows[0].chat_id);
        if (!participants || !isChatParticipant(participants, userId)) {
            return res.status(403).json({ message: 'Нет доступа к этому чату' });
        }

        await db.query(
            'DELETE FROM message_pins WHERE user_id = ? AND message_id = ?',
            [userId, messageId]
        );

        const [updated] = await db.query(
            `SELECT m.*, u.username, IF(mp.id IS NULL, 0, 1) AS self_pinned
            FROM messages m
            JOIN users u ON m.user_id = u.id
            LEFT JOIN message_pins mp ON mp.message_id = m.id AND mp.user_id = ?
            WHERE m.id = ?`,
            [userId, messageId]
        );
        res.json(updated[0]);
    } catch (error) {
        console.error('Unpin message for self error:', error);
        res.status(500).json({ message: 'Ошибка открепления сообщения' });
    }
});

//Администрирование
//Админ-маршрут - Получение списка всех пользователей
app.get('/admin/users', verifyToken, verifyAdmin, async (req, res) => {
    try {
        const [results] = await db.query(`
            SELECT id, username, email, role, isBlocked, reason_blocked 
            FROM users 
            WHERE role = 'user'
        `);
        res.status(200).json(results);
    } catch (err) {
        console.error('Ошибка при загрузке пользователей:', err);
        res.status(500).json({ message: 'Ошибка сервера' });
    }
});

// Блокировка с причиной и отправкой email
app.patch('/users/:id/block', verifyToken, verifyAdmin, async (req, res) => {
    const { id } = req.params;
    const { reason } = req.body;

    if (!reason || reason.trim().length === 0) {
        return res.status(400).json({ message: 'Причина блокировки обязательна' });
    }

    try {
        const [users] = await db.query("SELECT * FROM users WHERE id = ?", [id]);
        if (users.length === 0) {
            return res.status(404).json({ message: 'Пользователь не найден' });
        }
        const user = users[0];

        if (user.isBlocked === 'заблокирован') {
            return res.status(400).json({ message: 'Пользователь уже заблокирован' });
        }

        await db.query(
            "UPDATE users SET isBlocked = 'заблокирован', reason_blocked = ? WHERE id = ?",
            [reason, id]
        );

        // Отправка email уведомления
        try {
            const mailOptions = {
                from: '"Администрация сервиса IT-BIRD" <den4ik200518@mail.ru>',
                to: user.email,
                subject: 'Ваш аккаунт был заблокирован',
                text: `Ваш аккаунт был заблокирован по причине: ${reason}`,
                html: `
                    <div style="font-family: Arial, sans-serif; color: #333;">
                        <h2 style="color: #d9534f;">Уведомление о блокировке аккаунта</h2>
                        <p>Ваш аккаунт был заблокирован администратором.</p>
                        <p><strong>Причина:</strong> ${reason}</p>
                        <p>Если вы считаете, что это ошибка, пожалуйста, свяжитесь с поддержкой.</p>
                        <p style="margin-top: 20px; font-size: 12px; color: #999;">
                            Это автоматическое сообщение, пожалуйста, не отвечайте на него.
                        </p>
                    </div>
                `
            };

            await transporter.sendMail(mailOptions);
            console.log('Block notification email sent to:', user.email);
        } catch (emailError) {
            console.error('Ошибка при отправке email:', emailError);
            // Не прерываем выполнение, даже если email не отправился
        }

        res.status(200).json({ message: 'Пользователь заблокирован' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Ошибка при блокировке пользователя' });
    }
});

// Разблокировка и отправка email уведомления
app.patch('/users/:id/unblock', verifyToken, verifyAdmin, async (req, res) => {
    const { id } = req.params;

    try {
        const [users] = await db.query("SELECT * FROM users WHERE id = ?", [id]);
        if (users.length === 0) {
            return res.status(404).json({ message: 'Пользователь не найден' });
        }

        const user = users[0];

        if (user.isBlocked === 'активен') {
            return res.status(400).json({ message: 'Пользователь уже активен' });
        }

        await db.query(
            "UPDATE users SET isBlocked = 'активен', reason_blocked = NULL WHERE id = ?",
            [id]
        );

        // Отправка email уведомления о разблокировке
        try {
            const mailOptions = {
                from: '"Администрация сервиса IT-BIRD" <den4ik200518@mail.ru>',
                to: user.email,
                subject: 'Ваш аккаунт разблокирован',
                text: 'Ваш аккаунт был разблокирован администратором. Теперь вы снова можете пользоваться сервисом.',
                html: `
                    <div style="font-family: Arial, sans-serif; color: #333;">
                        <h2 style="color: #5cb85c;">Уведомление о разблокировке аккаунта</h2>
                        <p>Ваш аккаунт был разблокирован администратором.</p>
                        <p>Теперь вы снова можете пользоваться всеми возможностями сервиса.</p>
                        <p style="margin-top: 20px; font-size: 12px; color: #999;">
                            Это автоматическое сообщение, пожалуйста, не отвечайте на него.
                        </p>
                    </div>
                `
            };

            await transporter.sendMail(mailOptions);
            console.log('Unblock notification email sent to:', user.email);
        } catch (emailError) {
            console.error('Ошибка при отправке email:', emailError);
            // Не прерываем выполнение, даже если email не отправился
        }

        res.status(200).json({ message: 'Пользователь разблокирован' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Ошибка при разблокировке пользователя' });
    }
});

// Админ-маршрут - Изменение статуса новости 
app.patch('/admin/news/:id/status', verifyToken, verifyAdmin, async (req, res) => {
    const { status } = req.body;
    const newsId = req.params.id;

    if (!status || !['ожидание', 'принят', 'отклонен'].includes(status)) {
        return res.status(400).json({ message: 'Неверный статус' });
    }

    try {
        const [result] = await db.query('UPDATE news SET status = ? WHERE id = ?', [status, newsId]);
        if (result.affectedRows === 0) {
            return res.status(404).json({ message: 'Новость не найдена' });
        }
        res.json({ message: 'Статус новости обновлен' });
    } catch (err) {
        console.error('Ошибка при обновлении статуса новости:', err);
        res.status(500).json({ message: 'Ошибка сервера' });
    }
});

// Админ-маршрут - Изменение статуса поста
app.patch('/admin/posts/:id/status', verifyToken, verifyAdmin, async (req, res) => {
    const { status } = req.body;
    const postId = req.params.id;

    if (!status || !['ожидание', 'принят', 'отклонен'].includes(status)) {
        return res.status(400).json({ message: 'Неверный статус' });
    }

    try {
        const [result] = await db.query('UPDATE posts SET status = ? WHERE id = ?', [status, postId]);
        if (result.affectedRows === 0) {
            return res.status(404).json({ message: 'Пост не найден' });
        }
        res.json({ message: 'Статус поста обновлен' });
    } catch (err) {
        console.error('Ошибка при обновлении статуса поста:', err);
        res.status(500).json({ message: 'Ошибка сервера' });
    }
});

const hackathonsCache = {
    items: [],
    html: null,
    css: [],
    images: [],
    fetchedAt: 0,
    sourceSignature: null,
};
const HACKATHONS_CACHE_TTL_MS = 30 * 60 * 1000;

const mergeHackathonItems = (previousItems, nextItems) => {
    const previousByKey = new Map(
        previousItems.map((item) => [item.link || String(item.id), item])
    );

    const merged = [];
    for (const item of nextItems) {
        const key = item.link || String(item.id);
        const oldItem = previousByKey.get(key);
        merged.push({
            ...oldItem,
            ...item,
            cached_at: oldItem?.cached_at || new Date().toISOString(),
        });
        previousByKey.delete(key);
    }

    return [...merged, ...previousByKey.values()];
};

// Парсинг хакатанов с сайта hackathons.pro через парсинг HTML-кода
app.get('/hackathons', async (req, res) => {
    const now = Date.now();

    // Проверяем: если кеш свежий, сразу отдаем его
    if (hackathonsCache.items.length > 0 && (now - hackathonsCache.fetchedAt) < HACKATHONS_CACHE_TTL_MS) {
        return res.json({
            items: hackathonsCache.items,
            html: hackathonsCache.html,
            css: hackathonsCache.css,
            images: hackathonsCache.images,
            cached: true,
        });
    }

    // APP_FIX: hackathons-safe-browser
    let browser = null;

    try {
        browser = await puppeteer.launch({
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox'],
        });
        const page = await browser.newPage();
        await page.goto('https://hackathons.pro/', { waitUntil: 'networkidle2', timeout: 60000 });

        await page.evaluate(async () => {
            const distance = 100;
            const delay = 100;
            while (document.body.scrollHeight > window.scrollY + window.innerHeight) {
                window.scrollBy(0, distance);
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        });

        await page.evaluate(() => {
            const images = Array.from(document.querySelectorAll('img'));
            return Promise.all(images.map(img => {
                if (img.complete) return Promise.resolve();
                return new Promise(resolve => img.onload = resolve);
            }));
        });

        const htmlContent = await page.evaluate(() => {
            const block = document.querySelector('.js-feed.t-feed.t-feed_col');
            return block ? block.outerHTML : null;
        });

        const imageLinks = await page.evaluate(() => {
            const images = Array.from(document.querySelectorAll('.js-feed.t-feed.t-feed_col img'));
            const backgrounds = Array.from(document.querySelectorAll('.js-feed.t-feed.t-feed_col'));
            const imgLinks = images.map(img => img.dataset.src || img.src);
            const bgLinks = backgrounds.map(el => {
                const bgStyle = window.getComputedStyle(el).backgroundImage;
                return bgStyle && bgStyle !== 'none'
                    ? bgStyle.replace(/^url\(["']?/, '').replace(/["']?\)$/, '')
                    : null;
            });
            return [...imgLinks, ...bgLinks.filter(Boolean)];
        });

        const cssContent = await page.evaluate(() => {
            const styles = Array.from(document.querySelectorAll('link[rel="stylesheet"]'));
            return styles.map(style => style.href);
        });

        const hackathonItems = await page.evaluate(() => {
            const normalizeUrl = (url) => {
                if (!url) return '#';
                if (url.startsWith('//')) return `https:${url}`;
                if (url.startsWith('/')) return `https://hackathons.pro${url}`;
                return url;
            };

            return Array.from(document.querySelectorAll('.js-feed-post')).map((el, index) => {
                const titleEl = el.querySelector('.js-feed-post-title');
                const descEl = el.querySelector('.js-feed-post-descr');
                const imageEl = el.querySelector('.t-feed__post-bgimg');
                const linkEl = el.querySelector('.js-feed-post-title a');
                const backgroundImage = imageEl ? window.getComputedStyle(imageEl).backgroundImage : '';
                const image = backgroundImage && backgroundImage !== 'none'
                    ? backgroundImage.replace(/^url\(["']?/, '').replace(/["']?\)$/, '')
                    : '';

                return {
                    id: Number(el.getAttribute('data-post-uid')) || index + 1,
                    title: titleEl?.textContent?.trim() || 'Без названия',
                    description: descEl?.textContent?.trim() || 'Описание отсутствует',
                    image: normalizeUrl(image),
                    link: normalizeUrl(linkEl?.href || '#'),
                };
            }).filter((item) => item.title && item.link !== '#');
        });

        if (!htmlContent) {
            res.status(404).json({ message: 'Блок с хакатонами не найден.' });
        } else {
            const sourceSignature = crypto
                .createHash('sha1')
                .update(hackathonItems.map((item) => `${item.link}|${item.title}`).join('\n'))
                .digest('hex');

            if (hackathonsCache.items.length > 0 && hackathonsCache.sourceSignature === sourceSignature) {
                hackathonsCache.fetchedAt = now;
                return res.json({
                    items: hackathonsCache.items,
                    html: hackathonsCache.html,
                    css: hackathonsCache.css,
                    images: hackathonsCache.images,
                    cached: true,
                });
            }

            hackathonsCache.items = mergeHackathonItems(hackathonsCache.items, hackathonItems);
            hackathonsCache.html = htmlContent;
            hackathonsCache.css = cssContent;
            hackathonsCache.images = imageLinks;
            hackathonsCache.fetchedAt = now;
            hackathonsCache.sourceSignature = sourceSignature;

            res.json({
                items: hackathonsCache.items,
                html: hackathonsCache.html,
                css: hackathonsCache.css,
                images: hackathonsCache.images,
                cached: false,
            });
        }
    } catch (err) {
        console.error('Ошибка при парсинге:', err);
        if (hackathonsCache.items.length > 0) {
            return res.json({
                items: hackathonsCache.items,
                html: hackathonsCache.html,
                css: hackathonsCache.css,
                images: hackathonsCache.images,
                cached: true,
                stale: true,
            });
        }
        const browserUnavailable = /Could not find Chrome|Failed to launch|browser executable/i.test(String(err?.message || err));
        res.status(browserUnavailable ? 503 : 500).json({
            message: browserUnavailable
                ? 'Сервис хакатонов временно недоступен: браузер-парсер не установлен.'
                : 'Ошибка при загрузке данных',
            code: browserUnavailable ? 'HACKATHON_BROWSER_UNAVAILABLE' : 'HACKATHON_FETCH_FAILED',
        });
    } finally {
        if (browser) await browser.close().catch(() => undefined);
    }
});

// Получение репозиториев пользователя (заполняются и обновляются автоматически)
app.get('/repositories/:github_username', verifyToken, async (req, res) => {
    const { github_username } = req.params;

    try {
        const [users] = await db.query(
            'SELECT id FROM users WHERE github_username = ?',
            [github_username]
        );
        if (users.length === 0) {
            return res.status(404).json({ message: 'Пользователь с таким GitHub username не найден' });
        }

        const forceRefresh = req.query.refresh === '1' || req.query.refresh === 'true';
        const repositories = await getRepositoriesForUser(users[0].id, 'github', github_username, { forceRefresh });

        res.status(200).json(repositories);

    } catch (error) {
        console.error('Ошибка при получении репозиториев:', error);
        res.status(500).json({ message: 'Ошибка при получении репозиториев' });
    }
});


// Получение всех новостей
app.get("/news", async (req, res) => {
    try {
        if (newsCache.items && Date.now() - newsCache.fetchedAt < NEWS_CACHE_TTL_MS) {
            return res.status(200).json(newsCache.items);
        }

        const { data: html } = await axios.get('https://tproger.ru/', {
            headers: { 'User-Agent': 'IT-BIRD news parser/1.0' },
        });

        const sourceSignature = crypto.createHash('sha1')
            .update(html.slice(0, 250000))
            .digest('hex');

        if (
            newsCache.items &&
            newsCache.sourceSignature === sourceSignature &&
            Date.now() - newsCache.fetchedAt < NEWS_CACHE_TTL_MS
        ) {
            return res.status(200).json(newsCache.items);
        }

        const seen = new Set();
        const news = [];
        const articleRegex = /<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
        let match;

        const normalizeTprogerUrl = (url) => {
            if (!url) return null;
            const cleanUrl = url.replace(/&amp;/g, '&').trim();
            if (cleanUrl.startsWith('//')) return `https:${cleanUrl}`;
            if (cleanUrl.startsWith('/')) return `https://tproger.ru${cleanUrl}`;
            return cleanUrl;
        };

        const extractImageFromHtml = (pageHtml) => {
            const patterns = [
                /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i,
                /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i,
                /<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i,
                /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']twitter:image["']/i,
                /<img[^>]+(?:data-src|src)=["']([^"']+)["']/i,
                /background-image:\s*url\(["']?([^"')]+)["']?\)/i,
            ];

            for (const pattern of patterns) {
                const imageMatch = pageHtml.match(pattern);
                if (imageMatch?.[1]) return normalizeTprogerUrl(imageMatch[1]);
            }

            const srcSetMatch = pageHtml.match(/<img[^>]+srcset=["']([^"']+)["']/i);
            if (srcSetMatch?.[1]) {
                return normalizeTprogerUrl(srcSetMatch[1].split(',')[0].trim().split(/\s+/)[0]);
            }

            return null;
        };

        const fetchArticleImage = async (link, block) => {
            const imageFromBlock = extractImageFromHtml(block);
            if (imageFromBlock) return imageFromBlock;

            try {
                const { data: articleHtml } = await axios.get(link, {
                    headers: { 'User-Agent': 'IT-BIRD news parser/1.0' },
                    timeout: 8000,
                });
                return extractImageFromHtml(articleHtml);
            } catch (error) {
                console.warn('Не удалось загрузить изображение новости:', link, error.message);
                return null;
            }
        };

        while ((match = articleRegex.exec(html)) && news.length < 12) {
            const link = normalizeTprogerUrl(match[1]);
            const block = match[2];
            const title = block.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
            if (!title || title.length < 30 || seen.has(link) || !link.includes('tproger.ru')) continue;
            seen.add(link);
            news.push({
                id: news.length + 1,
                title,
                description: title,
                link,
                image_url: null,
                rawBlock: block,
                user: 'Tproger',
                created_at: new Date().toISOString(),
            });
        }

        await Promise.all(news.map(async (item) => {
            item.image_url = await fetchArticleImage(item.link, item.rawBlock);
            delete item.rawBlock;
        }));

        if (news.length > 0) {
            const previousByLink = new Map((newsCache.items || []).map((item) => [item.link, item.created_at]));
            news.forEach((item) => {
                item.created_at = previousByLink.get(item.link) || item.created_at;
            });
            newsCache.items = news;
            newsCache.fetchedAt = Date.now();
            newsCache.sourceSignature = sourceSignature;
            return res.status(200).json(news);
        }

        const [fallbackNews] = await db.query(`
            SELECT n.id, n.title, n.description, n.status, n.link, n.image_url, n.author_id, n.created_at, u.username AS user
            FROM news n
            JOIN users u ON n.author_id = u.id
            WHERE n.status = "принят"
            ORDER BY n.created_at DESC
        `);
        res.status(200).json(fallbackNews);
    } catch (error) {
        console.error("Ошибка при получении новостей:", error);
        res.status(500).json({ message: "Ошибка при получении новостей" });
    }
});

// Получение всех новостей для администраторов
app.get("/admin/news", verifyToken, verifyAdmin, async (req, res) => {
    console.log('Получен запрос на новости');
    try {
        const [news] = await db.query(`
            SELECT n.*, u.username AS user
            FROM news n
            JOIN users u ON n.author_id = u.id
            ORDER BY created_at DESC
        `);
        console.log('Новости получены:', news);
        res.status(200).json(news);
    } catch (error) {
        console.error("Ошибка при получении новостей:", error);
        res.status(500).json({ message: "Ошибка при получении новостей" });
    }
});

// Маршрут для добавления новости
app.post("/news", verifyToken, upload.single("file"), async (req, res) => {
    const { title, description, link } = req.body;
    const file = req.file;

    const authorId = req.user.id; // Извлекаем ID пользователя из токена
    const imageUrl = file ? `/uploads/news/${file.filename}` : null;

    try {
        await db.query(
            `INSERT INTO news (title, description, link, image_url, author_id, status, created_at)
            VALUES (?, ?, ?, ?, ?, 'ожидание', NOW())`,
            [title, description, link, imageUrl, authorId]
        );
        res.status(201).json({ message: "Новость добавлена!" });
    } catch (error) {
        console.error("Ошибка при добавлении новости:", error);
        res.status(500).json({ message: "Не удалось добавить новость." });
    }
});

// Удаление новостей
app.delete('/admin/news/:id', verifyToken, verifyAdmin, async (req, res) => {
    const { id } = req.params;
    try {
        const [result] = await db.query(`DELETE FROM news WHERE id = ?`, [id]);
        if (result.affectedRows > 0) {
            res.status(200).json({ message: 'Новость удалена успешно' });
        } else {
            res.status(404).json({ message: 'Новость не найдена' });
        }
    } catch (error) {
        console.error("Ошибка при удалении новости:", error);
        res.status(500).json({ message: 'Ошибка при удалении новости' });
    }
});

// Получение всех постов
app.get("/posts", async (req, res) => {
    try {
        const [posts] = await db.query(`
            SELECT p.id, p.title, p.description, p.status, p.image_url, p.attachment_url,
                p.attachment_name, p.attachment_size, p.attachment_type, p.code_content,
                p.code_language, p.author_id, p.created_at, u.username AS user
            FROM posts p
            JOIN users u ON p.author_id = u.id
            WHERE p.status = "принят"
            ORDER BY p.created_at DESC
        `);
        res.status(200).json(posts);
    } catch (error) {
        console.error("Ошибка при получении постов:", error);
        res.status(500).json({ message: "Ошибка при получении постов" });
    }
});

// Получение всех постов для администраторов
app.get("/admin/posts", verifyToken, verifyAdmin, async (req, res) => {
    try {
        const [posts] = await db.query(`
            SELECT p.*, u.username AS user
            FROM posts p
            JOIN users u ON p.author_id = u.id
            ORDER BY created_at DESC
        `);
        res.status(200).json(posts);
    } catch (error) {
        console.error("Ошибка при получении постов:", error);
        res.status(500).json({ message: "Ошибка при получении постов" });
    }
});

// Посты создание
app.post("/posts", verifyToken, upload.single("file"), async (req, res) => {
    const { title, description, code_content, code_language } = req.body;
    const file = req.file;

    const authorId = req.user.id; // Извлекаем ID пользователя из токена
    const attachmentUrl = file ? `/uploads/posts/${file.filename}` : null;
    const imageUrl = file && file.mimetype.startsWith('image/') ? attachmentUrl : null;
    const normalizedCode = typeof code_content === 'string' && code_content.trim() ? code_content : null;
    const normalizedLanguage = normalizedCode ? (code_language || 'javascript') : null;

    try {
        await db.query(
            `INSERT INTO posts (
                title, description, image_url, attachment_url, attachment_name,
                attachment_size, attachment_type, code_content, code_language,
                author_id, status, created_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ожидание', NOW())`,
            [
                title,
                description,
                imageUrl,
                attachmentUrl,
                file?.originalname || null,
                file?.size || null,
                file?.mimetype || null,
                normalizedCode,
                normalizedLanguage,
                authorId,
            ]
        );
        res.status(201).json({ message: "Пост создан!" });
    } catch (error) {
        console.error("Ошибка при добавлении новости:", error);
        res.status(500).json({ message: "Не удалось добавить новость." });
    }
});

// Удаление постов
app.delete('/admin/posts/:id', verifyToken, verifyAdmin, async (req, res) => {
    const { id } = req.params;
    try {
        const [result] = await db.query(`DELETE FROM posts WHERE id = ?`, [id]);
        if (result.affectedRows > 0) {
            res.status(200).json({ message: 'Пост успешно удален' });
        } else {
            res.status(404).json({ message: 'Пост не найден' });
        }
    } catch (error) {
        console.error("Ошибка при удалении поста:", error);
        res.status(500).json({ message: 'Ошибка при удалении поста' });
    }
});

// Получение всех вопросов на форуме
app.get("/forums", async (req, res) => {
    try {
        const [forums] = await db.query(`
            SELECT f.id, f.user_id, f.question AS title, f.description, f.created_at, f.status, u.username AS user
            FROM forums f
            JOIN users u ON f.user_id = u.id
            ORDER BY f.created_at DESC
        `);
        res.status(200).json(forums);
    } catch (error) {
        console.error("Ошибка при получении вопросов:", error);
        res.status(500).json({ message: "Ошибка при получении вопросов" });
    }
});

// Получение одного вопроса по ID
app.get("/forums/:id", async (req, res) => {
    const { id } = req.params;
    try {
        const [results] = await db.query(`
            SELECT f.id, f.user_id, f.question AS title, f.description, f.created_at, f.status, u.username AS user
            FROM forums f
            JOIN users u ON f.user_id = u.id
            WHERE f.id = ?
        `, [id]);

        if (results.length === 0) {
            return res.status(404).json({ message: "Вопрос не найден" });
        }

        res.status(200).json(results[0]);
    } catch (error) {
        console.error("Ошибка при получении вопроса:", error);
        res.status(500).json({ message: "Ошибка при получении вопроса" });
    }
});

// Добавление нового вопроса
app.post('/forums', verifyToken, async (req, res) => {
    const { title, description } = req.body;
    const user_id = req.user.id;  // Берем user_id из данных токена

    if (!user_id) {
        return res.status(400).json({ message: 'user_id обязателен' });
    }

    try {

        const [result] = await db.query(
            'INSERT INTO forums (question, description, user_id, created_at, status) VALUES (?, ?, ?, NOW(), ?)',
            [title, description, user_id, 'Открыт']
        );

        const [user] = await db.query('SELECT username FROM users WHERE id = ?', [user_id]);

        res.status(201).json({
            id: result.insertId,
            title,
            description,
            user: user[0].username,  // Возвращаем имя пользователя
            created_at: new Date(),
            status: 'Открыт',
            user_id,
        });
    } catch (error) {
        console.error('Ошибка при добавлении вопроса:', error);
        res.status(500).json({ message: 'Ошибка при добавлении вопроса' });
    }
});

// Получение ответов для вопроса
app.get("/forums/:id/answers", async (req, res) => {
    const { id } = req.params;
    try {
        const [answers] = await db.query(`
            SELECT a.id, a.answer, a.created_at, u.username AS user
            FROM forum_answers a
            JOIN users u ON a.user_id = u.id
            WHERE a.forum_id = ?
            ORDER BY a.created_at ASC
        `, [id]);
        res.status(200).json(answers);
    } catch (error) {
        console.error("Ошибка при получении ответов:", error);
        res.status(500).json({ message: "Ошибка при получении ответов" });
    }
});

// Добавление нового ответа
app.post("/forums/:id/answers", verifyToken, async (req, res) => {
    const { id } = req.params; // ID вопроса
    const { answer } = req.body;
    const userId = req.user.id;

    if (!answer) {
        return res.status(400).json({ message: "Ответ не может быть пустым." });
    }

    try {
        const [forumRows] = await db.query("SELECT id, question, user_id, status FROM forums WHERE id = ?", [id]);
        if (forumRows.length === 0) {
            return res.status(404).json({ message: "Вопрос не найден" });
        }
        if (forumRows[0].status === "\u0440\u0435\u0448\u0451\u043d") {
            return res.status(403).json({ message: "Вопрос уже решен, новые ответы закрыты" });
        }

        const [result] = await db.query(
            "INSERT INTO forum_answers (forum_id, user_id, answer, created_at) VALUES (?, ?, ?, ?)",
            [id, userId, answer, new Date()]
        );

        const [authorRows] = await db.query('SELECT username FROM users WHERE id = ?', [userId]);
        const forum = forumRows[0];
        const ownerId = Number(forum.user_id);
        const recipientIds = ownerId !== Number(userId) ? [ownerId] : [];

        const newAnswer = {
            id: result.insertId,
            forum_id: Number(id),
            user_id: userId,
            user: authorRows[0]?.username || 'Пользователь',
            answer,
            created_at: new Date(),
            forumTitle: forum.question,
            recipientIds,
        };

        if (recipientIds.length > 0) {
            notifyClients({
                type: 'NEW_FORUM_ANSWER',
                data: newAnswer,
            });
            await notifyOfflineUsersByEmail(
                recipientIds,
                'Новый ответ на ваш вопрос в IT-BIRD',
                `Форум\nВам пришёл ответ на ваш вопрос\nВопрос: ${forum.question}\n\n${newAnswer.user}: ${answer}`
            );
        }

        res.status(201).json(newAnswer);
    } catch (error) {
        console.error("Ошибка при добавлении ответа:", error);
        res.status(500).json({ message: "Ошибка сервера" });
    }
});


// Обновление статуса вопроса
app.put("/forums/:id/status", verifyToken, async (req, res) => {
    const { id } = req.params;
    const { status } = req.body;
    const userId = req.user.id;

    // Проверка, что статус допустимый
    if (status !== 'открыт' && status !== 'решён') {
        return res.status(400).json({ message: "Недопустимый статус." });
    }

    try {
        // Проверка, является ли пользователь автором вопроса или администратором
        const [questionOwner] = await db.query(
            'SELECT user_id FROM forums WHERE id = ?',
            [id]
        );

        if (!questionOwner.length) {
            return res.status(404).json({ message: "Вопрос не найден." });
        }

        // Проверка прав доступа (если это не администратор или автор вопроса)
        if (questionOwner[0].user_id !== userId && req.user.role !== 'admin') {
            return res.status(403).json({ message: "У вас нет прав для изменения статуса вопроса." });
        }

        // Обновляем статус
        const [result] = await db.query(
            "UPDATE forums SET status = ? WHERE id = ?",
            [status, id]
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({ message: "Вопрос не найден." });
        }

        // Получаем обновленные данные вопроса
        const [updatedQuestion] = await db.query(
            'SELECT id, question, description, status, user_id FROM forums WHERE id = ?',
            [id]
        );

        res.status(200).json(updatedQuestion[0]);
    } catch (error) {
        console.error("Ошибка при обновлении статуса:", error);
        res.status(500).json({ message: "Ошибка сервера" });
    }
});

app.delete("/forums/:id", verifyToken, verifyAdmin, async (req, res) => {
    const { id } = req.params;

    try {
        const [forumRows] = await db.query('SELECT id FROM forums WHERE id = ?', [id]);
        if (forumRows.length === 0) {
            return res.status(404).json({ message: "Вопрос не найден." });
        }

        const [answers] = await db.query('SELECT id FROM forum_answers WHERE forum_id = ?', [id]);
        const answerIds = answers.map((answer) => answer.id);
        if (answerIds.length > 0) {
            await db.query('DELETE FROM forum_answer_comments WHERE answer_id IN (?)', [answerIds]);
        }

        await db.query('DELETE FROM forum_answers WHERE forum_id = ?', [id]);
        await db.query('DELETE FROM forums WHERE id = ?', [id]);

        res.json({ message: "Вопрос удален" });
    } catch (error) {
        console.error("Ошибка удаления вопроса форума:", error);
        res.status(500).json({ message: "Ошибка сервера" });
    }
});

// Получение комментариев для ответа
app.get("/answers/:answerId/comments", async (req, res) => {
    const { answerId } = req.params;
    try {
        const [comments] = await db.query(`
            SELECT c.id, c.comment, c.created_at, c.updated_at, 
                u.username AS user, u.id AS user_id
            FROM forum_answer_comments c
            JOIN users u ON c.user_id = u.id
            WHERE c.answer_id = ? 
            ORDER BY c.created_at ASC
        `, [answerId]);
        res.status(200).json(comments);
    } catch (error) {
        console.error("Ошибка при получении комментариев:", error);
        res.status(500).json({ message: "Ошибка при получении комментариев" });
    }
});

// Добавление комментария к ответу
app.post("/answers/:answerId/comments", verifyToken, async (req, res) => {
    const { answerId } = req.params;
    const { comment } = req.body;
    const userId = req.user.id;

    if (!comment || comment.trim() === '') {
        return res.status(400).json({ message: "Комментарий не может быть пустым." });
    }

    try {
        // Проверяем существование ответа
        const [answer] = await db.query(
            "SELECT id FROM forum_answers WHERE id = ?",
            [answerId]
        );

        if (answer.length === 0) {
            return res.status(404).json({ message: "Ответ не найден" });
        }

        const [result] = await db.query(
            "INSERT INTO forum_answer_comments (answer_id, user_id, comment) VALUES (?, ?, ?)",
            [answerId, userId, comment.trim()]
        );

        const [newComment] = await db.query(`
            SELECT c.id, c.comment, c.created_at, u.username AS user
            FROM forum_answer_comments c
            JOIN users u ON c.user_id = u.id
            WHERE c.id = ?
        `, [result.insertId]);

        res.status(201).json(newComment[0]);
    } catch (error) {
        console.error("Ошибка при добавлении комментария:", error);
        res.status(500).json({ message: "Ошибка сервера" });
    }
});

// Старт сервера
// PRODUCTION_HARDENING: configurable-listen-address
const port = Number(process.env.PORT || 5000);
const host = process.env.HOST || '127.0.0.1';
server.listen(port, host, () => {
    console.log(`Server is running on http://${host}:${port}`);
});
