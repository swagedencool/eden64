// eden64 — serveur local alternatif pour qui a Node.js (Windows, macOS, Linux)
// Usage : node tools/serveur.mjs   puis ouvrir http://localhost:8064
import { createServer } from 'node:http';
import { readFile, stat, readdir, mkdir } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../web/', import.meta.url));
const roms = fileURLToPath(new URL('../roms/', import.meta.url));
const port = Number(process.env.PORT) || 8064;
const types = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.wasm': 'application/wasm',
  '.data': 'application/octet-stream', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json',
  '.txt': 'text/plain; charset=utf-8', '.md': 'text/plain; charset=utf-8'
};

createServer(async (req, res) => {
  // En-têtes d'isolation cross-origin : débloquent SharedArrayBuffer (threads WebAssembly)
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.setHeader('Cache-Control', 'no-cache');
  try {
    let path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (path === '/roms/index.json') {
      // Ludothèque locale : liste des dumps déposés dans roms/ (jamais publiés avec le site)
      await mkdir(roms, { recursive: true });
      const list = [];
      for (const f of await readdir(roms)) {
        if (!/\.(z64|n64|v64|zip)$/i.test(f)) continue;
        const st = await stat(join(roms, f));
        if (st.isFile()) list.push({ file: f, size: st.size });
      }
      const body = JSON.stringify(list);
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body) });
      return res.end(body);
    }
    if (path.endsWith('/')) path += 'index.html';
    const [dir, rel] = path.startsWith('/roms/') ? [roms, path.slice(6)] : [root, path];
    const file = normalize(join(dir, rel));
    if (!file.startsWith(normalize(dir + sep))) throw new Error('hors racine');
    const info = await stat(file);
    if (!info.isFile()) throw new Error('pas un fichier');
    res.writeHead(200, { 'Content-Type': types[extname(file).toLowerCase()] || 'application/octet-stream', 'Content-Length': info.size });
    if (req.method === 'HEAD') return res.end();
    res.end(await readFile(file));
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('404');
  }
}).listen(port, 'localhost', () => console.log(`eden64 : http://localhost:${port}  (Ctrl+C pour arrêter)`));
