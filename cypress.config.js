const { defineConfig } = require('cypress');
const fs = require('fs');
const http = require('http');
const path = require('path');

const PORT = 4173;
let server;

/**
 * Creates a minimal static file server so Cypress can hit the SPA without
 * needing `npm run dev` or another external process. The server simply serves
 * files relative to the repo root and infers content types from extensions.
 */
function createStaticServer() {
  const root = __dirname;
  return http.createServer((req, res) => {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    let filePath = url.pathname;
    if (filePath === '/' || filePath === '') {
      filePath = '/index.html';
    }

    const normalized = path.normalize(filePath).replace(/^[\\/]+/, '');
    const safePath = normalized.replace(/^\.\.(?:[\\/]|$)/, '');
    const absolutePath = path.join(root, safePath);

    fs.readFile(absolutePath, (err, data) => {
      if (err) {
        res.statusCode = 404;
        res.end('Not found');
        return;
      }

      const ext = path.extname(absolutePath);
      const contentType = {
        '.html': 'text/html',
        '.js': 'text/javascript',
        '.css': 'text/css',
        '.json': 'application/json',
        '.svg': 'image/svg+xml',
        '.ttf': 'font/ttf'
      }[ext] || 'application/octet-stream';

      res.setHeader('Content-Type', contentType);
      res.end(data);
    });
  });
}

/** Ensure the static server is running before Cypress starts executing specs. */
function ensureServer() {
  if (!server) {
    server = createStaticServer();
    server.listen(PORT);
  }
}

ensureServer();

module.exports = defineConfig({
  e2e: {
    baseUrl: `http://localhost:${PORT}`,
    supportFile: 'cypress/support/e2e.js',
    setupNodeEvents(on) {
      // After the suite finishes, clean up the server so future runs are fresh.
      on('after:run', async () => {
        if (server) {
          await new Promise((resolve) => server.close(resolve));
          server = undefined;
        }
      });
    }
  }
});
