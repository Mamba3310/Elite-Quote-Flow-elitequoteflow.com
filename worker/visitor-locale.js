const json = (body, status = 200) => Response.json(body, {
  status,
  headers: { 'Cache-Control': 'no-store' }
});

const COUNTRY_CURRENCY = {
  US: 'USD', GB: 'GBP', CA: 'CAD', AU: 'AUD', NZ: 'NZD',
  CH: 'CHF', JP: 'JPY', CN: 'CNY', IN: 'INR', MX: 'MXN', BR: 'BRL',
  ZA: 'ZAR', SG: 'SGD', HK: 'HKD', SE: 'SEK', NO: 'NOK', DK: 'DKK', PL: 'PLN',
  AT: 'EUR', BE: 'EUR', CY: 'EUR', DE: 'EUR', EE: 'EUR', ES: 'EUR', FI: 'EUR',
  FR: 'EUR', GR: 'EUR', HR: 'EUR', IE: 'EUR', IT: 'EUR', LT: 'EUR', LU: 'EUR',
  LV: 'EUR', MT: 'EUR', NL: 'EUR', PT: 'EUR', SI: 'EUR', SK: 'EUR'
};

export function currencyForCountry(country) {
  return COUNTRY_CURRENCY[String(country || '').trim().toUpperCase()] || 'USD';
}

export function visitorCountry(request) {
  const hinted = request?.cf?.country || request?.headers?.get?.('CF-IPCountry') || '';
  const country = String(hinted).trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(country) || country === 'XX' || country === 'T1' || !Object.hasOwn(COUNTRY_CURRENCY, country)) return '';
  return country;
}

export function onVisitorLocale(request) {
  if (request.method !== 'GET') return json({ error: 'Method not allowed.' }, 405);
  const country = visitorCountry(request);
  return json({ country: country || 'unknown', currency: currencyForCountry(country) });
}
