import {
  AUTHORITY,
  ContractError,
  acceptedEvent,
  collisionKey,
  effectiveExpiredHumanLease,
  impactFromEvents,
  makeReceipt,
  normalizeIdentity,
  normalizeRoute,
  requireCondition,
  requireExactKeys,
  validateActor,
  validateIdentifier,
  validateLeaseSeconds,
  validateReason,
} from "./core.mjs";

const CLAIM_KEYS = ["event_id", "actor", "org", "domain", "route", "purpose", "opportunity", "lease_seconds", "reason"];
const EVENT_KEYS = ["event_id", "kind", "actor", "org", "domain", "route", "purpose", "opportunity", "provider_receipt", "human_evidence_id", "reason"];

function common(input) {
  const eventId = validateIdentifier(input.event_id, "event id");
  const actor = validateActor(input.actor);
  const identity = normalizeIdentity(input);
  const key = collisionKey(input);
  const route = normalizeRoute(input.route);
  const reason = validateReason(input.reason);
  return { eventId, actor, identity, key, route, reason };
}

async function transaction(db, fn) {
  const client = await db.pool.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
    const value = await fn(client);
    await client.query("COMMIT");
    return value;
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch { /* keep original error */ }
    throw error;
  } finally {
    client.release();
  }
}

async function lockLane(client, key) {
  // The lock row solves the absent-row race without relying on advisory-lock
  // support: INSERT conflict serialization + SELECT FOR UPDATE gives one writer.
  await client.query("INSERT INTO lane_locks(collision_key) VALUES ($1) ON CONFLICT DO NOTHING", [key]);
  await client.query("SELECT collision_key FROM lane_locks WHERE collision_key=$1 FOR UPDATE", [key]);
}

async function serverNow(client) {
  const result = await client.query("SELECT clock_timestamp() AS now");
  return new Date(result.rows[0].now);
}

async function loadLane(client, key) {
  const result = await client.query("SELECT * FROM lanes WHERE collision_key=$1 FOR UPDATE", [key]);
  return result.rows[0] ?? null;
}

async function refenceExpiredHumanLease(client, lane, now) {
  const effective = effectiveExpiredHumanLease(lane, now);
  if (!effective) return { lane, refenced: false };
  const result = await client.query(
    `UPDATE lanes
       SET state=$2, holder=NULL, lease_until=NULL, leased_route=$3,
           reopen_from_state=NULL, reopen_from_route=NULL,
           version=version+1, updated_at=$4
     WHERE collision_key=$1
     RETURNING *`,
    [lane.collision_key, effective.state, effective.leased_route, now],
  );
  return { lane: result.rows[0], refenced: true };
}

async function reserveIdentifier(client, id, kind) {
  try {
    await client.query("INSERT INTO workspace_identifiers(identifier, kind) VALUES ($1,$2)", [id, kind]);
  } catch (error) {
    if (error?.code === "23505") throw new ContractError(`workspace identifier reused: ${id}`, 409);
    throw error;
  }
}

async function persistEvent(client, accepted, receipt) {
  const result = await client.query(
    `INSERT INTO events (
       event_id, collision_key, occurred_at, kind, actor, event_route, reason,
       lease_seconds, provider_receipt, human_evidence_id,
       prior_state, decision, new_state, lane_route_after, reopen_expiry_refenced,
       accepted_event, accepted_event_sha256, receipt, receipt_sha256, external_send_authorized
     ) VALUES (
       $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16::jsonb,$17,$18::jsonb,$19,FALSE
     ) RETURNING seq`,
    [
      accepted.event_id, accepted.collision_key, accepted.at_utc, accepted.kind, accepted.actor,
      accepted.event_route, accepted.reason, accepted.lease_seconds, accepted.provider_receipt,
      accepted.human_evidence_id, receipt.prior_state, receipt.decision, receipt.state,
      receipt.lane_route, receipt.reopen_expiry_refenced, JSON.stringify(accepted),
      receipt.accepted_event_sha256, JSON.stringify(receipt), receipt.receipt_sha256,
    ],
  );
  return Number(result.rows[0].seq);
}

