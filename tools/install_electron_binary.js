// 下载 Electron 二进制并解压 (Windows 环境, 使用 tar.exe 解压)
const https = require('https');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const VERSION = '37.10.3';
const url = `https://npmmirror.com/mirrors/electron/${VERSION}/electron-v${VERSION}-win32-x64.zip`;
const zip = path.join(__dirname, '..', 'electron.zip');
const dist = path.join(__dirname, '..', 'node_modules', 'electron', 'dist');

function get(u, redirects) {
  return new Promise((resolve, reject) => {
    const req = https.get(u, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (r) => {
      if ([301, 302, 303, 307, 308].includes(r.statusCode) && redirects < 6) {
        r.resume();
        resolve(get(new URL(r.headers.location, u).toString(), redirects + 1));
        return;
      }
      if (r.statusCode !== 200) { r.resume(); return reject(new Error('HTTP ' + r.statusCode)); }
      const ws = fs.createWriteStream(zip);
      r.pipe(ws);
      ws.on('finish', () => ws.close(() => resolve(fs.statSync(zip).size)));
      ws.on('error', reject);
    });
    req.setTimeout(300000, () => req.destroy(new Error('timeout')));
    req.on('error', reject);
  });
}

(async () => {
  if (!fs.existsSync(zip) || fs.statSync(zip).size < 100e6) {
    const size = await get(url, 0);
    console.log('downloaded', size, 'bytes');
  } else {
    console.log('zip already present');
  }
  fs.rmSync(dist, { recursive: true, force: true });
  fs.mkdirSync(dist, { recursive: true });
  // tar -xf zip -C dist  (Windows 10+ 自带 bsdtar, 可解 zip)
  execFileSync('tar.exe', ['-xf', zip, '-C', dist], { stdio: 'inherit' });
  fs.writeFileSync(path.join(__dirname, '..', 'node_modules', 'electron', 'path.txt'), 'electron.exe');
  fs.rmSync(zip, { force: true });
  const exe = path.join(dist, 'electron.exe');
  console.log('OK electron.exe exists:', fs.existsSync(exe), 'size:', fs.existsSync(exe) ? fs.statSync(exe).size : 0);
})();
