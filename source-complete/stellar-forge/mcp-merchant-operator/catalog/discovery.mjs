// MIT. Original tool metadata; provider runtimes load only when selected.


const releaseId = { type: 'string', pattern: '^[a-z0-9][a-z0-9_-]{0,63}$' };

const routeId = { type: 'string', minLength: 1, maxLength: 128 };

const digest = { type: 'string', pattern: '^[a-f0-9]{64}$' };

function discoveryTools(tool) {
  return [
    tool('merchant_discovery_status', 'Compare a retained release with its configured live catalog and read the original listing history. Returns current terms, source URL, seller pin, journal head and the last local apply outcome. No signatures, key reads or paid requests.',
      { id: releaseId }, ['id'], { readOnly: true, idempotent: true }),
    tool('merchant_discovery_review', 'Prepare this host’s latest exact review for publishing the running release or withdrawing one listed route. Returns every before/after payment alternative and source reference. Publishing requires the original release to be running; withdrawal requires routeId and reason. Does not read the signing key or publish.',
      { id: releaseId, action: { type: 'string', enum: ['publish', 'withdraw'], default: 'publish' },
        routeId, reason: { type: 'string', minLength: 1, maxLength: 256 } }, ['id']),
    tool('merchant_discovery_apply', 'Apply only the exact reviewId most recently returned by this host. Reads the host-configured merchant key, signs every alternative, and uses the original catalog batch or withdrawal. The original release/instance/head/pin must still match. Never retries a publication; read discovery status after an interrupted response.',
      { reviewId: digest }, ['reviewId'], { destructive: true, openWorld: true }),
  ];
}

export { discoveryTools, releaseId, routeId, digest };
