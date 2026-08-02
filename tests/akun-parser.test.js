const { test } = require('node:test');
const assert = require('node:assert');
const { parseLine, filterAccounts, filterInvalid, removeSuccessEntries, EMAIL_REGEX } = require('../lib/akun-parser');

test('parseLine: valid account with colon separator', () => {
    const r = parseLine('user@gmail.com:password123', 1);
    assert.strictEqual(r.type, 'account');
    assert.strictEqual(r.email, 'user@gmail.com');
    assert.strictEqual(r.password, 'password123');
    assert.strictEqual(r.lineNum, 1);
});

test('parseLine: valid account with pipe separator', () => {
    const r = parseLine('user@gmail.com|password123', 2);
    assert.strictEqual(r.type, 'account');
    assert.strictEqual(r.email, 'user@gmail.com');
});

test('parseLine: valid account with comma separator', () => {
    const r = parseLine('user@gmail.com,password123', 3);
    assert.strictEqual(r.type, 'account');
    assert.strictEqual(r.email, 'user@gmail.com');
});

test('parseLine: split only on first separator', () => {
    const r = parseLine('user@gmail.com:pass:with:colons', 1);
    assert.strictEqual(r.type, 'account');
    assert.strictEqual(r.email, 'user@gmail.com');
    assert.strictEqual(r.password, 'pass:with:colons');
});

test('parseLine: blank line', () => {
    assert.strictEqual(parseLine('', 1).type, 'blank');
    assert.strictEqual(parseLine('   ', 2).type, 'blank');
});

test('parseLine: comment line with #', () => {
    const r = parseLine('# ini komentar', 1);
    assert.strictEqual(r.type, 'comment');
    assert.strictEqual(r.raw, '# ini komentar');
});

test('parseLine: comment line with //', () => {
    const r = parseLine('// ini komentar', 2);
    assert.strictEqual(r.type, 'comment');
});

test('parseLine: no separator', () => {
    const r = parseLine('justanemail', 1);
    assert.strictEqual(r.type, 'invalid');
    assert.ok(r.error.includes('separator'));
});

test('parseLine: invalid email', () => {
    const r = parseLine('notanemail:password', 1);
    assert.strictEqual(r.type, 'invalid');
    assert.ok(r.error.includes('Email tidak valid'));
});

test('parseLine: empty email', () => {
    const r = parseLine(':password', 1);
    assert.strictEqual(r.type, 'invalid');
});

test('parseLine: short password', () => {
    const r = parseLine('user@gmail.com:ab', 1);
    assert.strictEqual(r.type, 'invalid');
    assert.ok(r.error.includes('Password terlalu pendek'));
});

test('filterAccounts: only returns account type', () => {
    const entries = [
        { type: 'account', email: 'a@b.com', password: 'pass' },
        { type: 'blank' },
        { type: 'comment', raw: '# test' },
        { type: 'invalid', error: 'bad' },
        { type: 'account', email: 'c@d.com', password: 'pass' },
    ];
    const accounts = filterAccounts(entries);
    assert.strictEqual(accounts.length, 2);
});

test('filterInvalid: only returns invalid type', () => {
    const entries = [
        { type: 'account' },
        { type: 'invalid', error: 'bad', lineNum: 5 },
    ];
    const invalids = filterInvalid(entries);
    assert.strictEqual(invalids.length, 1);
    assert.strictEqual(invalids[0].lineNum, 5);
});

test('removeSuccessEntries: preserves comments and blank lines', () => {
    const lines = ['# komentar', 'user@gmail.com:password', '', 'other@gmail.com:pass'];
    const successSet = new Set(['user@gmail.com:password']);
    const result = removeSuccessEntries(lines, successSet);
    assert.ok(result.includes('# komentar'));
    assert.ok(!result.includes('user@gmail.com:password'));
    assert.ok(result.includes('other@gmail.com:pass'));
});

test('EMAIL_REGEX: basic validation', () => {
    assert.ok(EMAIL_REGEX.test('user@gmail.com'));
    assert.ok(EMAIL_REGEX.test('a.b@c.d.edu'));
    assert.ok(!EMAIL_REGEX.test('notanemail'));
    assert.ok(!EMAIL_REGEX.test('@nodomain.com'));
    assert.ok(!EMAIL_REGEX.test('user@'));
});
