const puppeteer = require('puppeteer');
const fs = require('fs');
const os = require('os');
const path = require('path');
const https = require('https');
const http = require('http');
const readline = require('readline');
const { execSync, execFileSync } = require('child_process');
const { randomUUID } = require('crypto');

// Paksa konsol Windows ke UTF-8 agar karakter box (█ ─ ● ✔) tampil benar,
// bukan jadi mojibake (██) di cmd/PowerShell yang pakai codepage lama (CP437/1252).
if (process.platform === 'win32' && process.stdout.isTTY) {
    try { execSync('chcp 65001 >nul', { stdio: 'ignore', windowsHide: true }); } catch {}
}

// ── Konstanta ─────────────────────────────────────────────────────────────────

const CLIENT_ID     = '1071' + '006' + '060' + '591' + '-tmh' + 'ssin' + '2h2' + '1lcr' + 'e23' + '5vtol' + 'ojh' + '4g40' + '3ep.a' + 'pps.go' + 'ogleuse' + 'rcon' + 'tent.c' + 'om';
const CLIENT_SECRET = 'GOC' + 'SPX-' + 'K58' + 'FWR4' + '86L' + 'dLJ' + '1mLB' + '8sXC' + '4z6q' + 'DAf';
const SCOPES        = [
    'openid',
    'https://www.googleapis.com/auth/cloud-platform',
    'https://www.googleapis.com/auth/userinfo.email',
    'https://www.googleapis.com/auth/userinfo.profile',
    'https://www.googleapis.com/auth/cclog',
    'https://www.googleapis.com/auth/experimentsandconfigs'
].join(' ');

let AG_DIR        = path.join(process.env.USERPROFILE || os.homedir(), '.antigravity_tools');
let ACCOUNTS_DIR  = path.join(AG_DIR, 'accounts');
let ACCOUNTS_INDEX = path.join(AG_DIR, 'accounts.json');

const DEVICE_PROFILE = {
    machine_id:     'auth0|user_kfwllyifh6pb38vn8roj1gormxlxmwmo',
    mac_machine_id: '4bfec3e4-a156-4315-b910-8e9b7bc783d6',
    dev_device_id:  '19bd8916-d262-4a48-ab09-d06bd8cb466d',
    sqm_id:         '{D18262FE-D3E8-47AC-B703-E0E45A3A20DA}'
};

let AG_MANAGER_EXE = path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'Antigravity Tools', 'antigravity_tools.exe');

// ── Konfigurasi portabel (opsional config.json) ────────────────────────────────
// Supaya script bisa dijalankan di semua device, path & identitas device bisa
// di-override lewat file config.json di folder proyek (lihat config.example.json).
const CONFIG_FILE = path.join(__dirname, 'config.json');
let CFG = {};
try { CFG = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8')); } catch (e) {
    if (e.code !== 'ENOENT') console.warn('[config] config.json korup, abaikan:', e.message);
}

if (CFG.agDir)  { const p = path.resolve(CFG.agDir);  AG_DIR = p; ACCOUNTS_DIR = path.join(p, 'accounts'); ACCOUNTS_INDEX = path.join(p, 'accounts.json'); }
if (CFG.agExe)  { AG_MANAGER_EXE = path.resolve(CFG.agExe); }
if (CFG.deviceProfile && typeof CFG.deviceProfile === 'object') {
    DEVICE_PROFILE.machine_id     = CFG.deviceProfile.machine_id     || DEVICE_PROFILE.machine_id;
    DEVICE_PROFILE.mac_machine_id = CFG.deviceProfile.mac_machine_id || DEVICE_PROFILE.mac_machine_id;
    DEVICE_PROFILE.dev_device_id  = CFG.deviceProfile.dev_device_id  || DEVICE_PROFILE.dev_device_id;
    DEVICE_PROFILE.sqm_id         = CFG.deviceProfile.sqm_id         || DEVICE_PROFILE.sqm_id;
}

// ── Logging rapi ──────────────────────────────────────────────────────────────

const LOG_WIDTH = 46;

function logLine(char = '─') { console.log('  ' + char.repeat(LOG_WIDTH)); }

function logStep(icon, msg) {
    const ts = new Date().toLocaleTimeString('id-ID', { hour12: false });
    console.log(`  ${icon} [${ts}] ${msg}`);
}

function logInfo(msg)    { logStep('◆', msg); }
function logOk(msg)      { logStep('✔', msg); }
function logWarn(msg)    { logStep('!', msg); }
function logError(msg)   { logStep('✘', msg); }
function logBlank()      { console.log(''); }

// ── Helpers umum ──────────────────────────────────────────────────────────────

const delay = (ms) => new Promise(r => setTimeout(r, ms));
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise(resolve => rl.question(q, resolve));
function clear() { process.stdout.write('\x1Bc'); }

function formatDate(ts) {
    if (!ts) return '-';
    return new Date(ts * 1000).toLocaleString('id-ID', { dateStyle: 'short', timeStyle: 'short' });
}

function statusBadge(account) {
    if (account.disabled)       return 'DISABLED  ';
    if (account.proxy_disabled) return 'PROXY OFF ';
    return 'ACTIVE    ';
}

// ── File helpers ──────────────────────────────────────────────────────────────

function loadIndex() {
    if (!fs.existsSync(ACCOUNTS_INDEX))
        return { version: '2.0', accounts: [], current_account_id: null, current_target_ide: 'agy' };
    return JSON.parse(fs.readFileSync(ACCOUNTS_INDEX, 'utf-8'));
}

function saveIndex(index) {
    fs.writeFileSync(ACCOUNTS_INDEX, JSON.stringify(index, null, 2));
}

function loadAccountFile(id) {
    const file = path.join(ACCOUNTS_DIR, `${id}.json`);
    if (!fs.existsSync(file)) return null;
    return JSON.parse(fs.readFileSync(file, 'utf-8'));
}

// ── OAuth helpers ─────────────────────────────────────────────────────────────

// Bind callback server SEKALI (port 0 = OS yg pilih) → tanpa race-condition EADDRINUSE
// antar worker concurrent. Mengembalikan { port, callbackPromise }.
function startCallbackServer() {
    const server = http.createServer((req, res) => {
        const port = server.address().port;
        const url  = new URL(req.url, `http://localhost:${port}`);
        const code = url.searchParams.get('code');
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end('<html><body><h2>Login berhasil! Kamu bisa tutup tab ini.</h2></body></html>');
        setTimeout(() => server.close(), 500);
        resolveCallback({ code, redirectUri: `http://localhost:${port}/oauth-callback` });
    });

    let resolveCallback;
    const callbackPromise = new Promise(res => { resolveCallback = res; });

    return new Promise((resolve, reject) => {
        server.on('error', reject);
        // JANGAN bind '127.0.0.1' saja — Chrome/Edge resolve localhost ke ::1 (IPv6) DULU,
        // koneksi IPv6 ditolak sedangkan URL bar tetap `localhost:port/...` → redirected=true
        // tapi callback promise tak pernah resolve → "Callback timeout". Bind semua alamat
        // (dual-stack :: → terima ::1 dan 127.0.0.1) supaya callback pasti masuk.
        server.listen(0, () => {
            resolve({ port: server.address().port, callbackPromise });
        });
    });
}

// ── Debug helpers (untuk menemukan akar masalah OAuth yang gagal) ──────────────

const DEBUG_DIR = path.join(__dirname, 'debug');