export function createService(db) {
  return {
    async claim(input) {
      requireExactKeys(input, CLAIM_KEYS, "claim");
      const c = common(input);
      const leaseSeconds = validateLeaseSeconds(input.lease_seconds);
      return transaction(db, async (client) => {
        await lockLane(client, c.key);
        const now = await serverNow(client);
        await reserveIdentifier(client, c.eventId, "event");
        let lane = await loadLane(client, c.key);
        let refenced = false;
        let priorState = "CLEAR";
        let decision;

        if (!lane) {
          const inserted = await client.query(
            `INSERT INTO lanes (
               collision_key, org, domain, purpose, opportunity, state, holder,
               leased_route, lease_until, reopen_from_state, reopen_from_route, version, updated_at
             ) VALUES ($1,$2,$3,$4,$5,'LEASED',$6,$7,$8,NULL,NULL,1,$9)
             RETURNING *`,
            [c.key, c.identity.org, c.identity.domain, c.identity.purpose,
             c.identity.opportunity, c.actor, c.route,
             new Date(now.getTime() + leaseSeconds * 1000), now],
          );
          lane = inserted.rows[0];
          decision = "GRANTED";
        } else {
          const restored = await refenceExpiredHumanLease(client, lane, now);
          lane = restored.lane;
          refenced = restored.refenced;
          priorState = lane.state;

          if (lane.state === "LEASED") {
            if (now < new Date(lane.lease_until)) {
              decision = "DENIED_ACTIVE_LEASE";
            } else {
              const updated = await client.query(
                `UPDATE lanes
                   SET holder=$2, leased_route=$3, lease_until=$4,
                       reopen_from_state=NULL, reopen_from_route=NULL,
                       version=version+1, updated_at=$5
                 WHERE collision_key=$1 RETURNING *`,
                [c.key, c.actor, c.route, new Date(now.getTime() + leaseSeconds * 1000), now],
              );
              lane = updated.rows[0];
              decision = "GRANTED_STALE_RECOVERY";
            }
          } else if (lane.state === "HUMAN_EVENT_REOPEN") {
            const updated = await client.query(
              `UPDATE lanes
                 SET state='LEASED', holder=$2, leased_route=$3, lease_until=$4,
                     version=version+1, updated_at=$5
               WHERE collision_key=$1 RETURNING *`,
              [c.key, c.actor, c.route, new Date(now.getTime() + leaseSeconds * 1000), now],
            );
            lane = updated.rows[0];
            decision = "GRANTED_AFTER_HUMAN_EVENT";
          } else if (lane.state === "CLEAR") {
            const updated = await client.query(
              `UPDATE lanes
                 SET state='LEASED', holder=$2, leased_route=$3, lease_until=$4,
                     reopen_from_state=NULL, reopen_from_route=NULL,
                     version=version+1, updated_at=$5
               WHERE collision_key=$1 RETURNING *`,
              [c.key, c.actor, c.route, new Date(now.getTime() + leaseSeconds * 1000), now],
            );
            lane = updated.rows[0];
            decision = "GRANTED";
          } else {
            decision = `DENIED_${lane.state}`;
          }
        }

        const accepted = acceptedEvent({
          eventId: c.eventId, atUtc: now.toISOString(), kind: "CLAIM", actor: c.actor,
          identity: c.identity, collisionKey: c.key, route: c.route,
          leaseSeconds, reason: c.reason,
        });
        const receipt = makeReceipt({
          accepted, priorState, decision, state: lane.state,
          laneRoute: lane.leased_route, reopenExpiryRefenced: refenced,
        });
        const seq = await persistEvent(client, accepted, receipt);
        return { seq, receipt, authority: AUTHORITY };
      });
    },

    async record(input) {
      requireExactKeys(input, EVENT_KEYS, "event");
      const c = common(input);
      const kind = input.kind;
      requireCondition(["SENT", "BOUNCE", "HUMAN_EVENT", "HOLD"].includes(kind), "event kind must be SENT, BOUNCE, HUMAN_EVENT, or HOLD");
      const providerReceipt = input.provider_receipt === null ? null : validateIdentifier(input.provider_receipt, "provider_receipt");
      const humanEvidenceId = input.human_evidence_id === null ? null : validateIdentifier(input.human_evidence_id, "human_evidence_id");
      if (kind === "SENT" || kind === "BOUNCE") {
        requireCondition(Boolean(providerReceipt) && humanEvidenceId === null, `${kind} requires provider_receipt and forbids human_evidence_id`);
      } else if (kind === "HUMAN_EVENT") {
        requireCondition(providerReceipt === null && Boolean(humanEvidenceId), "HUMAN_EVENT requires human_evidence_id and forbids provider_receipt");
      } else {
        requireCondition(providerReceipt === null && humanEvidenceId === null, "HOLD forbids evidence identifiers");
      }

      return transaction(db, async (client) => {
        await lockLane(client, c.key);
        const now = await serverNow(client);
        let lane = await loadLane(client, c.key);
        requireCondition(Boolean(lane), "writer lane does not exist", 409);
        const restored = await refenceExpiredHumanLease(client, lane, now);
        lane = restored.lane;
        const refenced = restored.refenced;
        const priorState = lane.state;

        // A late provider outcome after a one-shot human lease expires is invalid.
        // Throwing here rolls back the refence too, so no persisted state transition
        // exists without a receipt. Snapshot still reports the effective fence; the
        // next admissible event will persist refence + receipt atomically.
        if (refenced && (kind === "SENT" || kind === "BOUNCE")) {
          throw new ContractError(`${kind} lease expired; prior fence is effective`, 409);
        }

        if (kind === "SENT" || kind === "BOUNCE") {
          requireCondition(lane.state === "LEASED", `${kind} requires an active lease`, 409);
          requireCondition(now < new Date(lane.lease_until), `${kind} lease expired`, 409);
          requireCondition(lane.holder === c.actor, `${kind} actor is not current lease holder`, 409);
          requireCondition(lane.leased_route === c.route, `${kind} route does not match current leased route`, 409);
        } else if (kind === "HUMAN_EVENT") {
          requireCondition(["HARD_DNR", "DEAD_ROUTE", "HOLD"].includes(lane.state), "HUMAN_EVENT requires a fenced prior lane", 409);
        } else {
          requireCondition(lane.state !== "LEASED", "HOLD cannot revoke an active lease", 409);
        }

        await reserveIdentifier(client, c.eventId, "event");
        if (providerReceipt) await reserveIdentifier(client, providerReceipt, "provider");
        if (humanEvidenceId) await reserveIdentifier(client, humanEvidenceId, "human");

        let decision;
        if (kind === "SENT" || kind === "BOUNCE") {
          const nextState = kind === "SENT" ? "HARD_DNR" : "DEAD_ROUTE";
          decision = kind === "SENT" ? "RECORDED_SENT" : "RECORDED_DEAD_ROUTE";
          const updated = await client.query(
            `UPDATE lanes
               SET state=$2, holder=NULL, lease_until=NULL,
                   reopen_from_state=NULL, reopen_from_route=NULL,
                   version=version+1, updated_at=$3
             WHERE collision_key=$1 RETURNING *`,
            [c.key, nextState, now],
          );
          lane = updated.rows[0];
        } else if (kind === "HUMAN_EVENT") {
          const updated = await client.query(
            `UPDATE lanes
               SET state='HUMAN_EVENT_REOPEN', holder=NULL, lease_until=NULL,
                   reopen_from_state=$2, reopen_from_route=leased_route,
                   version=version+1, updated_at=$3
             WHERE collision_key=$1 RETURNING *`,
            [c.key, lane.state, now],
          );
          lane = updated.rows[0];
          decision = "REOPENED_HUMAN_EVENT";
        } else {
          const updated = await client.query(
            `UPDATE lanes
               SET state='HOLD', holder=NULL, lease_until=NULL, leased_route=$2,
                   reopen_from_state=NULL, reopen_from_route=NULL,
                   version=version+1, updated_at=$3
             WHERE collision_key=$1 RETURNING *`,
            [c.key, c.route, now],
          );
          lane = updated.rows[0];
          decision = "RECORDED_HOLD";
        }

        const accepted = acceptedEvent({
          eventId: c.eventId, atUtc: now.toISOString(), kind, actor: c.actor,
          identity: c.identity, collisionKey: c.key, route: c.route,
          providerReceipt, humanEvidenceId, reason: c.reason,
        });
        const receipt = makeReceipt({
          accepted, priorState, decision, state: lane.state,
          laneRoute: lane.leased_route, reopenExpiryRefenced: refenced,
        });
        const seq = await persistEvent(client, accepted, receipt);
        return { seq, receipt, authority: AUTHORITY };
      });
    },

    async snapshot() {
      const [laneRows, eventRows, nowRows] = await Promise.all([
        db.sql`SELECT * FROM lanes ORDER BY updated_at DESC, collision_key ASC`,
        db.sql`SELECT seq, event_id, collision_key, occurred_at, kind, actor, event_route, decision, new_state, lane_route_after, receipt_sha256, external_send_authorized FROM events ORDER BY seq DESC LIMIT 200`,
        db.sql`SELECT clock_timestamp() AS now`,
      ]);
      const now = new Date(nowRows[0].now);
      const lanes = laneRows.map((row) => {
        const effective = effectiveExpiredHumanLease(row, now);
        return effective ? { ...effective, effective_refence_pending: true } : { ...row, effective_refence_pending: false };
      });
      return {
        status: "OK",
        server_time_utc: now.toISOString(),
        lanes,
        events: eventRows,
        impact: impactFromEvents(eventRows),
        authority: AUTHORITY,
      };
    },
  };
}
