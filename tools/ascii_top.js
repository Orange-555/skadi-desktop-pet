// 放大查看截图顶部 60px 区域 (疑似工具条意外可见)
const fs = require('fs');
const zlib = require('zlib');
function decodePNG(buf) {
  let pos = 8, width = 0, height = 0, colorType = 0, idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.slice(pos + 8, pos + 8 + len);
    if (type === 'IHDR') { width = data.readUInt32BE(0); height = data.readUInt32BE(4); colorType = data[9]; }
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    pos += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const bpp = colorType === 6 ? 4 : 3;
  const stride = width * bpp;
  const out = Buffer.alloc(height * stride);
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.slice(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const cur = Buffer.from(line);
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? cur[i - bpp] : 0;
      const b = prev[i];
      const c = i >= bpp ? prev[i - bpp] : 0;
      let v = cur[i];
      if (filter === 1) v = (v + a) & 0xff;
      else if (filter === 2) v = (v + b) & 0xff;
      else if (filter === 3) v = (v + ((a + b) >> 1)) & 0xff;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v = (v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 0xff;
      }
      cur[i] = v;
    }
    cur.copy(out, y * stride);
    prev = cur;
  }
  return { width, height, bpp, data: out };
}
const { width, height, bpp, data } = decodePNG(fs.readFileSync('screenshot.png'));
const COLS = 84, ROWS = 12;
const ramp = ' .:-=+*#%@';
for (let r = 0; r < ROWS; r++) {
  let line = '';
  for (let c = 0; c < COLS; c++) {
    const x0 = Math.floor((c / COLS) * width), x1 = Math.floor(((c + 1) / COLS) * width);
    const y0 = Math.floor((r / ROWS) * 60), y1 = Math.floor(((r + 1) / ROWS) * 60);
    let maxA = 0, sumR = 0, sumG = 0, sumB = 0, n = 0;
    for (let y = y0; y < y1; y += 2) for (let x = x0; x < x1; x += 2) {
      const i = (y * width + x) * bpp;
      const a = data[i + 3];
      if (a > maxA) maxA = a;
      if (a > 40) { sumR += data[i]; sumG += data[i + 1]; sumB += data[i + 2]; n++; }
    }
    line += ramp[Math.min(ramp.length - 1, Math.floor((maxA / 255) * (ramp.length - 1)))];
  }
  console.log(line);
}
// 统计顶部区域平均颜色
let n = 0, r = 0, g = 0, b = 0;
for (let y = 0; y < 60; y++) for (let x = 0; x < width; x++) {
  const i = (y * width + x) * bpp;
  if (data[i + 3] > 40) { r += data[i]; g += data[i + 1]; b += data[i + 2]; n++; }
}
console.log('top60px colored px:', n, 'avgRGB:', n ? [Math.round(r / n), Math.round(g / n), Math.round(b / n)] : '-');
