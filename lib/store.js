const fs = require('fs');
const path = require('path');
const { ACCOUNTS_DIR, ACCOUNTS_INDEX } = require('./platform');

const LOCK_RETRY_MS = 50;
const LOCK_TIMEOUT_MS = 2000;

function atomicWrite(file, data) {
    const tmp = file + '.tmp.' + process.pid;
    fs.writeFileSync(tmp, data);
    fs.renameSync(tmp, file);
}

function ensureDirs() {
    if (!fs.existsSync(ACCOUNTS_DIR)) fs.mkdirSync(ACCOUNTS_DIR, { recursive: true });
}

function loadIndex() {
    if (!fs.existsSync(ACCOUNTS_INDEX))
        return { version: '2.0', accounts: [], current_account_id: null, current_target_ide: 'agy' };
    try {
        return JSON.parse(fs.readFileSync(ACCOUNTS_INDEX, 'utf-8'));
    } catch {
        return { version: '2.0', accounts: [], current_account_id: null, current_target_ide: 'agy' };
    }
}

function saveIndex(index) {
    ensureDirs();
    atomicWrite(ACCOUNTS_INDEX, JSON.stringify(index, null, 2));
}

function loadAccount(id) {
    const file = path.join(ACCOUNTS_DIR, `${id}.json`);
    if (!fs.existsSync(file)) return null;
    try {
        return JSON.parse(fs.readFileSync(file, 'utf-8'));
    } catch {
        return null;
    }
}

function saveAccount(account) {
    ensureDirs();
    atomicWrite(path.join(ACCOUNTS_DIR, `${account.id}.json`), JSON.stringify(account, null, 2));
}

function deleteAccountFile(id) {
    const file = path.join(ACCOUNTS_DIR, `${id}.json`);
    try { fs.unlinkSync(file); } catch (e) { /* file mungkin sudah tidak ada */ }
}

function addAccount(index, entry) {
    if (index.accounts.some(a => a.email === entry.email)) return false;
    index.accounts.push(entry);
    if (!index.current_account_id) index.current_account_id = entry.id;
    return true;
}

function removeAccounts(index, ids) {
    const idSet = new Set(ids);
    for (const id of idSet) deleteAccountFile(id);
    index.accounts = index.accounts.filter(a => !idSet.has(a.id));
    if (idSet.has(index.current_account_id))
        index.current_account_id = index.accounts[0]?.id || null;
}

function clearAll(index) {
    for (const a of index.accounts) deleteAccountFile(a.id);
    index.accounts = [];
    index.current_account_id = null;
}

function countActive(index) {
    return index.accounts.filter(a => !a.disabled).length;
}

function countProxyActive(index) {
    return index.accounts.filter(a => !a.disabled && !a.proxy_disabled).length;
}

module.exports = {
    atomicWrite, ensureDirs,
    loadIndex, saveIndex,
    loadAccount, saveAccount, deleteAccountFile,
    addAccount, removeAccounts, clearAll,
    countActive, countProxyActive
};
