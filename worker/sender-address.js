const RESERVED_LOCAL_PARTS = new Set([
  'abuse', 'admin', 'administrator', 'billing', 'contact', 'dmarc', 'email',
  'hello', 'help', 'hostmaster', 'info', 'legal', 'mail', 'mailer-daemon',
  'no-reply', 'noreply', 'owner', 'postmaster', 'privacy', 'quotes', 'root',
  'sales', 'security', 'spf', 'staff', 'support', 'team', 'webmaster', 'www'
]);

function normalizeDomain(value) {
  const domain = String(value || '').trim().toLowerCase().replace(/\.+$/, '');
  if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/.test(domain)) return '';
  return domain;
}

export function sendingDomain(env) {
  const explicit = normalizeDomain(env?.RESEND_FROM_DOMAIN);
  if (explicit) return explicit;
  const configured = String(env?.RESEND_FROM_EMAIL || '').trim().toLowerCase();
  let domain = normalizeDomain(configured.split('@')[1] || '');
  if (domain.startsWith('admin.')) {
    const parent = domain.slice('admin.'.length);
    if (parent.includes('.')) domain = parent;
  }
  return domain;
}

export function businessLocalPart(name) {
  const ascii = String(name || '')
    .replace(/&/g, ' and ')
    .replace(/['’]/g, '')
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase();
  let local = ascii.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48).replace(/-+$/g, '');
  if (!local) local = 'studio';
  if (RESERVED_LOCAL_PARTS.has(local)) local = `${local}-studio`.slice(0, 64);
  return local;
}

function cleanDisplayName(value) {
  return String(value || '').replace(/[\r\n]+/g, ' ').replace(/[<>"]/g, '').trim().slice(0, 60);
}

function formatMailbox(displayName, address) {
  const name = cleanDisplayName(displayName) || 'Elite Quote Flow';
  const quoted = /[,;:@()\\]/.test(name) ? `"${name}"` : name;
  return `${quoted} <${address}>`;
}

export function normalizeReplyTo(value) {
  const email = String(value || '').trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return '';
  return email;
}

export function businessSender(env, { businessName = '', fullName = '', replyTo = '' } = {}) {
  const domain = sendingDomain(env);
  if (!domain) return null;
  const name = cleanDisplayName(businessName) || cleanDisplayName(fullName) || 'Elite Quote Flow';
  const address = `${businessLocalPart(businessName || fullName)}@${domain}`;
  return { name, address, replyTo: normalizeReplyTo(replyTo), from: formatMailbox(name, address) };
}
