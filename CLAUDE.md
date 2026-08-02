# CLAUDE.md — agctlv2

> Panduan singkat untuk Claude Code saat bekerja di repo ini.

## Apa ini

CLI otomatisasi Node.js untuk Antigravity Manager. Satu file utama: `manage.js` (~1300 baris). Pakai Puppeteer untuk OAuth Google headless, baca/tulis JSON akun lokal, dan monitor SQLite `proxy_logs.db` untuk deteksi 429.

## Quick Start

```bash
npm install        # install puppeteer
node manage.js     # jalankan CLI
```

## Yang Harus Diketahui

- **Satu file monolith**: semua logika ada di `manage.js`. Tidak ada modul terpisah.
- **CommonJS**: pakai `require`, bukan `import`.
- **Windows-first**: banyak fitur Windows-only. Selalu cek `process.platform` sebelum panggil Windows API (`tasklist`, `taskkill`, VBScript, `LOCALAPPDATA`).
- **Path runtime**: `HOME_DIR` = `USERPROFILE || HOME || os.homedir()`. `AG_DIR` = `AG_TOOLS_DIR env || ~/.antigravity_tools`.
- **Puppeteer**: Linux butuh `PUPPETEER_EXECUTABLE_PATH` atau Chromium di path standar. Mode `headless: 'shell'`.
- **Python**: fitur 429 butuh Python terinstal. Deteksi dinamis: `python` → `python3` → `py`.
- **State files**: `auto429.json`, `autodisableproxy.json` — tidak di-commit (ada di `.gitignore`).
- **`akun.txt`**: file input akun, format `email:password` atau `email|password`. Tidak di-commit.

## Menu CLI

1. Tambah Akun (concurrent headless OAuth)
2. List Akun
3. Hapus Akun
4. Lihat Kuota (progress bar per bucket)
5. Auto Delete Expired (validasi refresh token)
6. Auto Delete 429 (monitor SQLite, toggle on/off)
7. Auto Enable Proxy (reset semua proxy_disabled)
8. Auto Disable Proxy 429 (monitor + disable proxy, filter model)
9. Refresh All Accounts (refresh token batch)

## Aturan Edit

- Jangan pecah ke multi-file kecuali diminta.
- Ikuti style yang ada: 4-space indent, single quotes, komentar Bahasa Indonesia.
- Logging pakai helper yang sudah ada: `logInfo`, `logOk`, `logWarn`, `logError`.
- Jangan hardcode path Python atau path browser.
- SQL: selalu parameterized query.
- Validasi: `node --check manage.js` setelah edit.

## Git

- Upstream: `HaikalFadhilah/agctlv2`
- Fork: `neiaki/agctlv2`
- Conventional commits, branch dari `main`.
