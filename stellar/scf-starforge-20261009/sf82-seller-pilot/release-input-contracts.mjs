// MIT. Original synchronous SF82 release input contracts without runtime initialization.
import { join, resolve } from 'node:path';

const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
export function upstreamReleaseSnapshot(value) {
  if (!plain(value) || Object.keys(value).some(key => !['file', 'sha256'].includes(key)) ||
      !/^[a-f0-9]{64}$/.test(value.sha256 ?? '') || value.file !== `pilot-upstreams-${value.sha256}.json`)
    throw new TypeError('Invalid original upstream release snapshot.');
  return { file: value.file, sha256: value.sha256 };
}

export function releaseCacheControlPath(root, instanceId) {
  if (typeof instanceId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(instanceId))
    throw new TypeError('Original running seller instance ID required.');
  return join(resolve(root), 'cache-control', instanceId + '.json');
}
