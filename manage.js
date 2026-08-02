const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');

const {
    AG_DIR, ACCOUNTS_DIR, LOCAL_APP_DATA, AG_EXE, IS_WIN,
    getBrowserPath, findPython, isProcessRunning, killProcess, getTempDir,
    runVbsStealth
} = require('./lib/platform');

const { CLIENT_ID, CLIENT_SECRET, SCOPES, DEVICE_PROFILE } = require('./lib/credentials');

const store = require('./lib/store');
const { loadIndex, saveIndex, loadAccount, saveAccount, deleteAccountFile,
        addAccount, removeAccounts, clearAll, countActive, countProxyActive } = store;

const oauth = require('./lib/oauth');
const { findFreePort, startCallbackServer, exchangeCodeForTokens,
        validateToken, refreshAccessToken, decodeJWT, saveAccountToAG, buildAuthUrl } = oauth;

const monitor = require('./lib/monitor');
const { createDeleteMonitor, createDisableProxyMonitor } = monitor;

const ui = require('./lib/ui');
const { logLine, logInfo, logOk, logWarn, logBlank,
        rl, ask, delay, clear, formatDate, statusBadge, quotaBar,
        printHeader, close } = ui;

const AUTO429_STATE_FILE = path.join(__dirname, 'auto429.json');
const AUTO_DISABLE_PROXY_STATE_FILE = path.join(__dirname, 'autodisableproxy.json');

let auto429Monitor = null;
let autoDisableProxyMonitor = null;

process.on('SIGINT', () => {
    auto429Monitor?.stop();
    autoDisableProxyMonitor?.stop();
    close();
    process.exit(0);
});

// ── State helpers ─────────────────────────────────────────────────────────────

function isAuto429On() {
    try { return JSON.parse(fs.readFileSync(AUTO429_STATE_FILE, 'utf-8')).enabled === true; }
    catch { return false; }
}

function setAuto429(enabled) {
    fs.writeFileSync(AUTO429_STATE_FILE, JSON.stringify({ enabled }));
}

function getAutoDisableProxyState() {
    try {
        const data = JSON.parse(fs.readFileSync(AUTO_DISABLE_PROXY_STATE_FILE, 'utf-8'));
        return { enabled: !!data.enabled, model: data.model || '' };
    } catch { return { enabled: false, model: '' }; }
}

function setAutoDisableProxy(enabled, model = '') {
    fs.writeFileSync(AUTO_DISABLE_PROXY_STATE_FILE, JSON.stringify({ enabled, model }));
}

// ── Fitur: Tambah Akun ────────────────────────────────────────────────────────

