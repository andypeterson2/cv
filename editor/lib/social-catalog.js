const SOCIAL_CATALOG = [
  // Web & Code
  { key: 'homepage', label: 'Homepage', args: 1, placeholder: 'yoursite.com' },
  { key: 'github', label: 'GitHub', args: 1, placeholder: 'username' },
  { key: 'gitlab', label: 'GitLab', args: 1, placeholder: 'username' },
  { key: 'bitbucket', label: 'Bitbucket', args: 1, placeholder: 'username' },
  { key: 'linkedin', label: 'LinkedIn', args: 1, placeholder: 'username' },
  // Social
  { key: 'twitter', label: 'Twitter', args: 1, placeholder: 'handle' },
  { key: 'x', label: 'X', args: 1, placeholder: 'handle' },
  { key: 'reddit', label: 'Reddit', args: 1, placeholder: 'username' },
  { key: 'medium', label: 'Medium', args: 1, placeholder: 'username' },
  { key: 'xing', label: 'Xing', args: 1, placeholder: 'username' },
  {
    key: 'mastodon',
    label: 'Mastodon',
    args: 2,
    fields: ['mastodonInstance', 'mastodonName'],
    placeholders: ['instance', 'username'],
  },
  { key: 'telegram', label: 'Telegram', args: 1, placeholder: 'username' },
  { key: 'skype', label: 'Skype', args: 1, placeholder: 'username' },
  { key: 'whatsapp', label: 'WhatsApp', args: 1, placeholder: 'phone number' },
  // Academic
  { key: 'orcid', label: 'ORCID', args: 1, placeholder: '0000-0000-0000-0000' },
  { key: 'researchgate', label: 'ResearchGate', args: 1, placeholder: 'account' },
  {
    key: 'googlescholar',
    label: 'Google Scholar',
    args: 2,
    fields: ['googlescholarId', 'googlescholarName'],
    placeholders: ['user ID', 'display name'],
  },
  {
    key: 'stackoverflow',
    label: 'Stack Overflow',
    args: 2,
    fields: ['stackoverflowId', 'stackoverflowName'],
    placeholders: ['user ID', 'display name'],
  },
  { key: 'kaggle', label: 'Kaggle', args: 1, placeholder: 'username' },
  { key: 'hackerrank', label: 'HackerRank', args: 1, placeholder: 'username' },
];

module.exports = SOCIAL_CATALOG;
