/**
 * Download a layout zip from a URL on behalf of a caller (the MCP install path),
 * without letting that URL reach the server's own network. Only https is fetched,
 * and every connection's resolved address is checked in the socket's `lookup`, so a
 * hostname that resolves (or later re-resolves) to a private, loopback, link-local
 * or metadata address is refused. Redirects are followed by hand, each re-checked.
 * The body is capped in size and time.
 */
const fs = require('fs');
const dns = require('dns');
const net = require('net');
const http = require('http');
const https = require('https');
const { AppError } = require('./errors');

const MAX_BYTES = 25 * 1024 * 1024;
const TIMEOUT_MS = 20000;
const MAX_REDIRECTS = 3;

const BLOCKED = new net.BlockList();
for (const [addr, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['224.0.0.0', 3],
]) {
  BLOCKED.addSubnet(addr, prefix, 'ipv4');
}
for (const [addr, prefix] of [
  ['::', 128],
  ['::1', 128],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8],
]) {
  BLOCKED.addSubnet(addr, prefix, 'ipv6');
}

/** True for an address a fetch on someone else's behalf must not reach. */
function isPrivateAddress(address) {
  const family = net.isIP(address);
  if (family === 0) return true;
  if (family === 6) {
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address);
    if (mapped) return BLOCKED.check(mapped[1], 'ipv4');
    return BLOCKED.check(address, 'ipv6');
  }
  return BLOCKED.check(address, 'ipv4');
}

function guardedLookup(hostname, options, callback) {
  dns.lookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err);
    const list = Array.isArray(addresses) ? addresses : [{ address: addresses, family: 4 }];
    const bad = list.find((a) => isPrivateAddress(a.address));
    if (bad)
      return callback(new AppError(`Refusing to fetch from ${hostname} (${bad.address})`, 400));
    if (options && options.all) return callback(null, list);
    callback(null, list[0].address, list[0].family);
  });
}

/**
 * Fetch `url` into `destPath`.
 * @param {object} [opts] for tests only: { allowHttp, allowPrivate, maxBytes }
 */
function downloadZip(url, destPath, opts = {}, redirects = 0) {
  const { allowHttp = false, allowPrivate = false, maxBytes = MAX_BYTES } = opts;
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return Promise.reject(new AppError('Not a valid URL', 400));
  }
  const httpsUrl = parsed.protocol === 'https:';
  if (!httpsUrl && !(allowHttp && parsed.protocol === 'http:'))
    return Promise.reject(new AppError('Only https URLs can be installed from', 400));
  const client = httpsUrl ? https : http;
  // An address written into the URL never goes through `lookup`, so check it here.
  const literal = parsed.hostname.replace(/^\[|\]$/g, '');
  if (!allowPrivate && net.isIP(literal) && isPrivateAddress(literal))
    return Promise.reject(new AppError(`Refusing to fetch from ${literal}`, 400));

  return new Promise((resolve, reject) => {
    const req = client.get(
      url,
      { lookup: allowPrivate ? undefined : guardedLookup, timeout: TIMEOUT_MS },
      (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          if (redirects >= MAX_REDIRECTS) return reject(new AppError('Too many redirects', 400));
          const next = new URL(res.headers.location, url).toString();
          return resolve(downloadZip(next, destPath, opts, redirects + 1));
        }
        if (res.statusCode !== 200) {
          res.resume();
          return reject(new AppError(`The URL answered HTTP ${res.statusCode}`, 400));
        }
        const declared = Number(res.headers['content-length']);
        if (declared > maxBytes) {
          res.destroy();
          return reject(new AppError('The zip is larger than 25 MB', 413));
        }
        let size = 0;
        const out = fs.createWriteStream(destPath);
        res.on('data', (chunk) => {
          size += chunk.length;
          if (size > maxBytes) {
            res.destroy();
            out.destroy();
            fs.rmSync(destPath, { force: true });
            reject(new AppError('The zip is larger than 25 MB', 413));
          }
        });
        res.pipe(out);
        out.on('finish', () => resolve(destPath));
        out.on('error', reject);
      },
    );
    req.on('timeout', () => req.destroy(new AppError('The download timed out', 408)));
    req.on('error', (e) =>
      reject(e instanceof AppError ? e : new AppError(`Could not download: ${e.message}`, 400)),
    );
  });
}

module.exports = { downloadZip, isPrivateAddress };