async function addAccounts() {
    clear(); printHeader(); logBlank(); logLine();
    console.log('  TAMBAH AKUN BARU'); logLine(); logBlank();

    const filePath = './akun.txt';
    if (!fs.existsSync(filePath)) {
        logWarn('File akun.txt tidak ditemukan di folder ini.'); logBlank(); return;
    }

    const rawLines = fs.readFileSync(filePath, 'utf-8')
        .split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);

    const accounts = rawLines.map(line => {
        const parts = line.split(/[:|,]/);
        return { email: parts[0]?.trim(), password: parts[1]?.trim(), raw: line };
    });

    logInfo(`Ditemukan ${accounts.length} akun di akun.txt`); logBlank();
    if (accounts.length === 0) return;

    let threads = 1;
    const ans = await ask(`  Berapa worker/task bersamaan yang mau dijalankan? (Max: ${accounts.length}, Default: 1): `);
    const parsed = parseInt(ans.trim(), 10);
    if (!isNaN(parsed) && parsed > 0) threads = Math.min(parsed, accounts.length);

    logInfo(`Menggunakan ${threads} concurrency worker...`); logBlank(); logLine('─');

    const successLines = new Set();
    function removeSuccessFromFile() {
        const remaining = rawLines.filter(l => !successLines.has(l));
        fs.writeFileSync(filePath, remaining.join('\n') + (remaining.length > 0 ? '\n' : ''), 'utf-8');
    }

    let sukses = 0, gagal = 0, skip = 0;

    const chunks = [];
    for (let i = 0; i < accounts.length; i += threads) chunks.push(accounts.slice(i, i + threads));

    const processAccount = async (account, indexNum) => {
        const logPrefix = `[${String(indexNum).padStart(2)}/${accounts.length}] ${account.email}`;

        if (!account.email || !account.password) {
            console.log(`  ${logPrefix} ✘ Gagal: Format salah, dilewati.`); gagal++; return;
        }

        const idx = loadIndex();
        if (idx.accounts?.some(a => a.email === account.email)) {
            console.log(`  ${logPrefix} ⊘ Dilewati: Sudah ada di AG Manager.`);
            successLines.add(account.raw); skip++; return;
        }

        let browser;
        try {
            const state = randomUUID();
            const callbackPort = await findFreePort();
            const redirectUri = `http://localhost:${callbackPort}/oauth-callback`;
            const authUrl = buildAuthUrl(redirectUri, state);
            const browserPath = getBrowserPath();

            const callbackPromise = startCallbackServer(callbackPort, state);

            browser = await puppeteer.launch({
                executablePath: browserPath,
                headless: 'shell',
                args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled', '--window-size=1280,800']
            });
            const page = await browser.newPage();
            await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');
            await page.setExtraHTTPHeaders({ 'accept-language': 'en-US,en;q=0.9' });

            console.log(`  ${logPrefix} ◆ Membuka Google...`);
            await page.goto(authUrl, { waitUntil: 'networkidle2', timeout: 60000 });

            await page.waitForSelector('#identifierId', { visible: true, timeout: 30000 });
            await page.type('#identifierId', account.email, { delay: 0 });
            await page.keyboard.press('Enter');
            console.log(`  ${logPrefix} ◆ Input Email...`);

            await page.waitForSelector('input[name="Passwd"]', { visible: true, timeout: 30000 });
            await delay(100);
            await page.type('input[name="Passwd"]', account.password, { delay: 0 });
            await page.keyboard.press('Enter');
            console.log(`  ${logPrefix} ◆ Input Pass...`);

            let redirected = false;
            for (let w = 0; w < 40; w++) {
                try {
                    if (page.url().includes(`localhost:${callbackPort}`)) { redirected = true; break; }

                    const buttons = await page.$$('button, input[type="button"], input[type="submit"]');
                    let isClicked = false;

                    for (const btn of buttons) {
                        const text = await page.evaluate(el => (el.innerText || el.textContent || el.value || '').toLowerCase().trim(), btn);
                        const keywords = ['continue', 'lanjutkan', 'allow', 'izinkan', 'sign in', 'signin', 'next', 'yes', 'masuk', 'confirm', 'i understand', 'understand'];
                        if (keywords.some(k => text.includes(k))) { await btn.click(); isClicked = true; break; }
                    }
                    if (isClicked) await delay(2000); else await delay(500);
                } catch { await delay(500); }
            }

            if (!redirected) throw new Error('Timeout menunggu redirect OAuth');

            console.log(`  ${logPrefix} ◆ Menukar Kode OAuth...`);
            const { code, redirectUri: actualUri } = await Promise.race([
                callbackPromise,
                new Promise((_, rej) => setTimeout(() => rej(new Error('Callback timeout')), 15000))
            ]);

            await browser.close();
            if (!code) throw new Error('OAuth code tidak ditemukan');

            const tokens = await exchangeCodeForTokens(code, actualUri);
            const jwt = decodeJWT(tokens.id_token || '');
            const email = jwt.email || account.email;
            const name = jwt.name || email.split('@')[0];

            const id = saveAccountToAG({ email, name, access_token: tokens.access_token, refresh_token: tokens.refresh_token, expires_in: tokens.expires_in, id_token: tokens.id_token });
            const index = loadIndex();
            addAccount(index, { id, email, name, disabled: false, proxy_disabled: false, created_at: Math.floor(Date.now() / 1000), last_used: Math.floor(Date.now() / 1000) });
            saveIndex(index);

            console.log(`  ${logPrefix} ✔ BERHASIL!`);
            successLines.add(account.raw); sukses++;
        } catch (err) {
            console.log(`  ${logPrefix} ✘ GAGAL: ${err.message}`); gagal++;
            try { await browser?.close(); } catch (e) { console.log(`  ${logPrefix} browser close error: ${e.message}`); }
        }
    };

    let accIndex = 1;
    for (const chunk of chunks) {
        const promises = chunk.map((acc) => processAccount(acc, accIndex++));
        await Promise.all(promises);
        removeSuccessFromFile();
    }

    logLine();
    console.log(`  SELESAI  ✔ ${sukses} berhasil  |  ✘ ${gagal} gagal  |  ⊘ ${skip} dilewati`);
    logLine();

    if (sukses > 0) {
        logBlank();
        logOk('Semua data akun sudah tersimpan ke direktori AG Tools.');
        logInfo('Memulai Refresh Token otomatis...');
        logBlank();
        await refreshAllAccounts();
        logLine(); logOk('SINKRONISASI REFRESH SELESAI!');
    }
    logBlank();
}

