// MIT. Original tool metadata; provider runtimes load only when selected.


const digest = { type: 'string', pattern: '^[0-9a-f]{64}$' };

const alias = { type: 'string', pattern: '^[a-z][a-z0-9-]{0,39}$' };

const tenant = { type: 'string', pattern: '^[a-z][a-z0-9-]{1,39}$' };

const release = { type: 'string', pattern: '^[a-z0-9][a-z0-9_-]{0,63}$' };

const identity = { type: 'string', minLength: 1, maxLength: 128 };

const revision = { type: 'integer', minimum: 1 };

function fleetControlTools(tool) {
  return [
    tool('merchant_fleet_plan', 'Inspect the host-configured original fleet: plan digest, tenant/slot/package aliases, listener ports and limits. Reads original release stores without starting a process or exposing private paths.', {}, [], { readOnly: true, idempotent: true }),
    tool('merchant_fleet_status', 'Read this MCP process ownership and the original live fleet revision, candidates, exact release mapping, retained rollback history, active requests and drain state. A stopped fleet remains stopped.', {}, [], { readOnly: true, idempotent: true }),
    tool('merchant_fleet_start', 'Start or reopen the original retained multi-store fleet using the exact inspected host-plan digest. Starts its original selected merchant sessions and gateway; does not request a paid resource.', { expectedPlanDigest: digest }, ['expectedPlanDigest'], { openWorld: true }),
    tool('merchant_fleet_catalog', 'Inspect the retained original release catalog and selection generation for one declared tenant/slot. Requires this process to own the running fleet.', { tenant, slot: alias }, ['tenant', 'slot'], { readOnly: true, idempotent: true }),
    tool('merchant_fleet_stage', 'Stage one host-registered merchant source through its original release engine into a new immutable release in the selected tenant/slot. Uses the configured source kind and capture limits; returns its actual digest and native source facts without routing traffic to it.', { tenant, slot: alias, package: alias, releaseId: release }, ['tenant', 'slot', 'package', 'releaseId']),
    tool('merchant_fleet_review', 'Compare a staged replacement against the currently serving tenant release. Returns exact native changes and a short-lived review bound to the fleet revision and original store generations.', { tenant, slot: alias, releaseId: release }, ['tenant', 'slot', 'releaseId']),
    tool('merchant_fleet_prepare', 'Consume an original replacement review, start its selected merchant session and prepare the native fleet candidate. Returns the candidate ID and exact expected revision for activation.', { reviewId: identity }, ['reviewId'], { openWorld: true }),
    tool('merchant_fleet_activate', 'Activate the exact prepared candidate at its reviewed fleet revision. Existing requests drain on the prior original merchant sessions; new requests use the activated release.', { candidateId: identity, expectedRevision: revision }, ['candidateId', 'expectedRevision']),
    tool('merchant_fleet_rollback_review', 'Review a specific retained original fleet revision, comparing all affected tenant releases and verifying their native immutable source identities.', { targetRevision: revision }, ['targetRevision']),
    tool('merchant_fleet_rollback', 'Consume the original rollback review, reopen any needed retained merchant sessions and restore that exact fleet mapping as a new native revision.', { reviewId: identity }, ['reviewId'], { openWorld: true }),
    tool('merchant_fleet_retire', 'Retire only the named original child instance owned by this fleet after it has no current/candidate routing or draining requests. The original gateway routing mutex spans the child close.', { tenant, slot: alias, instanceId: identity, expectedRevision: revision }, ['tenant', 'slot', 'instanceId', 'expectedRevision'], { destructive: true }),
    tool('merchant_fleet_operations', 'Read the original developer explorer and available merchant operations or private availability desk links for the exact running instance owned by this fleet. Use tenant, slot and instanceId from merchant_fleet_status. Keep the availability control link in the operator session.', { tenant, slot: alias, instanceId: identity }, ['tenant', 'slot', 'instanceId'], { readOnly: true, idempotent: true }),
    tool('merchant_fleet_stop', 'Gracefully drain the original gateway and close its owned merchant sessions. Pass managerId from merchant_fleet_status. Preserves native release, mapping and rollback state.', { managerId: identity }, ['managerId'], { destructive: true }),
    tool('merchant_fleet_restart', 'Drain this process-owned fleet, then reopen its retained original state with the inspected host-plan digest. Checks current manager ownership and plan before stopping.', { managerId: identity, expectedPlanDigest: digest }, ['managerId', 'expectedPlanDigest'], { destructive: true, openWorld: true }),
  ];
}

export { fleetControlTools, digest, tenant, alias, release, identity, revision };
