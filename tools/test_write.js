// 测试细粒度 token 的 Contents 写权限
const https = require('https');
const fs = require('fs');
const os = require('os');
const path = require('path');

function getToken() {
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN;
  const s = fs.readFileSync(path.join(os.homedir(), '.dsh', '.credentials.yaml'), 'utf8');
  const m = s.match(/^GITHUB_TOKEN\s*:\s*["']?([^"'\s]+)/m);
  return m ? m[1] : null;
}
function api(method, url, body) {
  return new Promise((resolve) => {
    const u = new URL('https://api.github.com' + url);
    const data = body ? JSON.stringify(body) : null;
    const req = https.request({
      hostname: 'api.github.com', path: u.pathname, method,
      headers: {
        'User-Agent': 'skadi-test', 'Accept': 'application/vnd.github+json',
        'Authorization': 'Bearer ' + getToken(),
        ...(data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {}),
      },
    }, (r) => {
      let b = '';
      r.on('data', (d) => (b += d));
      r.on('end', () => resolve({ status: r.statusCode, raw: b.slice(0, 300) }));
    });
    req.setTimeout(120000, () => { req.destroy(); resolve({ status: 'TIMEOUT', raw: '' }); });
    req.on('error', (e) => resolve({ status: 'ERR ' + e.message, raw: '' }));
    if (data) req.write(data);
    req.end();
  });
}

(async () => {
  // 1. 写一个测试文件
  let r = await api('PUT', '/repos/Orange-555/skadi-desktop-pet/contents/test-upload.txt', {
    message: 'test write', content: Buffer.from('hello').toString('base64'), branch: 'main',
  });
  console.log('PUT test-upload.txt ->', r.status, r.raw);
  if (r.status === 201 || r.status === 200) {
    // 2. 删除测试文件
    const sha = JSON.parse(r.raw).content.sha;
    r = await api('DELETE', '/repos/Orange-555/skadi-desktop-pet/contents/test-upload.txt', {
      message: 'remove test', sha, branch: 'main',
    });
    console.log('DELETE test-upload.txt ->', r.status, r.raw);
  }
  // 3. 读 README 检查现有文件 sha (为后续更新做准备)
  r = await api('GET', '/repos/Orange-555/skadi-desktop-pet/contents/README.md', null);
  console.log('GET README.md ->', r.status, r.raw.includes('sha') ? 'has sha' : r.raw);
})();