async function captureFailedPage(page, label) {
    try {
        fs.mkdirSync(DEBUG_DIR, { recursive: true });
        const safe = label.replace(/[^a-z0-9@.\-]/gi, '_');
        const ts   = new Date().toISOString().replace(/[:.]/g, '-');
        const info = await page.evaluate(() => ({
            url:   location.href,
            title: document.title,
            text:  (document.body ? document.body.innerText : '').slice(0, 800)
        })).catch(() => ({ url: '?', title: '?', text: '' }));
        fs.writeFileSync(path.join(DEBUG_DIR, `${safe}_${ts}.txt`),
            `URL   : ${info.url}\nTITLE : ${info.title}\n\n${info.text}\n`, 'utf-8');
        await page.screenshot({ path: path.join(DEBUG_DIR, `${safe}_${ts}.png`) }).catch(() => {});
        return info;
    } catch { return null; }
}

// Klik tombol kata kunci via koordinat mouse CDP (trusted click, pasti diterima Google).
// Tembus shadow DOM + scroll otomatis ke tombol kalau berada di bawah viewport
// (halaman onboarding Google Workspace / ToS "speedbump" sering menaruh tombolnya di bawah lipatan).
// Cakupan keyword: consent asli, halaman "nativeapp" (Login), dan halaman ToS/onboarding.
async function clickConsentButton(page) {
    const KEYWORDS = ['lanjutkan', 'lanjut', 'continue', 'berikutnya', 'selanjutnya',
                      'izinkan', 'allow', 'setuju', 'setujui', 'agree', 'accept',
                      'terima', 'menerima', 'memahami', 'understand', 'konfirmasi', 'confirm', 'next',
                      'yes', 'login', 'masuk', 'sign in', 'iya', 'ya', 'oke', 'ok'];
    const target = await page.evaluate(async (kws) => {
        // 0) Cek dulu checkbox persetujuan ("saya mengerti/agree/understand") -- sering wajib
        //    dicentang sebelum tombol lanjut aktif di halaman ToS Workspace.
        async function tryCheckbox() {
            const boxes = [];
            const seen = new Set();
            const scan = (root) => {
                for (const el of root.querySelectorAll('input[type="checkbox"]')) {
                    if (seen.has(el)) continue;
                    seen.add(el);
                    const label = el.closest('label');
                    const text = (label ? (label.innerText || label.textContent || '') : '') + ' ' + (el.getAttribute('aria-label') || '');
                    if (kws.some(k => text.toLowerCase().includes(k))) boxes.push(el);
                }
                for (const el of root.querySelectorAll('*')) {
                    if (el.shadowRoot) scan(el.shadowRoot);
                }
            };
            scan(document);
            for (const box of boxes) {
                const r = box.getBoundingClientRect();
                if (r.width < 1 || r.height < 1) continue;
                if (box.checked) continue;
                try { box.scrollIntoView({ block: 'center', inline: 'center' }); } catch {}
                await new Promise(res => requestAnimationFrame(() => requestAnimationFrame(res)));
                const rr = box.getBoundingClientRect();
                return { mode: 'checkbox', x: rr.left + rr.width / 2, y: rr.top + rr.height / 2, text: 'checkbox' };
            }
            return null;
        }
        const chk = await tryCheckbox();
        if (chk) return chk;

        // 1) Cari tombol lanjut/konsent
        const PRIMARY_LABELS = ['login', 'masuk', 'sign in', 'next', 'continue', 'lanjut', 'lanjutkan', 'berikutnya', 'selanjutnya', 'agree', 'accept', 'ok', 'iya'];
        function findButton(root) {
            const matches = [];
            for (const el of root.querySelectorAll('button, input[type="button"], input[type="submit"], [role="button"], a[role="button"]')) {
                const text = (el.innerText || el.textContent || el.value || el.getAttribute('aria-label') || '').trim();
                if (!text) continue;
                const lower = text.toLowerCase();
                const r = el.getBoundingClientRect();
                const vis = r.width > 1 && r.height > 1 && r.top >= 0 && r.bottom <= innerHeight;
                let score = 0;
                const norm = lower.replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
                const exact = PRIMARY_LABELS.includes(norm);
                if (norm === 'login' || norm === 'masuk' || norm === 'sign in') score = 8;   // tombol konfirmasi Login/OAuth
                else if (norm === 'next' || norm === 'continue' || norm === 'lanjut' || norm === 'lanjutkan' ||
                         norm === 'berikutnya' || norm === 'selanjutnya' || norm === 'agree' || norm === 'accept') score = 6;
                else if (exact) score = 5;
                else if (kws.some(k => lower.includes(k))) score = 2;        // label mengandung keyword
                if (score === 0) continue;
                matches.push({ el, text, vis, score });
            }
            for (const el of root.querySelectorAll('*')) {
                if (el.shadowRoot) matches.push(...findButton(el.shadowRoot));
            }
            return matches;
        }
        let c = findButton(document);
        c.sort((a, b) => (b.score - a.score) || (b.vis - a.vis) || (a.text.length - b.text.length));
        let pick = c[0];

        // 2) Fallback: kalau tidak ada tombol berkeyword tapi halaman ini halaman konfirmasi
        //    OAuth/Login ("Sign in with Google ... to continue to ..."), klik tombol utama
        //    Google Sign-In (#identifierNext / #signIn / tombol filled Material) apa adanya.
        if (!pick) {
            const bodyText = (document.body ? document.body.innerText : '').toLowerCase();
            const isSignInPage = bodyText.includes('sign in with google') ||
                                 bodyText.includes('to continue to google antigravity');
            if (isSignInPage) {
                const sel = '#identifierNext, #signIn, .VfPpkd-LgbsSe, button[jsname="V67aGc"], [data-id="google-button"]';
                const el = document.querySelector(sel);
                if (el && el.getBoundingClientRect().width > 1) {
                    pick = { el, text: 'SignIn-primary', vis: true, score: 6 };
                }
            }
        }

        if (!pick) return null;
        try { pick.el.scrollIntoView({ block: 'center', inline: 'center' }); } catch {}
        await new Promise(res => requestAnimationFrame(() => requestAnimationFrame(res)));
        const r = pick.el.getBoundingClientRect();
        return { mode: 'button', text: pick.text, x: r.left + r.width / 2, y: r.top + r.height / 2 };
    }, KEYWORDS);

    if (!target) return false;
    try {
        await page.mouse.click(target.x, target.y);
    } catch (e) {
        // Kalau klik koordinat gagal (misal elemen tertutup overlay/animasi),
        // fallback ke DOM .click() langsung — tombol Login/Next biasanya di doc root.
        try {
            await page.evaluate(() => {
                const btns = [...document.querySelectorAll('button, [role="button"], a[role="button"], #identifierNext, #signIn')];
                for (let i = btns.length - 1; i >= 0; i--) {
                    const b = btns[i];
                    const t = ((b.innerText || b.textContent || b.getAttribute('aria-label') || '') + '').toLowerCase();
                    if (/login|masuk|sign ?in|next|continue|lanjut|berikutnya|izinkan|allow|setuju|agree/.test(t)) {
                        b.click();
                        return;
                    }
                }
            });
        } catch {}
    }
    return true;
}

// Deteksi halaman masalah Google yang menghalangi redirect OAuth
async function detectGoogleError(page) {
    const text = (await page.evaluate(() => (document.body ? document.body.innerText : '')).catch(() => '')) || '';
    const t = text.toLowerCase();
    if (t.includes('this browser or app may not be secure')) return { flag: 'BROWSER_BLOCKED',  msg: 'Browser terdeteksi otomatis/headless oleh Google' };
    if (t.includes('wrong password') || t.includes("couldn't sign you in")) return { flag: 'SIGNIN_DENIED',  msg: 'Password salah / login ditolak' };
    if (t.includes('two-step verification') || t.includes('verification code')) return { flag: 'NEEDS_2FA',      msg: 'Akun pakai 2-Step Verification' };
    if (t.includes('confirm your recovery email')) return { flag: 'NEEDS_RECOVERY', msg: 'Google minta konfirmasi recovery email' };
    if (t.includes("verify it's you")) return { flag: 'NEEDS_VERIFY', msg: 'Google minta verifikasi identitas (verify it\'s you)' };
    return null;
}

