// 浏览器预览服务器: node tools/serve.js → http://localhost:8080/pet/
// 桌宠网页应用 (pet/index.html) 依赖 fetch 加载本地模型, file:// 下会被浏览器拦截, 故用此服务预览。
const http = require("http");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".png": "image/png",
  ".skel": "application/octet-stream",
  ".atlas": "text/plain; charset=utf-8",
  ".ico": "image/x-icon",
};

http
  .createServer((req, res) => {
    let urlPath = decodeURIComponent((req.url || "/").split("?")[0]);
    if (urlPath === "/") urlPath = "/pet/index.html";
    if (urlPath.endsWith("/")) urlPath += "index.html";
    const file = path.normalize(path.join(ROOT, urlPath));
    if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
    fs.readFile(file, (err, data) => {
      if (err) { res.writeHead(404); return res.end("not found"); }
      res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream" });
      res.end(data);
    });
  })
  .listen(8080, () => {
    console.log("预览服务已启动: http://localhost:8080/pet/");
  });
