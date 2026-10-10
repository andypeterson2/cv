const { startFakeGithub } = require('../helpers/fake-github');
const github = require('../../lib/github');

let gh;
beforeAll(async () => {
  gh = await startFakeGithub();
  process.env.CV_GITHUB_API_BASE = gh.base;
  process.env.CV_GITHUB_CODELOAD_BASE = gh.base;
  const sha = 'a'.repeat(40);
  gh.repos['ada/modern'] = {
    private: false,
    defaultBranch: 'main',
    branches: { main: sha },
    releases: [],
    files: { [sha]: { 'layout.json': '{}' } },
  };
  gh.repos['ada/secret'] = {
    private: true,
    defaultBranch: 'main',
    branches: {},
    releases: [],
    files: {},
  };
});
afterAll(async () => {
  await gh.close();
  delete process.env.CV_GITHUB_API_BASE;
  delete process.env.CV_GITHUB_CODELOAD_BASE;
});

describe('parseRepo', () => {
  test('takes owner/repo and github.com links', () => {
    expect(github.parseRepo('ada/modern')).toEqual({ owner: 'ada', repo: 'modern' });
    expect(github.parseRepo('https://github.com/ada/modern.git')).toEqual({
      owner: 'ada',
      repo: 'modern',
    });
    expect(github.parseRepo('github.com/ada/modern/')).toEqual({ owner: 'ada', repo: 'modern' });
  });
  test('refuses anything else', () => {
    for (const bad of ['', 'ada', 'https://gitlab.com/ada/modern', 'ada/../x', '../x/y', 'a b/c'])
      expect(() => github.parseRepo(bad)).toThrow(/owner\/repo/);
  });
});

describe('resolveSource', () => {
  test('follows a branch and answers not-modified for the same ETag', async () => {
    const first = await github.resolveSource({ owner: 'ada', repo: 'modern', track: 'branch' });
    expect(first).toMatchObject({ sha: 'a'.repeat(40), ref: 'main' });
    const again = await github.resolveSource({
      owner: 'ada',
      repo: 'modern',
      track: 'branch',
      etag: first.etag,
    });
    expect(again).toEqual({ notModified: true });
  });

  test('a repo with no releases says so, and a private repo is refused', async () => {
    await expect(
      github.resolveSource({ owner: 'ada', repo: 'modern', track: 'release' }),
    ).rejects.toThrow(/no releases yet/);
    await expect(
      github.resolveSource({ owner: 'ada', repo: 'secret', track: 'branch' }),
    ).rejects.toMatchObject({ status: 403 });
    await expect(github.getRepo('ada', 'nope')).rejects.toMatchObject({ status: 404 });
  });

  test('a rate-limited answer is reported as such', async () => {
    gh.setRateLimited(true);
    await expect(github.getRepo('ada', 'modern')).rejects.toMatchObject({ status: 429 });
    gh.setRateLimited(false);
  });
});

test('refuses a branch name that would escape the URL path', () => {
  expect(() => github.assertRef('../../x')).toThrow(/not a valid/);
  expect(github.assertRef('feature/new-look')).toBe('feature/new-look');
});

describe('token health', () => {
  afterEach(() => {
    delete process.env.GITHUB_TOKEN;
    gh.options.badToken = null;
    gh.options.tokenExpiry = null;
    github.resetTokenState();
  });

  test('unset without a token, ok with one that is far from expiry', async () => {
    expect(github.tokenState()).toBe('unset');
    process.env.GITHUB_TOKEN = 'good';
    expect(github.tokenState()).toBe('unchecked');
    gh.options.tokenExpiry = '2099-01-01 00:00:00 UTC';
    expect(await github.checkToken()).toBe('ok');
  });

  test('expiring within a week, in either header format', async () => {
    process.env.GITHUB_TOKEN = 'good';
    const soon = new Date(Date.now() + 3 * 24 * 3600 * 1000);
    const pad = (n) => String(n).padStart(2, '0');
    const utc = `${soon.getUTCFullYear()}-${pad(soon.getUTCMonth() + 1)}-${pad(soon.getUTCDate())} 12:00:00`;
    gh.options.tokenExpiry = `${utc} UTC`;
    expect(await github.checkToken()).toBe('expiring');
    github.resetTokenState();
    gh.options.tokenExpiry = `${utc} -0700`;
    expect(await github.checkToken()).toBe('expiring');
  });

  test('a refused token is reported and dropped, and calls carry on without it', async () => {
    process.env.GITHUB_TOKEN = 'bad';
    gh.options.badToken = 'bad';
    expect(await github.getRepo('ada', 'modern')).toMatchObject({ defaultBranch: 'main' });
    expect(github.tokenState()).toBe('invalid');
    expect(await github.getRepo('ada', 'modern')).toMatchObject({ defaultBranch: 'main' });
  });
});
