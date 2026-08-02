const fs = require('fs');
const path = require('path');
const { PROXY_LOGS_DB, ACCOUNTS_DIR, findPython } = require('./platform');
const { loadIndex, removeAccounts, deleteAccountFile, saveIndex, countActive, countProxyActive } = require('./store');

const POLL_INTERVAL_MS = 5000;

function poll429Native(lastTs, modelFilter = '') {
    let Database;
    try { ({ DatabaseSync } = require('node:sqlite')); }
    catch (e) { return null; }

    if (!fs.existsSync(PROXY_LOGS_DB)) return [];

    try {
        const db = new DatabaseSync(PROXY_LOGS_DB, { readOnly: true });
        db.setAllowBareMappedObjects(true);

        let rows;
        if (modelFilter) {
            const stmt = db.prepare('SELECT timestamp, account_email FROM request_logs WHERE status=429 AND timestamp>? AND model LIKE ? ORDER BY timestamp ASC');
            rows = stmt.all(lastTs, '%' + modelFilter + '%');
        } else {
            const stmt = db.prepare('SELECT timestamp, account_email FROM request_logs WHERE status=429 AND timestamp>? ORDER BY timestamp ASC');
            rows = stmt.all(lastTs);
        }
        db.close();
        return rows.map(r => [r.timestamp, r.account_email]);
    } catch (e) {
        if (e.message.includes('SQLITE_BUSY') || e.message.includes('database is locked')) {
            return [];
        }
        console.log(`  ! [MONITOR] SQLite error: ${e.message}`);
        return [];
    }
}

function poll429Python(lastTs, modelFilter = '') {
    const { execFileSync } = require('child_process');
    const python = findPython();
    if (!python) return [];

    const script = `
import sqlite3, json, sys
db = sys.argv[1]
ts = int(sys.argv[2])
model = sys.argv[3] if len(sys.argv) > 3 else ""
try:
    conn = sqlite3.connect(db, timeout=3)
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
        const out = execFileSync(python, args, { encoding: 'utf-8', timeout: 5000 });
        return JSON.parse(out.trim() || '[]');
    } catch (e) {
        console.log(`  ! [MONITOR] poll429 python error: ${e.message}`);
        return [];
    }
}

function poll429(lastTs, modelFilter = '') {
    const native = poll429Native(lastTs, modelFilter);
    if (native !== null) return native;
    return poll429Python(lastTs, modelFilter);
}

function createMonitor(name, modelFilter, onMatch) {
    let watcher = null;
    let lastTs = 0;
    let processed = new Set();
    let initialized = false;

    function start(skipHistorical = true) {
        if (watcher) return;
        lastTs = 0;
        processed.clear();
        initialized = false;

        const modelStr = modelFilter ? ` (Filter: ${modelFilter})` : ' (Semua model)';
        console.log(`  ✔ [${name}] Monitor aktif — polling setiap ${POLL_INTERVAL_MS / 1000} detik${modelStr}`);

        watcher = setInterval(() => {
            if (skipHistorical && !initialized) {
                const rows = poll429(lastTs, modelFilter);
                if (rows.length > 0) {
                    lastTs = Math.max(...rows.map(r => r[0]));
                    console.log(`  ◆ [${name}] Skip ${rows.length} event lama, mulai dari ts=${lastTs}`);
                }
                initialized = true;
                return;
            }

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
        initialized = false;
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

        const file = path.join(ACCOUNTS_DIR, `${acc.id}.json`);
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
    poll429, poll429Native, poll429Python,
    createMonitor, createDeleteMonitor, createDisableProxyMonitor
};
