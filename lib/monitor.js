const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { PROXY_LOGS_DB, findPython } = require('./platform');
const { loadIndex, removeAccounts, deleteAccountFile, saveIndex, countActive, countProxyActive } = require('./store');

const POLL_INTERVAL_MS = 5000;

function poll429(lastTs, modelFilter = '') {
    const python = findPython();
    if (!python) return [];

    const script = `
import sqlite3, json, sys
db = sys.argv[1]
ts = int(sys.argv[2])
model = sys.argv[3] if len(sys.argv) > 3 else ""
try:
    conn = sqlite3.connect(db)
    conn.text_factory = lambda b: b.decode("utf-8", errors="replace")
    cur = conn.cursor()
    if model:
        cur.execute("SELECT timestamp, account_email FROM request_logs WHERE status=429 AND timestamp>? AND model LIKE ? ORDER BY timestamp ASC", (ts, "%" + model + "%"))
    else:
        cur.execute("SELECT timestamp, account_email FROM request_logs WHERE status=429 AND timestamp>? ORDER BY timestamp ASC", (ts,))
    rows = cur.fetchall()
    conn.close()
    print(json.dumps(rows))
except Exception:
    print("[]")
`;

    try {
        const args = ['-c', script, PROXY_LOGS_DB, String(lastTs)];
        if (modelFilter) args.push(modelFilter);
        const out = execFileSync(python, args, { encoding: 'utf-8', timeout: 5000, shell: true });
        return JSON.parse(out.trim() || '[]');
    } catch (e) {
        console.log(`  ! [MONITOR] poll429 error: ${e.message}`);
        return [];
    }
}

function createMonitor(name, modelFilter, onMatch) {
    let watcher = null;
    let lastTs = 0;
    let processed = new Set();

    function start() {
        if (watcher) return;
        lastTs = 0;
        processed.clear();
        const modelStr = modelFilter ? ` (Filter: ${modelFilter})` : ' (Semua model)';
        console.log(`  ✔ [${name}] Monitor aktif — polling setiap ${POLL_INTERVAL_MS / 1000} detik${modelStr}`);

        watcher = setInterval(() => {
            const rows = poll429(lastTs, modelFilter);
            if (!rows.length) return;

            lastTs = Math.max(...rows.map(r => r[0]));
            const index = loadIndex();

            for (const [ts, email] of rows) {
                if (!email || processed.has(email)) continue;
                const acc = index.accounts.find(a => a.email === email);
                if (!acc) continue;

                processed.add(email);
                onMatch(acc, ts, index);
            }
        }, POLL_INTERVAL_MS);
    }

    function stop() {
        if (!watcher) return;
        clearInterval(watcher);
        watcher = null;
        lastTs = 0;
        processed.clear();
        console.log(`  ! [${name}] Monitor dihentikan.`);
    }

    function isActive() { return watcher !== null; }

    return { start, stop, isActive };
}

function createDeleteMonitor(modelFilter) {
    return createMonitor('AUTO-DELETE 429', modelFilter, (acc, ts, index) => {
        const timeStr = new Date(ts).toLocaleTimeString('id-ID', { hour12: false });
        console.log(`  ! [AUTO-DELETE 429] ${acc.email} kena 429 (${timeStr}) → menghapus...`);
        removeAccounts(index, [acc.id]);
        saveIndex(index);
        console.log(`  ✔ [AUTO-DELETE 429] ${acc.email} → dihapus. Sisa aktif: ${countActive(index)}`);
    });
}

function createDisableProxyMonitor(modelFilter) {
    return createMonitor('AUTO-DISABLE PROXY 429', modelFilter, (acc, ts, index) => {
        const timeStr = new Date(ts).toLocaleTimeString('id-ID', { hour12: false });
        console.log(`  ! [AUTO-DISABLE PROXY 429] ${acc.email} kena 429 (${timeStr}) → disable proxy...`);

        const file = path.join(require('./platform').ACCOUNTS_DIR, `${acc.id}.json`);
        try {
            const accData = JSON.parse(fs.readFileSync(file, 'utf-8'));
            accData.proxy_disabled = true;
            fs.writeFileSync(file, JSON.stringify(accData, null, 2));
        } catch (e) {
            console.log(`  ! [AUTO-DISABLE PROXY 429] Gagal update file: ${e.message}`);
        }

        acc.proxy_disabled = true;
        saveIndex(index);
        console.log(`  ✔ [AUTO-DISABLE PROXY 429] ${acc.email} → PROXY OFF. Sisa aktif: ${countProxyActive(index)}`);
    });
}

module.exports = {
    POLL_INTERVAL_MS,
    poll429,
    createMonitor,
    createDeleteMonitor,
    createDisableProxyMonitor
};
