const https = require('https');
const http = require('http');
const net = require('net');
const { randomUUID } = require('crypto');
const { CLIENT_ID, CLIENT_SECRET, SCOPES, DEVICE_PROFILE } = require('./credentials');
const { saveAccount } = require('./store');

const CALLBACK_TIMEOUT_MS = 30000;
const HTTP_TIMEOUT_MS = 15000;
const BROWSER_TIMEOUT_MS = 90000;
const MAX_RETRIES = 3;

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

function findFreePort() {
    return new Promise((resolve, reject) => {
        const srv = net.createServer();
        srv.listen(0, '127.0.0.1', () => {
            const port = srv.address().port;
            srv.close(() => resolve(port));
        });
        srv.on('error', reject);
    });
}

function startCallbackServer(port, expectedState) {
    return new Promise((resolve, reject) => {
        let settled = false;

        const server = http.createServer((req, res) => {
            const url = new URL(req.url, `http://localhost:${port}`);

            if (req.method !== 'GET' || url.pathname !== '/oauth-callback') {
                res.writeHead(404);
                res.end('Not found');
                return;
            }

            const code = url.searchParams.get('code');
            const state = url.searchParams.get('state');
            const errorParam = url.searchParams.get('error');

            if (errorParam) {
                res.writeHead(200, { 'Content-Type': 'text/html' });
                res.end(`<html><body><h2>OAuth error: ${errorParam}</h2></body></html>`);
                if (!settled) { settled = true; try { server.close(); } catch (e) {} reject(new Error(`OAuth error: ${errorParam}`)); }
                return;
            }

            if (state !== expectedState) {
                res.writeHead(200, { 'Content-Type': 'text/html' });
                res.end('<html><body><h2>State mismatch — akses ditolak.</h2></body></html>');
                if (!settled) { settled = true; try { server.close(); } catch (e) {} reject(new Error('OAuth state mismatch — kemungkinan CSRF')); }
                return;
            }

            if (!code) {
                res.writeHead(200, { 'Content-Type': 'text/html' });
                res.end('<html><body><h2>Kode OAuth tidak ditemukan.</h2></body></html>');
                if (!settled) { settled = true; try { server.close(); } catch (e) {} reject(new Error('OAuth code tidak ditemukan di callback')); }
                return;
            }

            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end('<html><body><h2>Login berhasil! Kamu bisa tutup tab ini.</h2></body></html>');
            if (!settled) { settled = true; try { server.close(); } catch (e) {} resolve({ code, redirectUri: `http://localhost:${port}/oauth-callback` }); }
        });

        server.on('error', (e) => {
            if (!settled) { settled = true; reject(e); }
        });
        server.listen(port, '127.0.0.1');

        setTimeout(() => {
            if (!settled) {
                settled = true;
                try { server.close(); } catch (e) { /* server mungkin sudah closed */ }
                reject(new Error('Callback server timeout'));
            }
        }, CALLBACK_TIMEOUT_MS);
    });
}

function httpsPost(hostname, path, body) {
    return new Promise((resolve, reject) => {
        const req = https.request({
            hostname, path, method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) },
            timeout: HTTP_TIMEOUT_MS
        }, (res) => {
            let data = '';
            res.on('data', c => data += c);
            res.on('end', () => {
                try {
                    const parsed = JSON.parse(data);
                    resolve({ statusCode: res.statusCode, data: parsed });
                } catch (e) {
                    reject(new Error(`HTTP ${res.statusCode}: parse error`));
                }
            });
        });
        req.on('timeout', () => { req.destroy(); reject(new Error('HTTP request timeout')); });
        req.on('error', reject);
        req.write(body);
        req.end();
    });
}

async function withRetry(fn, label) {
    let lastErr;
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
        try {
            return await fn();
        } catch (e) {
            lastErr = e;
            if (e.message.includes('invalid_grant') || e.message.includes('CSRF') || e.message.includes('state mismatch')) {
                throw e;
            }
            if (attempt < MAX_RETRIES - 1) {
                await delay(1000 * Math.pow(2, attempt));
            }
        }
    }
    throw lastErr;
}

