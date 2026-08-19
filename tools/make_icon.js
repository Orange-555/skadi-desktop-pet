// 生成 32x32 托盘图标 (简单蓝色圆角方块 + 白色"剑"形)
const fs = require("fs");
const zlib = require("zlib");

const W = 32, H = 32;
const raw = Buffer.alloc(W * H * 4);

function put(x, y, r, g, b, a) {
  if (x < 0 || y < 0 || x >= W || y >= H) return;
  const i = (y * W + x) * 4;
  raw[i] = r; raw[i + 1] = g; raw[i + 2] = b; raw[i + 3] = a;
}

// 圆角方块背景 (#246bbc 斯卡蒂蓝)
const radius = 6;
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const dx = x < radius ? radius - x : x > W - 1 - radius ? x - (W - 1 - radius) : 0;
    const dy = y < radius ? radius - y : y > H - 1 - radius ? y - (H - 1 - radius) : 0;
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d <= radius) put(x, y, 0x24, 0x6b, 0xbc, 255);
  }
}
// 白色竖剑形
for (let y = 8; y <= 23; y++) put(15, y, 255, 255, 255, 255);
for (let x = 13; x <= 18; x++) put(x, 8, 255, 255, 255, 255);
put(13, 23, 255, 255, 255, 255); put(18, 23, 255, 255, 255, 255);
put(12, 24, 255, 255, 255, 255); put(19, 24, 255, 255, 255, 255);
for (let x = 10; x <= 21; x++) put(x, 25, 255, 255, 255, 255);

function crc32(buf) {
  let c, table = crc32.table;
  if (!table) {
    table = crc32.table = [];
    for (let n = 0; n < 256; n++) {
      c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c >>> 0;
    }
  }
  c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = table[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4);
ihdr[8] = 8; ihdr[9] = 6; // 8bit RGBA
const scanlines = Buffer.alloc(H * (1 + W * 4));
for (let y = 0; y < H; y++) {
  scanlines[y * (1 + W * 4)] = 0;
  raw.copy(scanlines, y * (1 + W * 4) + 1, y * W * 4, (y + 1) * W * 4);
}
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk("IHDR", ihdr),
  chunk("IDAT", zlib.deflateSync(scanlines)),
  chunk("IEND", Buffer.alloc(0)),
]);
fs.writeFileSync("icon.png", png);
console.log("icon.png written", png.length, "bytes");
