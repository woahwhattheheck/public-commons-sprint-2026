// MIT. Example embeddable application handler; execution is gated by the native server.
// In config use "handler": "dataset" instead of "response", then --handlers application.mjs.
const rows = Object.freeze([{ region: 'north', value: 4 }, { region: 'south', value: 7 }]);

export async function dataset({ query }) {
  const region = query instanceof URLSearchParams ? query.get('region') : query?.region;
  return { status: 200, headers: { 'content-type': 'application/json' },
    body: { dataset: 'local-example', rows: region ? rows.filter(row => row.region === region) : rows } };
}
