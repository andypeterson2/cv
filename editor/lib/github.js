/**
 * The only network access for layouts: public GitHub repositories, read through
 * the GitHub API (repo visibility, the latest release, a branch or tag's commit)
 * and codeload (a zip of one commit). The two hosts are fixed, so nothing a caller
 * types can point a request anywhere else.
 *
 * GITHUB_TOKEN, when set, raises the API rate limit; it needs no scopes, and a repo
 * still has to be public because visibility is checked on every call. ETags are
 * sent back so an unchanged answer is a 304 that costs no rate limit.
 *
 * CV_GITHUB_API_BASE / CV_GITHUB_CODELOAD_BASE replace the two hosts in tests.
 */
const fs = require('fs');
const http = require('http');
const https = require('https');
const { AppError } = require('./errors');

const API_BASE = () => process.env.CV_GITHUB_API_BASE || 'https://api.github.com';
const CODELOAD_BASE = () => process.env.CV_GITHUB_CODELOAD_BASE || 'https://codeload.github.com';
const MAX_ZIP_BYTES = 25 * 1024 * 1024;
const TIMEOUT_MS = 20000;

const NAME_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const REPO_RE = /^[A-Za-z0-9._-]{1,100}$/;
const BRANCH_RE = /^[A-Za-z0-9._/-]{1,200}$/;

