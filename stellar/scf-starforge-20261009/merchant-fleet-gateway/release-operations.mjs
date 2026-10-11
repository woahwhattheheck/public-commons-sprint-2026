// MIT. Original merchant desk capabilities remain scoped to the owned SF82 session.
const fail = (code, status = 409) => Object.assign(new Error(code), { status });
const ORIGIN = /^http:\/\/127\.0\.0\.1:([1-9]\d{0,4})$/;

export function validateFleetNavigationOrigin(value) {
  if (value === undefined) return;
  const match = typeof value === 'string' && ORIGIN.exec(value);
  if (!match || Number(match[1]) > 65535)
    throw fail('FLEET_RELEASE_NAVIGATION_ORIGIN_INVALID', 400);
}

function originalLinks(session) {
  const value = session?.operations;
  if (!value) return null;
  const match = typeof value.url === 'string' && ORIGIN.exec(value.url);
  if (!match || Number(match[1]) > 65535 || value.availability !== value.url + '/availability' ||
      value.availabilityControl !== null && (typeof value.availabilityControl !== 'string' ||
        !value.availabilityControl.startsWith(value.availability + '#') ||
        !/^[0-9a-f]{64}$/.test(value.availabilityControl.slice(value.availability.length + 1))))
    throw fail('FLEET_RELEASE_OPERATIONS_INVALID', 502);
  return { url: value.url, availability: value.availability, availabilityControl: value.availabilityControl };
}

/** Ordinary status and exported reports contain capabilities, never private links. */
export function describeFleetOperations(runtime) {
  const available = Boolean(runtime && !runtime.ended), links = available ? originalLinks(runtime.session) : null;
  return { available, explorerAvailable: available, operationsAvailable: Boolean(links),
    availabilityControlAvailable: Boolean(links?.availabilityControl) };
}

/** Called only with the original manager's tenant/slot entry; never reads an old observation. */
export function readFleetOperations(runtime, { tenant, slot, instanceId }) {
  if (!runtime || runtime.ended || typeof instanceId !== 'string' ||
      instanceId !== runtime.session.observation.instanceId)
    throw fail('FLEET_RELEASE_SESSION_NOT_OWNED');
  const operations = originalLinks(runtime.session);
  const listener = runtime.session.url, match = typeof listener === 'string' && ORIGIN.exec(listener);
  if (!match || Number(match[1]) !== runtime.descriptor.port)
    throw fail('FLEET_RELEASE_OPERATIONS_INVALID', 502);
  // The original SF30 developer portal and native launchers declare this route.
  // Its authority comes from this owned session, never the requested public host.
  const explorer = listener + '/_seller/docs';
  return { schema: 'stellar-forge.fleet-merchant-operations.v1', tenant, slot, instanceId,
    releaseId: runtime.descriptor.releaseId, releaseDigest: runtime.descriptor.releaseDigest, explorer, operations };
}
