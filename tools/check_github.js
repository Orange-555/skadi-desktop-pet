const https = require('https');
const fs = require('fs');
const os = require('os');
const path = require('path');

function check(url) {
  return new Promise((res) => {
    const req = https.get(url, { headers: { 'User-Agent': 'test', 'Accept': 'application/vnd.github+json' } }, (r) => {
      res(url + ' -> ' + r.statusCode);
      r.resume();
    });
    req.setTimeout(15000, () => { req.destroy(); res(url + ' -> TIMEOUT'); });
    req.on('error', (e) => res(url + ' -> ERR ' + e.message));
  });
}

(async () => {
  console.log(await check('https://api.github.com'));
  console.log(await check('https://github.com'));
  // credentials
  try {
    const s = fs.readFileSync(path.join(os.homedir(), '.dsh', '.credentials.yaml'), 'utf8');
    s.split(/\r?\n/).filter(Boolean).forEach((l) => {
      const m = l.match(/^([A-Z_]+)\s*:\s*(.*)$/);
      if (m) {
        const v = m[2].replace(/^['"]|['"]$/g, '');
        const masked = v.length > 8 ? v.slice(0, 6) + '...(' + v.length + ')' : v;
        console.log('cred:', m[1], '=>', masked);
      }
    });
  } catch (e) {
    console.log('cred file err', e.message);
  }
  // env tokens
  ['GITHUB_TOKEN', 'GH_TOKEN', 'GITLAB_TOKEN'].forEach((k) => {
    if (process.env[k]) console.log('env:', k, '=> SET (' + process.env[k].length + ')');
  });
  // gitconfig
  try {
    const g = fs.readFileSync(path.join(os.homedir(), '.gitconfig'), 'utf8');
    console.log('gitconfig:', g.split(/\r?\n/).filter((l) => /user|email|name/i.test(l)).join(' | ') || '(no user config)');
  } catch (e) {
    console.log('no gitconfig');
  }
  // gh auth
  const { execSync } = require('child_process');
  try {
    const out = execSync('gh auth status 2>&1', { stdio: ['ignore', 'pipe', 'pipe'] }).toString();
    console.log('gh auth status:', out.split(/\r?\n/).filter((l) => l.trim()).slice(0, 5).join(' / '));
  } catch (e) {
    console.log('gh auth: unavailable or not authed', e.stdout ? e.stdout.toString().split(/\r?\n/)[0] : '');
  }
})();
