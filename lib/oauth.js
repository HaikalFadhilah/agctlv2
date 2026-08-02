const https = require('https');
const http = require('http');
const net = require('net');
const { randomUUID } = require('crypto');
const { CLIENT_ID, CLIENT_SECRET, SCOPES } = require('./credentials');
const { saveAccount } = require('./store');
const { DEVICE_PROFILE } = require('./credentials');

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
        const server = http.createServer((req, res) => {
            const url = new URL(req.url, `http://localhost:${port}`);
            const code = url.searchParams.get('code');
            const state = url.searchParams.get('state');

            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end('<html><body><h2>Login berhasil! Kamu bisa tutup tab ini.</h2></body></html>');

            if (state !== expectedState) {
                reject(new Error('OAuth state mismatch — kemungkinan CSRF'));
                return;
            }

            server.close();
            resolve({ code, redirectUri: `http://localhost:${port}/oauth-callback` });
        });
        server.on('error', reject);
        server.listen(port, '127.0.0.1');

        setTimeout(() => {
            try { server.close(); } catch (e) { /* server mungkin sudah closed */ }
            reject(new Error('Callback server timeout'));
        }, 30000);
    });
}

function exchangeCodeForTokens(code, redirectUri) {
    return new Promise((resolve, reject) => {
        const body = new URLSearchParams({
            code, client_id: CLIENT_ID, client_secret: CLIENT_SECRET,
            redirect_uri: redirectUri, grant_type: 'authorization_code'
        }).toString();

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

function validateToken(refresh_token) {
    return new Promise((resolve) => {
        const body = new URLSearchParams({
            client_id: CLIENT_ID, client_secret: CLIENT_SECRET,
            refresh_token, grant_type: 'refresh_token'
        }).toString();

        const req = https.request({
            hostname: 'oauth2.googleapis.com', path: '/token', method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) }
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

function refreshAccessToken(refresh_token) {
    return new Promise((resolve) => {
        const body = new URLSearchParams({
            client_id: CLIENT_ID, client_secret: CLIENT_SECRET,
            refresh_token, grant_type: 'refresh_token'
        }).toString();

        const req = https.request({
            hostname: 'oauth2.googleapis.com', path: '/token', method: 'POST',
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
}

function decodeJWT(token) {
    try {
        return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf-8'));
    } catch { return {}; }
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

module.exports = {
    findFreePort, startCallbackServer,
    exchangeCodeForTokens, validateToken, refreshAccessToken,
    decodeJWT, saveAccountToAG, buildAuthUrl
};
