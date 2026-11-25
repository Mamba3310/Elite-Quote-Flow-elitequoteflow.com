const json = (body, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

function formatAddress(properties = {}) {
  const street = [properties.housenumber, properties.street].filter(Boolean).join(' ');
  const locality = [properties.postcode, properties.city || properties.name, properties.state, properties.country].filter(Boolean);
  const parts = [];
  if (street) parts.push(street);
  else if (properties.name) parts.push(properties.name);
  for (const part of locality) {
    if (!parts.includes(part)) parts.push(part);
  }
  return parts.join(', ').slice(0, 300);
}

export async function onAddressSuggest(request) {
  if (request.method !== 'GET') return json({ error: 'Method not allowed.' }, 405);
  const query = new URL(request.url).searchParams.get('q')?.trim() || '';
  if (query.length < 3 || query.length > 80) return json({ suggestions: [] });
  const response = await fetch(`https://photon.komoot.io/api/?limit=5&q=${encodeURIComponent(query)}`, {
    headers: { Accept: 'application/json', 'User-Agent': 'EliteQuoteFlow/1.0 (address suggestions)' }
  });
  if (!response.ok) return json({ suggestions: [] });
  const payload = await response.json();
  const suggestions = [];
  for (const feature of payload.features || []) {
    const label = formatAddress(feature.properties);
    if (label && !suggestions.includes(label)) suggestions.push(label);
  }
  return json({ suggestions: suggestions.slice(0, 5) });
}