// ── Fitur: List Akun ──────────────────────────────────────────────────────────

function listAccounts() {
    const index = loadIndex();
    logBlank();
    if (!index.accounts.length) { logWarn('Tidak ada akun.'); logBlank(); return; }

    console.log(`  ${'No'.padEnd(4)} ${'Status'.padEnd(11)} ${'Email'.padEnd(35)} Ditambahkan`);
    logLine('─');
    index.accounts.forEach((a, i) => {
        const cur = a.id === index.current_account_id ? '* ' : '  ';
        const badge = statusBadge(a);
        console.log(`  ${cur}${String(i + 1).padStart(2)} ${badge} ${a.email.padEnd(35)} ${formatDate(a.created_at)}`);
    });
    logLine('─');
    console.log('  * = akun aktif saat ini'); logBlank();
}

// ── Fitur: Hapus Akun ─────────────────────────────────────────────────────────

async function deleteAccount() {
    const index = loadIndex();
    if (!index.accounts.length) { logWarn('Tidak ada akun.'); logBlank(); return; }

    listAccounts();
    const input = await ask('  Nomor akun yang mau dihapus (atau "all" hapus semua, "q" batal): ');
    if (input.trim().toLowerCase() === 'q') return;

    if (input.trim().toLowerCase() === 'all') {
        logBlank();
        console.log(`  Semua ${index.accounts.length} akun akan dihapus!`);
        const confirm = await ask('  Yakin? (y/n): ');
        if (confirm.trim().toLowerCase() !== 'y') { logWarn('Dibatalkan.'); logBlank(); return; }
        const total = index.accounts.length;
        clearAll(index);
        saveIndex(index);
        logBlank(); logOk(`Semua ${total} akun berhasil dihapus.`);
        logWarn('Restart AG Manager agar perubahan diterapkan.'); logBlank(); return;
    }

    const nums = input.split(',').map(s => parseInt(s.trim())).filter(n => !isNaN(n) && n >= 1 && n <= index.accounts.length);
    if (!nums.length) { logWarn('Nomor tidak valid.'); logBlank(); return; }

    const targets = [...new Map(nums.map(n => [index.accounts[n-1].id, index.accounts[n-1]])).values()];
    logBlank();
    console.log('  Akun yang akan dihapus:');
    targets.forEach(t => console.log(`    - ${t.email}`));

    const confirm = await ask('\n  Yakin? (y/n): ');
    if (confirm.trim().toLowerCase() !== 'y') { logWarn('Dibatalkan.'); logBlank(); return; }

    removeAccounts(index, targets.map(t => t.id));
    saveIndex(index);

    logBlank(); logOk(`${targets.length} akun berhasil dihapus.`);
    logWarn('Restart AG Manager agar perubahan diterapkan.'); logBlank();
}

// ── Fitur: Lihat Kuota ────────────────────────────────────────────────────────

