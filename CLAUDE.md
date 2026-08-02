# CLAUDE.md — agctlv2

> Panduan singkat untuk Claude Code saat bekerja di repo ini.

## Apa ini

CLI otomatisasi Node.js untuk Antigravity Manager. Entry point: `manage.js` (~650 baris). Logic dipecah ke modul `lib/`.

## Quick Start

```bash
npm install
node manage.js
```

## Struktur Modul

| File | Tugas |
|------|-------|
| `manage.js` | Menu CLI, orchestration, fitur utama |
| `lib/platform.js` | Paths, browser, Python, process management (IS_WIN guard) |
| `lib/credentials.js` | OAuth credentials (env vars + fallback) |
| `lib/store.js` | AccountStore — atomic write, load/save index & akun |
| `lib/oauth.js` | OAuth callback server, token exchange/refresh, JWT decode |
| `lib/monitor.js` | 429 monitor — polling SQLite, callback pattern |
| `lib/ui.js` | Logging, readline, formatting helpers |

Dependency graph: `manage.js → semua lib/`. Tidak ada circular dependency.

## Aturan

- **CommonJS** (`require`), bukan ESM.
- Akses `process.env`, `tasklist`, `taskkill`, Python detection — **wajib lewat `lib/platform.js`**.
- Baca/tulis `accounts.json` dan file akun — **wajib lewat `lib/store.js`**.
- HTTP request ke Google OAuth — **wajib lewat `lib/oauth.js`**.
- Logging — **wajib pakai `lib/ui.js`** helpers (`logInfo`, `logOk`, `logWarn`).
- Jangan buat `readline` baru di modul lain — pakai `rl` dari `lib/ui.js`.
- SQL: selalu parameterized query.
- Error handling: jangan bare `catch {}` — log atau beri komentar.
- Windows-only API: guard dengan `IS_WIN` dari `lib/platform.js`.

## Menu CLI

1. Tambah Akun (concurrent headless OAuth)
2. List Akun
3. Hapus Akun
4. Lihat Kuota (progress bar per bucket)
5. Auto Delete Expired (validasi refresh token)
6. Auto Delete 429 (monitor SQLite, toggle)
7. Auto Enable Proxy
8. Auto Disable Proxy 429 (monitor + filter model)
9. Refresh All Accounts (batch refresh + stealth restart)

## Validasi

```bash
node --check manage.js && node --check lib/*.js
```

## Git

- Upstream: `HaikalFadhilah/agctlv2`
- Fork: `neiaki/agctlv2`
- Conventional commits, branch dari `main`.
