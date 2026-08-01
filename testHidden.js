const { execSync } = require('child_process');
const path = require('path');

const agExe = path.join(process.env.LOCALAPPDATA, 'Antigravity Tools', 'antigravity_tools.exe');

console.log('Mematikan AG Tools (kalau sedang terbuka)...');
try {
    execSync('taskkill /F /IM antigravity_tools.exe', {stdio:'ignore'});
} catch(e){}

setTimeout(() => {
    console.log('Membuka ulang AG Tools dengan Mode HIDDEN...');
    execSync(`powershell -Command "Start-Process -FilePath '${agExe}' -WindowStyle Hidden"`, { windowsHide: true, stdio: 'ignore' });
    console.log('Selesai! Kamu tidak seharusnya melihat jendela AG Tools terbuka di monitor. (Silakan cek Task Manager di bagian Background processes)');
}, 1000);
