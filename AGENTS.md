# AGENTS.md — agctlv2

> Instruksi untuk AI agent yang bekerja di repo **agctlv2**.

---

## Project Overview

**agctlv2** (Antigravity Control v2) adalah CLI interaktif berbasis Node.js untuk mengelola akun, proxy, dan kuota [Antigravity Manager](https://github.com/lbjarq/Antigravity-Manager). Dibangun dengan Puppeteer untuk OAuth headless.

- **Bahasa**: Node.js (CommonJS, `.js`)
- **Runtime**: Node.js v21+ disarankan
- **Dependency utama**: `puppeteer`
- **Entry point**: `manage.js`
- **Platform**: Windows (utama) · Linux (didukung dengan batasan)

## Menjalankan

```bash
npm install
node manage.js
```

## Struktur Project

```
agctlv2/
├── manage.js              # Entry point — menu CLI dan orchestration
├── lib/
│   ├── platform.js        # Runtime adapter: paths, browser, process, python
│   ├── credentials.js     # OAuth credentials + device profile (env vars support)
│   ├── store.js           # AccountStore: atomic write, load/save index & akun
│   ├── oauth.js           # OAuth flow: callback server, token exchange, refresh
│   ├── monitor.js         # 429 monitor: polling SQLite, delete/disable callback
│   └── ui.js              # CLI helpers: logging, formatting, readline
├── package.json
├── .env.example           # Template env vars
├── .gitignore
├── akun.txt               # Input akun (TIDAK di-commit)
├── auto429.json           # State monitor (TIDAK di-commit)
└── autodisableproxy.json  # State monitor (TIDAK di-commit)
```

## Dependency Graph

```
manage.js
├── lib/platform.js     (mandiri)
├── lib/credentials.js  (mandiri)
├── lib/store.js        → platform.js
├── lib/oauth.js        → credentials.js, store.js
├── lib/monitor.js      → platform.js, store.js
└── lib/ui.js           (mandiri)
```

Tidak ada circular dependency.

## Konvensi Kode

- **Module system**: CommonJS (`require`), bukan ESM.
- **Style**: 4-space indent, single quotes.
- **Logging**: Gunakan helper dari `lib/ui.js`: `logInfo`, `logOk`, `logWarn`, `logBlank`.
- **Komentar**: Bahasa Indonesia, jelaskan "kenapa" bukan "apa".
- **Tidak ada comments yang tidak pernah** — kode harus self-documenting.
- **Error handling**: Jangan pakai bare `catch {}` — selalu log atau beri komentar kenapa diabaikan.

## Modul

### `lib/platform.js`
Path dan runtime adapter. Semua akses ke `process.env`, `os.homedir()`, deteksi browser, deteksi Python, dan Windows process management (`tasklist`, `taskkill`) harus lewat modul ini.

### `lib/credentials.js`
OAuth credentials. Bisa di-override via env vars (`AGCTL_CLIENT_ID`, `AGCTL_CLIENT_SECRET`). Jangan hardcode credentials baru.

### `lib/store.js`
AccountStore. Semua baca/tulis `accounts.json` dan file akun UUID lewat modul ini. Menggunakan atomic write (write-tmp + rename).

### `lib/oauth.js`
OAuth flow: callback server (dengan state validation), token exchange, token refresh, JWT decode. Jangan tulis HTTP request ke Google langsung di `manage.js` — gunakan modul ini.

### `lib/monitor.js`
429 monitor. Pola callback: `createDeleteMonitor(model)` / `createDisableProxyMonitor(model)` return object dengan `.start()`, `.stop()`, `.isActive()`.

### `lib/ui.js`
UI helpers. `rl`, `ask`, `clear`, logging, formatting. Jangan buat `readline` baru di modul lain.

## Hal Penting yang Harus Diperhatikan

### Security
- **OAuth state validation**: Callback server memvalidasi `state` parameter.
- **SQL injection**: `lib/monitor.js` menggunakan parameterized query.
- **Atomic write**: `lib/store.js` menggunakan write-tmp + rename.
- **Jangan commit** `akun.txt`, `auto429.json`, `autodisableproxy.json`.

### Platform Compatibility
- Semua Windows-only API di-guard dengan `IS_WIN` dari `lib/platform.js`.
- Jangan akses `process.env.TEMP` atau `process.env.LOCALAPPDATA` langsung — gunakan `getTempDir()` / `LOCAL_APP_DATA`.

### Puppeteer
- Browser path: `getBrowserPath()` dari `lib/platform.js`.
- Headless mode: `'shell'`.
- Setiap worker OAuth wajib pakai port unik via `findFreePort()` dari `lib/oauth.js`.

### Python
- Deteksi via `findPython()` dari `lib/platform.js`.
- Script Python menerima argumen via `sys.argv`, bukan string interpolation.

## Testing

Belum ada test framework. Validasi manual:

```bash
node --check manage.js          # syntax check
node --check lib/*.js           # syntax check semua modul
node manage.js                  # jalankan dan cek menu
```

## Git Workflow

- **Branch naming**: `fix/deskripsi`, `feat/deskripsi`, `refactor/deskripsi`.
- **Conventional commits**: `fix:`, `feat:`, `docs:`, `chore:`, `refactor:`.
- **Jangan push langsung ke `main`**.
- PR ke `HaikalFadhilah/agctlv2` (upstream) dari fork.
