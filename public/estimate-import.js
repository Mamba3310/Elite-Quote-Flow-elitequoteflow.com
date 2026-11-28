(() => {
  'use strict';

  const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
  const PHONE_RE = /(?:(?:\+|00)?\d{1,3}[\s.-]?)?(?:\(?\d{2,4}\)?[\s.-]?)\d{3,4}[\s.-]?\d{3,4}\b/;
  const LABELED_TOTAL_RE = /(?:grand\s*total|quote\s*total|invoice\s*total|amount\s*due|balance\s*due|total\s*due|\btotal\b)\s*[:\-]?\s*(?:(?:USD|EUR|GBP|CAD|AUD|\$|£|€)\s*)?([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]{1,2})?|[0-9]+(?:\.[0-9]{1,2})?)/i;
  const CURRENCY_HINT_RE = /\b(USD|EUR|GBP|CAD|AUD|NZD|CHF|JPY|CNY|INR|MXN|BRL|ZAR|SGD|HKD|SEK|NOK|DKK|PLN)\b|[£€$]/i;
  const CUSTOMER_LABEL_RE = /(?:bill\s*to|customer(?:\s*name)?|client(?:\s*name)?|prepared\s*for|sold\s*to|attention|attn)\s*[:\-]\s*(.+)/i;
  const SERVICE_LABEL_RE = /(?:service(?:\s*description)?|description|job(?:\s*title)?|scope(?:\s*of\s*work)?|project(?:\s*name)?|work\s*requested)\s*[:\-]\s*(.+)/i;

  function decodePdfLiteral(raw) {
    return String(raw || '')
      .replace(/\\n/g, '\n')
      .replace(/\\r/g, '\r')
      .replace(/\\t/g, '\t')
      .replace(/\\\(/g, '(')
      .replace(/\\\)/g, ')')
      .replace(/\\\\/g, '\\')
      .replace(/\\([0-7]{1,3})/g, (_, oct) => String.fromCharCode(parseInt(oct, 8)));
  }

  function extractTextFromPdfBytes(bytes) {
    const decoder = new TextDecoder('latin1');
    const source = decoder.decode(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));
    if (!source.startsWith('%PDF')) {
      throw new Error('That file does not look like a PDF.');
    }
    const chunks = [];
    const tjRe = /\((?:\\.|[^\\)])*\)\s*Tj/g;
    const tjArrayRe = /\[(.*?)\]\s*TJ/gs;
    let match;
    while ((match = tjRe.exec(source))) {
      const inner = match[0].slice(1, match[0].lastIndexOf(')'));
      chunks.push(decodePdfLiteral(inner));
    }
    while ((match = tjArrayRe.exec(source))) {
      const parts = [];
      const itemRe = /\((?:\\.|[^\\)])*\)/g;
      let item;
      while ((item = itemRe.exec(match[1]))) {
        parts.push(decodePdfLiteral(item[0].slice(1, -1)));
      }
      if (parts.length) chunks.push(parts.join(''));
    }
    const text = chunks.join('\n').replace(/[^\S\n]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
    return text;
  }

  function guessCurrency(text) {
    const match = String(text || '').match(CURRENCY_HINT_RE);
    if (!match) return '';
    const token = match[0].toUpperCase();
    if (token === '$') return 'USD';
    if (token === '£') return 'GBP';
    if (token === '€') return 'EUR';
    return token;
  }

  function cleanLine(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
  }

  function filenameHint(name) {
    const base = String(name || '').split(/[\\/]/).pop() || '';
    const withoutExt = base.replace(/\.[^.]+$/, '');
    return cleanLine(withoutExt.replace(/[_-]+/g, ' ')).slice(0, 80);
  }

  function parseEstimateText(rawText, options = {}) {
    const text = String(rawText || '').replace(/\r\n?/g, '\n').trim();
    const filename = options.filename || '';
    const sourceType = options.sourceType || 'text';
    const warnings = [];
    const fields = {
      customer: '',
      service: '',
      email: '',
      phone: '',
      amount: '',
      currency: '',
      note: '',
      terms: ''
    };

    if (!text) {
      if (sourceType === 'image') {
        const hint = filenameHint(filename);
        if (hint) fields.service = hint;
        fields.note = `Imported image: ${filename || 'upload'} — confirm fields manually.`;
        warnings.push('Image OCR is not available yet. Confirm customer, service, and amount before saving.');
        return { fields, warnings, extractedText: '', sourceType, filename };
      }
      warnings.push('No text was found to parse. Fill in the quote fields manually.');
      if (filename) fields.note = `Imported from: ${filename}`;
      return { fields, warnings, extractedText: '', sourceType, filename };
    }

    const emailMatch = text.match(EMAIL_RE);
    if (emailMatch) fields.email = emailMatch[0].slice(0, 120);

    const phoneMatch = text.match(PHONE_RE);
    if (phoneMatch) {
      const candidate = phoneMatch[0].trim();
      const digits = candidate.replace(/\D/g, '');
      if (digits.length >= 7 && digits.length <= 15) fields.phone = candidate.slice(0, 30);
    }

    const totalMatch = text.match(LABELED_TOTAL_RE);
    if (totalMatch) {
      const amount = Number(String(totalMatch[1]).replace(/,/g, ''));
      if (Number.isFinite(amount) && amount > 0 && amount <= 99999999) {
        fields.amount = amount.toFixed(2);
      }
    } else {
      warnings.push('No clearly labeled total was found. Enter the amount yourself — nothing was invented.');
    }

    fields.currency = guessCurrency(text);

    const customerMatch = text.match(CUSTOMER_LABEL_RE);
    if (customerMatch) fields.customer = cleanLine(customerMatch[1]).replace(EMAIL_RE, '').replace(PHONE_RE, '').slice(0, 70);

    const serviceMatch = text.match(SERVICE_LABEL_RE);
    if (serviceMatch) fields.service = cleanLine(serviceMatch[1]).slice(0, 80);

    if (!fields.customer) {
      const lines = text.split('\n').map(cleanLine).filter(Boolean);
      const skip = /^(estimate|quote|invoice|proposal|total|date|from|to|page)\b/i;
      const candidate = lines.find(line => !skip.test(line) && !EMAIL_RE.test(line) && line.length >= 3 && line.length <= 70 && /[A-Za-z]/.test(line));
      if (candidate && !/\d{2,}[.,]\d{2}/.test(candidate)) {
        fields.customer = candidate.slice(0, 70);
        warnings.push('Customer name was guessed from the first name-like line. Confirm before saving.');
      }
    }

    if (!fields.service) {
      const hint = filenameHint(filename);
      if (hint && !/^(estimate|quote|invoice|scan|img|image|photo|screenshot)\b/i.test(hint)) {
        fields.service = hint;
        warnings.push('Service was hinted from the filename. Confirm or edit before saving.');
      }
    }

    const sourceLabel = filename ? `Imported from: ${filename}` : `Imported from pasted ${sourceType}`;
    fields.note = sourceLabel.slice(0, 240);
    fields.terms = text.slice(0, 2000);

    if (!fields.customer) warnings.push('Customer name was not detected. Add it on the next step.');
    if (!fields.service) warnings.push('Service/description was not detected. Add it on the next step.');

    return { fields, warnings, extractedText: text, sourceType, filename };
  }

  async function readFileAsText(file) {
    return await file.text();
  }

  async function readFileAsArrayBuffer(file) {
    return await file.arrayBuffer();
  }

  async function extractFromFile(file) {
    if (!file) throw new Error('Choose a file to import.');
    const name = file.name || 'upload';
    const type = (file.type || '').toLowerCase();
    const lower = name.toLowerCase();

    if (type.startsWith('image/') || /\.(png|jpe?g|gif|webp|bmp|heic)$/i.test(lower)) {
      return parseEstimateText('', { filename: name, sourceType: 'image' });
    }

    if (type === 'application/pdf' || lower.endsWith('.pdf')) {
      const buffer = await readFileAsArrayBuffer(file);
      let text = '';
      try {
        text = extractTextFromPdfBytes(buffer);
      } catch (error) {
        return {
          fields: {
            customer: '',
            service: filenameHint(name),
            email: '',
            phone: '',
            amount: '',
            currency: '',
            note: `Imported PDF: ${name} — text could not be read.`,
            terms: ''
          },
          warnings: [error.message || 'Could not read that PDF.', 'Paste the estimate text or fill the quote form manually.'],
          extractedText: '',
          sourceType: 'pdf',
          filename: name
        };
      }
      const parsed = parseEstimateText(text, { filename: name, sourceType: 'pdf' });
      if (!text) {
        parsed.warnings.unshift('No extractable text was found in this PDF (it may be a scan). Paste text or confirm fields manually.');
      }
      return parsed;
    }

    if (type.startsWith('text/') || /\.(txt|csv|md|rtf)$/i.test(lower)) {
      const text = await readFileAsText(file);
      return parseEstimateText(text, { filename: name, sourceType: 'text' });
    }

    throw new Error('Supported uploads: PDF, image, or plain text (.txt).');
  }

  const api = {
    parseEstimateText,
    extractTextFromPdfBytes,
    extractFromFile,
    filenameHint
  };

  const root = typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : undefined;
  if (root) root.QuoteFlowEstimateImport = api;
})();
