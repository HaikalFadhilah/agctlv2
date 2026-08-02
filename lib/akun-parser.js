const fs = require('fs');
const path = require('path');

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function parseLine(line, lineNum) {
    const trimmed = line.trim();
    if (trimmed.length === 0) return { type: 'blank', lineNum };
    if (trimmed.startsWith('#') || trimmed.startsWith('//')) return { type: 'comment', raw: trimmed, lineNum };

    const sepIdx = trimmed.search(/[:|,]/);
    if (sepIdx === -1) {
        return { type: 'invalid', raw: trimmed, lineNum, error: 'Tidak ada separator (: atau | atau ,)' };
    }

    const email = trimmed.slice(0, sepIdx).trim();
    const password = trimmed.slice(sepIdx + 1).trim();

    if (!email || !password) {
        return { type: 'invalid', raw: trimmed, lineNum, error: 'Email atau password kosong' };
    }
    if (!EMAIL_REGEX.test(email)) {
        return { type: 'invalid', raw: trimmed, lineNum, error: `Email tidak valid: ${email}` };
    }
    if (password.length < 4) {
        return { type: 'invalid', raw: trimmed, lineNum, error: `Password terlalu pendek untuk: ${email}` };
    }

    return { type: 'account', email, password, raw: trimmed, lineNum };
}

function parseFile(filePath) {
    if (!fs.existsSync(filePath)) return { entries: [], lines: [], rawContent: '' };

    const rawContent = fs.readFileSync(filePath, 'utf-8');
    const lines = rawContent.split(/\r?\n/);
    const entries = lines.map((line, i) => parseLine(line, i + 1));

    return { entries, lines, rawContent };
}

function filterAccounts(entries) {
    return entries.filter(e => e.type === 'account');
}

function filterComments(entries) {
    return entries.filter(e => e.type === 'comment');
}

function filterInvalid(entries) {
    return entries.filter(e => e.type === 'invalid');
}

function removeSuccessEntries(lines, successSet) {
    const remaining = lines.filter(l => {
        const trimmed = l.trim();
        if (trimmed.length === 0) return true;
        if (trimmed.startsWith('#') || trimmed.startsWith('//')) return true;
        return !successSet.has(trimmed);
    });
    return remaining.join('\n') + (remaining.length > 0 ? '\n' : '');
}

module.exports = { parseLine, parseFile, filterAccounts, filterComments, filterInvalid, removeSuccessEntries, EMAIL_REGEX };