function exchangeCodeForTokens(code, redirectUri) {
    return new Promise((resolve, reject) => {
        const body = new URLSearchParams({ code, client_id: CLIENT_ID, client_secret: CLIENT_SECRET, redirect_uri: redirectUri, grant_type: 'authorization_code' }).toString();
        const req = https.request({
            hostname: 'oauth2.googleapis.com', path: '/token', method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) }
        }, (res) => {
            let data = '';
            res.on('data', c => data += c);
            res.on('end', () => {
                try {
                    const parsed = JSON.parse(data);
                    if (parsed.error) reject(new Error(parsed.error_description || parsed.error));
                    else resolve(parsed);
                } catch (e) { reject(e); }
            });
        });
        req.on('error', reject);
        req.write(body);
        req.end();
    });
}

function decodeJWT(token) {
    try {
        return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf-8'));
    } catch { return {}; }
}

function saveAccountToAG(accountData) {
    if (!fs.existsSync(ACCOUNTS_DIR)) fs.mkdirSync(ACCOUNTS_DIR, { recursive: true });
    const id  = randomUUID();
    const now = Math.floor(Date.now() / 1000);
    fs.writeFileSync(path.join(ACCOUNTS_DIR, `${id}.json`), JSON.stringify({
        id, email: accountData.email, name: accountData.name,
        token: {
            access_token: accountData.access_token, refresh_token: accountData.refresh_token,
            expires_in: accountData.expires_in || 3599, expiry_timestamp: now + (accountData.expires_in || 3599),
            token_type: 'Bearer', email: accountData.email,
            oauth_client_key: 'antigravity_enterprise', is_gcp_tos: false, id_token: accountData.id_token
        },
        device_profile: DEVICE_PROFILE,
        device_history: [{ id: randomUUID(), created_at: now, label: 'auto_generated', profile: DEVICE_PROFILE, is_current: true }],
        disabled: false, proxy_disabled: false, validation_blocked: false, created_at: now, last_used: now
    }, null, 2));

    let index = loadIndex();
    if (index.accounts.some(a => a.email === accountData.email)) return id;
    index.accounts.push({ id, email: accountData.email, name: accountData.name, disabled: false, proxy_disabled: false, created_at: now, last_used: now });
    if (!index.current_account_id) index.current_account_id = id;
    saveIndex(index);
    return id;
}

// ── Fitur: Tambah Akun ────────────────────────────────────────────────────────