async function exchangeCodeForTokens(code, redirectUri) {
    return withRetry(async () => {
        const body = new URLSearchParams({
            code, client_id: CLIENT_ID, client_secret: CLIENT_SECRET,
            redirect_uri: redirectUri, grant_type: 'authorization_code'
        }).toString();

        const { statusCode, data } = await httpsPost('oauth2.googleapis.com', '/token', body);

        if (data.error) {
            throw new Error(data.error_description || data.error);
        }
        if (statusCode >= 500) {
            throw new Error(`Google server error ${statusCode}`);
        }
        if (statusCode >= 400) {
            throw new Error(`HTTP ${statusCode}: ${data.error || 'unknown'}`);
        }
        return data;
    }, 'exchangeCodeForTokens');
}

function classifyTokenError(error) {
    const msg = (error || '').toLowerCase();
    if (msg.includes('invalid_grant')) return 'invalid_grant';
    if (msg.includes('rate_limit') || msg.includes('rate limit') || msg.includes('quota')) return 'rate_limit';
    if (msg.includes('server error') || msg.includes('500') || msg.includes('503')) return 'server_error';
    if (msg.includes('network') || msg.includes('timeout') || msg.includes('econnrefused')) return 'network_error';
    return 'unknown';
}

async function validateToken(refresh_token) {
    try {
        const body = new URLSearchParams({
            client_id: CLIENT_ID, client_secret: CLIENT_SECRET,
            refresh_token, grant_type: 'refresh_token'
        }).toString();
        const { statusCode, data } = await httpsPost('oauth2.googleapis.com', '/token', body);
        if (data.access_token) return { ok: true, error: null };
        return { ok: false, error: data.error || `HTTP ${statusCode}`, classification: classifyTokenError(data.error) };
    } catch (e) {
        return { ok: false, error: e.message, classification: classifyTokenError(e.message) };
    }
}

async function refreshAccessToken(refresh_token) {
    try {
        const body = new URLSearchParams({
            client_id: CLIENT_ID, client_secret: CLIENT_SECRET,
            refresh_token, grant_type: 'refresh_token'
        }).toString();
        const { statusCode, data } = await httpsPost('oauth2.googleapis.com', '/token', body);
        if (data.access_token) return { ok: true, data };
        return { ok: false, error: data.error || `HTTP ${statusCode}`, classification: classifyTokenError(data.error) };
    } catch (e) {
        return { ok: false, error: e.message, classification: classifyTokenError(e.message) };
    }
}

function decodeJWT(token) {
    try {
        return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf-8'));
    } catch (e) { return {}; }
}

function saveAccountToAG(accountData) {
    const id  = randomUUID();
    const now = Math.floor(Date.now() / 1000);
    saveAccount({
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
    });
    return id;
}

function buildAuthUrl(redirectUri, state) {
    return `https://accounts.google.com/o/oauth2/v2/auth?client_id=${CLIENT_ID}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=${encodeURIComponent(SCOPES)}&access_type=offline&prompt=consent&include_granted_scopes=true&state=${state}`;
}

function redactToken(token) {
    if (!token || typeof token !== 'string') return '[none]';
    if (token.length <= 10) return '[redacted]';
    return token.slice(0, 5) + '...' + token.slice(-3);
}

function wipeString(str) {
    if (typeof str !== 'string') return;
    for (let i = 0; i < str.length; i++) str[i] = '\0';
}

module.exports = {
    findFreePort, startCallbackServer,
    exchangeCodeForTokens, validateToken, refreshAccessToken,
    decodeJWT, saveAccountToAG, buildAuthUrl,
    classifyTokenError, redactToken, wipeString,
    BROWSER_TIMEOUT_MS, CALLBACK_TIMEOUT_MS, MAX_RETRIES
};