function showQuota() {
    const index = loadIndex();
    logBlank();
    if (!index.accounts.length) { logWarn('Tidak ada akun.'); logBlank(); return; }

    const agRunning = isProcessRunning('antigravity_tools.exe');
    if (!agRunning) {
        if (IS_WIN) {
            logWarn('AG Manager tidak running. Data quota mungkin tidak up-to-date.');
            logWarn('Buka AG Manager untuk auto-refresh quota setiap 15 menit.');
        } else {
            logInfo('Cek quota via tasklist hanya didukung di Windows.');
            logInfo('Pastikan AG Manager running agar data quota up-to-date.');
        }
    } else {
        logInfo('AG Manager running. Data quota di-refresh otomatis setiap 15 menit.');
    }
    logBlank();

    index.accounts.forEach((a, i) => {
        if (a.disabled) return;
        const accFile = loadAccount(a.id);
        const isCurrent = a.id === index.current_account_id ? ' ← AKTIF' : '';
        const cur = a.id === index.current_account_id ? '*' : ' ';

        const lastUpdate = accFile?.quota?.last_updated;
        const lastUpdateStr = lastUpdate ? formatDate(lastUpdate) : 'belum pernah';
        const minsAgo = lastUpdate ? Math.round((Date.now() / 1000 - lastUpdate) / 60) : null;
        const freshStr = minsAgo !== null ? ` (${minsAgo < 60 ? minsAgo + ' menit lalu' : Math.round(minsAgo/60) + ' jam lalu'})` : '';

        console.log(`  ${cur} ${String(i + 1).padStart(2)}. ${a.email}${isCurrent}`);
        console.log(`       Last update: ${lastUpdateStr}${freshStr}`);

        if (!accFile?.quota?.quota_groups?.length) {
            logWarn('     Data quota belum tersedia. Pastikan AG Manager sudah running.'); logBlank(); return;
        }

        const buckets = accFile.quota.quota_groups[0]?.buckets || [];
        if (!buckets.length) { logWarn('     Tidak ada data bucket.'); logBlank(); return; }

        logBlank();
        buckets.forEach(b => {
            const name = b.display_name.padEnd(30);
            const bar = quotaBar(b.remaining_fraction);
            const reset = b.description ? `  ${b.description}` : '';
            console.log(`       ${name} ${bar}${reset}`);
        });
        logBlank();
    });

    if (agRunning) logInfo('Tip: Quota diperbarui otomatis oleh AG Manager saat ada activity.');
    else logWarn('Tip: Buka AG Manager lalu tunggu ~15 detik, lalu cek quota lagi.');
    logBlank();
}

// ── Fitur: Auto Delete Expired ────────────────────────────────────────────────

async function autoDeleteExpired() {
    const index = loadIndex();
    logBlank();
    if (!index.accounts.length) { logWarn('Tidak ada akun.'); logBlank(); return; }

    logInfo(`Memeriksa ${index.accounts.length} akun...`); logBlank();

    let valid = 0, deleted = 0, errNet = 0;
    const deletedEmails = [];
    const idsToDelete = new Set();

    for (let i = 0; i < index.accounts.length; i++) {
        const a = index.accounts[i];
        const accFile = loadAccount(a.id);
        const rt = accFile?.token?.refresh_token;

        process.stdout.write(`  [${String(i + 1).padStart(2)}/${index.accounts.length}] ${a.email.padEnd(40)} `);

        if (!rt) {
            console.log('✘ no refresh_token → dihapus');
            idsToDelete.add(a.id); deletedEmails.push(a.email); deleted++; continue;
        }

        const result = await validateToken(rt);

        if (result.ok) { console.log('✔ valid'); valid++; }
        else if (result.error === 'network_error') { console.log('! network error, dilewati'); errNet++; }
        else {
            console.log(`✘ ${result.error || 'invalid'} → dihapus`);
            idsToDelete.add(a.id); deletedEmails.push(a.email); deleted++;
        }
    }

    removeAccounts(index, [...idsToDelete]);
    saveIndex(index);

    logBlank(); logLine();
    console.log(`  HASIL  ✔ ${valid} valid  |  ✘ ${deleted} dihapus  |  ! ${errNet} network error`);
    logLine();

    if (deletedEmails.length) {
        logBlank(); console.log('  Akun yang dihapus:');
        deletedEmails.forEach(e => console.log(`    ✘ ${e}`));
    }

    logBlank();
    if (deleted > 0) logWarn('Restart AG Manager agar perubahan diterapkan.');
    logBlank();
}

