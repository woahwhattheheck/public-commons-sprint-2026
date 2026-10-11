// MIT. Trusted validation example; substitute your existing application validator.
// No network operation, mutation of the request, payment or protected result here.
export function admitCityQuery({ query }) {
  if (Object.keys(query).some(key => key !== 'city') ||
      typeof query.city !== 'string' || !query.city.trim() || query.city.length > 80) {
    return { status: 422, body: { error: 'ONE_CITY_QUERY_REQUIRED', fields: ['city'] } };
  }
  return true;
}
// Runs only after admission AND original native payment verification.
// Deliberate local example, not actual weather or customer data.
export function cityDataset({ query }) {
  return { body: { example: true, city: query.city, message: 'Replace with your protected dataset.' } };
}
