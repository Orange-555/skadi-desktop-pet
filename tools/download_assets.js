const https = require('https');
const fs = require('fs');
const path = require('path');

const base = 'https://torappu.prts.wiki/assets/char_spine/char_263_skadi/';
const files = [
  'defaultskin/front/char_263_skadi',
  'defaultskin/build/build_char_263_skadi',
  'defaultskin/back/char_263_skadi',
  'char_263_skadi_summer_3/front/char_263_skadi_summer_3',
  'char_263_skadi_summer_3/build/build_char_263_skadi_summer_3',
  'char_263_skadi_summer_3/back/char_263_skadi_summer_3',
  'char_263_skadi_marthe_5/front/char_263_skadi_marthe_5',
  'char_263_skadi_marthe_5/build/build_char_263_skadi_marthe_5',
  'char_263_skadi_marthe_5/back/char_263_skadi_marthe_5',
];
const exts = ['.skel', '.json', '.atlas', '.png'];

function dl(url, dest) {
  return new Promise((resolve, reject) => {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    const req = https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (r) => {
      if (r.statusCode !== 200) { r.resume(); return reject(new Error(url + ' -> ' + r.statusCode)); }
      const ws = fs.createWriteStream(dest);
      r.pipe(ws);
      ws.on('finish', () => ws.close(() => resolve(fs.statSync(dest).size)));
      ws.on('error', reject);
    });
    req.setTimeout(60000, () => { req.destroy(new Error('timeout ' + url)); });
    req.on('error', reject);
  });
}

(async () => {
  let total = 0, n = 0;
  for (const f of files) {
    for (const ext of exts) {
      const url = base + f + ext;
      const dest = path.join('assets', f + ext);
      try {
        const size = await dl(url, dest);
        total += size; n++;
        console.log('OK', size, dest);
      } catch (e) {
        console.log('FAIL', e.message);
      }
    }
  }
  console.log('done', n, 'files,', total, 'bytes');
})();