async function addAccounts() {
    clear();
    printHeader();
    logLine();
    console.log('  TAMBAH AKUN BARU');
    logLine();
    logBlank();

    const filePath = './akun.txt';
    if (!fs.existsSync(filePath)) {
        logError('File akun.txt tidak ditemukan di folder ini.');
        logBlank();
        return;
    }

    // Baca raw lines agar kita bisa hapus per baris setelah sukses
    const rawLines = fs.readFileSync(filePath, 'utf-8')
        .split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);

    const accounts = rawLines.map(line => {
        const parts = line.split(/[:|,|]/);
        return { email: parts[0]?.trim(), password: parts[1]?.trim(), raw: line };
    });

    logInfo(`Ditemukan ${accounts.length} akun di akun.txt`);
    logBlank();

    if (accounts.length === 0) return;

    // Prompt jumlah worker untuk concurrent
    let threads = 1;
    const ans = await ask(`  Berapa worker/task bersamaan yang mau dijalankan? (Max: ${accounts.length}, Default: 1): `);
    const parsed = parseInt(ans.trim(), 10);
    if (!isNaN(parsed) && parsed > 0) {
        threads = Math.min(parsed, accounts.length);
    }
    logInfo(`Menggunakan ${threads} concurrency worker...`);
    logBlank();
    logLine('─');

    // Set berisi baris yang sudah berhasil (akan dihapus dari file)
    const successLines = new Set();

    function removeSuccessFromFile() {
        const remaining = rawLines.filter(l => !successLines.has(l));
        fs.writeFileSync(filePath, remaining.join('\n') + (remaining.length > 0 ? '\n' : ''), 'utf-8');
    }

    let sukses = 0, gagal = 0, skip = 0;
    
    // Pecah akun menjadi grup/chunk sesuai jumlah thread parameter
    const chunks = [];
    for (let i = 0; i < accounts.length; i += threads) {
        chunks.push(accounts.slice(i, i + threads));
    }

    // Fungsi worker yang berdiri sendiri secara thread-safe per akun
    const processAccount = async (account, indexNum) => {
        const logPrefix = `[${String(indexNum).padStart(2)}/${accounts.length}] ${account.email}`;
        
        if (!account.email || !account.password) {
            console.log(`  ${logPrefix} ✘ Gagal: Format salah, dilewati.`);
            gagal++;
            return;
        }

        const idx = loadIndex();
        if (idx.accounts?.some(a => a.email === account.email)) {
            console.log(`  ${logPrefix} ⊘ Dilewati: Sudah ada di AG Manager.`);
            successLines.add(account.raw);
            skip++;
            return;
        }

        let browser;
        try {
            // Stagger: jeda acak antar worker supaya beberapa browser tidak buka
            // accounts.google.com pada waktu yang bersamaan (pemicu challenge Google).
            const staggerMs = Math.floor(Math.random() * 2500) + ((indexNum - 1) % 5) * 800;
            if (staggerMs > 0) await delay(staggerMs);

            const { port: callbackPort, callbackPromise } = await startCallbackServer(); // Bind sekali, tanpa race
            const redirectUri   = `http://localhost:${callbackPort}/oauth-callback`;
            const AUTH_URL      = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${CLIENT_ID}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=${encodeURIComponent(SCOPES)}&access_type=offline&prompt=consent&include_granted_scopes=true&state=${randomUUID()}`;

            // Headless true dengan config Chrome bot siluman ----------------
            browser = await puppeteer.launch({
                headless: 'shell',
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-blink-features=AutomationControlled',
                    '--disable-features=IsolateOrigins,site-per-process',
                    '--start-maximized',
                    '--lang=en-US'
                ],
                defaultViewport: { width: 1366, height: 900 },
                ignoreHTTPSErrors: true
            });
            const page = await browser.newPage();

            // Spoof petunjuk otomasi biar Google tidak tahu ini bot
            await page.evaluateOnNewDocument(() => {
                Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
                Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
                Object.defineProperty(navigator, 'plugins',   { get: () => [1, 2, 3, 4, 5] });
                window.chrome = { runtime: {} };
            });
            
            // User-Agent + Client-Hints override, KONSISTEN dengan versi bundel Chrome.
            // Kenapa harus override: headless shell (headless:'shell') mengirim token
            // `HeadlessChrome` di navigator.userAgent DAN di navigator.userAgentData.brands
            // (client-hints). Google membaca client-hints, bukan cuma UA string →
            // token HeadlessChrome = browser dianggap tak didukung →
            // `myaccount.google.com/not-supported` SETELAH login (bukti debug 27 Sep).
            // Override UA string saja TIDAK cukup (brands tetap bocor `HeadlessChrome`).
            // Pakai setUserAgent(userAgent, userAgentMetadata) → keduanya konsisten versi 153
            // (tidak mismatch seperti ISSUE 9 yang memicu challenge) TANPA token HeadlessChrome.
            const CLEAN_BRANDS = [
                { brand: 'Google Chrome', version: '153' },
                { brand: 'Not)A;Brand',    version: '8'  },
                { brand: 'Chromium',       version: '153' }
            ];
            const CLEAN_METADATA = {
                brands: CLEAN_BRANDS,
                fullVersionList: [
                    { brand: 'Google Chrome', version: '153.0.8010.36' },
                    { brand: 'Not)A;Brand',    version: '8.0.0.0' },
                    { brand: 'Chromium',       version: '153.0.8010.36' }
                ],
                platform: 'Windows',
                platformVersion: '10.0.22631.0',
                architecture: 'x64',
                model: '',
                mobile: false
            };
            const CLEAN_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.8010.36 Safari/537.36';
            await page.setUserAgent(CLEAN_UA, CLEAN_METADATA);
            await page.setExtraHTTPHeaders({
                'accept-language': 'en-US,en;q=0.9'
            });

            console.log(`  ${logPrefix} ◆ Membuka Google...`);
            await page.goto(AUTH_URL, { waitUntil: 'networkidle2', timeout: 60000 });

            await page.waitForSelector('#identifierId', { visible: true, timeout: 30000 });
            await page.type('#identifierId', account.email, { delay: 0 });
            await page.keyboard.press('Enter');
            console.log(`  ${logPrefix} ◆ Input Email...`);

            // Setelah submit email, Google kadang menaruh halaman PERANTARA sebelum field password
            // (onboarding akun baru / ToS "speedbump" / verifikasi tambahan), terutama untuk domain
            // Workspace yang baru dipakai. Loop ini: tunggu Passwd sambil klik tombol lanjut
            // (continue/next/lanjut...), supaya halaman perantara bisa dilewati otomatis.
            let passwordReady = false;
            const waitBegin = Date.now();
            let clickedOnce = false;
            let lastClickTs = 0;
            for (let w = 0; w < 60; w++) {
                // Seluruh operasi DOM dibungkus try/catch: navigasi email→password sedang
                // berlangsung akan membunuh execution context ("Execution context was
                // destroyed...") — itu PAGI ignorable, lanjut iterasi berikutnya.
                try {
                    try {
                        await page.waitForSelector('input[name="Passwd"]', { visible: true, timeout: 2000 });
                        passwordReady = true;
                        break;
                    } catch {}

                    const url = page.url();
                    // URL sudah di halaman password, tapi pastikan input SUNGGAH render dulu
                    // (race render → page.type error "No element found for selector"). Hanya
                    // treat sebagai ready kalau elemen benar-benar ada.
                    const passwdBox = await page.$('input[name="Passwd"]');
                    if (url.includes('/signin/challenge/pwd') && passwdBox) {
                        passwordReady = true;
                        break;
                    }
                    if (passwdBox) { passwordReady = true; break; }

                    const pgErr = await detectGoogleError(page);
                    if (pgErr) {
                        await captureFailedPage(page, account.email);
                        throw new Error(`Google menghalangi saat tunggu password: ${pgErr.msg} (${pgErr.flag})`);
                    }

                    // JANGAN spam-klik — Google butuh waktu transisi & klik berulang justru
                    // memicu challenge anti-bot (URL balik ke /identifier). Fakta empiris:
                    //  - transisi email→password berjalan ~2-4 detik TANPA intervensi apa pun.
                    //  - klik #identifierNext / konsent SELAMA transisi = re-submit email = challenge.
                    //  - halaman intermediate (ToS/speedbump/onboarding) baru muncul SETELAH password.
                    // Strategi: di fase tunggu password, JANGAN klik apa-apa.
                    //   ~ Hanya jika >8 detik masih di identifier (email tidak ter-submit sama sekali)
                    //     baru klik identifierNext SEKALI sebagai fallback.
                    //   ~ Kalau sudah di halaman non-identifier tapi Passwd belum muncul (anomali),
                    //     pakai clickConsentButton dengan cooldown 2500ms.
                    const now = Date.now();
                    const stillIdentifier = (await page.$('#identifierId')) !== null;
                    if (!stillIdentifier) {
                        if (now - lastClickTs > 2500) {
                            lastClickTs = now;
                            try { await clickConsentButton(page); } catch {}
                        }
                    } else if (now - waitBegin > 8000 && !clickedOnce) {
                        clickedOnce = true;
                        await page.evaluate(() => {
                            const el = document.querySelector('#identifierNext, #next, button[jsname="V67aGc"], .VfPpkd-LgbsSe');
                            if (el) el.click();
                        });
                    }
                } catch {}
                await delay(500);
            }
            if (!passwordReady) {
                const dbg = await captureFailedPage(page, account.email);
                throw new Error(`Halaman password tidak muncul setelah input email${dbg ? `. Bukti di debug/ (URL: ${dbg.url})` : ''}`);
            }

            // Ketik password robust: input Passwd bisa hilang/berganti cepat (flow Google
            // bergerak, terutama setelah akun "warm"). Coba sampai 5x; kalau tetap tidak
            // muncul, tangkap bukti + gagal eksplisit.
            let passwordTyped = false;
            for (let pt = 0; pt < 5 && !passwordTyped; pt++) {
                try {
                    await page.waitForSelector('input[name="Passwd"]:not([disabled])', { visible: true, timeout: 4000 });
                    await page.type('input[name="Passwd"]', account.password, { delay: 0 });
                    await page.keyboard.press('Enter');
                    passwordTyped = true;
                } catch {
                    await delay(800);
                }
            }
            if (!passwordTyped) {
                const dbg = await captureFailedPage(page, account.email);
                throw new Error(`Gagal mengetik password (input Passwd hilang)${dbg ? `. Bukti di debug/ (URL: ${dbg.url})` : ''}`);
            }
            console.log(`  ${logPrefix} ◆ Input Pass...`);

            let redirected = false;
            let retyped = false;
            for (let w = 0; w < 45; w++) {
                try {
                    // Redirect OAuth terdeteksi hanya jika URL BENAR-BENAR di callback
                    // (host localhost/127.0.0.1/[::1] + port callback), bukan sekadar
                    // substring — mencegah false-positive dari URL consent/error page.
                    let u;
                    try { u = new URL(page.url()); } catch { u = null; }
                    const onCallback = !!u && u.port === String(callbackPort) &&
                        ['localhost', '127.0.0.1', '[::1]', '::1'].includes(u.hostname);
                    if (onCallback) { redirected = true; break; }

                    // Setelah password, Google untuk PERANGKAT BARU/akan login sering
                    // minta konfirmasi password ulang di `/v3/signin/challenge/pwd`
                    // (title "Welcome"). Ketik ulang password SEKALI supaya lanjut ke consent.
                    if (!retyped && (page.url().includes('/challenge/pwd') || (await page.$('input[name="Passwd"]')))) {
                        try {
                            await page.waitForSelector('input[name="Passwd"]:not([disabled])', { visible: true, timeout: 3000 });
                            await page.click('input[name="Passwd"]');
                            await page.keyboard.down('Control');
                            await page.keyboard.press('KeyA');
                            await page.keyboard.up('Control');
                            await page.keyboard.press('Backspace');
                            await page.type('input[name="Passwd"]', account.password, { delay: 0 });
                            await page.keyboard.press('Enter');
                            retyped = true;
                            await delay(1500);
                            continue;
                        } catch {}
                    }

                    // Cek dulu apakah Google menampilkan halaman masalah (bukan consent)
                    const gErr = await detectGoogleError(page);
                    if (gErr) {
                        await captureFailedPage(page, account.email);
                        throw new Error(`Google diblokir: ${gErr.msg} (${gErr.flag})`);
                    }

                    const isClicked = await clickConsentButton(page);

                    if (isClicked) await delay(2000); 
                    else await delay(500);
                } catch (e) {
                    if (e.message && e.message.includes('Google diblokir')) throw e;
                    await delay(500);
                }
            }

            if (!redirected) {
                const dbg = await captureFailedPage(page, account.email);
                throw new Error(`Timeout menunggu redirect OAuth${dbg ? `. Bukti disimpan di debug/ (URL: ${dbg.url})` : ''}`);
            }

            console.log(`  ${logPrefix} ◆ Menukar Kode OAuth...`);
            const { code, redirectUri: actualUri } = await Promise.race([
                callbackPromise,
                new Promise((_, rej) => setTimeout(() => rej(new Error('Callback timeout')), 15000))
            ]);

            await browser.close();
            if (!code) throw new Error('OAuth code tidak ditemukan');

            const tokens     = await exchangeCodeForTokens(code, actualUri);
            const jwt        = decodeJWT(tokens.id_token || '');
            const email      = jwt.email || account.email;
            const name       = jwt.name  || email.split('@')[0];

            saveAccountToAG({ email, name, access_token: tokens.access_token, refresh_token: tokens.refresh_token, expires_in: tokens.expires_in, id_token: tokens.id_token });

            console.log(`  ${logPrefix} ✔ BERHASIL!`);
            successLines.add(account.raw);
            sukses++;

        } catch (err) {
            console.log(`  ${logPrefix} ✘ GAGAL: ${err.message}`);
            gagal++;
            try { await browser?.close(); } catch {}
        }
    };

    // Eksekusi tiap per batch (Misal: 5 pekerja akan mengunyah 5 akun bersamaan per putarannya)
    let accIndex = 1;
    for (const chunk of chunks) {
        const promises = chunk.map((acc) => {
            const currentIdx = accIndex++;
            return processAccount(acc, currentIdx);
        });
        
        await Promise.all(promises); 
        removeSuccessFromFile(); 
    }

    logLine();
    console.log(`  SELESAI  ✔ ${sukses} berhasil  |  ✘ ${gagal} gagal  |  ⊘ ${skip} dilewati`);
    logLine();

    if (sukses > 0) {
        logBlank();
        logOk('Semua data akun sudah tersimpan ke direktori AG Tools.');
        logInfo('Memulai Refresh Token otomatis agar akun langsung tersinkronisasi...');
        logBlank();
        
        // Memanggil fungsi refresh all di belakang layar, agar applikasi AG tools langsung bisa mendeteksi JSON nya
        await refreshAllAccounts();
        
        logLine();
        logOk('SINKRONISASI REFRESH SELESAI!');
        logInfo('Akun-akun baru sudah siap digunakan 100% tanpa perlu dimuat-ulang manual aplikasinya.');
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
        const cur   = a.id === index.current_account_id ? '* ' : '  ';
        const badge = statusBadge(a);
        console.log(`  ${cur}${String(i + 1).padStart(2)} ${badge} ${a.email.padEnd(35)} ${formatDate(a.created_at)}`);
    });
    logLine('─');
    console.log('  * = akun aktif saat ini');
    logBlank();
}

// ── Fitur: Hapus Akun ─────────────────────────────────────────────────────────

async function deleteAccount() {
    const index = loadIndex();
    if (!index.accounts.length) { logWarn('Tidak ada akun.'); logBlank(); return; }

    listAccounts();
    const input = await ask('  Nomor akun yang mau dihapus (atau "all" hapus semua, "q" batal): ');
    if (input.trim().toLowerCase() === 'q') return;

    // Opsi hapus semua
    if (input.trim().toLowerCase() === 'all') {
        logBlank();
        console.log(`  Semua ${index.accounts.length} akun akan dihapus!`);
        const confirm = await ask('  Yakin? (y/n): ');
        if (confirm.trim().toLowerCase() !== 'y') { logWarn('Dibatalkan.'); logBlank(); return; }

        for (const a of index.accounts) {
            const file = path.join(ACCOUNTS_DIR, `${a.id}.json`);
            if (fs.existsSync(file)) fs.unlinkSync(file);
        }
        const total = index.accounts.length;
        index.accounts = [];
        index.current_account_id = null;
        saveIndex(index);

        logBlank();
        logOk(`Semua ${total} akun berhasil dihapus.`);
        logWarn('Restart AG Manager agar perubahan diterapkan.');
        logBlank();
        return;
    }

    const nums = input.split(',').map(s => parseInt(s.trim())).filter(n => !isNaN(n) && n >= 1 && n <= index.accounts.length);
    if (!nums.length) { logWarn('Nomor tidak valid.'); logBlank(); return; }

    const targets = [...new Map(nums.map(n => [index.accounts[n-1].id, index.accounts[n-1]])).values()];
    logBlank();
    console.log('  Akun yang akan dihapus:');
    targets.forEach(t => console.log(`    - ${t.email}`));

    const confirm = await ask('\n  Yakin? (y/n): ');
    if (confirm.trim().toLowerCase() !== 'y') { logWarn('Dibatalkan.'); logBlank(); return; }

    const ids = new Set(targets.map(t => t.id));
    for (const id of ids) {
        const file = path.join(ACCOUNTS_DIR, `${id}.json`);
        if (fs.existsSync(file)) fs.unlinkSync(file);
    }
    index.accounts = index.accounts.filter(a => !ids.has(a.id));
    if (ids.has(index.current_account_id))
        index.current_account_id = index.accounts[0]?.id || null;
    saveIndex(index);

    logBlank();
    logOk(`${targets.length} akun berhasil dihapus.`);
    logWarn('Restart AG Manager agar perubahan diterapkan.');
    logBlank();
}

// ── Fitur: Validate Token ─────────────────────────────────────────────────────

async function validateToken(refresh_token) {
    return new Promise((resolve) => {
        const body = new URLSearchParams({
            client_id:     CLIENT_ID,
            client_secret: CLIENT_SECRET,
            refresh_token,
            grant_type:    'refresh_token'
        }).toString();

        const req = https.request({
            hostname: 'oauth2.googleapis.com',
            path:     '/token',
            method:   'POST',
            headers:  { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) }
        }, res => {
            let data = '';
            res.on('data', c => data += c);
            res.on('end', () => {
                try {
                    const json = JSON.parse(data);
                    resolve({ ok: !!json.access_token, error: json.error || null });
                } catch {
                    resolve({ ok: false, error: 'parse_error' });
                }
            });
        });
        req.on('error', () => resolve({ ok: false, error: 'network_error' }));
        req.write(body);
        req.end();
    });
}

async function autoDeleteExpired() {
    const index = loadIndex();
    logBlank();

    if (!index.accounts.length) { logWarn('Tidak ada akun.'); logBlank(); return; }

    logInfo(`Memeriksa ${index.accounts.length} akun...`);
    logBlank();

    let valid = 0, deleted = 0, errNet = 0;
    const deletedEmails = [];
    const idsToDelete = new Set();

    for (let i = 0; i < index.accounts.length; i++) {
        const a       = index.accounts[i];
        const accFile = loadAccountFile(a.id);
        const rt      = accFile?.token?.refresh_token;

        process.stdout.write(`  [${String(i + 1).padStart(2)}/${index.accounts.length}] ${a.email.padEnd(40)} `);

        if (!rt) {
            console.log('✘ no refresh_token → dihapus');
            idsToDelete.add(a.id);
            deletedEmails.push(a.email);
            deleted++;
            continue;
        }

        const result = await validateToken(rt);

        if (result.ok) {
            console.log('✔ valid');
            valid++;
        } else if (result.error === 'network_error') {
            console.log('! network error, dilewati');
            errNet++;
        } else {
            console.log(`✘ ${result.error || 'invalid'} → dihapus`);
            idsToDelete.add(a.id);
            deletedEmails.push(a.email);
            deleted++;
        }
    }

    for (const id of idsToDelete) {
        const file = path.join(ACCOUNTS_DIR, `${id}.json`);
        if (fs.existsSync(file)) fs.unlinkSync(file);
    }
    index.accounts = index.accounts.filter(a => !idsToDelete.has(a.id));
    if (idsToDelete.has(index.current_account_id))
        index.current_account_id = index.accounts[0]?.id || null;
    saveIndex(index);

    logBlank();
    logLine();
    console.log(`  HASIL  ✔ ${valid} valid  |  ✘ ${deleted} dihapus  |  ! ${errNet} network error`);
    logLine();

    if (deletedEmails.length) {
        logBlank();
        console.log('  Akun yang dihapus:');
        deletedEmails.forEach(e => console.log(`    ✘ ${e}`));
    }

    logBlank();
    if (deleted > 0) logWarn('Restart AG Manager agar perubahan diterapkan.');
    logBlank();
}

// ── Fitur: Auto Delete 429 ────────────────────────────────────────────────────

const AUTO429_STATE_FILE = path.join(__dirname, 'auto429.json');
const PROXY_LOGS_DB      = path.join(AG_DIR, 'proxy_logs.db');

let auto429Watcher    = null;
let auto429DeletedEmails = new Set();
let auto429LastTs     = 0;

function isAuto429On() {
    try { return JSON.parse(fs.readFileSync(AUTO429_STATE_FILE, 'utf-8')).enabled === true; }
    catch { return false; }
}

function setAuto429(enabled) {
    fs.writeFileSync(AUTO429_STATE_FILE, JSON.stringify({ enabled }));
}

function deleteAccountById(id) {
    const index = loadIndex();
    const acc   = index.accounts.find(a => a.id === id);
    if (!acc) return null;

    const file = path.join(ACCOUNTS_DIR, `${id}.json`);
    if (fs.existsSync(file)) fs.unlinkSync(file);

    index.accounts = index.accounts.filter(a => a.id !== id);
    if (index.current_account_id === id)
        index.current_account_id = index.accounts[0]?.id || null;
    saveIndex(index);
    return acc.email;
}

// ── Fitur Baru: Auto Disable / Enable Proxy ───────────────────────────────────

const AUTO_DISABLE_PROXY_STATE_FILE = path.join(__dirname, 'autodisableproxy.json');
let autoDisableProxyWatcher = null;
let autoDisableProxyDeletedEmails = new Set();
let autoDisableProxyLastTs = 0;

function getAutoDisableProxyState() {
    try {
        const data = JSON.parse(fs.readFileSync(AUTO_DISABLE_PROXY_STATE_FILE, 'utf-8'));
        return { enabled: !!data.enabled, model: data.model || '' };
    } catch {
        return { enabled: false, model: '' };
    }
}

function isAutoDisableProxyOn() {
    return getAutoDisableProxyState().enabled;
}

function setAutoDisableProxy(enabled, model = '') {
    fs.writeFileSync(AUTO_DISABLE_PROXY_STATE_FILE, JSON.stringify({ enabled, model }));
}

function disableProxyById(id) {
    const index = loadIndex();
    const acc = index.accounts.find(a => a.id === id);
    if (!acc) return null;

    // Ubah di file akun UUID
    const file = path.join(ACCOUNTS_DIR, `${id}.json`);
    if (fs.existsSync(file)) {
        try {
            const accData = JSON.parse(fs.readFileSync(file, 'utf-8'));
            accData.proxy_disabled = true;
            fs.writeFileSync(file, JSON.stringify(accData, null, 2));
        } catch { /* silent */ }
    }

    // Ubah di index
    acc.proxy_disabled = true;
    saveIndex(index);
    return acc.email;
}

function enableAllProxies() {
    const index = loadIndex();
    logBlank();
    let count = 0;

    index.accounts.forEach(a => {
        let isProxyOff = false;

        // Cek status dari file index dulu
        if (a.proxy_disabled === true || a.proxy_disabled === "true") {
            isProxyOff = true;
        }

        // Kalau di index tidak ada, cek status real dari file UUID.json masing-masing
        const file = path.join(ACCOUNTS_DIR, `${a.id}.json`);
        let accData = null;
        if (fs.existsSync(file)) {
            try {
                accData = JSON.parse(fs.readFileSync(file, 'utf-8'));
                if (accData.proxy_disabled === true || accData.proxy_disabled === "true") {
                    isProxyOff = true;
                }
            } catch { /* silent */ }
        }

        // Jika terdeteksi PROXY OFF dari mana saja, nyalakan kembali!
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
        logBlank();
        logOk(`${count} akun berhasil di-enable kembali proxy-nya.`);
        logWarn('Restart AG Manager agar perubahan diterapkan.');
    } else {
        logWarn('Tidak ada akun dengan status PROXY OFF saat ini.');
    }
    logBlank();
}

// ── Fitur Baru: Refresh All Accounts ───────────────────────────────────────────

async function refreshAllAccounts() {
    const index = loadIndex();
    logBlank();
    if (!index.accounts.length) {
        logWarn('Tidak ada akun untuk di-refresh.');
        logBlank();
        return;
    }

    logInfo(`Memulai proses refresh untuk ${index.accounts.length} akun (Batching 10 sekaligus)...`);
    logBlank();

    let sukses = 0, gagal = 0;

    // Fungsi helper untuk refresh 1 akun
    const refreshSingleAccount = async (a, indexNum) => {
        const af = loadAccountFile(a.id);
        const rt = af?.token?.refresh_token;

        if (!rt) {
            return { indexNum, email: a.email, status: 'gagal', message: 'tidak ada refresh_token' };
        }

        try {
            const body = new URLSearchParams({
                client_id: CLIENT_ID,
                client_secret: CLIENT_SECRET,
                refresh_token: rt,
                grant_type: 'refresh_token'
            }).toString();

            const reqResult = await new Promise((resolve) => {
                const req = https.request({
                    hostname: 'oauth2.googleapis.com',
                    path: '/token',
                    method: 'POST',
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) }
                }, res => {
                    let data = '';
                    res.on('data', c => data += c);
                    res.on('end', () => {
                        try {
                            const json = JSON.parse(data);
                            resolve({ ok: !!json.access_token, data: json });
                        } catch {
                            resolve({ ok: false, error: 'parse_error' });
                        }
                    });
                });
                req.on('error', () => resolve({ ok: false, error: 'network_error' }));
                req.write(body);
                req.end();
            });

            if (reqResult.ok) {
                const now = Math.floor(Date.now() / 1000);
                const expiresIn = reqResult.data.expires_in || 3599;
                
                af.token.access_token = reqResult.data.access_token;
                af.token.expires_in = expiresIn;
                af.token.expiry_timestamp = now + expiresIn;

                if (reqResult.data.refresh_token) af.token.refresh_token = reqResult.data.refresh_token;
                if (reqResult.data.id_token) af.token.id_token = reqResult.data.id_token;

                fs.writeFileSync(path.join(ACCOUNTS_DIR, `${a.id}.json`), JSON.stringify(af, null, 2));
                return { indexNum, email: a.email, status: 'sukses', message: 'Token diperbarui' };
            } else {
                return { indexNum, email: a.email, status: 'gagal', message: reqResult.data?.error || reqResult.error || 'invalid_grant' };
            }
        } catch (e) {
            return { indexNum, email: a.email, status: 'gagal', message: e.message };
        }
    };

    // Eksekusi paralel dengan batasan Batch (misal 10 sekaligus)
    const BATCH_SIZE = 10;
    for (let i = 0; i < index.accounts.length; i += BATCH_SIZE) {
        const batch = index.accounts.slice(i, i + BATCH_SIZE);
        const promises = batch.map((acc, idx) => refreshSingleAccount(acc, i + idx + 1));
        
        // Tunggu batch ini selesai semua
        const results = await Promise.all(promises);

        // Print hasil dari batch ini
        for (const res of results) {
            const numStr = `[${String(res.indexNum).padStart(2)}/${index.accounts.length}]`;
            const emailStr = res.email.padEnd(40);
            if (res.status === 'sukses') {
                console.log(`  ${numStr} ${emailStr} ✔ Sukses (${res.message})`);
                sukses++;
            } else {
                console.log(`  ${numStr} ${emailStr} ✘ Gagal (${res.message})`);
                gagal++;
            }
        }
    }

    logBlank();
    logLine();
    console.log(`  SELESAI  ✔ ${sukses} berhasil di-refresh  |  ✘ ${gagal} gagal`);
    logLine();
    
    if (sukses > 0) {
        logBlank();
        
        try {
            logInfo('Melakukan auto-refresh AG Manager di latar belakang...');
            
            // 1. Matikan AG Tools (silent kill)
            try { execSync('taskkill /F /IM antigravity_tools.exe 2>nul', {stdio: 'ignore'}); } catch(e){}
            
            // 2. Buat launcher VBS di Temp untuk restart AG secara full stealth (tanpa pop up GUI sekejap pun)
            if (fs.existsSync(AG_MANAGER_EXE)) {
                const vbsFile = path.join(process.env.TEMP || os.tmpdir(), 'run_ag.vbs');
                fs.writeFileSync(vbsFile, `CreateObject("WScript.Shell").Run """${AG_MANAGER_EXE}""", 0, False`);
                
                // 3. Jalankan file VBS
                execSync(`cscript //nologo "${vbsFile}"`, { windowsHide: true, stdio: 'ignore' });
                logOk('AG Tools berhasil direstart dengan mode diam (Stealth).');
            } else {
                logWarn('AG Tools Exe tidak ditemukan. Silakan restart manual.');
            }
        } catch (e) {
            logWarn('Gagal restart AG Tools otomatis. Silakan tutup dan buka kembali aplikasinya manual.');
        }
    }
    logBlank();
}

