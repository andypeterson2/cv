// `link` is the profile URL without its scheme, as a parser should read it
// from the PDF; {0} and {1} are the social's values.
const SOCIAL_CATALOG = [
  // Web & Code
  { key: 'homepage', label: 'Homepage', link: '{0}', args: 1, placeholder: 'yoursite.com' },
  { key: 'github', label: 'GitHub', link: 'github.com/{0}', args: 1, placeholder: 'username' },
  { key: 'gitlab', label: 'GitLab', link: 'gitlab.com/{0}', args: 1, placeholder: 'username' },
  {
    key: 'bitbucket',
    label: 'Bitbucket',
    link: 'bitbucket.com/{0}',
    args: 1,
    placeholder: 'username',
  },
  {
    key: 'linkedin',
    label: 'LinkedIn',
    link: 'linkedin.com/in/{0}',
    args: 1,
    placeholder: 'username',
  },
  // Social
  { key: 'twitter', label: 'Twitter', link: 'twitter.com/{0}', args: 1, placeholder: 'handle' },
  { key: 'x', label: 'X', link: 'x.com/{0}', args: 1, placeholder: 'handle' },
  { key: 'reddit', label: 'Reddit', link: 'reddit.com/user/{0}', args: 1, placeholder: 'username' },
  { key: 'medium', label: 'Medium', link: 'medium.com/@{0}', args: 1, placeholder: 'username' },
  { key: 'xing', label: 'Xing', link: 'xing.com/profile/{0}', args: 1, placeholder: 'username' },
  {
    key: 'mastodon',
    label: 'Mastodon',
    link: '{0}/@{1}',
    args: 2,
    fields: ['mastodonInstance', 'mastodonName'],
    placeholders: ['instance', 'username'],
  },
  { key: 'telegram', label: 'Telegram', link: 't.me/{0}', args: 1, placeholder: 'username' },
  { key: 'skype', label: 'Skype', link: '{0}', args: 1, placeholder: 'username' },
  { key: 'whatsapp', label: 'WhatsApp', link: '{0}', args: 1, placeholder: 'phone number' },
  // Academic
  {
    key: 'orcid',
    label: 'ORCID',
    link: 'orcid.org/{0}',
    args: 1,
    placeholder: '0000-0000-0000-0000',
  },
  {
    key: 'researchgate',
    label: 'ResearchGate',
    link: 'researchgate.net/profile/{0}',
    args: 1,
    placeholder: 'account',
  },
  {
    key: 'googlescholar',
    label: 'Google Scholar',
    link: 'scholar.google.com/citations?user={0}',
    args: 2,
    fields: ['googlescholarId', 'googlescholarName'],
    placeholders: ['user ID', 'display name'],
  },
  {
    key: 'stackoverflow',
    label: 'Stack Overflow',
    link: 'stackoverflow.com/users/{0}',
    args: 2,
    fields: ['stackoverflowId', 'stackoverflowName'],
    placeholders: ['user ID', 'display name'],
  },
  { key: 'kaggle', label: 'Kaggle', link: 'kaggle.com/{0}', args: 1, placeholder: 'username' },
  {
    key: 'hackerrank',
    label: 'HackerRank',
    link: 'hackerrank.com/{0}',
    args: 1,
    placeholder: 'username',
  },
];

module.exports = SOCIAL_CATALOG;
