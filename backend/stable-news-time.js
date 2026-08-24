const crypto = require('crypto');

const registerStableNewsTime = ({ app, getDb }) => {
    let schemaPromise = null;
    const ensureSchema = async () => {
        if (!schemaPromise) {
            schemaPromise = getDb().query(`CREATE TABLE IF NOT EXISTS news_first_seen (
                news_key CHAR(64) NOT NULL PRIMARY KEY,
                first_seen_at DATETIME NOT NULL,
                source_time DATETIME NULL,
                created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`).catch((error) => {
                schemaPromise = null;
                throw error;
            });
        }
        return schemaPromise;
    };

    const toMysqlDate = (date) => date.toISOString().slice(0, 19).replace('T', ' ');
    const stableKey = (item) => crypto.createHash('sha256').update(String(
        item?.id || item?.url || item?.link || item?.guid || `${item?.source || ''}|${item?.title || item?.name || ''}`
    )).digest('hex');
    const sourceDate = (item) => {
        const candidates = [item?.publishedAt, item?.published_at, item?.publication_date, item?.date, item?.created_at, item?.createdAt];
        for (const value of candidates) {
            if (!value) continue;
            const date = new Date(value);
            if (Number.isFinite(date.getTime()) && date.getTime() <= Date.now() + 5 * 60 * 1000) return date;
        }
        return null;
    };

    const stabilizeItems = async (items) => {
        if (!Array.isArray(items) || !items.length) return items;
        await ensureSchema();
        const db = getDb();
        const output = [];
        for (const item of items) {
            if (!item || typeof item !== 'object') { output.push(item); continue; }
            const key = stableKey(item);
            const candidate = sourceDate(item);
            const first = candidate || new Date();
            await db.query(`INSERT INTO news_first_seen (news_key, first_seen_at, source_time)
                VALUES (?, ?, ?)
                ON DUPLICATE KEY UPDATE news_key = VALUES(news_key)`, [key, toMysqlDate(first), candidate ? toMysqlDate(candidate) : null]);
            const [rows] = await db.query('SELECT first_seen_at, source_time FROM news_first_seen WHERE news_key = ? LIMIT 1', [key]);
            const stable = rows[0]?.source_time || rows[0]?.first_seen_at || first;
            const iso = new Date(stable).toISOString();
            output.push({
                ...item,
                publishedAt: iso,
                published_at: iso,
                created_at: iso,
                stablePublishedAt: iso,
            });
        }
        return output;
    };

    // Wrap only news-like API responses. The original scraper/API remains unchanged; only timestamps become immutable.
    app.use((req, res, next) => {
        const pathname = String(req.path || '').toLowerCase();
        if (req.method !== 'GET' || (!pathname.includes('news') && !pathname.includes('novosti'))) return next();
        const originalJson = res.json.bind(res);
        res.json = (payload) => {
            Promise.resolve().then(async () => {
                if (Array.isArray(payload)) return originalJson(await stabilizeItems(payload));
                if (payload && Array.isArray(payload.articles)) return originalJson({ ...payload, articles: await stabilizeItems(payload.articles) });
                if (payload && Array.isArray(payload.news)) return originalJson({ ...payload, news: await stabilizeItems(payload.news) });
                if (payload && Array.isArray(payload.items)) return originalJson({ ...payload, items: await stabilizeItems(payload.items) });
                return originalJson(payload);
            }).catch((error) => {
                console.warn('Stable news time fallback:', error.message);
                originalJson(payload);
            });
            return res;
        };
        next();
    });
};

module.exports = { registerStableNewsTime };