function poll429FromDb(lastTs, modelFilter = '') {
    let condition = "status=429 AND timestamp>?";
    if (modelFilter) {
        condition += ` AND model LIKE '%${modelFilter}%'`;
    }
    const script = `
import sqlite3, json, sys
db = r"${PROXY_LOGS_DB.replace(/\\/g, '\\\\')}"
ts = ${lastTs}
try:
    conn = sqlite3.connect(db)
    conn.text_factory = lambda b: b.decode("utf-8", errors="replace")
    cur = conn.cursor()
    cur.execute("SELECT timestamp, account_email FROM request_logs WHERE ${condition} ORDER BY timestamp ASC", (ts,))
    rows = cur.fetchall()
    conn.close()
    print(json.dumps(rows))
except Exception as e:
    print("[]")
`;
    try {
        const out = execFileSync('C:\\Python313\\python.exe', ['-c', script], { encoding: 'utf-8', timeout: 5000 });
        return JSON.parse(out.trim() || '[]');
    } catch { return []; }
}

// ==================== MONITOR 1: AUTO DELETE ====================
function startAuto429Monitor() {
    if (auto429Watcher) return;

    auto429LastTs = 0;

    logOk('[AUTO-DELETE 429] Monitor aktif — baca dari Traffic Logs DB, polling setiap 5 detik...');

    auto429Watcher = setInterval(() => {
        const rows = poll429FromDb(auto429LastTs);
        if (!rows.length) return;

        auto429LastTs = Math.max(...rows.map(r => r[0]));

        const index = loadIndex();

        for (const [ts, email] of rows) {
            if (!email) continue;
            if (auto429DeletedEmails.has(email)) continue;

            const acc = index.accounts.find(a => a.email === email);
            if (!acc) continue;

            auto429DeletedEmails.add(email);

            const timeStr = new Date(ts).toLocaleTimeString('id-ID', { hour12: false });
            logWarn(`[AUTO-DELETE 429] ${email} kena 429 di Traffic Logs (${timeStr}) → menghapus...`);

            const deletedEmail = deleteAccountById(acc.id);
            if (deletedEmail) {
                const remaining = loadIndex().accounts.filter(a => !a.disabled).length;
                logOk(`[AUTO-DELETE 429] Akun ${deletedEmail} → dihapus. Sisa aktif: ${remaining}`);
            }
        }
    }, 5000);
}

