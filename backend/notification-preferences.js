const normalizeEmailNotificationsEnabled = (value, fallback = true) => {
    if (value === undefined || value === null || value === '') return Boolean(fallback);
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return value !== 0;

    const normalized = String(value).trim().toLowerCase();
    if (['1', 'true', 'on', 'yes', 'enabled'].includes(normalized)) return true;
    if (['0', 'false', 'off', 'no', 'disabled'].includes(normalized)) return false;
    return Boolean(fallback);
};

module.exports = { normalizeEmailNotificationsEnabled };