// ── Fitur: Auto Enable Proxy ──────────────────────────────────────────────────

function enableAllProxies() {
    const index = loadIndex();
    logBlank();
    let count = 0;

    index.accounts.forEach(a => {
        let isProxyOff = a.proxy_disabled === true;

        const file = path.join(ACCOUNTS_DIR, `${a.id}.json`);
        let accData = null;
        if (fs.existsSync(file)) {
            try {
                accData = JSON.parse(fs.readFileSync(file, 'utf-8'));
                if (accData.proxy_disabled === true) isProxyOff = true;
            } catch (e) { console.log(`  ! Gagal baca ${a.email}: ${e.message}`); }
        }

        if (isProxyOff) {
            a.proxy_disabled = false;
            if (accData) {
                accData.proxy_disabled = false;
                fs.writeFileSync(file, JSON.stringify(accData, null, 2));
            }
            count++;
            console.log(`  ✔ ${a.email} → ACTIVE`);
        }
    });

    if (count > 0) {
        saveIndex(index);
        logBlank(); logOk(`${count} akun berhasil di-enable kembali proxy-nya.`);
        logWarn('Restart AG Manager agar perubahan diterapkan.');
    } else {
        logWarn('Tidak ada akun dengan status PROXY OFF saat ini.');
    }
    logBlank();
}

// ── Fitur: Refresh All Accounts ───────────────────────────────────────────────

async function refreshAllAccounts() {
    const index = loadIndex();
    logBlank();
    if (!index.accounts.length) { logWarn('Tidak ada akun untuk di-refresh.'); logBlank(); return; }

    logInfo(`Memulai refresh untuk ${index.accounts.length} akun (Batch 10)...`); logBlank();

    let sukses = 0, gagal = 0;
    const BATCH_SIZE = 10;

    const refreshSingle = async (a, indexNum) => {
        const af = loadAccount(a.id);
        const rt = af?.token?.refresh_token;
        if (!rt) return { indexNum, email: a.email, status: 'gagal', message: 'tidak ada refresh_token' };

        const result = await refreshAccessToken(rt);
        if (result.ok) {
            const now = Math.floor(Date.now() / 1000);
            const expiresIn = result.data.expires_in || 3599;
            af.token.access_token = result.data.access_token;
            af.token.expires_in = expiresIn;
            af.token.expiry_timestamp = now + expiresIn;
            if (result.data.refresh_token) af.token.refresh_token = result.data.refresh_token;
            if (result.data.id_token) af.token.id_token = result.data.id_token;
            saveAccount(af);
            return { indexNum, email: a.email, status: 'sukses', message: 'Token diperbarui' };
        } else {
            return { indexNum, email: a.email, status: 'gagal', message: result.data?.error || result.error || 'invalid_grant' };
        }
    };

    for (let i = 0; i < index.accounts.length; i += BATCH_SIZE) {
        const batch = index.accounts.slice(i, i + BATCH_SIZE);
        const promises = batch.map((acc, idx) => refreshSingle(acc, i + idx + 1));
        const results = await Promise.all(promises);

        for (const res of results) {
            const numStr = `[${String(res.indexNum).padStart(2)}/${index.accounts.length}]`;
            const emailStr = res.email.padEnd(40);
            if (res.status === 'sukses') { console.log(`  ${numStr} ${emailStr} ✔ Sukses (${res.message})`); sukses++; }
            else { console.log(`  ${numStr} ${emailStr} ✘ Gagal (${res.message})`); gagal++; }
        }
    }

    logBlank(); logLine();
    console.log(`  SELESAI  ✔ ${sukses} berhasil di-refresh  |  ✘ ${gagal} gagal`);
    logLine();

    if (sukses > 0 && IS_WIN) {
        logBlank();
        try {
            logInfo('Melakukan auto-refresh AG Manager di latar belakang...');
            killProcess('antigravity_tools.exe');
            if (fs.existsSync(AG_EXE)) {
                if (runVbsStealth(AG_EXE)) {
                    logOk('AG Tools berhasil direstart dengan mode diam (Stealth).');
                } else {
                    logWarn('Gagal menjalankan VBScript stealth. Silakan restart manual.');
                }
            } else { logWarn('AG Tools Exe tidak ditemukan. Silakan restart manual.'); }
        } catch (e) { logWarn(`Gagal restart AG Tools: ${e.message}`); }
    }
    logBlank();
}

