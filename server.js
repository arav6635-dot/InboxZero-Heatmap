const fs = require("fs");
const path = require("path");
const http = require("http");

const ROOT = process.cwd();

loadDotEnv(path.join(ROOT, ".env"));
const HOST = process.env.HOST || "localhost";
const PORT = Number(process.env.PORT || 5500);


const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};


http
  .createServer((req, res) => {
    const reqPath = decodeURIComponent((req.url || "/").split("?")[0]);

    if (reqPath === "/config.js") {
      const payload = {
        googleClientId: process.env.GOOGLE_CLIENT_ID || "",
        googleApiKey: process.env.GOOGLE_API_KEY || "",
      };
      res.writeHead(200, { "Content-Type": MIME_TYPES[".js"], "Cache-Control": "no-store" });
      res.end(`window.APP_CONFIG = ${JSON.stringify(payload)};`);
      return;
    }

    const safePath = reqPath === "/" ? "/index.html" : reqPath;
    const filePath = path.normalize(path.join(ROOT, safePath));

    if (!filePath.startsWith(ROOT)) {
      res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Forbidden");
      return;
    }

    fs.readFile(filePath, (err, data) => {
      if (err) {
        res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
        res.end("Not Found");
        return;
      }

      const ext = path.extname(filePath).toLowerCase();
      const contentType = MIME_TYPES[ext] || "application/octet-stream";
      res.writeHead(200, { "Content-Type": contentType });
      res.end(data);
    });
  })
  .listen(PORT, HOST, () => {
    console.log(`InboxZero server running at http://${HOST}:${PORT}`);
  });

function loadDotEnv(dotEnvPath) {
  if (!fs.existsSync(dotEnvPath)) return;
  const content = fs.readFileSync(dotEnvPath, "utf8");

  content.split(/\r?\n/).forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return;

    const eqIndex = trimmed.indexOf("=");
    if (eqIndex <= 0) return;

    const key = trimmed.slice(0, eqIndex).trim();
    let value = trimmed.slice(eqIndex + 1).trim();

    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }

    if (!(key in process.env)) {
      process.env[key] = value;
    }
  });
}
