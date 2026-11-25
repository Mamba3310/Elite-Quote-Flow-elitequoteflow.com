const MAX_ATTACHMENTS = 3;
const MAX_ATTACHMENT_BYTES = 2 * 1024 * 1024;
const ALLOWED = new Set(['pdf', 'png', 'jpg', 'jpeg', 'webp', 'txt', 'csv']);

function safeFilename(value) {
  const base = String(value || '').split(/[/\\]/).pop().replace(/[^\w.\- ]+/g, '').trim().slice(0, 80);
  if (!base || base.startsWith('.') || !base.includes('.')) return '';
  return base;
}

function decodedBytes(content) {
  const padding = content.endsWith('==') ? 2 : content.endsWith('=') ? 1 : 0;
  return Math.floor(content.length * 3 / 4) - padding;
}

export function messageAttachments(payload) {
  const source = Array.isArray(payload?.attachments) ? payload.attachments : [];
  if (!source.length) return { attachments: [] };
  if (source.length > MAX_ATTACHMENTS) return { error: `Attach up to ${MAX_ATTACHMENTS} files.` };
  const attachments = [];
  for (const item of source) {
    const filename = safeFilename(item?.filename);
    const content = String(item?.content || '').replace(/\s/g, '');
    const extension = filename.split('.').pop().toLowerCase();
    if (!filename || !ALLOWED.has(extension)) return { error: 'Attach a PDF, image, text, or CSV file.' };
    if (!content || !/^[A-Za-z0-9+/]+={0,2}$/.test(content)) return { error: 'That attachment could not be read.' };
    if (decodedBytes(content) > MAX_ATTACHMENT_BYTES) return { error: `${filename} is larger than 2 MB.` };
    attachments.push({ filename, content });
  }
  return { attachments };
}