// ── Toggle Monitors ───────────────────────────────────────────────────────────

function toggleAuto429() {
    if (getAutoDisableProxyState().enabled) {
        logWarn("Matikan dulu 'Auto Disable Proxy' sebelum menyalakan ini.");
        return false;
    }
    const newState = !isAuto429On();
    setAuto429(newState);
    if (newState) {
        auto429Monitor = createDeleteMonitor('');
        auto429Monitor.start();
    } else {
        auto429Monitor?.stop();
    }
    return newState;
}

async function toggleAutoDisableProxy() {
    if (isAuto429On()) {
        logWarn("Matikan dulu 'Auto Delete 429' sebelum menyalakan ini.");
        return false;
    }
    const state = getAutoDisableProxyState();
    const newState = !state.enabled;

    if (newState) {
        logBlank();
        const modelInput = await ask('  Masukkan keyword model (misal: "claude", "gpt")\n  Atau kosongkan untuk semua model: ');
        const modelFilter = modelInput.trim().toLowerCase();
        setAutoDisableProxy(true, modelFilter);
        autoDisableProxyMonitor = createDisableProxyMonitor(modelFilter);
        autoDisableProxyMonitor.start();
    } else {
        setAutoDisableProxy(false, '');
        autoDisableProxyMonitor?.stop();
    }
    return newState;
}

// ── Auto-start Services ──────────────────────────────────────────────────────

function ensureProxyConfig() {
    const guiConfigPath = path.join(AG_DIR, 'gui_config.json');
    let cfg;
    try { cfg = JSON.parse(fs.readFileSync(guiConfigPath, 'utf-8')); } catch { return false; }
    if (!cfg) return false;

    let changed = false;
    if (!cfg.proxy) cfg.proxy = {};
    if (!cfg.proxy.enabled)    { cfg.proxy.enabled    = true; changed = true; }
    if (!cfg.proxy.auto_start) { cfg.proxy.auto_start = true; changed = true; }
    if (changed) fs.writeFileSync(guiConfigPath, JSON.stringify(cfg, null, 2));
    return changed;
}

async function ensureAgRunning() {
    if (!IS_WIN) return 'unsupported';
    if (isProcessRunning('antigravity_tools.exe')) return 'already';
    if (!fs.existsSync(AG_EXE)) return 'not_found';

    if (!runVbsStealth(AG_EXE)) {
        logWarn('Gagal menjalankan VBScript stealth.');
    }

    for (let i = 0; i < 8; i++) {
        await delay(1000);
        if (isProcessRunning('antigravity_tools.exe')) return 'launched';
    }
    return 'timeout';
}