function stopAuto429Monitor() {
    if (auto429Watcher) {
        clearInterval(auto429Watcher);
        auto429Watcher = null;
        auto429LastTs  = 0;
        auto429DeletedEmails.clear();
        logWarn('[AUTO-DELETE 429] Monitor dihentikan.');
    }
}

function toggleAuto429() {
    if (isAutoDisableProxyOn()) {
        logWarn("Matikan dulu 'Auto Disable Proxy' sebelum menyalakan ini.");
        return false;
    }
    const current = isAuto429On();
    const newState = !current;
    setAuto429(newState);
    if (newState) {
        startAuto429Monitor();
    } else {
        stopAuto429Monitor();
    }
    return newState;
}

// ==================== MONITOR 2: AUTO DISABLE PROXY ====================
function startAutoDisableProxyMonitor() {
    if (autoDisableProxyWatcher) return;

    autoDisableProxyLastTs = 0;
    const state = getAutoDisableProxyState();
    const modelStr = state.model ? ` (Model filter: ${state.model})` : ' (Semua model)';

    logOk(`[AUTO-DISABLE PROXY 429] Monitor aktif — baca dari Traffic Logs DB, polling setiap 5 detik...${modelStr}`);

    autoDisableProxyWatcher = setInterval(() => {
        const rows = poll429FromDb(autoDisableProxyLastTs, state.model);
        if (!rows.length) return;

        autoDisableProxyLastTs = Math.max(...rows.map(r => r[0]));

        const index = loadIndex();

        for (const [ts, email] of rows) {
            if (!email) continue;
            if (autoDisableProxyDeletedEmails.has(email)) continue;

            const acc = index.accounts.find(a => a.email === email);
            if (!acc) continue;

            autoDisableProxyDeletedEmails.add(email);

            const timeStr = new Date(ts).toLocaleTimeString('id-ID', { hour12: false });
            logWarn(`[AUTO-DISABLE PROXY 429] ${email} kena 429 di Traffic Logs (${timeStr}) → disable proxy...`);

            const disabledEmail = disableProxyById(acc.id);
            if (disabledEmail) {
                const remaining = loadIndex().accounts.filter(a => !a.disabled && !a.proxy_disabled).length;
                logOk(`[AUTO-DISABLE PROXY 429] Akun ${disabledEmail} → PROXY OFF. Sisa aktif: ${remaining}`);
            }
        }
    }, 5000);
}

