const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

let tmpDir;
let origAccountDir;
let origAccountIndex;

const { ACCOUNTS_DIR, ACCOUNTS_INDEX } = require('../lib/platform');

function setupTmp() {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agctl-test-'));
    const tmpAccountsDir = path.join(tmpDir, 'accounts');
    fs.mkdirSync(tmpAccountsDir, { recursive: true });
    const tmpIndex = path.join(tmpDir, 'accounts.json');

    delete require.cache[require.resolve('../lib/store')];
    delete require.cache[require.resolve('../lib/platform')];

    const platform = require('../lib/platform');
    origAccountDir = platform.ACCOUNTS_DIR;
    origAccountIndex = platform.ACCOUNTS_INDEX;

    Object.defineProperty(platform, 'ACCOUNTS_DIR', { value: tmpAccountsDir, writable: true, configurable: true });
    Object.defineProperty(platform, 'ACCOUNTS_INDEX', { value: tmpIndex, writable: true, configurable: true });
}

function teardownTmp() {
    const platform = require('../lib/platform');
    Object.defineProperty(platform, 'ACCOUNTS_DIR', { value: origAccountDir, writable: true, configurable: true });
    Object.defineProperty(platform, 'ACCOUNTS_INDEX', { value: origAccountIndex, writable: true, configurable: true });
    delete require.cache[require.resolve('../lib/store')];
    delete require.cache[require.resolve('../lib/platform')];
    fs.rmSync(tmpDir, { recursive: true, force: true });
}

test('loadIndex: returns default when file missing', () => {
    setupTmp();
    const { loadIndex } = require('../lib/store');
    const index = loadIndex();
    assert.strictEqual(index.version, '2.0');
    assert.deepStrictEqual(index.accounts, []);
    assert.strictEqual(index.current_account_id, null);
    teardownTmp();
});

test('loadIndex: returns default when JSON corrupt', () => {
    setupTmp();
    const platform = require('../lib/platform');
    fs.writeFileSync(platform.ACCOUNTS_INDEX, '{ broken json');
    const { loadIndex } = require('../lib/store');
    const index = loadIndex();
    assert.strictEqual(index.version, '2.0');
    assert.deepStrictEqual(index.accounts, []);
    teardownTmp();
});

test('saveIndexSync + loadIndex: roundtrip', () => {
    setupTmp();
    const store = require('../lib/store');
    const index = { version: '2.0', accounts: [{ id: 'abc', email: 'test@test.com', disabled: false }], current_account_id: 'abc', current_target_ide: 'agy' };
    store.saveIndexSync(index);
    const loaded = store.loadIndex();
    assert.strictEqual(loaded.accounts.length, 1);
    assert.strictEqual(loaded.accounts[0].email, 'test@test.com');
    assert.strictEqual(loaded.current_account_id, 'abc');
    teardownTmp();
});

test('addAccount: prevents duplicate email', () => {
    setupTmp();
    const store = require('../lib/store');
    const index = { version: '2.0', accounts: [{ id: 'a', email: 'dup@test.com', disabled: false }], current_account_id: 'a', current_target_ide: 'agy' };
    assert.strictEqual(store.addAccount(index, { id: 'b', email: 'dup@test.com' }), false);
    assert.strictEqual(store.addAccount(index, { id: 'c', email: 'unique@test.com' }), true);
    assert.strictEqual(index.accounts.length, 2);
    teardownTmp();
});

test('addAccount: prevents duplicate id', () => {
    setupTmp();
    const store = require('../lib/store');
    const index = { version: '2.0', accounts: [{ id: 'sameid', email: 'a@test.com', disabled: false }], current_account_id: 'sameid', current_target_ide: 'agy' };
    assert.strictEqual(store.addAccount(index, { id: 'sameid', email: 'b@test.com' }), false);
    teardownTmp();
});

test('addAccount: rejects missing id or email', () => {
    setupTmp();
    const store = require('../lib/store');
    const index = { version: '2.0', accounts: [], current_account_id: null, current_target_ide: 'agy' };
    assert.strictEqual(store.addAccount(index, { email: 'noId@test.com' }), false);
    assert.strictEqual(store.addAccount(index, { id: 'noemail' }), false);
    assert.strictEqual(store.addAccount(index, {}), false);
    teardownTmp();
});

