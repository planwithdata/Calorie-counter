import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';

const types = {
  '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json',
  '.css': 'text/css', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json',
};
const port = Number(process.env.PORT || 4173);
createServer(async (request, response) => {
  const { pathname } = new URL(request.url, 'http://localhost');
  const subpath = pathname.replace(/^\/Calorie-counter\//, '/');
  const filename = subpath === '/' ? 'index.html' : subpath.slice(1);
  if (!/^[\w.-]+$/.test(filename) || !Object.hasOwn(types, extname(filename))) {
    response.writeHead(404).end();
    return;
  }
  try {
    const body = await readFile(new URL('./site/' + filename, import.meta.url));
    response.writeHead(200, { 'content-type': types[extname(filename)] }).end(body);
  } catch {
    response.writeHead(404).end();
  }
}).listen(port, '127.0.0.1', () => console.log(`Local app: http://127.0.0.1:${port}/Calorie-counter/`));
