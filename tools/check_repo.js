// 检查仓库是否存在 (配合细粒度 token 工作流)
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
const token = getToken();
if (!token) { console.log('NO TOKEN'); process.exit(1); }

const owner = 'Orange-555';
const repo = 'skadi-desktop-pet';
https.get('https://api.github.com/repos/' + owner + '/' + repo, {
  headers: { 'User-Agent': 'skadi-check', 'Authorization': 'Bearer ' + token },
}, (r) => {
  let b = '';
  r.on('data', (d) => (b += d));
  r.on('end', () => {
    console.log('GET /repos/' + owner + '/' + repo, '->', r.statusCode);
    if (r.statusCode === 200) {
      const j = JSON.parse(b);
      console.log('仓库存在: ' + j.full_name + ' (' + j.visibility + ') 默认分支: ' + j.default_branch);
    } else if (r.statusCode === 404) {
      console.log('仓库不存在 → 需要先手动创建');
    } else {
      console.log('响应:', b.slice(0, 300));
    }
  });
}).on('error', (e) => console.log('ERR', e.message));