async function autoStartServices() {
    const configChanged = ensureProxyConfig();
    if (!IS_WIN) {
        if (configChanged) logOk('Proxy config diupdate.');
        return;
    }

    const agStatus = await ensureAgRunning();

    if (agStatus === 'launched') {
        logOk('AG Manager berhasil distart.');
        if (configChanged) logOk('Proxy service diaktifkan.');
        logBlank(); await delay(500);
    } else if (agStatus === 'timeout') {
        logWarn('AG Manager belum terdeteksi. Tunggu sebentar...');
        logBlank(); await delay(500);
    } else if (agStatus === 'already' && !configChanged) {
        logOk('AG Manager sudah running. Proxy service aktif.');
        logBlank(); await delay(400);
    } else if (agStatus === 'already' && configChanged) {
        logInfo('Proxy config diupdate. Merestart AG Manager...');
        killProcess('antigravity_tools.exe');
        await delay(1000);
        const relaunch = await ensureAgRunning();
        if (relaunch === 'launched') logOk('AG Manager direstart dan proxy aktif.');
        else logWarn('AG Manager gagal direstart.');
        logBlank(); await delay(500);
    }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
    await autoStartServices();
    if (isAuto429On()) {
        auto429Monitor = createDeleteMonitor('');
        auto429Monitor.start();
    }

    while (true) {
        clear(); printHeader();

        const index = loadIndex();
        const total = index.accounts.length;
        const active = countActive(index);
        const disabled = total - active;

        logBlank(); logLine();
        console.log(`  Akun: ${total} total  |  ${active} aktif  |  ${disabled} disabled`);
        logLine(); logBlank();

        const auto429Label = isAuto429On() ? 'AUTO DELETE 429                   [ON] ' : 'AUTO DELETE 429                   [OFF]';
        const proxyState = getAutoDisableProxyState();
        let proxyLabel = 'AUTO DISABLE PROXY 429            [OFF]';
        if (proxyState.enabled) proxyLabel = `AUTO DISABLE PROXY 429            [ON]  (Filter: ${proxyState.model || 'Semua'})`;

        console.log('  1.  TAMBAH AKUN BARU');
        console.log('  2.  LIST SEMUA AKUN');
        console.log('  3.  HAPUS AKUN');
        console.log('  4.  LIHAT KUOTA');
        console.log('  5.  AUTO DELETE EXPIRED');
        console.log(`  6.  ${auto429Label}`);
        console.log('  7.  AUTO ENABLE PROXY');
        console.log(`  8.  ${proxyLabel}`);
        console.log('  9.  REFRESH ALL ACCOUNTS');
        console.log('  0.  KELUAR');
        logBlank();

        const choice = await ask('  Pilih menu: ');

        switch (choice.trim()) {
            case '1': clear(); printHeader(); logBlank(); logLine(); console.log('  TAMBAH AKUN'); logLine(); await addAccounts(); await ask('  Tekan Enter untuk kembali...'); break;
            case '2': clear(); printHeader(); logBlank(); logLine(); console.log('  DAFTAR AKUN'); logLine(); listAccounts(); await ask('  Tekan Enter untuk kembali...'); break;
            case '3': clear(); printHeader(); logBlank(); logLine(); console.log('  HAPUS AKUN'); logLine(); await deleteAccount(); await ask('  Tekan Enter untuk kembali...'); break;
            case '4': clear(); printHeader(); logBlank(); logLine(); console.log('  LIHAT KUOTA'); logLine(); showQuota(); await ask('  Tekan Enter untuk kembali...'); break;
            case '5': clear(); printHeader(); logBlank(); logLine(); console.log('  AUTO DELETE EXPIRED'); logLine(); await autoDeleteExpired(); await ask('  Tekan Enter untuk kembali...'); break;
            case '6': { const on = toggleAuto429(); logBlank(); if(on !== false) logOk(`Auto Delete 429 sekarang: ${on ? 'ON' : 'OFF'}`); logBlank(); await ask('  Tekan Enter untuk kembali...'); break; }
            case '7': clear(); printHeader(); logBlank(); logLine(); console.log('  AUTO ENABLE PROXY'); logLine(); enableAllProxies(); await ask('  Tekan Enter untuk kembali...'); break;
            case '8': { const on = await toggleAutoDisableProxy(); logBlank(); if(on !== false) logOk(`Auto Disable Proxy 429 sekarang: ${on ? 'ON' : 'OFF'}`); logBlank(); await ask('  Tekan Enter untuk kembali...'); break; }
            case '9': clear(); printHeader(); logBlank(); logLine(); console.log('  REFRESH ALL ACCOUNTS'); logLine(); await refreshAllAccounts(); await ask('  Tekan Enter untuk kembali...'); break;
            case '0': logBlank(); console.log('  Bye!'); logBlank(); close(); process.exit(0); break;
            default: logWarn('Pilihan tidak valid.'); await delay(200);
        }
    }
}

main().catch(err => { console.log(`  ✘ Fatal error: ${err.message}`); close(); });
