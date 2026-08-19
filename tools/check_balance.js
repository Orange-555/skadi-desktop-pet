// 查询 DeepSeek API 余额 (仅打印余额信息, 不打印密钥)
const https = require("https");
const fs = require("fs");
const os = require("os");
const path = require("path");

function getKey() {
  if (process.env.DEEPSEEK_API_KEY) return process.env.DEEPSEEK_API_KEY;
  try {
    const y = fs.readFileSync(path.join(os.homedir(), ".dsh", ".credentials.yaml"), "utf8");
    const m = y.match(/DEEPSEEK_API_KEY\s*:\s*["']?([^"'\s]+)/);
    if (m) return m[1];
  } catch (_) {}
  return null;
}

const key = getKey();
if (!key) { console.log("NO KEY"); process.exit(1); }
console.log("key found, prefix:", key.slice(0, 6) + "..., length:", key.length);

https.get("https://api.deepseek.com/user/balance", {
  headers: { Authorization: "Bearer " + key, Accept: "application/json" },
}, (r) => {
  let b = "";
  r.on("data", (d) => (b += d));
  r.on("end", () => {
    console.log("status:", r.statusCode);
    try {
      const j = JSON.parse(b);
      console.log("is_available:", j.is_available);
      for (const info of j.balance_infos || []) {
        console.log(`currency=${info.currency} total=${info.total_balance} granted=${info.granted_balance} topped_up=${info.topped_up_balance}`);
      }
    } catch (e) {
      console.log("raw:", b.slice(0, 300));
    }
  });
}).on("error", (e) => console.log("ERR", e.message));
