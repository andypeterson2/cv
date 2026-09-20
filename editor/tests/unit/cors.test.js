/**
 * The CORS origin allowlist.
 *
 * The origin callback admits any localhost/127.0.0.1 port, the production
 * origin, and anything named in CV_CORS_ORIGINS. Everything else is refused by
 * omitting Access-Control-Allow-Origin, so the reject path is the one worth pinning:
 * a test that only ever sends an allowed origin passes whatever the rule says.
 */
process.env.CV_PROD_ORIGIN = 'https://cv.example.test';
process.env.CV_CORS_ORIGINS = 'https://extra.example.test, https://second.example.test';

const app = require('../../server');
const http = require('http');

// Helper: make an HTTP request against the Express app
function makeRequest(method, path, headers = {}) {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, () => {
      const port = server.address().port;
      const options = { hostname: '127.0.0.1', port, path, method, headers };
      const req = http.request(options, (res) => {
        let body = '';
        res.on('data', (chunk) => {
          body += chunk;
        });
        res.on('end', () => {
          server.close();
          resolve({ status: res.statusCode, headers: res.headers, body });
        });
      });
      req.on('error', (err) => {
        server.close();
        reject(err);
      });
      req.end();
    });
  });
}

// /api/catalog is static (no DB) — safe to hit without injecting a test DB.
const allowOrigin = async (origin) =>
  (await makeRequest('GET', '/api/catalog', origin ? { Origin: origin } : {})).headers[
    'access-control-allow-origin'
  ];

describe('CORS — allowed origins', () => {
  test('a localhost origin on any port is echoed back', async () => {
    for (const o of ['http://localhost:3001', 'http://127.0.0.1:5173', 'https://localhost']) {
      expect(await allowOrigin(o)).toBeDefined();
    }
  });

  test('the production origin is allowed', async () => {
    expect(await allowOrigin('https://cv.example.test')).toBeDefined();
  });

  test('every entry in CV_CORS_ORIGINS is allowed', async () => {
    expect(await allowOrigin('https://extra.example.test')).toBeDefined();
    expect(await allowOrigin('https://second.example.test')).toBeDefined();
  });

  test('a request with no Origin is allowed (curl, same-origin, server-to-server)', async () => {
    const res = await makeRequest('GET', '/api/catalog');
    expect(res.status).toBe(200);
  });

  test('OPTIONS preflight returns CORS headers', async () => {
    const res = await makeRequest('OPTIONS', '/api/catalog', {
      Origin: 'http://localhost:3001',
      'Access-Control-Request-Method': 'GET',
    });
    expect(res.status).toBeLessThanOrEqual(204);
    expect(res.headers['access-control-allow-origin']).toBeDefined();
  });
});

describe('CORS — refused origins', () => {
  test('an unrelated origin gets no Access-Control-Allow-Origin', async () => {
    for (const o of [
      'https://evil.example.test',
      'https://cv.example.test.evil.test', // suffix trick
      'http://notlocalhost:3001',
      'https://sub.cv.example.test',
    ]) {
      expect(await allowOrigin(o)).toBeUndefined();
    }
  });

  test('a refused preflight carries no allow-origin either', async () => {
    const res = await makeRequest('OPTIONS', '/api/catalog', {
      Origin: 'https://evil.example.test',
      'Access-Control-Request-Method': 'GET',
    });
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  // CORS middleware runs before routing, so an unmatched path behaves the same way.
  test('an unmatched /api path follows the same rule', async () => {
    const ok = await makeRequest('GET', '/api/does-not-exist', {
      Origin: 'http://localhost:3001',
    });
    const no = await makeRequest('GET', '/api/does-not-exist', {
      Origin: 'https://evil.example.test',
    });
    expect(ok.headers['access-control-allow-origin']).toBeDefined();
    expect(no.headers['access-control-allow-origin']).toBeUndefined();
  });
});
