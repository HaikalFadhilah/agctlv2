<div align="center">

# AGCTL-v2 — Antigravity Control

**CLI otomatisasi untuk mengelola akun, proxy, dan kuota [Antigravity Manager](https://github.com/lbjarq/Antigravity-Manager)**

[![Node.js](https://img.shields.io/badge/Node.js-21+-339933?style=flat-square&logo=node.js&logoColor=white)](https://nodejs.org)
[![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20Linux-lightgrey?style=flat-square)](#prasyarat)
[![License](https://img.shields.io/badge/license-MIT-blue?style=flat-square)](LICENSE)

</div>

---

## Daftar Isi

- [Fitur](#fitur)
- [Prasyarat](#prasyarat)
- [Instalasi](#instalasi)
- [Format akun.txt](#format-akuntxt)
- [Penggunaan](#penggunaan)
- [Menu CLI](#menu-cli)
- [Mekanisme Stealth](#mekanisme-stealth)
- [Environment Variables](#environment-variables)
- [Struktur Project](#struktur-project)
- [Keamanan](#keamanan)
- [Disclaimer](#disclaimer)

---

## Fitur

| # | Fitur | Keterangan |
|---|-------|------------|
| 1 | **Tambah Akun** | OAuth Google headless via Puppeteer dengan concurrent worker — tambah ratusan akun sekaligus |
| 2 | **List Akun** | Tampilkan semua akun dengan status (`ACTIVE` / `DISABLED` / `PROXY OFF`) |
| 3 | **Hapus Akun** | Per nomor, multi-select (pisah koma), atau hapus semua dengan konfirmasi |
| 4 | **Lihat Kuota** | Progress bar visual per bucket langsung dari JSON AG Manager |
| 5 | **Auto Delete Expired** | Validasi refresh token ke Google; hapus akun yang token-nya tidak valid |
| 6 | **Auto Delete 429** | Monitor `proxy_logs.db` setiap 5 detik — hapus akun yang kena `QuotaExhausted` |
| 7 | **Auto Enable Proxy** | Reset `proxy_disabled` ke `false` untuk semua akun dalam satu klik |
| 8 | **Auto Disable Proxy 429** | Monitor 429 dengan filter model AI (misal: "claude", "gpt") — disable proxy otomatis |
| 9 | **Refresh All Accounts** | Refresh token semua akun secara batch (10 sekaligus) + restart stealth AG Manager |

---

## Prasyarat

- **Node.js** v21+ (disarankan)
- **Google Chrome** atau **Chromium** (untuk Puppeteer OAuth)
- **Python** (untuk fitur Auto Delete 429 dan Auto Disable Proxy — baca SQLite)
- OS: Windows x64 (utama) · Linux x64 (didukung dengan batasan)

---

## Instalasi

```bash
git clone https://github.com/HaikalFadhilah/agctlv2.git
cd agctlv2
npm install
```

### Linux tambahan

Pastikan Chromium terinstal dan ada di path standar, atau set env var:

```bash
export PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
```

---

## Format akun.txt

Buat file `akun.txt` di folder yang sama dengan `manage.js`. Satu akun per baris:

```
email@domain.com:password
email@domain.com|password
email@domain.com,password
```

**Contoh:**

```
user1@gmail.com:passwordku123
user2@gmail.com|passwordlain456
```

> **Catatan:** File `akun.txt` tidak di-commit ke Git (sudah ada di `.gitignore`).

---

## Penggunaan

```bash
node manage.js
```

---

## Menu CLI

```text
  █████╗  ██████╗  ██████╗████████╗██╗     
 ██╔══██╗██╔════╝ ██╔════╝╚══██╔══╝██║     
 ███████║██║  ███╗██║        ██║   ██║     
 ██╔══██║██║   ██║██║        ██║   ██║     
 ██║  ██║╚██████╔╝╚██████╗    ██║   ███████╗
 ╚═╝  ╚═╝ ╚═════╝  ╚═════╝    ╚═╝   ╚══════╝
              v2.0  —  by CROPz
──────────────────────────────────────────────

  1.  TAMBAH AKUN BARU
  2.  LIST SEMUA AKUN
  3.  HAPUS AKUN
  4.  LIHAT KUOTA
  5.  AUTO DELETE EXPIRED
  6.  AUTO DELETE 429: [ OFF ]
  7.  AUTO ENABLE PROXY
  8.  AUTO DISABLE PROXY 429: [ OFF ]
  9.  REFRESH ALL ACCOUNTS
  0.  KELUAR

  Pilih menu: _
```

### Menu 1 — Tambah Akun

- Membaca semua baris dari `akun.txt`
- Membuka Puppeteer headless untuk setiap akun (concurrent worker)
- OAuth Google dilakukan secara otomatis dengan validasi `state` (anti-CSRF)
- Akun yang berhasil **dihapus otomatis** dari `akun.txt`
- Setelah selesai, token di-refresh otomatis agar langsung tersinkronisasi

### Menu 4 — Lihat Kuota

Menampilkan progress bar kuota per bucket setiap akun:

```
  1. user@gmail.com ← AKTIF
       Last update: 02/08/26 14.30 (5 menit lalu)

       Bucket A                       ████████░░░░░░░░░░░░  40%
       Bucket B                       ████░░░░░░░░░░░░░░░░  20%
```

### Menu 6 & 8 — Auto Delete 429 / Auto Disable Proxy

Monitor background yang membaca `proxy_logs.db` (SQLite) setiap 5 detik:

- **Auto Delete 429**: Akun yang kena `429 QuotaExhausted` dihapus permanen
- **Auto Disable Proxy 429**: Proxy akun yang kena 429 di-disable (bisa filter per model AI)
- Status ON/OFF tersimpan di `auto429.json` / `autodisableproxy.json`
- Berjalan sebagai `setInterval` — tidak memblokir menu utama

---

## Mekanisme Stealth

Saat menjalankan Menu 1 atau Menu 9 di Windows:

1. **Puppeteer headless** — browser 100% tidak terlihat di layar
2. **VBScript stealth restart** — setelah token di-refresh, AG Manager di-restart via `.vbs` temporer dengan argumen `0` (Completely Hidden), sehingga tidak ada pop-up GUI yang muncul

> Pada Linux, fitur stealth restart dilewati (Windows-only). AG Manager harus di-restart manual.

---

## Environment Variables

Semua opsional. Jika tidak diset, nilai default dari kode digunakan.

| Variable | Deskripsi | Default |
|----------|-----------|---------|
| `AGCTL_CLIENT_ID` | Google OAuth Client ID | Hardcoded di `lib/credentials.js` |
| `AGCTL_CLIENT_SECRET` | Google OAuth Client Secret | Hardcoded di `lib/credentials.js` |
| `PUPPETEER_EXECUTABLE_PATH` | Path browser untuk Puppeteer | Auto-detect di Linux |
| `AG_TOOLS_DIR` | Direktori data AG Manager | `~/.antigravity_tools` |

Salin `.env.example` ke `.env` untuk kustomisasi.

---

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
├── .env.example           # Template environment variables
├── .gitignore
├── AGENTS.md              # Panduan AI agent
├── CLAUDE.md              # Quick reference Claude Code
├── akun.txt               # Input akun (TIDAK di-commit)
├── auto429.json           # State monitor (TIDAK di-commit)
└── autodisableproxy.json  # State monitor (TIDAK di-commit)
```

---

## Keamanan

- **OAuth state validation**: Callback server memvalidasi `state` parameter untuk mencegah CSRF
- **Atomic file write**: Penulisan `accounts.json` dan file akun menggunakan pattern write-tmp + rename
- **Parameterized SQL**: Query SQLite menggunakan placeholder `?`, bukan string interpolation
- **No hardcoded Python path**: Deteksi dinamis (`python` → `python3` → `py`)
- **Platform guards**: Semua Windows-only API di-guard dengan `IS_WIN`
- **Graceful shutdown**: Ctrl+C menghentikan semua monitor sebelum exit
- **Credentials via env vars**: `CLIENT_ID` dan `CLIENT_SECRET` bisa di-override via environment

> **Tips:** Jangan commit `akun.txt`, `auto429.json`, atau `autodisableproxy.json` — sudah ada di `.gitignore`.

---

## Disclaimer

Script ini menggunakan OAuth Consent dari aplikasi GCP tersendiri. Fitur VBScript stealth mode di Windows mungkin terdeteksi sebagai false positive oleh antivirus. Beri pengecualian jika diperlukan.

---

<div align="center">

Dibuat oleh **[HaikalFadhilah (CROPz)](https://github.com/HaikalFadhilah)**

</div>
