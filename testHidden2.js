const fs = require('fs');
const path = require('path');
const cp = require('child_process');

try {
    cp.execSync('taskkill /F /IM antigravity_tools.exe', {stdio:'ignore'});
} catch(e) {}

const agExe = path.join(process.env.LOCALAPPDATA, 'Antigravity Tools', 'antigravity_tools.exe');
const vbsPath = path.join(process.env.TEMP, 'run_ag.vbs');

// Pakai VBScript untuk FORCE eksekusi benar-benar silent tanpa jendela apapun
fs.writeFileSync(vbsPath, `CreateObject("WScript.Shell").Run """${agExe}""", 0, False`);

cp.execSync(`cscript //nologo "${vbsPath}"`, { windowsHide: true, stdio: 'ignore' });
console.log('Diluncurkan via VBScript Stealth Mode');