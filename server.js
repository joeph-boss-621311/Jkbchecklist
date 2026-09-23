// Serves the app and a small API so the browser, CLI and Claude share one checklist file.
const http = require("http");
const fs = require("fs");
const path = require("path");
const store = require("./lib/store");

const PORT = Number(process.env.PORT) || 4545;
const HOST = process.env.HOST || "127.0.0.1";

const STATIC = {
  "/": ["index.html", "text/html; charset=utf-8"],
  "/index.html": ["index.html", "text/html; charset=utf-8"],
  "/shared.js": ["shared.js", "text/javascript; charset=utf-8"],
};

function send(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", c => {
      size += c.length;
      if (size > 5e6) { reject(new Error("Body too large")); req.destroy(); }
      else chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  try {
    if (req.method === "GET" && url.pathname === "/api/state") return send(res, 200, store.load());
    if (req.method === "POST" && url.pathname === "/api/op") {
      const op = JSON.parse(await readBody(req));
      return send(res, 200, store.apply(op));
    }
    const file = STATIC[url.pathname];
    if (req.method === "GET" && file) {
      res.writeHead(200, { "Content-Type": file[1], "Cache-Control": "no-cache" });
      return fs.createReadStream(path.join(__dirname, file[0])).pipe(res);
    }
    send(res, 404, { error: "Not found" });
  } catch (e) {
    send(res, 400, { error: e.message });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`JKB checklist running at http://${HOST}:${PORT}`);
  console.log(`Data file: ${store.DATA_FILE}`);
});
