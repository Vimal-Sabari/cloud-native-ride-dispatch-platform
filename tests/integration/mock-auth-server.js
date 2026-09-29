/**
 * Lightweight local Auth Server for Simulator End-to-End Testing.
 *
 * Implements the standard POST /auth/token endpoint expected by
 * Driver Simulator and Rider Simulator, issuing HMAC-SHA256 (HS256)
 * signed JWT tokens with 12-hour expiry.
 */

const http = require('http');
const jwt = require('jsonwebtoken');

const port = parseInt(process.env.AUTH_PORT || '4567', 10);
const secret = process.env.JWT_SECRET || 'dev-jwt-secret-for-ride-dispatch-local-testing';

const server = http.createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/auth/token') {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });

    req.on('end', () => {
      try {
        const payload = JSON.parse(body || '{}');
        const { subjectId, role } = payload;

        if (!subjectId || !role) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Missing subjectId or role' }));
          return;
        }

        const token = jwt.sign(
          { sub: subjectId, role },
          secret,
          { algorithm: 'HS256', expiresIn: '12h' }
        );

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ token }));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid JSON payload' }));
      }
    });
  } else {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
  }
});

server.listen(port, () => {
  console.log(`[MockAuthServer] Listening on http://localhost:${port}`);
});

process.on('SIGTERM', () => {
  server.close(() => process.exit(0));
});
process.on('SIGINT', () => {
  server.close(() => process.exit(0));
});