function stopAutoDisableProxyMonitor() {
    if (autoDisableProxyWatcher) {
        clearInterval(autoDisableProxyWatcher);
        autoDisableProxyWatcher = null;
        autoDisableProxyLastTs  = 0;
        autoDisableProxyDeletedEmails.clear();
        logWarn('[AUTO-DISABLE PROXY 429] Monitor dihentikan.');
    }
}

async function toggleAutoDisableProxy() {
    if (isAuto429On()) {
        logWarn("Matikan dulu 'Auto Delete 429' sebelum menyalakan ini.");
        return false;
    }
    const state = getAutoDisableProxyState();
    const newState = !state.enabled;
    
    if (newState) {
        // Tanya filter model saat dihidupkan
        logBlank();
        const modelInput = await ask('  Masukkan keyword model untuk dideteksi (misal: "claude", "gpt")\n  Atau kosongkan (Enter) untuk mendeteksi semua model: ');
        const modelFilter = modelInput.trim().toLowerCase();
        
        setAutoDisableProxy(true, modelFilter);
        startAutoDisableProxyMonitor();
    } else {
        setAutoDisableProxy(false, '');
        stopAutoDisableProxyMonitor();
    }
    return newState;
}

const GUI_CONFIG     = path.join(AG_DIR, 'gui_config.json');

