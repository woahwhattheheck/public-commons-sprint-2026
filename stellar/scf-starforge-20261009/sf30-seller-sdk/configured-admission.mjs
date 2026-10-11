// MIT. Compose the existing live-schema and application admissions at startup.
import { createLiveRequestAdmission } from '../sf89-live-request-admission/index.mjs';

const own = (value, key) => Object.hasOwn(value, key);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);

/** Explicit opt-in only: ordinary definitions and existing configs are unchanged. */
export function validateInputOption(route) {
  if (!object(route)) throw new TypeError('Seller route required');
  if (own(route, 'validateInput') && typeof route.validateInput !== 'boolean') {
    throw new TypeError('validateInput must be a boolean');
  }
  if (route.validateInput === true && !object(route.offer)) {
    throw new TypeError('validateInput requires an imported offer with its original Bazaar schema');
  }
  return route.validateInput === true;
}

/** Resolve once, before listening. Both steps share the runtime's ONE admission
 * timeout, cancellation signal and isolated request copy. Neither step pays. */
export function createConfiguredAdmission(route, handlers = {}) {
  const enabled = validateInputOption(route);
  if (!object(handlers)) throw new TypeError('Application handler map required');
  let application;
  if (own(route, 'admit')) {
    if (typeof route.admit !== 'string' || !/^[A-Za-z_$][\w$]{0,127}$/.test(route.admit) ||
        !own(handlers, route.admit) || typeof handlers[route.admit] !== 'function') {
      throw new TypeError('Admission export missing or invalid: ' + String(route.admit));
    }
    application = handlers[route.admit];
  }
  if (!enabled) return application;
  const schema = createLiveRequestAdmission(route.offer);
  if (!application) return schema;
  return context => {
    const decision = schema(context);
    if (decision !== true) return decision;
    context.signal?.throwIfAborted();
    return application(context);
  };
}