test('removeAccounts: deletes files and updates index', () => {
    setupTmp();
    const store = require('../lib/store');
    const platform = require('../lib/platform');
    const index = { version: '2.0', accounts: [
        { id: 'a1', email: 'a@test.com', disabled: false },
        { id: 'a2', email: 'b@test.com', disabled: false },
    ], current_account_id: 'a1', current_target_ide: 'agy' };
    fs.writeFileSync(path.join(platform.ACCOUNTS_DIR, 'a1.json'), '{}');
    fs.writeFileSync(path.join(platform.ACCOUNTS_DIR, 'a2.json'), '{}');
    store.removeAccounts(index, ['a1']);
    assert.strictEqual(index.accounts.length, 1);
    assert.strictEqual(index.current_account_id, 'a2');
    assert.ok(!fs.existsSync(path.join(platform.ACCOUNTS_DIR, 'a1.json')));
    teardownTmp();
});

test('validateIndex: rejects invalid structure', () => {
    const { validateIndex } = require('../lib/store');
    assert.strictEqual(validateIndex(null), false);
    assert.strictEqual(validateIndex('string'), false);
    assert.strictEqual(validateIndex({}), false);
    assert.strictEqual(validateIndex({ accounts: 'notarray' }), false);
    assert.strictEqual(validateIndex({ accounts: [{ id: '', email: 'a@b.com' }] }), false);
    assert.strictEqual(validateIndex({ accounts: [{ id: 'x', email: 'a@b.com' }] }), true);
});

test('validateAccount: rejects invalid structure', () => {
    const { validateAccount } = require('../lib/store');
    assert.strictEqual(validateAccount(null), false);
    assert.strictEqual(validateAccount({}), false);
    assert.strictEqual(validateAccount({ id: 'x', email: 'a@b.com' }), false);
    assert.strictEqual(validateAccount({ id: 'x', email: 'a@b.com', token: {} }), false);
    assert.strictEqual(validateAccount({ id: 'x', email: 'a@b.com', token: { refresh_token: 'rt' } }), true);
});

test('backupIndex: creates backup file', () => {
    setupTmp();
    const store = require('../lib/store');
    const platform = require('../lib/platform');
    store.saveIndexSync({ version: '2.0', accounts: [], current_account_id: null, current_target_ide: 'agy' });
    const backupPath = store.backupIndex();
    assert.ok(backupPath);
    assert.ok(fs.existsSync(backupPath));
    teardownTmp();
});

test('findOrphanFiles: detects orphan UUID files', () => {
    setupTmp();
    const store = require('../lib/store');
    const platform = require('../lib/platform');
    const index = { version: '2.0', accounts: [{ id: 'known', email: 'a@b.com' }], current_account_id: 'known', current_target_ide: 'agy' };
    fs.writeFileSync(path.join(platform.ACCOUNTS_DIR, 'known.json'), '{}');
    fs.writeFileSync(path.join(platform.ACCOUNTS_DIR, 'orphan.json'), '{}');
    const orphans = store.findOrphanFiles(index);
    assert.strictEqual(orphans.length, 1);
    assert.strictEqual(orphans[0], 'orphan');
    teardownTmp();
});

test('cleanupOrphans: removes orphan files', () => {
    setupTmp();
    const store = require('../lib/store');
    const platform = require('../lib/platform');
    const index = { version: '2.0', accounts: [{ id: 'known', email: 'a@b.com' }], current_account_id: 'known', current_target_ide: 'agy' };
    fs.writeFileSync(path.join(platform.ACCOUNTS_DIR, 'known.json'), '{}');
    fs.writeFileSync(path.join(platform.ACCOUNTS_DIR, 'orphan1.json'), '{}');
    fs.writeFileSync(path.join(platform.ACCOUNTS_DIR, 'orphan2.json'), '{}');
    const removed = store.cleanupOrphans(index);
    assert.strictEqual(removed, 2);
    assert.ok(!fs.existsSync(path.join(platform.ACCOUNTS_DIR, 'orphan1.json')));
    teardownTmp();
});

test('atomicWrite: writes via tmp + rename', () => {
    setupTmp();
    const { atomicWrite } = require('../lib/store');
    const platform = require('../lib/platform');
    const file = path.join(tmpDir, 'test.json');
    atomicWrite(file, '{"ok":true}');
    assert.strictEqual(fs.readFileSync(file, 'utf-8'), '{"ok":true}');
    teardownTmp();
});
