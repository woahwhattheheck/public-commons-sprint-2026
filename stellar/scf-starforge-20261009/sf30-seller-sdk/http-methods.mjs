// MIT. One method/body contract for the existing SF30 HTTP seller adapters.
// Exact uppercase methods match the original seller compiler and native SDK.
const methods = new Set(['GET', 'HEAD', 'DELETE', 'POST', 'PUT', 'PATCH']);
const jsonBodyMethods = new Set(['POST', 'PUT', 'PATCH']);

export function supportsSellerMethod(method) {
  return methods.has(method);
}

export function requiresJsonBody(method) {
  return jsonBodyMethods.has(method);
}
