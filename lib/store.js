const fs = require('fs');
const path = require('path');
const { ACCOUNTS_DIR, ACCOUNTS_INDEX } = require('./platform');

let writeQueue = Promise.resolve();

function withLock(fn) {
    const run = writeQueue.then(() => fn());
    writeQueue = run.catch(() => {});
    return run;
}

function atomicWrite(file, data) {
    const tmp = file + '.tmp.' + process.pid;
    fs.writeFileSync(tmp, data);
    fs.renameSync(tmp, file);
}

function ensureDirs() {
    if (!fs.existsSync(ACCOUNTS_DIR)) fs.mkdirSync(ACCOUNTS_DIR, { recursive: true });
}

function validateIndex(index) {
    if (!index || typeof index !== 'object') return false;
    if (!Array.isArray(index.accounts)) return false;
    for (const a of index.accounts) {
        if (!a.id || !a.email) return false;
    }
    if (index.current_account_id && !index.accounts.some(a => a.id === index.current_account_id)) {
        index.current_account_id = null;
    }
    return true;
}

function validateAccount(acc) {
    if (!acc || typeof acc !== 'object') return false;
    if (!acc.id || !acc.email) return false;
    if (!acc.token || !acc.token.refresh_token) return false;
    return true;
}

function loadIndex() {
    if (!fs.existsSync(ACCOUNTS_INDEX))
        return { version: '2.0', accounts: [], current_account_id: null, current_target_ide: 'agy' };
    try {
        const raw = fs.readFileSync(ACCOUNTS_INDEX, 'utf-8');
        const parsed = JSON.parse(raw);
        if (!validateIndex(parsed)) {
            return { version: '2.0', accounts: [], current_account_id: null, current_target_ide: 'agy' };
        }
        return parsed;
    } catch (e) {
        return { version: '2.0', accounts: [], current_account_id: null, current_target_ide: 'agy' };
    }
}

function saveIndex(index) {
    return withLock(() => {
        ensureDirs();
        const seen = new Set();
        const deduped = [];
        for (const a of index.accounts) {
            if (!seen.has(a.email)) { seen.add(a.email); deduped.push(a); }
        }
        index.accounts = deduped;
        atomicWrite(ACCOUNTS_INDEX, JSON.stringify(index, null, 2));
    });
}

function saveIndexSync(index) {
    ensureDirs();
    const seen = new Set();
    index.accounts = index.accounts.filter(a => {
        if (seen.has(a.email)) return false;
        seen.add(a.email);
        return true;
    });
    atomicWrite(ACCOUNTS_INDEX, JSON.stringify(index, null, 2));
}

function loadAccount(id) {
    const file = path.join(ACCOUNTS_DIR, `${id}.json`);
    if (!fs.existsSync(file)) return null;
    try {
        const acc = JSON.parse(fs.readFileSync(file, 'utf-8'));
        if (!validateAccount(acc)) return null;
        return acc;
    } catch (e) {
        return null;
    }
}

function saveAccount(account) {
    return withLock(() => {
        ensureDirs();
        atomicWrite(path.join(ACCOUNTS_DIR, `${account.id}.json`), JSON.stringify(account, null, 2));
    });
}

function deleteAccountFile(id) {
    const file = path.join(ACCOUNTS_DIR, `${id}.json`);
    try { fs.unlinkSync(file); } catch (e) { /* file mungkin sudah tidak ada */ }
}

function addAccount(index, entry) {
    if (!entry.id || !entry.email) return false;
    if (index.accounts.some(a => a.email === entry.email)) return false;
    if (index.accounts.some(a => a.id === entry.id)) return false;
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

function findOrphanFiles(index) {
    const knownIds = new Set(index.accounts.map(a => a.id));
    const orphans = [];
    if (!fs.existsSync(ACCOUNTS_DIR)) return orphans;
    for (const file of fs.readdirSync(ACCOUNTS_DIR)) {
        if (!file.endsWith('.json')) continue;
        const id = file.replace('.json', '');
        if (!knownIds.has(id)) orphans.push(id);
    }
    return orphans;
}

function cleanupOrphans(index) {
    const orphans = findOrphanFiles(index);
    for (const id of orphans) deleteAccountFile(id);
    return orphans.length;
}

function backupIndex() {
    if (!fs.existsSync(ACCOUNTS_INDEX)) return null;
    const backup = ACCOUNTS_INDEX + '.backup.' + Date.now();
    fs.copyFileSync(ACCOUNTS_INDEX, backup);
    return backup;
}

function countActive(index) {
    return index.accounts.filter(a => !a.disabled).length;
}

function countProxyActive(index) {
    return index.accounts.filter(a => !a.disabled && !a.proxy_disabled).length;
}

module.exports = {
    atomicWrite, ensureDirs,
    loadIndex, saveIndex, saveIndexSync,
    loadAccount, saveAccount, deleteAccountFile,
    addAccount, removeAccounts, clearAll,
    countActive, countProxyActive,
    validateIndex, validateAccount,
    findOrphanFiles, cleanupOrphans, backupIndex
};
