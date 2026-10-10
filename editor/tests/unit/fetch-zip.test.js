const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { downloadZip, isPrivateAddress } = require('../../lib/fetch-zip');

describe('isPrivateAddress', () => {
  test('blocks loopback, private, link-local, metadata and mapped addresses', () => {
    for (const a of [
      '127.0.0.1',
      '10.0.0.5',
      '172.16.3.4',
      '192.168.1.1',
      '169.254.169.254',
      '::1',
      'fd12::1',
      'fe80::1',
      '::ffff:10.0.0.1',
      '0.0.0.0',
    ])
      expect(isPrivateAddress(a)).toBe(true);
  });
  test('allows public addresses', () => {
    for (const a of ['8.8.8.8', '1.1.1.1', '2606:4700:4700::1111'])
      expect(isPrivateAddress(a)).toBe(false);
  });
});

describe('downloadZip', () => {
  let server;
  let base;
  let dir;
  beforeAll(async () => {
    server = http.createServer((req, res) => {
      if (req.url === '/ok.zip') return res.end('PK-zip-bytes');
      if (req.url === '/big.zip') return res.end(Buffer.alloc(2048));
      if (req.url.startsWith('/loop')) {
        res.writeHead(302, { Location: '/loop' });
        return res.end();
      }
      res.writeHead(404);
      res.end();
    });
    await new Promise((r) => server.listen(0, r));
    base = `http://127.0.0.1:${server.address().port}`;
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fetch-zip-'));
  });
  afterAll(async () => {
    await new Promise((r) => server.close(r));
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const local = { allowHttp: true, allowPrivate: true };

  test('refuses http, and private addresses even over https', async () => {
    await expect(downloadZip(`${base}/ok.zip`, path.join(dir, 'a'))).rejects.toMatchObject({
      status: 400,
    });
    await expect(downloadZip('https://127.0.0.1:9/ok.zip', path.join(dir, 'a'))).rejects.toThrow(
      /Refusing to fetch/,
    );
  });

  test('saves the body, caps the size and limits redirects', async () => {
    const out = await downloadZip(`${base}/ok.zip`, path.join(dir, 'ok'), local);
    expect(fs.readFileSync(out, 'utf-8')).toBe('PK-zip-bytes');
    await expect(
      downloadZip(`${base}/big.zip`, path.join(dir, 'big'), { ...local, maxBytes: 1024 }),
    ).rejects.toMatchObject({ status: 413 });
    await expect(downloadZip(`${base}/loop`, path.join(dir, 'loop'), local)).rejects.toThrow(
      /Too many redirects/,
    );
    await expect(downloadZip(`${base}/nope`, path.join(dir, 'nope'), local)).rejects.toThrow(
      /HTTP 404/,
    );
  });
});
