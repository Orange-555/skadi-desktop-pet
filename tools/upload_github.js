// 创建 GitHub 仓库并上传桌宠全部文件 (使用 GitHub Contents API, 无需 git)
// 用法: node tools/upload_github.js <owner> <repo> <public|private>
// 认证: 优先环境变量 GITHUB_TOKEN, 其次 ~/.dsh/.credentials.yaml 的 GITHUB_TOKEN 字段
const https = require('https');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const owner = process.argv[2] || null; // 可省略, 自动从 /user 获取
const repo = process.argv[3];
const visibility = (process.argv[4] || 'public') === 'private' ? 'private' : 'public';

function getToken() {
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN;
  try {
    const s = fs.readFileSync(path.join(os.homedir(), '.dsh', '.credentials.yaml'), 'utf8');
    const m = s.match(/^GITHUB_TOKEN\s*:\s*["']?([^"'\s]+)/m);
    if (m) return m[1];
  } catch (_) {}
  return null;
}

function api(method, url, body, token) {
  return new Promise((resolve, reject) => {
    const u = new URL('https://api.github.com' + url);
    const data = body ? JSON.stringify(body) : null;
    const req = https.request({
      hostname: 'api.github.com', path: u.pathname + u.search, method,
      headers: {
        'User-Agent': 'skadi-pet-uploader',
        'Accept': 'application/vnd.github+json',
        'Authorization': 'Bearer ' + token,
        ...(data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {}),
      },
    }, (r) => {
      let b = '';
      r.on('data', (d) => (b += d));
      r.on('end', () => {
        let j = null;
        try { j = JSON.parse(b); } catch (_) {}
        resolve({ status: r.statusCode, json: j, raw: b });
      });
    });
    req.setTimeout(120000, () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

// 收集要上传的文件 (排除本地依赖/无关文件)
const EXCLUDE_DIRS = new Set(['node_modules', '.npm-cache', '.git']);
const EXCLUDE_NAMES = /\.(exe|msi|zip|7z|sha256|log|tmp|lock)$/i;
const EXCLUDE_EXTRA = new Set(['download-dsh-desktop.js', 'shot1.png', 'shot2.png', 'screenshot.png']);
function collectFiles(dir, base, out) {
  for (const name of fs.readdirSync(dir)) {
    if (EXCLUDE_DIRS.has(name) || EXCLUDE_NAMES.test(name) || EXCLUDE_EXTRA.has(name)) continue;
    const p = path.join(dir, name);
    const rel = base ? base + '/' + name : name;
    const st = fs.statSync(p);
    if (st.isDirectory()) collectFiles(p, rel, out);
    else out.push(rel);
  }
}

(async () => {
  const token = getToken();
  if (!token) {
    console.error('未找到 GITHUB_TOKEN: 请设置环境变量 GITHUB_TOKEN, 或在 ~/.dsh/.credentials.yaml 添加 GITHUB_TOKEN 字段后重试');
    process.exit(1);
  }
  if (!repo) {
    console.error('用法: node tools/upload_github.js [owner] <repo> [public|private]');
    process.exit(1);
  }
  // 1. 获取当前用户
  const me = await api('GET', '/user', null, token);
  const login = (me.json && me.json.login) || owner;
  if (!login) {
    console.error('无法获取 GitHub 用户名:', me.status, (me.raw || '').slice(0, 200));
    process.exit(1);
  }
  console.log('GitHub 用户:', login);
  const isFineGrained = token.startsWith('github_pat_');

  // 2. 确认仓库存在 (细粒度 token 不能创建仓库, 需手动创建)
  const check = await api('GET', '/repos/' + login + '/' + repo, null, token);
  let defaultBranch = 'main';
  if (check.status === 200) {
    defaultBranch = (check.json && check.json.default_branch) || 'main';
    console.log('仓库已存在:', check.json.full_name, '(' + check.json.visibility + ') 分支:', defaultBranch);
  } else if (isFineGrained) {
    console.error('仓库不存在。细粒度 token 无法通过 API 创建仓库, 请手动创建:');
    console.error('  1) 打开 https://github.com/new');
    console.error('  2) Repository name 填: ' + repo);
    console.error('  3) 选 Public, 并勾选 "Add a README file" (必须有初始提交, 否则无法上传)');
    console.error('  4) 点 Create repository, 然后重新运行本脚本');
    process.exit(1);
  } else {
    console.log('创建仓库', login + '/' + repo, '(' + visibility + ') ...');
    const created = await api('POST', '/user/repos', { name: repo, private: visibility === 'private', auto_init: true }, token);
    if (created.status !== 201) {
      console.error('创建仓库失败:', created.status, created.raw.slice(0, 300));
      process.exit(1);
    }
    defaultBranch = (created.json && created.json.default_branch) || 'main';
    console.log('仓库已创建 ✓');
  }

  // 3. 收集文件
  const files = [];
  collectFiles(ROOT, '', files);
  files.sort();
  console.log('待上传文件数:', files.length);

  // 4. 逐个上传 (Contents API: content 一律 base64)
  let ok = 0, fail = 0;
  for (const rel of files) {
    const data = fs.readFileSync(path.join(ROOT, rel));
    const content = data.toString('base64');
    // 已存在文件需要 sha 才能更新
    let sha = null;
    try {
      const ex = await api('GET', '/repos/' + login + '/' + repo + '/contents/' + encodeURIComponent(rel), null, token);
      if (ex.status === 200) sha = (ex.json && ex.json.sha) || null;
    } catch (_) {}
    const body = {
      message: 'add ' + rel,
      content,
      encoding: 'base64',
      ...(sha ? { sha } : {}),
      branch: defaultBranch,
    };
    let r = null;
    for (let attempt = 1; attempt <= 3 && !r; attempt++) {
      try {
        r = await api('PUT', '/repos/' + login + '/' + repo + '/contents/' + encodeURIComponent(rel), body, token);
      } catch (e) {
        console.error('  重试', rel, '第' + attempt + '次:', e.message);
      }
    }
    if (r && (r.status === 201 || r.status === 200)) { ok++; }
    else { fail++; console.error('  失败', rel, r ? r.status : 'no response', r ? (r.raw || '').slice(0, 200) : ''); }
    if ((ok + fail) % 20 === 0) console.log('  进度', ok + fail + '/' + files.length);
  }
  console.log('完成: 成功', ok, '失败', fail);
  console.log('仓库地址: https://github.com/' + login + '/' + repo);
})();
