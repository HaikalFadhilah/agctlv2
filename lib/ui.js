const LOG_WIDTH = 46;

function logLine(char = '─') { console.log('  ' + char.repeat(LOG_WIDTH)); }

function logStep(icon, msg) {
    const ts = new Date().toLocaleTimeString('id-ID', { hour12: false });
    console.log(`  ${icon} [${ts}] ${msg}`);
}

function logInfo(msg)  { logStep('◆', msg); }
function logOk(msg)    { logStep('✔', msg); }
function logWarn(msg)  { logStep('!', msg); }
function logBlank()    { console.log(''); }

const readline = require('readline');
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise(resolve => rl.question(q, resolve));
const delay = (ms) => new Promise(r => setTimeout(r, ms));
function clear() { process.stdout.write('\x1Bc'); }

function formatDate(ts) {
    if (!ts) return '-';
    return new Date(ts * 1000).toLocaleString('id-ID', { dateStyle: 'short', timeStyle: 'short' });
}

function statusBadge(account) {
    if (account.disabled)       return 'DISABLED  ';
    if (account.proxy_disabled) return 'PROXY OFF ';
    return 'ACTIVE    ';
}

function quotaBar(fraction, width = 20) {
    const filled = Math.round(fraction * width);
    const empty  = width - filled;
    const bar    = '█'.repeat(filled) + '░'.repeat(empty);
    const pct    = Math.round(fraction * 100);
    return `${bar} ${String(pct).padStart(3)}%`;
}

function printHeader() {
    console.log('');
    console.log('       ██████╗  ██████╗  ██████╗████████╗██╗     ');
    console.log('      ██╔══██╗██╔════╝ ██╔════╝╚══██╔══╝██║     ');
    console.log('      ███████║██║  ███╗██║         ██║   ██║     ');
    console.log('      ██╔══██║██║   ██║██║         ██║   ██║     ');
    console.log('      ██║  ██║╚██████╔╝╚██████╗    ██║   ███████╗');
    console.log('      ╚═╝  ╚═╝ ╚═════╝  ╚═════╝    ╚═╝   ╚══════╝');
    console.log('               v2.0  —  by CROPz               ');
}

function close() { rl.close(); }

module.exports = {
    logLine, logStep, logInfo, logOk, logWarn, logBlank,
    rl, ask, delay, clear, formatDate, statusBadge, quotaBar,
    printHeader, close
};
