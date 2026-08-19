const { execSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

function run(cmd) {
  try {
    return execSync(cmd, { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' }).trim();
  } catch (e) {
    return '(err) ' + (e.stdout || e.stderr || '').toString().trim().split(/\r?\n/)[0];
  }
}

console.log('git:', run('git --version'));
console.log('git credential helper:', run('git config --global credential.helper'));
console.log('ssh keys:', (() => {
  try {
    return fs.readdirSync(path.join(os.homedir(), '.ssh')).join(', ');
  } catch { return '(none)'; }
})());
console.log('ssh known github:', (() => {
  try {
    const k = fs.readFileSync(path.join(os.homedir(), '.ssh', 'known_hosts'), 'utf8');
    return k.includes('github.com') ? 'yes' : 'no';
  } catch { return '(none)'; }
})());
console.log('cmdkey github:', run('cmdkey /list').includes('github.com') ? 'found github entry' : 'no github entry in cmdkey');
console.log('gh config dir:', fs.existsSync(path.join(os.homedir(), '.config', 'gh')) ? 'exists' : '(none)');
console.log('git credentials file:', (() => {
  try {
    const c = fs.readFileSync(path.join(os.homedir(), '.git-credentials'), 'utf8');
    return 'exists, ' + c.split(/\r?\n/).filter(Boolean).length + ' line(s), hosts: ' + c.split(/\r?\n/).filter(Boolean).map((l) => l.split('://')[1].split('@')[1] || l.split('://')[0]).join(',');
  } catch { return '(none)'; }
})());