function loadGuiConfig() {
    try { return JSON.parse(fs.readFileSync(GUI_CONFIG, 'utf-8')); }
    catch { return null; }
}

function saveGuiConfig(cfg) {
    fs.writeFileSync(GUI_CONFIG, JSON.stringify(cfg, null, 2));
}

function isAgRunning() {
    try {
        const out = execSync('tasklist', { encoding: 'utf-8' });
        return out.toLowerCase().includes('antigravity_tools.exe');
    } catch { return false; }
}

function ensureProxyConfig() {
    const cfg = loadGuiConfig();
    if (!cfg) return false;

    let changed = false;
    if (!cfg.proxy) cfg.proxy = {};
    if (!cfg.proxy.enabled)    { cfg.proxy.enabled    = true; changed = true; }
    if (!cfg.proxy.auto_start) { cfg.proxy.auto_start = true; changed = true; }

    if (changed) {
        saveGuiConfig(cfg);
        return true; 
    }
    return false;
}

async function ensureAgRunning() {
    if (isAgRunning()) return 'already';

    if (!fs.existsSync(AG_MANAGER_EXE)) {
        logWarn(`AG Manager exe tidak ditemukan: ${AG_MANAGER_EXE}`);
        return 'not_found';
    }

    const vbsPath = path.join(process.env.TEMP || os.tmpdir(), 'run_ag.vbs');
    
    // Tulis VB script ke sistem yang memaksa argumen rahasia "0" = Completely Hidden
    fs.writeFileSync(vbsPath, `CreateObject("WScript.Shell").Run """${AG_MANAGER_EXE}""", 0, False`);

    try {
        // Eksekusi Windows Script Host secara background
        execSync(`cscript //nologo "${vbsPath}"`, { windowsHide: true, stdio: 'ignore' });
    } catch {
        logWarn('Gagal menjalankan VBScript, metode refresh akan dilewati.');
    }

    for (let i = 0; i < 8; i++) {
        await delay(1000);
        if (isAgRunning()) return 'launched';
    }
    return 'timeout';
}

async function autoStartServices() {
    const configChanged = ensureProxyConfig();
    const agStatus = await ensureAgRunning();

    if (agStatus === 'launched') {
        logOk('AG Manager berhasil distart.');
        if (configChanged) logOk('Proxy service diaktifkan (enabled + auto_start = true).');
        logBlank();
        await delay(500);
    } else if (agStatus === 'timeout') {
        logWarn('AG Manager dilaunch tapi belum terdeteksi running. Tunggu sebentar...');
        logBlank();
        await delay(500);
    } else if (agStatus === 'already' && !configChanged) {
        logOk('AG Manager sudah running. Proxy service aktif.');
        logBlank();
        await delay(400);
    } else if (agStatus === 'already' && configChanged) {
        logInfo('Proxy config diupdate (enabled/auto_start). Merestart AG Manager...');
        try {
            execSync('taskkill /F /IM antigravity_tools.exe', { encoding: 'utf-8' });
        } catch { /* mungkin sudah mati */ }
        await delay(1000);
        const relaunch = await ensureAgRunning();
        if (relaunch === 'launched') {
            logOk('AG Manager direstart dan proxy service aktif.');
        } else {
            logWarn('AG Manager gagal direstart. Restart manual ya.');
        }
        logBlank();
        await delay(500);
    }
}

// ── Header & Menu ─────────────────────────────────────────────────────────────

function printHeader() {
    console.log('');
    console.log('       ██████╗  ██████╗  ██████╗████████╗██╗     ');
    console.log('      ██╔══██╗██╔════╝ ██╔════╝╚══██╔══╝██║     ');
    console.log('      ███████║██║  ███╗██║         ██║   ██║     ');
    console.log('      ██╔══██║██║   ██║██║         ██║   ██║     ');
    console.log('      ██║  ██║╚██████╔╝╚██████╗    ██║   ███████╗');
    console.log('      ╚═╝  ╚═╝ ╚═════╝  ╚═════╝    ╚═╝   ╚══════╝');
    console.log('               v1.0  —  by CROPz               ');
}

async function main() {
    await autoStartServices();
    if (isAuto429On()) {
        startAuto429Monitor();
    }
    while (true) {
        clear();
        printHeader();

        const index    = loadIndex();
        const total    = index.accounts.length;
        const active   = index.accounts.filter(a => !a.disabled).length;
        const disabled = total - active;

        logBlank();
        logLine();
        console.log(`  Akun: ${total} total  |  ${active} aktif  |  ${disabled} disabled`);
        logLine();
        logBlank();
        const auto429Label = isAuto429On() ? 'AUTO DELETE 429                   [ON] ' : 'AUTO DELETE 429                   [OFF]';
        const autoDisableProxyState = getAutoDisableProxyState();
        let autoDisableProxyLabel = 'AUTO DISABLE PROXY 429            [OFF]';
        if (autoDisableProxyState.enabled) {
            autoDisableProxyLabel = `AUTO DISABLE PROXY 429            [ON]  (Filter: ${autoDisableProxyState.model || 'Semua'})`;
        }

        console.log('  1.  TAMBAH AKUN BARU');
        console.log('  2.  LIST SEMUA AKUN');
        console.log('  3.  HAPUS AKUN');
        console.log('  4.  AUTO DELETE EXPIRED');
        console.log(`  5.  ${auto429Label}`);
        console.log('  6.  AUTO ENABLE PROXY');
        console.log(`  7.  ${autoDisableProxyLabel}`);
        console.log('  8.  REFRESH ALL ACCOUNTS');
        console.log('  0.  KELUAR');
        logBlank();

        const choice = await ask('  Pilih menu: ');

        switch (choice.trim()) {
            case '1': clear(); printHeader(); logBlank(); logLine(); console.log('  TAMBAH AKUN'); logLine(); await addAccounts(); await ask('  Tekan Enter untuk kembali...'); break;
            case '2': clear(); printHeader(); logBlank(); logLine(); console.log('  DAFTAR AKUN'); logLine(); listAccounts(); await ask('  Tekan Enter untuk kembali...'); break;
            case '3': clear(); printHeader(); logBlank(); logLine(); console.log('  HAPUS AKUN'); logLine(); await deleteAccount(); await ask('  Tekan Enter untuk kembali...'); break;
            case '4': clear(); printHeader(); logBlank(); logLine(); console.log('  AUTO DELETE EXPIRED'); logLine(); await autoDeleteExpired(); await ask('  Tekan Enter untuk kembali...'); break;
            case '5': { const on = toggleAuto429(); logBlank(); if(on !== false) logOk(`Auto Delete 429 sekarang: ${on ? 'ON' : 'OFF'}`); logBlank(); await ask('  Tekan Enter untuk kembali...'); break; }
            case '6': clear(); printHeader(); logBlank(); logLine(); console.log('  AUTO ENABLE PROXY'); logLine(); enableAllProxies(); await ask('  Tekan Enter untuk kembali...'); break;
            case '7': { const on = await toggleAutoDisableProxy(); logBlank(); if(on !== false) logOk(`Auto Disable Proxy 429 sekarang: ${on ? 'ON' : 'OFF'}`); logBlank(); await ask('  Tekan Enter untuk kembali...'); break; }
            case '8': clear(); printHeader(); logBlank(); logLine(); console.log('  REFRESH ALL ACCOUNTS'); logLine(); await refreshAllAccounts(); await ask('  Tekan Enter untuk kembali...'); break;
            case '0': logBlank(); console.log('  Bye!'); logBlank(); rl.close(); process.exit(0); break;
            default:  logWarn('Pilihan tidak valid.'); await delay(200);
        }
    }
}

main().catch(err => { console.error(err); rl.close(); });