/** `owner/repo`, or a github.com URL to one, as {owner, repo}. */
function parseRepo(input) {
  const text = String(input || '').trim();
  const m =
    /^(?:(?:https?:\/\/)?(?:www\.)?github\.com\/)?([^/\s]+)\/([^/\s#?]+?)(?:\.git)?\/?(?:[#?].*)?$/i.exec(
      text,
    );
  if (!m || !NAME_RE.test(m[1]) || !REPO_RE.test(m[2]) || m[2] === '.' || m[2] === '..')
    throw new AppError('Give the repository as owner/repo or a github.com link', 400);
  return { owner: m[1], repo: m[2] };
}

/** A branch, tag or commit name safe to put in a URL path. */
function assertRef(ref) {
  if (!BRANCH_RE.test(ref) || ref.includes('..') || ref.startsWith('/'))
    throw new AppError(`"${ref}" is not a valid branch or tag name`, 400);
  return ref;
}

function headers({ accept = 'application/vnd.github+json', etag } = {}) {
  const h = {
    'User-Agent': 'cv-editor-layouts',
    Accept: accept,
    'X-GitHub-Api-Version': '2022-11-28',
  };
  if (process.env.GITHUB_TOKEN) h.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  if (etag) h['If-None-Match'] = etag;
  return h;
}

function get(url, opts) {
  const client = url.startsWith('http:') ? http : https;
  return new Promise((resolve, reject) => {
    const req = client.get(url, { headers: headers(opts), timeout: TIMEOUT_MS }, resolve);
    req.on('timeout', () => req.destroy(new AppError('GitHub did not answer in time', 504)));
    req.on('error', (e) =>
      reject(e instanceof AppError ? e : new AppError(`Could not reach GitHub: ${e.message}`, 502)),
    );
  });
}

function readBody(res) {
  return new Promise((resolve, reject) => {
    let data = '';
    res.setEncoding('utf8');
    res.on('data', (c) => {
      data += c;
      if (data.length > 1_000_000) res.destroy(new Error('GitHub response too large'));
    });
    res.on('end', () => resolve(data));
    res.on('error', reject);
  });
}

function rateLimited(res) {
  return (
    (res.statusCode === 403 || res.statusCode === 429) &&
    res.headers['x-ratelimit-remaining'] === '0'
  );
}

/** GET an API path: {status, body, etag}; a 304 has no body. */
async function api(pathname, { etag, accept } = {}) {
  const res = await get(`${API_BASE()}${pathname}`, { etag, accept });
  if (res.statusCode === 304) {
    res.resume();
    return { status: 304, body: null, etag };
  }
  const text = await readBody(res);
  if (rateLimited(res))
    throw new AppError('GitHub rate limit reached; layouts will be checked again later', 429);
  return { status: res.statusCode, body: text, etag: res.headers.etag || null };
}

/** The repo's metadata; refuses a missing or private repository. */
async function getRepo(owner, repo) {
  const r = await api(`/repos/${owner}/${repo}`);
  if (r.status === 404) throw new AppError(`github.com/${owner}/${repo} was not found`, 404);
  if (r.status !== 200) throw new AppError(`GitHub answered HTTP ${r.status}`, 502);
  const data = JSON.parse(r.body);
  if (data.private !== false || data.visibility === 'private' || data.visibility === 'internal')
    throw new AppError(`github.com/${owner}/${repo} is not public`, 403);
  return { defaultBranch: data.default_branch, archived: !!data.archived };
}

/** The commit SHA a branch, tag or SHA names. */
async function commitSha(owner, repo, ref, etag) {
  const r = await api(`/repos/${owner}/${repo}/commits/${encodeURIComponent(assertRef(ref))}`, {
    accept: 'application/vnd.github.sha',
    etag,
  });
  if (r.status === 304) return { notModified: true, etag };
  if (r.status === 404 || r.status === 422)
    throw new AppError(`No branch, tag or commit "${ref}" in ${owner}/${repo}`, 404);
  if (r.status !== 200) throw new AppError(`GitHub answered HTTP ${r.status}`, 502);
  const sha = r.body.trim();
  if (!/^[0-9a-f]{40}$/.test(sha)) throw new AppError('GitHub returned an unexpected commit', 502);
  return { sha, etag: r.etag };
}

/**
 * The commit a layout source points at now.
 * track 'release': the latest release's tag; track 'branch': the branch head.
 * Returns {sha, ref, etag}, or {notModified: true} when the stored ETag still matches.
 */
async function resolveSource({ owner, repo, track, branch, etag }) {
  const { defaultBranch } = await getRepo(owner, repo);
  if (track === 'release') {
    const r = await api(`/repos/${owner}/${repo}/releases/latest`, { etag });
    if (r.status === 304) return { notModified: true };
    if (r.status === 404)
      throw new AppError(
        `${owner}/${repo} has no releases yet; publish one or track a branch`,
        404,
      );
    if (r.status !== 200) throw new AppError(`GitHub answered HTTP ${r.status}`, 502);
    const tag = JSON.parse(r.body).tag_name;
    const { sha } = await commitSha(owner, repo, tag);
    return { sha, ref: tag, etag: r.etag };
  }
  const name = branch || defaultBranch;
  const c = await commitSha(owner, repo, name, etag);
  if (c.notModified) return { notModified: true };
  return { sha: c.sha, ref: name, etag: c.etag };
}

/** Save the zip of one commit to `dest`, refusing anything over 25 MB. */
async function downloadZipball(owner, repo, sha, dest) {
  if (!/^[0-9a-f]{40}$/.test(sha)) throw new AppError('Not a commit SHA', 400);
  const res = await get(`${CODELOAD_BASE()}/${owner}/${repo}/zip/${sha}`, {
    accept: 'application/zip',
  });
  if (res.statusCode !== 200) {
    res.resume();
    throw new AppError(
      `Could not download ${owner}/${repo}@${sha.slice(0, 7)} (HTTP ${res.statusCode})`,
      502,
    );
  }
  if (Number(res.headers['content-length']) > MAX_ZIP_BYTES) {
    res.destroy();
    throw new AppError('The repository zip is larger than 25 MB', 413);
  }
  return new Promise((resolve, reject) => {
    let size = 0;
    const out = fs.createWriteStream(dest);
    res.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_ZIP_BYTES) {
        res.destroy();
        out.destroy();
        fs.rmSync(dest, { force: true });
        reject(new AppError('The repository zip is larger than 25 MB', 413));
      }
    });
    res.pipe(out);
    out.on('finish', () => resolve(dest));
    out.on('error', reject);
  });
}

module.exports = { parseRepo, getRepo, commitSha, resolveSource, downloadZipball, assertRef };
