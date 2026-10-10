/**
 * A local stand-in for api.github.com and codeload.github.com, so layout linking and
 * sync run in tests without the network. Repos are plain objects the test mutates:
 *   { private, defaultBranch, branches: {name: sha}, releases: [{tag, sha}], files: {sha: {path: content}} }
 * Tests point CV_GITHUB_API_BASE and CV_GITHUB_CODELOAD_BASE at its base URL.
 */
const http = require('http');
const archiver = require('archiver');

function zipOf(prefix, files) {
  return new Promise((resolve, reject) => {
    const zip = archiver('zip');
    const chunks = [];
    zip.on('data', (c) => chunks.push(c));
    zip.on('end', () => resolve(Buffer.concat(chunks)));
    zip.on('error', reject);
    for (const [name, content] of Object.entries(files))
      zip.append(content, { name: prefix + name });
    zip.finalize();
  });
}

const json = (res, status, body, extra = {}) => {
  res.writeHead(status, { 'Content-Type': 'application/json', ...extra });
  res.end(JSON.stringify(body));
};

/** 304 when the client already has `etag`; otherwise false. */
function notModified(req, res, etag) {
  if (req.headers['if-none-match'] !== etag) return false;
  res.writeHead(304);
  res.end();
  return true;
}

function latestRelease(req, res, repo) {
  const rel = repo.releases.at(-1);
  if (!rel) return json(res, 404, { message: 'Not Found' });
  const etag = `"rel-${rel.tag}"`;
  if (notModified(req, res, etag)) return;
  json(res, 200, { tag_name: rel.tag }, { ETag: etag });
}

function commit(req, res, repo, ref) {
  const sha =
    repo.branches[ref] ||
    repo.releases.find((r) => r.tag === ref)?.sha ||
    (repo.files[ref] ? ref : null);
  if (!sha) return json(res, 404, { message: 'No commit found' });
  const etag = `"c-${sha}"`;
  if (notModified(req, res, etag)) return;
  res.writeHead(200, { 'Content-Type': 'text/plain', ETag: etag });
  res.end(sha);
}

/** /rate_limit: refuses `options.badToken`, and reports `options.tokenExpiry` on a token. */
function rateLimitRoute(req, res, options) {
  const auth = req.headers.authorization;
  if (auth && auth === `Bearer ${options.badToken}`)
    return json(res, 401, { message: 'Bad credentials' });
  const extra =
    auth && options.tokenExpiry
      ? { 'github-authentication-token-expiration': options.tokenExpiry }
      : {};
  json(res, 200, { resources: {} }, extra);
}

function apiRoute(req, res, repos, parts) {
  const repo = repos[`${parts[1]}/${parts[2]}`];
  if (!repo) return json(res, 404, { message: 'Not Found' });
  if (parts.length === 3)
    return json(res, 200, { private: repo.private, default_branch: repo.defaultBranch });
  if (parts[3] === 'releases' && parts[4] === 'latest') return latestRelease(req, res, repo);
  if (parts[3] === 'commits')
    return commit(req, res, repo, decodeURIComponent(parts.slice(4).join('/')));
  json(res, 404, {});
}

// codeload: /<owner>/<repo>/zip/<sha>
async function codeloadRoute(res, repos, parts) {
  const repo = repos[`${parts[0]}/${parts[1]}`];
  const files = repo && repo.files[parts[3]];
  if (!files) {
    res.writeHead(404);
    return res.end();
  }
  const body = await zipOf(`${parts[1]}-${parts[3]}/`, files);
  res.writeHead(200, { 'Content-Type': 'application/zip', 'Content-Length': body.length });
  res.end(body);
}

function startFakeGithub() {
  const repos = {};
  const calls = [];
  let rateLimited = false;
  const options = { badToken: null, tokenExpiry: null };
  const server = http.createServer(async (req, res) => {
    calls.push(req.url);
    if (rateLimited) {
      res.writeHead(403, { 'x-ratelimit-remaining': '0' });
      return res.end('{}');
    }
    const parts = new URL(req.url, 'http://x').pathname.split('/').filter(Boolean);
    if (parts[0] === 'rate_limit') return rateLimitRoute(req, res, options);
    if (req.headers.authorization === `Bearer ${options.badToken}`)
      return json(res, 401, { message: 'Bad credentials' });
    if (parts[0] === 'repos') return apiRoute(req, res, repos, parts);
    if (parts[2] === 'zip') return codeloadRoute(res, repos, parts);
    res.writeHead(404);
    res.end();
  });
  return new Promise((resolve) => {
    server.listen(0, () => {
      const base = `http://127.0.0.1:${server.address().port}`;
      resolve({
        base,
        repos,
        calls,
        options,
        setRateLimited: (v) => (rateLimited = v),
        close: () => new Promise((r) => server.close(r)),
      });
    });
  });
}

module.exports = { startFakeGithub };
