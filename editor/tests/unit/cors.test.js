const app = require('../../server');
const http = require('http');

// Helper: make an HTTP request against the Express app
function makeRequest(method, path, headers = {}) {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, () => {
      const port = server.address().port;
      const options = {
        hostname: '127.0.0.1',
        port,
        path,
        method,
        headers,
      };
      const req = http.request(options, (res) => {
        let body = '';
        res.on('data', (chunk) => { body += chunk; });
        res.on('end', () => {
          server.close();
          resolve({ status: res.statusCode, headers: res.headers, body });
        });
      });
      req.on('error', (err) => { server.close(); reject(err); });
      req.end();
    });
  });
}

describe('CORS headers', () => {
  test('GET /api/documents includes Access-Control-Allow-Origin', async () => {
    const res = await makeRequest('GET', '/api/documents', {
      Origin: 'https://andypeterson2.github.io',
    });
    expect(res.status).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBeDefined();
  });

  test('OPTIONS preflight returns CORS headers', async () => {
    const res = await makeRequest('OPTIONS', '/api/documents', {
      Origin: 'https://andypeterson2.github.io',
      'Access-Control-Request-Method': 'GET',
    });
    expect(res.status).toBeLessThanOrEqual(204);
    expect(res.headers['access-control-allow-origin']).toBeDefined();
  });

  test('GET /api/data includes Access-Control-Allow-Origin', async () => {
    const res = await makeRequest('GET', '/api/data', {
      Origin: 'https://andypeterson2.github.io',
    });
    expect(res.headers['access-control-allow-origin']).toBeDefined();
  });
});
