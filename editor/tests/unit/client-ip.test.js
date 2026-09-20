/**
 * The rate-limit key.
 *
 * CF-Connecting-IP is client-supplied except behind Cloudflare, which overwrites it.
 * Unless CV_TRUST_CF_IP says Cloudflare is in front, the key must ignore the header,
 * or a client rotating it gets an unlimited number of rate-limit buckets.
 */
const { clientIp } = require('../../lib/client-ip');

const mkReq = (cf, ip = '198.51.100.7') => ({
  headers: cf ? { 'cf-connecting-ip': cf } : {},
  ip,
});

let saved;
beforeEach(() => {
  saved = process.env.CV_TRUST_CF_IP;
});
afterEach(() => {
  if (saved === undefined) delete process.env.CV_TRUST_CF_IP;
  else process.env.CV_TRUST_CF_IP = saved;
});

describe('clientIp', () => {
  test('ignores CF-Connecting-IP by default', () => {
    delete process.env.CV_TRUST_CF_IP;
    expect(clientIp(mkReq('203.0.113.1'))).toBe(clientIp(mkReq('203.0.113.2')));
    expect(clientIp(mkReq('203.0.113.1'))).toBe(clientIp(mkReq(null)));
  });

  test('a client rotating the header cannot change its own key', () => {
    delete process.env.CV_TRUST_CF_IP;
    const keys = new Set();
    for (let i = 0; i < 6; i++) keys.add(clientIp(mkReq(`203.0.113.${i}`)));
    expect(keys.size).toBe(1);
  });

  test('only the exact string "true" turns the header on', () => {
    for (const v of ['1', 'yes', 'TRUE', '']) {
      process.env.CV_TRUST_CF_IP = v;
      expect(clientIp(mkReq('203.0.113.1'))).toBe(clientIp(mkReq('203.0.113.2')));
    }
  });

  test('with CV_TRUST_CF_IP=true the header keys the bucket', () => {
    process.env.CV_TRUST_CF_IP = 'true';
    expect(clientIp(mkReq('203.0.113.1'))).not.toBe(clientIp(mkReq('203.0.113.2')));
    expect(clientIp(mkReq('203.0.113.1'))).toBe(clientIp(mkReq('203.0.113.1'), 'x'));
  });

  test('with the header trusted but absent, it falls back to req.ip', () => {
    process.env.CV_TRUST_CF_IP = 'true';
    expect(clientIp(mkReq(null, '198.51.100.7'))).not.toBe(clientIp(mkReq(null, '198.51.100.8')));
  });

  test('IPv6 clients bucket by subnet, not by single address', () => {
    delete process.env.CV_TRUST_CF_IP;
    expect(clientIp(mkReq(null, '2001:db8:abcd:1234::1'))).toBe(
      clientIp(mkReq(null, '2001:db8:abcd:1234::2')),
    );
  });
});
