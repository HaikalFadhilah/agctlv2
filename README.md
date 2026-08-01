# AGCTL-v2 (Antigravity Tools Manager)

AGCTL-v2 adalah aplikasi **CLI Otomatisasi (Command-Line Interface)** interaktif yang di-desain khusus untuk memberdayakan dan mengelola akun, proxy, dan kuota untuk aplikasi [Antigravity Manager](https://github.com/lbjlaq/Antigravity-Manager).

Script ini mampu mengambil alih manajemen _headless_ secara keseluruhan tanpa memicu gangguan Jendela GUI pada sistem operasimu, membuatnya 100% _Ninja mode_/tersembunyi dalam menjalankan pembaruan *state*, OAuth konsent, dan penguraian kendali Proxy layaknya **Daemon**.

---

## ⚡ Fitur Utama

1. **Tambahkan Akun Google Skala Penuh (Headless Concurrency)**
   Menambahkan ratusan email dan kata sandi baru untuk aplikasi Antigravity melalui OAuth 2.0.
   * ✅ **Fully Headless:** Menggunakan Puppeteer siluman (`headless: 'shell'`) tanpa sedikitpun memunculkan *pop up window browser*.
   * ✅ **Multi-threading/Concurrency Worker:** Ingin mengunyah 10 akun sekaligus? Tinggal tentukan total pekerjanya! Keamanan OAuth tetap terpisahkan secara mandiri di masing-masing *Localhost port*.
   * ✅ **Bypass Bot Google:** Secara otomatis menyembunyikan flag "Automation" menggunakan User-Agent normal Desktop (Chrome 122).
2. **Auto Refresh Tokens Siluman (Stealth Hot Reload)**
   Setelah memperbarui kuncian JSON, kamu tidak perlu capek-capek memuat ulang GUI AG Tools-mu. Proses Restart AG Tools akan dijalankan ke *background* via intervensi memori `VBScript Stealth Mode` secara gaib *(Jendelanya tidak akan lompat menutupi layarmu)*.
3. **Pembersih Sampah Pintar (Auto Delete 429)**
   Mengendus _Database logs_ SQLite buatan AG Tools secara langsung. Skrip akan memisahkan, menghitung, dan menghapus permanen identitas akun yang dilaporkan terkena status `Error 429` (Limit harian habis).
4. **Proteksi Proxy Pintar (Auto-Disable Proxy)**
   Bosan proxy-nya terkuras oleh _request error_ dari model yang salah? Fitur ini akan otomatis memeriksa rasio *Error 429* untuk _Filter Model AI_ (misal: "Gemini", "Claude"). Jika ditemukan, Proxy terhadap akun yang bersangkutan otomatis diputus *(disable\_proxy: true)*.
5. **Pemulihan Massal Akun (Auto-Enable Proxy)**
   Membersihkan parameter `proxy_disabled` serta `disabled` ke status bersih dari seluruh UUID _cache json_ dalam satu ketukan terminal.
6. **Murni Lokal**
   Segala bentuk injeksi *JSON/Data Base* ditempatkan pada `%LOCALAPPDATA%\Antigravity Tools`.

---

## 🚀 Instalasi & Persiapan

1. Pastikan Anda memiliki **Node.js** (v21+ disarankan) yang terinstal di komputer.
2. Clone repository ini:
   ```bash
   git clone https://github.com/HaikalFadhilah/agctlv2.git
   cd agctlv2
   ```
3. Lakukan instalasi pada seluruh dependensinya:
   ```bash
   npm install puppeteer
   ```
4. Buat file `akun.txt` tepat di direktori ini untuk injeksi massal (Format isi data wajib `email:password` per-baris). 
   *(Contoh isi `akun.txt`:)*
   ```text
   zoro123@email.com:rahasia123
   sanji.blackleg@domain.com:password456
   ```

---

## 🎮 Panduan Penggunaan

Hanya terdapat 1 pintu masuk, eksekusi perintah di bawah ini dari CMD/PowerShell:

```bash
node manage.js
```

Pilihan menu yang tersedia di antar muka (*CLI*):
```text
  1.  TAMBAH AKUN BARU
  2.  LIST SEMUA AKUN
  3.  HAPUS AKUN
  4.  AUTO DELETE EXPIRED
  5.  AUTO DELETE 429: [ OFF ]
  6.  AUTO ENABLE PROXY
  7.  AUTO DISABLE PROXY 429: [ OFF ]
  8.  REFRESH ALL ACCOUNTS
  0.  KELUAR
```

### 🔧 Mekanisme Stealth (Anti-Pop Up)
Aplikasi ini sudah dipatenkan memiliki tingkat invasi layar 0%. 
Jika kalian mengeksekusi Menu `[1] ADD ACCOUNT` atau `[8] REFRESH ALL ACCOUNTS`:
1. *Browser Puppeteer* berwujud 100% konsol murni.
2. Saat penyimpanan terselesaikan, fitur OS di Windows sangat bandel menampilkan layar UI Antigravity Tools saat di _restart_. **Ini sudah ditangani!** 
Skrip otomatis menyuntikkan `.vbs` temporer rahasia (Windows Script Host) dan menjalankan Antigravity Tools beserta *Arg 0* (`Completely Hidden`), membunuh kemungkinan render *window graphic* tanpa sepengetahuan OS. Sangat aman dan tenteram digunakan sambil bermain *Game Full-screen* atau menatap Visual Studio Code.  

## 🛡️ Disclaimer Privasi 
Script ini menggunakan konfigurasi *OAuth Consent* dari Aplikasi GCP tersendiri untuk menjembatani komunikasi ke Token Google secara absolut. 
Pengaturan tingkat keamanan `Stealth Mode` bisa terdeteksi pada *Windows Defender* khusus fitur VBS-nya karena perilakunya yang nyaris tak kasat mata (seperti *backdoor*). Beri pengecualian *Allowed* (Ignore) apabila terminal CLI-mu ditahan oleh Antivirus *(False Positives)*.

---
_AGCTL-v2 - Automate Everything._