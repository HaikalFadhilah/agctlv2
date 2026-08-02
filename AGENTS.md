# AGENTS.md — agctlv2

> Instruksi untuk AI agent yang bekerja di repo **agctlv2**.

---

## Project Overview

**agctlv2** (Antigravity Control v2) adalah CLI interaktif berbasis Node.js untuk mengelola akun, proxy, dan kuota [Antigravity Manager](https://github.com/lbjarq/Antigravity-Manager). Dibangun dengan Puppeteer untuk OAuth headless.

- **Bahasa**: Node.js (CommonJS, `.js`)
- **Runtime**: Node.js v21+ disarankan
- **Dependency utama**: `puppeteer`
- **Entry point**: `manage.js`
- **Platform utama**: Windows (dukungan Linux sedang dalam pengembangan)

## Menjalankan

```bash
npm install
node manage.js
```

## Struktur Project

```
agctlv2/
├── manage.js              # Source code utama (semua logika ada di sini)
├── package.json           # NPM manifest
├── .gitignore             # node_modules, akun.txt, state JSON, log
├── AGENTS.md              # Instruksi untuk AI agent
├── CLAUDE.md              # Quick reference untuk Claude Code
├── akun.txt               # File input akun (TIDAK di-commit)
├── auto429.json           # State Auto Delete 429 (TIDAK di-commit)
├── autodisableproxy.json  # State Auto Disable Proxy (TIDAK di-commit)
└── README.md
```

## Konvensi Kode

- **Module system**: CommonJS (`require`), bukan ESM.
- **Style**: 4-space indent, single quotes.
- **Logging**: Gunakan helper `logInfo`, `logOk`, `logWarn`, `logError` yang sudah ada.
- **Komentar**: Bahasa Indonesia, jelaskan "kenapa" bukan "apa".
- **Tidak ada comments yang tidak perlu** — kode harus self-documenting.

## Hal Penting yang Harus Diperhatikan

### Security
- **Jangan hardcode credentials** — `CLIENT_ID` dan `CLIENT_SECRET` sudah ada di kode (milik upstream), jangan tambah yang baru.
- **Jangan commit** `akun.txt`, `auto429.json`, `autodisableproxy.json` — sudah ada di `.gitignore`.
- **SQL injection**: Selalu gunakan parameterized query untuk SQLite, jangan string interpolation.

### Platform Compatibility
- Banyak fitur Windows-only (`tasklist`, `taskkill`, VBScript stealth, `LOCALAPPDATA`).
- Selalu gunakan `process.platform` guard sebelum memanggil Windows API.
- Path home direktori sudah menggunakan fallback: `USERPROFILE || HOME || os.homedir()`.

### Puppeteer
- Browser path di Linux: gunakan env `PUPPETEER_EXECUTABLE_PATH` atau deteksi `/usr/bin/chromium`.
- Headless mode: `'shell'` untuk menghindari deteksi bot.
- Setiap worker OAuth **wajib** pakai port unik via `findFreePort()`.

### Python Dependency
- Fitur Auto Delete 429 dan Auto Disable Proxy butuh Python untuk baca SQLite.
- Deteksi python sekarang dinamis (`python` → `python3` → `py`).
- Script Python menerima argumen via `sys.argv`, bukan string interpolation.

## Testing

Belum ada test framework. Validasi manual:

```bash
node --check manage.js     # syntax check
node manage.js             # jalankan dan cek menu
```

## Git Workflow

- **Branch naming**: `fix/deskripsi` atau `feat/deskripsi`.
- **Conventional commits**: `fix:`, `feat:`, `docs:`, `chore:`, `refactor:`.
- **Jangan push langsung ke `main`**.
- PR ke `HaikalFadhilah/agctlv2` (upstream) dari fork.
