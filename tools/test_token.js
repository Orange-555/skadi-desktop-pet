const fs = require('fs');
const os = require('os');
const path = require('path');
const https = require('https');

const s = fs.readFileSync(path.join(os.homedir(), '.dsh', '.credentials.yaml'), 'utf8');
const m = s.match(/^GITHUB_TOKEN\s*:\s*(.*)$/m);
if (!m) {
  console.log('cred file 中没有 GITHUB_TOKEN 行');
  console.log('文件内容(脱敏):');
  s.split(/\r?\n/).filter(Boolean).forEach((l) => console.log('  ' + l.replace(/(sk-[A-Za-z0-9]{4})[A-Za-z0-9]+/g, '$1...')));
  process.exit(0);
}
const raw = m[1].trim().replace(/^['"]|['"]$/g, '');
console.log('token 长度:', raw.length);
console.log('token 前缀:', raw.slice(0, 7));
console.log('token 尾缀:', '...' + raw.slice(-4));
console.log('是否含空白:', /\s/.test(raw));
console.log('是否含引号:', /['"]/.test(raw));

// 直接测试 token
https.get('https://api.github.com/user', {
  headers: { 'User-Agent': 'test', 'Authorization': 'Bearer ' + raw },
}, (r) => {
  let b = '';
  r.on('data', (d) => (b += d));
  r.on('end', () => {
    console.log('/user 状态:', r.statusCode);
    if (r.statusCode === 200) {
      const j = JSON.parse(b);
      console.log('登录名:', j.login, '| 用户名:', j.name);
    } else {
      console.log('响应:', b.slice(0, 200));
    }
  });
}).on('error', (e) => console.log('ERR', e.message));
