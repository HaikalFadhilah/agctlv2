const { test } = require('node:test');
const assert = require('node:assert');
const { classifyTokenError, redactToken, buildAuthUrl, decodeJWT } = require('../lib/oauth');

test('classifyTokenError: invalid_grant', () => {
    assert.strictEqual(classifyTokenError('invalid_grant'), 'invalid_grant');
    assert.strictEqual(classifyTokenError('INVALID_GRANT'), 'invalid_grant');
});

test('classifyTokenError: rate_limit', () => {
    assert.strictEqual(classifyTokenError('rate_limit_exceeded'), 'rate_limit');
    assert.strictEqual(classifyTokenError('rate limit'), 'rate_limit');
    assert.strictEqual(classifyTokenError('quota exceeded'), 'rate_limit');
});

test('classifyTokenError: server_error', () => {
    assert.strictEqual(classifyTokenError('server error 500'), 'server_error');
    assert.strictEqual(classifyTokenError('HTTP 503'), 'server_error');
});

test('classifyTokenError: network_error', () => {
    assert.strictEqual(classifyTokenError('network_error'), 'network_error');
    assert.strictEqual(classifyTokenError('ECONNREFUSED'), 'network_error');
    assert.strictEqual(classifyTokenError('request timeout'), 'network_error');
});

test('classifyTokenError: unknown', () => {
    assert.strictEqual(classifyTokenError('something weird'), 'unknown');
    assert.strictEqual(classifyTokenError(''), 'unknown');
    assert.strictEqual(classifyTokenError(null), 'unknown');
    assert.strictEqual(classifyTokenError(undefined), 'unknown');
});

test('redactToken: short token returns [none]', () => {
    assert.strictEqual(redactToken(''), '[none]');
    assert.strictEqual(redactToken(null), '[none]');
    assert.strictEqual(redactToken(undefined), '[none]');
    assert.strictEqual(redactToken('short'), '[redacted]');
});

test('redactToken: long token shows first 5 and last 3', () => {
    const token = 'abcdefghijklmnop';
    const redacted = redactToken(token);
    assert.ok(redacted.startsWith('abcde'));
    assert.ok(redacted.endsWith('nop'));
    assert.ok(redacted.includes('...'));
});

test('redactToken: does not reveal full token', () => {
    const token = 'verylongsecrettoken1234567890';
    const redacted = redactToken(token);
    assert.ok(!redacted.includes('longsecret'));
});

test('buildAuthUrl: contains required parameters', () => {
    const url = buildAuthUrl('http://localhost:1234/oauth-callback', 'test-state-123');
    assert.ok(url.includes('client_id='));
    assert.ok(url.includes('redirect_uri='));
    assert.ok(url.includes('response_type=code'));
    assert.ok(url.includes('state=test-state-123'));
    assert.ok(url.includes('access_type=offline'));
});

test('decodeJWT: invalid token returns empty object', () => {
    assert.deepStrictEqual(decodeJWT(''), {});
    assert.deepStrictEqual(decodeJWT('invalid'), {});
    assert.deepStrictEqual(decodeJWT(null), {});
});

test('decodeJWT: valid JWT extracts payload', () => {
    const header = Buffer.from(JSON.stringify({ alg: 'RS256' })).toString('base64url');
    const payload = Buffer.from(JSON.stringify({ email: 'test@gmail.com', name: 'Test User' })).toString('base64url');
    const token = `${header}.${payload}.signature`;
    const decoded = decodeJWT(token);
    assert.strictEqual(decoded.email, 'test@gmail.com');
    assert.strictEqual(decoded.name, 'Test User');
});
