const MANIFEST_URL = 'https://github.com/Denis18UKS/SocialNetworkForProfessionalInIT/releases/download/android-latest/SocialBIRD-Android-version.json';
const APK_URL = 'https://github.com/Denis18UKS/SocialNetworkForProfessionalInIT/releases/download/android-latest/SocialBIRD-Android.apk';
const CACHE_TTL_MS = 5 * 60 * 1000;

const registerAndroidVersion = ({ app }) => {
    let cache = null;
    let fetchedAt = 0;

    const fetchLatest = async () => {
        if (cache && Date.now() - fetchedAt < CACHE_TTL_MS) return cache;
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5000);
        try {
            const response = await fetch(MANIFEST_URL, {
                headers: { Accept: 'application/json' },
                redirect: 'follow',
                signal: controller.signal,
            });
            if (!response.ok) throw new Error(`manifest HTTP ${response.status}`);
            const data = await response.json();
            const versionCode = Number(data.versionCode || 0);
            const versionName = String(data.versionName || '').trim();
            if (!Number.isInteger(versionCode) || versionCode <= 0 || !versionName) {
                throw new Error('invalid Android version manifest');
            }
            cache = {
                available: true,
                versionCode,
                versionName,
                apkUrl: APK_URL,
                publishedAt: data.publishedAt || null,
                source: 'android-latest',
            };
            fetchedAt = Date.now();
            return cache;
        } finally {
            clearTimeout(timeout);
        }
    };

    app.get('/android/version', async (req, res) => {
        try {
            res.setHeader('Cache-Control', 'public, max-age=60');
            return res.json(await fetchLatest());
        } catch (error) {
            console.warn('Android version manifest unavailable:', error.message);
            if (cache) return res.json(cache);
            return res.status(503).json({
                available: false,
                message: 'Информация о последней версии Android-приложения временно недоступна.',
                apkUrl: APK_URL,
            });
        }
    });
};

module.exports = { registerAndroidVersion };
