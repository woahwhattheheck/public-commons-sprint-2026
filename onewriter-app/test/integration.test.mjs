import assert from "node:assert/strict";
import test, { after, before, beforeEach } from "node:test";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { NetlifyDB } from "@netlify/database-dev";
import { getDatabase } from "@netlify/database";
import { createService } from "../lib/service.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
let local;
let db;
let service;

before(async () => {
  local = new NetlifyDB({ logger: () => {} });
  const connectionString = await local.start();
  await local.applyMigrations(join(HERE, "../netlify/database/migrations"));
  db = getDatabase({ connectionString });
  service = createService(db);
});

after(async () => {
  await db?.pool?.end?.();
  await local?.stop?.();
});

beforeEach(async () => {
  await db.sql`TRUNCATE events, workspace_identifiers, lanes, lane_locks RESTART IDENTITY CASCADE`;
});

function claim(eventId, actor, route, overrides = {}) {
  return {
    event_id: eventId,
    actor,
    org: "Northstar Labs",
    domain: "northstar.example",
    route,
    purpose: "initial outreach",
    opportunity: "builder fest",
    lease_seconds: 300,
    reason: "race proof",
    ...overrides,
  };
}

function event(eventId, kind, actor, route, overrides = {}) {
  return {
    event_id: eventId,
    kind,
    actor,
    org: "Northstar Labs",
    domain: "northstar.example",
    route,
    purpose: "initial outreach",
    opportunity: "builder fest",
    provider_receipt: null,
    human_evidence_id: null,
    reason: "integration proof",
    ...overrides,
  };
}

test("two concurrent workers on different routes get at most one live writer lease", async () => {
  const [a, b] = await Promise.all([
    service.claim(claim("evt-race-a", "worker-a", "email:sales@northstar.example")),
    service.claim(claim("evt-race-b", "worker-b", "email:founder@northstar.example")),
  ]);
  const decisions = [a.receipt.decision, b.receipt.decision].sort();
  assert.deepEqual(decisions, ["DENIED_ACTIVE_LEASE", "GRANTED"]);
  const lanes = await db.sql`SELECT state, holder, leased_route FROM lanes`;
  assert.equal(lanes.length, 1);
  assert.equal(lanes[0].state, "LEASED");
});

test("wrong-route provider outcome cannot mutate the lane", async () => {
  await service.claim(claim("evt-claim", "worker-a", "email:sales@northstar.example"));
  await assert.rejects(
    service.record(event("evt-wrong", "SENT", "worker-a", "email:founder@northstar.example", { provider_receipt: "provider-wrong" })),
    /does not match current leased route/,
  );
  const lanes = await db.sql`SELECT state, holder, leased_route FROM lanes`;
  assert.equal(lanes[0].state, "LEASED");
  assert.equal(lanes[0].leased_route, "email:sales@northstar.example");
  const ids = await db.sql`SELECT identifier FROM workspace_identifiers ORDER BY identifier`;
  assert.deepEqual(ids.map((row) => row.identifier), ["evt-claim"]);
});

test("one-shot human reopen refences to the exact prior fence after unused expiry", async () => {
  await service.claim(claim("evt-claim", "worker-a", "email:sales@northstar.example"));
  await service.record(event("evt-sent", "SENT", "worker-a", "email:sales@northstar.example", { provider_receipt: "provider-sent" }));
  await service.record(event("evt-human", "HUMAN_EVENT", "reviewer", "email:sales@northstar.example", { human_evidence_id: "human-reply" }));
  const reopened = await service.claim(claim("evt-reopen-claim", "worker-b", "email:founder@northstar.example", { lease_seconds: 30 }));
  assert.equal(reopened.receipt.decision, "GRANTED_AFTER_HUMAN_EVENT");

  await db.sql`UPDATE lanes SET lease_until = clock_timestamp() - interval '1 second'`;
  const blocked = await service.claim(claim("evt-after-expiry", "worker-c", "email:partner@northstar.example"));
  assert.equal(blocked.receipt.reopen_expiry_refenced, true);
  assert.equal(blocked.receipt.prior_state, "HARD_DNR");
  assert.equal(blocked.receipt.decision, "DENIED_HARD_DNR");
  assert.equal(blocked.receipt.state, "HARD_DNR");
});

test("workspace identifiers are single-use across event/provider/human classes", async () => {
  await service.claim(claim("evt-claim", "worker-a", "email:sales@northstar.example"));
  await service.record(event("evt-sent", "SENT", "worker-a", "email:sales@northstar.example", { provider_receipt: "shared-proof" }));
  await assert.rejects(
    service.record(event("evt-human", "HUMAN_EVENT", "reviewer", "email:sales@northstar.example", { human_evidence_id: "shared-proof" })),
    /workspace identifier reused/,
  );
});

test("SENT hard-fences every alternate route", async () => {
  await service.claim(claim("evt-claim", "worker-a", "email:sales@northstar.example"));
  await service.record(event("evt-sent", "SENT", "worker-a", "email:sales@northstar.example", { provider_receipt: "provider-sent" }));
  const alternate = await service.claim(claim("evt-alt", "worker-b", "email:founder@northstar.example"));
  assert.equal(alternate.receipt.decision, "DENIED_HARD_DNR");
  assert.equal(alternate.receipt.external_send_authorized, false);
});
