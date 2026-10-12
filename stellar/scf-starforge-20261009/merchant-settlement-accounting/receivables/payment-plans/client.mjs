/** Payment-plan HTTP client composed with the original receivables transport. */
import {ReceivablesClient, ReceivablesApiError} from '../client.mjs';
export {ReceivablesApiError as PaymentPlansApiError};
const segment = value => {
  const text = String(value ?? '');
  if (!text || text === '.' || text === '..') throw new TypeError('A record identifier is required.');
  return encodeURIComponent(text);
};
const query = (values = {}) => {
  const result = new URLSearchParams();
  for (const [name, value] of Object.entries(values)) {
    if (value !== undefined && value !== null && value !== '') result.set(name, String(value));
  }
  return result.size ? '?' + result : '';
};
export class PaymentPlansClient extends ReceivablesClient {
  constructor(options = {}) {
    super({baseUrl: '/api/receivables/payment-plans', ...options});
  }
  state(values) { return this.request('/state' + query(values)); }
  detail(id, values) { return this.request('/plans/' + segment(id) + query(values)); }
  generate(value) { return this.request('/generate', {method: 'POST', body: value}); }
  savePlan(value) { return this.request('/plans', {method: 'POST', body: value}); }
  previewPlan(id) { return this.request('/plans/' + segment(id) + '/preview'); }
  activate(id, value) { return this.request('/plans/' + segment(id) + '/activate', {method: 'POST', body: value}); }
  cancelPlan(id, value) { return this.request('/plans/' + segment(id) + '/cancel', {method: 'POST', body: value}); }
  getOperation(id) { return this.request('/operations/' + segment(id)); }
  scheduleFile(id, edition, name) {
    return this.request('/plans/' + segment(id) + '/editions/' + segment(edition) + '/files/' + segment(name), {binary: true});
  }
  collectionsFiles(values) { return this.request('/collections/export' + query(values)); }
  collectionsFile(name, values) {
    return this.request('/collections/export' + query({...values, name}), {binary: true});
  }
}
export function createPaymentPlansClient(options) { return new PaymentPlansClient(options); }
