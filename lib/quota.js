function clampFraction(v) {
    const n = Number(v);
    if (!Number.isFinite(n)) return 0;
    return Math.max(0, Math.min(1, n));
}

function normalizeTimestamp(ts) {
    if (!ts) return null;
    const n = Number(ts);
    if (!Number.isFinite(n) || n <= 0) return null;

    const nowSec = Math.floor(Date.now() / 1000);
    if (n > nowSec * 1000) return Math.floor(n); 
    if (n > 1e12) return Math.floor(n / 1000);
    return Math.floor(n);
}

function parseQuotaGroups(accFile) {
    if (!accFile || !accFile.quota) return [];
    const groups = accFile.quota.quota_groups;
    if (!Array.isArray(groups) || groups.length === 0) return [];
    return groups;
}

function parseBuckets(group) {
    if (!group || !Array.isArray(group.buckets)) return [];
    return group.buckets;
}

function formatQuotaDisplay(accFile, barFormatter) {
    const groups = parseQuotaGroups(accFile);
    if (groups.length === 0) return null;

    const lines = [];
    for (let gi = 0; gi < groups.length; gi++) {
        const group = groups[gi];
        const buckets = parseBuckets(group);
        if (buckets.length === 0) continue;

        if (groups.length > 1) lines.push(`       [Group ${gi + 1}]`);

        for (const b of buckets) {
            const name = (b.display_name || 'Unknown').padEnd(30);
            const fraction = clampFraction(b.remaining_fraction);
            const bar = barFormatter ? barFormatter(fraction) : String(fraction);
            const reset = b.description ? `  ${b.description}` : '';
            lines.push(`       ${name} ${bar}${reset}`);
        }
    }
    return lines.length > 0 ? lines : null;
}

module.exports = { clampFraction, normalizeTimestamp, parseQuotaGroups, parseBuckets, formatQuotaDisplay };
