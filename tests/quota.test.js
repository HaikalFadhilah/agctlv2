const { test } = require('node:test');
const assert = require('node:assert');
const { clampFraction, normalizeTimestamp, parseQuotaGroups, parseBuckets, formatQuotaDisplay } = require('../lib/quota');

test('clampFraction: normal values', () => {
    assert.strictEqual(clampFraction(0), 0);
    assert.strictEqual(clampFraction(0.5), 0.5);
    assert.strictEqual(clampFraction(1), 1);
});

test('clampFraction: clamps above 1', () => {
    assert.strictEqual(clampFraction(1.5), 1);
    assert.strictEqual(clampFraction(2), 1);
    assert.strictEqual(clampFraction(Infinity), 0);
});

test('clampFraction: clamps below 0', () => {
    assert.strictEqual(clampFraction(-0.5), 0);
    assert.strictEqual(clampFraction(-1), 0);
});

test('clampFraction: non-numeric returns 0', () => {
    assert.strictEqual(clampFraction(NaN), 0);
    assert.strictEqual(clampFraction('abc'), 0);
    assert.strictEqual(clampFraction(null), 0);
    assert.strictEqual(clampFraction(undefined), 0);
});

test('normalizeTimestamp: null/undefined returns null', () => {
    assert.strictEqual(normalizeTimestamp(null), null);
    assert.strictEqual(normalizeTimestamp(undefined), null);
    assert.strictEqual(normalizeTimestamp(0), null);
    assert.strictEqual(normalizeTimestamp(-1), null);
});

test('normalizeTimestamp: seconds timestamp', () => {
    const ts = 1700000000;
    assert.strictEqual(normalizeTimestamp(ts), ts);
});

test('normalizeTimestamp: milliseconds timestamp', () => {
    const ms = 1700000000000;
    assert.strictEqual(normalizeTimestamp(ms), Math.floor(ms / 1000));
});

test('parseQuotaGroups: empty/null', () => {
    assert.deepStrictEqual(parseQuotaGroups(null), []);
    assert.deepStrictEqual(parseQuotaGroups({}), []);
    assert.deepStrictEqual(parseQuotaGroups({ quota: null }), []);
    assert.deepStrictEqual(parseQuotaGroups({ quota: {} }), []);
    assert.deepStrictEqual(parseQuotaGroups({ quota: { quota_groups: [] } }), []);
});

test('parseQuotaGroups: single group', () => {
    const acc = { quota: { quota_groups: [{ buckets: [{ display_name: 'A', remaining_fraction: 0.5 }] }] } };
    const groups = parseQuotaGroups(acc);
    assert.strictEqual(groups.length, 1);
});

test('parseQuotaGroups: multiple groups', () => {
    const acc = { quota: { quota_groups: [
        { buckets: [{ display_name: 'A', remaining_fraction: 0.5 }] },
        { buckets: [{ display_name: 'B', remaining_fraction: 0.8 }] },
    ] } };
    const groups = parseQuotaGroups(acc);
    assert.strictEqual(groups.length, 2);
});

test('parseBuckets: empty/null', () => {
    assert.deepStrictEqual(parseBuckets(null), []);
    assert.deepStrictEqual(parseBuckets({}), []);
    assert.deepStrictEqual(parseBuckets({ buckets: null }), []);
    assert.deepStrictEqual(parseBuckets({ buckets: 'notarray' }), []);
});

test('formatQuotaDisplay: null when no quota', () => {
    assert.strictEqual(formatQuotaDisplay(null), null);
    assert.strictEqual(formatQuotaDisplay({}), null);
    assert.strictEqual(formatQuotaDisplay({ quota: {} }), null);
});

test('formatQuotaDisplay: single group single bucket', () => {
    const acc = { quota: { quota_groups: [{ buckets: [{ display_name: 'Bucket A', remaining_fraction: 0.8, description: 'resets in 1h' }] }] } };
    const lines = formatQuotaDisplay(acc, (f) => `${Math.round(f * 100)}%`);
    assert.ok(lines);
    assert.ok(lines.length >= 1);
    assert.ok(lines[0].includes('Bucket A'));
    assert.ok(lines[0].includes('80%'));
});

test('formatQuotaDisplay: multiple groups', () => {
    const acc = { quota: { quota_groups: [
        { buckets: [{ display_name: 'A', remaining_fraction: 0.5 }] },
        { buckets: [{ display_name: 'B', remaining_fraction: 1.5 }] },
    ] } };
    const lines = formatQuotaDisplay(acc, (f) => `${f}`);
    assert.ok(lines.some(l => l.includes('[Group 1]')));
    assert.ok(lines.some(l => l.includes('[Group 2]')));
});

test('formatQuotaDisplay: clamps fraction in output', () => {
    const acc = { quota: { quota_groups: [{ buckets: [{ display_name: 'X', remaining_fraction: 1.5 }] }] } };
    const lines = formatQuotaDisplay(acc, (f) => `frac=${f}`);
    assert.ok(lines[0].includes('frac=1'));
});

test('formatQuotaDisplay: missing display_name uses Unknown', () => {
    const acc = { quota: { quota_groups: [{ buckets: [{ remaining_fraction: 0.5 }] }] } };
    const lines = formatQuotaDisplay(acc, (f) => `${f}`);
    assert.ok(lines[0].includes('Unknown'));
});
