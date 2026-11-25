(function (root) {
  const CONSUMED = /otp_expired|flow_state_expired|invalid or has expired|already been used|one-time token|code verifier|flow state/i;
  const VERIFY_TYPES = new Set(['signup', 'invite', 'magiclink', 'recovery', 'email_change', 'email']);

  function read(href) {
    const url = new URL(href, 'https://elitequoteflow.com');
    const hash = new URLSearchParams(url.hash.replace(/^#/, ''));
    const search = url.searchParams;
    const pick = key => hash.get(key) || search.get(key) || '';
    const description = pick('error_description').replace(/\+/g, ' ');
    const type = pick('type');
    return {
      error: pick('error'),
      errorCode: pick('error_code'),
      description,
      type: VERIFY_TYPES.has(type) ? type : '',
      tokenHash: pick('token_hash'),
      consumed: CONSUMED.test(`${pick('error')} ${pick('error_code')} ${description}`)
    };
  }

  function consumedText(message) {
    return CONSUMED.test(String(message || ''));
  }

  function without(href, keys) {
    const url = new URL(href, 'https://elitequoteflow.com');
    keys.forEach(key => url.searchParams.delete(key));
    const hash = new URLSearchParams(url.hash.replace(/^#/, ''));
    keys.forEach(key => hash.delete(key));
    const next = hash.toString();
    url.hash = next ? `#${next}` : '';
    return `${url.pathname}${url.search}${url.hash}`;
  }

  root.EliteQuoteFlowAuth = {
    read,
    consumedText,
    cleanError: href => without(href, ['error', 'error_code', 'error_description']),
    cleanVerify: href => without(href, ['token_hash', 'type', 'code'])
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
