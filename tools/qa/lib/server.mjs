// Tiny static file server with Range support (so <audio> seeking works) for the QA harness.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";

const MIME = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json", ".png": "image/png", ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif", ".svg": "image/svg+xml", ".mp3": "audio/mpeg",
  ".ogg": "audio/ogg", ".wav": "audio/wav", ".woff": "font/woff", ".woff2": "font/woff2", ".ttf": "font/ttf",
  ".ico": "image/x-icon", ".txt": "text/plain; charset=utf-8", ".md": "text/markdown; charset=utf-8",
};

/**
 * @param {string} root site root to serve
 * @param {{ transform?: (relPath:string, body:Buffer)=>Buffer|null }} [opts] optional body rewriter (used by play.mjs for the __dbg hook)
 * @returns {Promise<{ server: http.Server, port: number, origin: string, close: ()=>Promise<void> }>}
 */
export function startServer(root, opts = {}) {
  root = path.resolve(root);
  const server = http.createServer((req, res) => {
    try {
      let rel = decodeURIComponent(new URL(req.url, "http://x").pathname);
      if (rel.endsWith("/")) rel += "index.html";
      if (rel === "/favicon.ico") { res.writeHead(204); return res.end(); } // keep the console clean of the browser favicon probe
      const file = path.normalize(path.join(root, rel));
      if (!file.startsWith(root)) { res.writeHead(403); return res.end("forbidden"); }
      let st;
      try { st = fs.statSync(file); } catch { res.writeHead(404, { "Content-Type": "text/plain" }); return res.end("not found"); }
      if (st.isDirectory()) { res.writeHead(404); return res.end("not found"); }
      const type = MIME[path.extname(file).toLowerCase()] || "application/octet-stream";
      const common = { "Content-Type": type, "Cache-Control": "no-store", "Accept-Ranges": "bytes" };

      if (opts.transform && /\.html?$/i.test(file)) {
        const out = opts.transform(rel.replace(/^\//, ""), fs.readFileSync(file));
        if (out) { res.writeHead(200, { ...common, "Content-Length": out.length }); return res.end(out); }
      }

      const range = req.headers.range;
      if (range) {
        const m = /bytes=(\d*)-(\d*)/.exec(range);
        if (m) {
          let start = m[1] === "" ? Math.max(0, st.size - Number(m[2])) : Number(m[1]);
          let end = m[1] === "" || m[2] === "" ? st.size - 1 : Math.min(Number(m[2]), st.size - 1);
          if (start > end || start >= st.size) { res.writeHead(416, { "Content-Range": `bytes */${st.size}` }); return res.end(); }
          res.writeHead(206, { ...common, "Content-Range": `bytes ${start}-${end}/${st.size}`, "Content-Length": end - start + 1 });
          return fs.createReadStream(file, { start, end }).pipe(res);
        }
      }
      res.writeHead(200, { ...common, "Content-Length": st.size });
      fs.createReadStream(file).pipe(res);
    } catch (e) {
      res.writeHead(500); res.end(String(e));
    }
  });
  return new Promise((resolve, reject) => {
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      resolve({ server, port, origin: `http://127.0.0.1:${port}`, close: () => new Promise((r) => server.close(() => r())) });
    });
  });
}
