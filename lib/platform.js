const fs = require('fs');
const path = require('path');
const os = require('os');

const HOME_DIR       = process.env.USERPROFILE || process.env.HOME || os.homedir();
const LOCAL_APP_DATA = process.env.LOCALAPPDATA || path.join(HOME_DIR, 'AppData', 'Local');
const AG_DIR         = process.env.AG_TOOLS_DIR || path.join(HOME_DIR, '.antigravity_tools');
const ACCOUNTS_DIR   = path.join(AG_DIR, 'accounts');
const ACCOUNTS_INDEX = path.join(AG_DIR, 'accounts.json');
const GUI_CONFIG     = path.join(AG_DIR, 'gui_config.json');
const PROXY_LOGS_DB  = path.join(AG_DIR, 'proxy_logs.db');
const AG_EXE         = path.join(LOCAL_APP_DATA, 'Antigravity Tools', 'antigravity_tools.exe');

const IS_WIN = process.platform === 'win32';

const LINUX_BROWSERS = ['/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome'];

function getBrowserPath() {
    return process.env.PUPPETEER_EXECUTABLE_PATH || (
        process.platform === 'linux' ? LINUX_BROWSERS.find(fs.existsSync) : undefined
    );
}

function findPython() {
    const { execSync } = require('child_process');
    for (const cmd of ['python', 'python3', 'py']) {
        try {
            execSync(`${cmd} --version`, { stdio: 'ignore', timeout: 3000, shell: true });
            return cmd;
        } catch (e) { /* python tidak ditemukan, coba berikutnya */ }
    }
    return null;
}

function isProcessRunning(name) {
    if (!IS_WIN) return false;
    try {
        const { execSync } = require('child_process');
        const out = execSync(`tasklist /FI "IMAGENAME eq ${name}" /NH`, { encoding: 'utf-8' });
        return out.includes(name);
    } catch { return false; }
}

function killProcess(name) {
    if (!IS_WIN) return;
    try {
        const { execSync } = require('child_process');
        execSync(`taskkill /F /IM ${name}`, { encoding: 'utf-8' });
    } catch (e) { /* proses mungkin sudah mati */ }
}

function getTempDir() {
    return process.env.TEMP || os.tmpdir();
}

function runVbsStealth(exePath) {
    if (!IS_WIN) return false;
    const vbsPath = path.join(getTempDir(), 'run_ag.vbs');
    fs.writeFileSync(vbsPath, `CreateObject("WScript.Shell").Run """${exePath}""", 0, False`);
    try {
        const { execSync } = require('child_process');
        execSync(`cscript //nologo "${vbsPath}"`, { windowsHide: true, stdio: 'ignore' });
        return true;
    } catch (e) { return false; }
}

module.exports = {
    HOME_DIR, LOCAL_APP_DATA, AG_DIR, ACCOUNTS_DIR, ACCOUNTS_INDEX,
    GUI_CONFIG, PROXY_LOGS_DB, AG_EXE, IS_WIN,
    getBrowserPath, findPython, isProcessRunning, killProcess, getTempDir,
    runVbsStealth
};
