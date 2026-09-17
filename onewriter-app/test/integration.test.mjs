import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test, { after, before, beforeEach } from "node:test";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { NetlifyDB } from "@netlify/database-dev";
import { getDatabase } from "@netlify/database";
import { createService } from "../lib/service.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const MIGRATION = join(HERE, "../netlify/database/migrations/001_onewriter/migration.sql");
let local = null;
let db;
let service;

const workerA = Object.freeze({ subject: "worker-a", roles: ["state", "claim", "provider_evidence"] });
const workerB = Object.freeze({ subject: "worker-b", roles: ["state", "claim", "provider_evidence"] });
const workerC = Object.freeze({ subject: "worker-c", roles: ["state", "claim"] });
const humanRecorder = Object.freeze({ subject: "human-recorder", roles: ["state", "human_evidence"] });
const stateOnly = Object.freeze({ subject: "observer", roles: ["state"] });

before(async () => {
  const external = process.env.ONEWRITER_TEST_DATABASE_URL;
  if (external) {
    db = getDatabase({ connectionString: external });
    await db.pool.query(await readFile(MIGRATION, "utf8"));
  } else {
    local = new NetlifyDB({ logger: () => {} });
    const connectionString = await local.start();
    await local.applyMigrations(join(HERE, "../netlify/database/migrations"));
    db = getDatabase({ connectionString });
  }
  service = createService(db);
});

after(async () => {
  await db?.pool?.end?.();
  await local?.stop?.();
});

beforeEach(async () => {
  await db.sql`TRUNCATE events, workspace_identifiers, lanes, lane_locks RESTART IDENTITY CASCADE`;
});

function claim(eventId, route, overrides = {}) {
  return {
    event_id: eventId,
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

function event(eventId, kind, route, overrides = {}) {
  return {
    event_id: eventId,
    kind,
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

function serializationFailure(code = "40001") {
  const error = new Error(`injected PostgreSQL ${code}`);
  error.code = code;
  return error;
}

test("two authenticated concurrent workers on different routes get one grant and one typed denial", async () => {
  const [a, b] = await Promise.all([
    service.claim(claim("evt-race-a", "email:sales@northstar.example"), workerA),
    service.claim(claim("evt-race-b", "email:founder@northstar.example"), workerB),
  ]);
  const decisions = [a.receipt.decision, b.receipt.decision].sort();
  assert.deepEqual(decisions, ["DENIED_ACTIVE_LEASE", "GRANTED"]);
  const lanes = await db.sql`SELECT state, holder, leased_route FROM lanes`;
  assert.equal(lanes.length, 1);
  assert.equal(lanes[0].state, "LEASED");
  const events = await db.sql`SELECT event_id, actor, decision FROM events ORDER BY event_id`;
  assert.equal(events.length, 2);
  assert.deepEqual(events.map((row) => row.actor).sort(), ["worker-a", "worker-b"]);
});

test("whole transaction retries 40001 with a fresh DB clock and no aborted-generation leakage", async () => {
  const samples = [];
  let injected = false;
  const retrying = createService(db, {
    transactionMaxAttempts: 3,
    afterServerNow: async ({ operation, attempt, now }) => {
      if (operation !== "claim") return;
      samples.push({ attempt, now });
      if (!injected) {
        injected = true;
        throw serializationFailure("40001");
      }
    },
  });
  const result = await retrying.claim(claim("evt-retry", "email:sales@northstar.example"), workerA);
  assert.equal(result.receipt.decision, "GRANTED");
  assert.deepEqual(samples.map((sample) => sample.attempt), [1, 2]);
  assert.ok(samples.every((sample) => sample.now instanceof Date));
  assert.ok(samples[1].now.getTime() >= samples[0].now.getTime());
  const ids = await db.sql`SELECT identifier FROM workspace_identifiers`;
  const events = await db.sql`SELECT event_id FROM events`;
  const lanes = await db.sql`SELECT collision_key FROM lanes`;
  assert.deepEqual(ids.map((row) => row.identifier), ["evt-retry"]);
  assert.deepEqual(events.map((row) => row.event_id), ["evt-retry"]);
  assert.equal(lanes.length, 1);
});

test("40P01 deadlock is deliberately retried as a whole transaction", async () => {
  let injected = false;
  const retrying = createService(db, {
    afterServerNow: async ({ operation }) => {
      if (operation === "claim" && !injected) {
        injected = true;
        throw serializationFailure("40P01");
      }
    },
  });
  const result = await retrying.claim(claim("evt-deadlock", "email:sales@northstar.example"), workerA);
  assert.equal(result.receipt.decision, "GRANTED");
});

test("retry exhaustion fails closed and leaves no writer, identifier, or receipt", async () => {
  const exhausted = createService(db, {
    transactionMaxAttempts: 2,
    afterServerNow: async ({ operation }) => {
      if (operation === "claim") throw serializationFailure("40001");
    },
  });
  await assert.rejects(
    exhausted.claim(claim("evt-exhausted", "email:sales@northstar.example"), workerA),
    /database contention retry exhausted; no writer authority granted/,
  );
  assert.equal((await db.sql`SELECT * FROM lane_locks`).length, 0);
  assert.equal((await db.sql`SELECT * FROM lanes`).length, 0);
  assert.equal((await db.sql`SELECT * FROM workspace_identifiers`).length, 0);
  assert.equal((await db.sql`SELECT * FROM events`).length, 0);
});

test("caller cannot relabel actor and insufficient roles cannot mutate", async () => {
  await assert.rejects(
    service.claim({ ...claim("evt-injected", "email:sales@northstar.example"), actor: "attacker" }, workerA),
    /claim key set changed/,
  );
  await assert.rejects(
    service.claim(claim("evt-role", "email:sales@northstar.example"), stateOnly),
    /role claim required/,
  );
  assert.equal((await db.sql`SELECT * FROM lanes`).length, 0);
  assert.equal((await db.sql`SELECT * FROM workspace_identifiers`).length, 0);
});

test("wrong-route provider outcome cannot mutate the lane", async () => {
  await service.claim(claim("evt-claim", "email:sales@northstar.example"), workerA);
  await assert.rejects(
    service.record(event("evt-wrong", "SENT", "email:founder@northstar.example", { provider_receipt: "provider-wrong" }), workerA),
    /does not match current leased route/,
  );
  const lanes = await db.sql`SELECT state, holder, leased_route FROM lanes`;
  assert.equal(lanes[0].state, "LEASED");
  assert.equal(lanes[0].leased_route, "email:sales@northstar.example");
  const ids = await db.sql`SELECT identifier FROM workspace_identifiers ORDER BY identifier`;
  assert.deepEqual(ids.map((row) => row.identifier), ["evt-claim"]);
});

test("provider outcome requires provider-evidence role and authenticated holder identity", async () => {
  await service.claim(claim("evt-claim", "email:sales@northstar.example"), workerA);
  await assert.rejects(
    service.record(event("evt-role-provider", "SENT", "email:sales@northstar.example", { provider_receipt: "provider-role" }), workerC),
    /role provider_evidence required/,
  );
  await assert.rejects(
    service.record(event("evt-wrong-holder", "SENT", "email:sales@northstar.example", { provider_receipt: "provider-holder" }), workerB),
    /recorder is not current lease holder/,
  );
});

test("one-shot human reopen refences to the exact prior fence after unused expiry", async () => {
  await service.claim(claim("evt-claim", "email:sales@northstar.example"), workerA);
  await service.record(event("evt-sent", "SENT", "email:sales@northstar.example", { provider_receipt: "provider-sent" }), workerA);
  await service.record(event("evt-human", "HUMAN_EVENT", "email:sales@northstar.example", { human_evidence_id: "human-reply" }), humanRecorder);
  const reopened = await service.claim(claim("evt-reopen-claim", "email:founder@northstar.example", { lease_seconds: 30 }), workerB);
  assert.equal(reopened.receipt.decision, "GRANTED_AFTER_HUMAN_EVENT");

  await db.sql`UPDATE lanes SET lease_until = clock_timestamp() - interval '1 second'`;
  const blocked = await service.claim(claim("evt-after-expiry", "email:partner@northstar.example"), workerC);
  assert.equal(blocked.receipt.reopen_expiry_refenced, true);
  assert.equal(blocked.receipt.prior_state, "HARD_DNR");
  assert.equal(blocked.receipt.decision, "DENIED_HARD_DNR");
  assert.equal(blocked.receipt.state, "HARD_DNR");
});

test("workspace identifiers are single-use across authenticated evidence classes", async () => {
  await service.claim(claim("evt-claim", "email:sales@northstar.example"), workerA);
  await service.record(event("evt-sent", "SENT", "email:sales@northstar.example", { provider_receipt: "shared-proof" }), workerA);
  await assert.rejects(
    service.record(event("evt-human", "HUMAN_EVENT", "email:sales@northstar.example", { human_evidence_id: "shared-proof" }), humanRecorder),
    /workspace identifier reused/,
  );
});

test("SENT hard-fences every alternate route", async () => {
  await service.claim(claim("evt-claim", "email:sales@northstar.example"), workerA);
  await service.record(event("evt-sent", "SENT", "email:sales@northstar.example", { provider_receipt: "provider-sent" }), workerA);
  const alternate = await service.claim(claim("evt-alt", "email:founder@northstar.example"), workerB);
  assert.equal(alternate.receipt.decision, "DENIED_HARD_DNR");
  assert.equal(alternate.receipt.external_send_authorized, false);
});

test("state projection itself requires state capability", async () => {
  const snapshot = await service.snapshot(workerA);
  assert.equal(snapshot.principal.subject, "worker-a");
  await assert.rejects(service.snapshot({ subject: "blind", roles: ["claim"] }), /role state required/);
});

test("canonically equivalent composed and decomposed identities share one writer lane", async () => {
  const [a, b] = await Promise.all([
    service.claim(
      claim("evt-unicode-composed", "email:composed@northstar.example", { org: "Café Labs" }),
      workerA,
    ),
    service.claim(
      claim("evt-unicode-decomposed", "email:decomposed@northstar.example", { org: "Cafe\u0301 Labs" }),
      workerB,
    ),
  ]);
  const decisions = [a.receipt.decision, b.receipt.decision].sort();
  assert.deepEqual(decisions, ["DENIED_ACTIVE_LEASE", "GRANTED"]);
  assert.equal(a.receipt.collision_key, b.receipt.collision_key);
  assert.equal((await db.sql`SELECT * FROM lanes`).length, 1);
  assert.equal((await db.sql`SELECT * FROM lane_locks`).length, 1);
  assert.equal((await db.sql`SELECT * FROM events`).length, 2);
});

test("zero-width collision alias fails closed and cannot mint a second lane", async () => {
  const [valid, invisible] = await Promise.allSettled([
    service.claim(
      claim("evt-visible", "email:visible@northstar.example", { org: "Northstar Labs" }),
      workerA,
    ),
    service.claim(
      claim("evt-zero-width", "email:invisible@northstar.example", { org: "North\u200bstar Labs" }),
      workerB,
    ),
  ]);
  assert.equal(valid.status, "fulfilled");
  assert.equal(valid.value.receipt.decision, "GRANTED");
  assert.equal(invisible.status, "rejected");
  assert.match(String(invisible.reason?.message), /category-C/);
  assert.equal((await db.sql`SELECT * FROM lanes`).length, 1);
  assert.equal((await db.sql`SELECT * FROM lane_locks`).length, 1);
  const events = await db.sql`SELECT event_id FROM events ORDER BY event_id`;
  assert.deepEqual(events.map((row) => row.event_id), ["evt-visible"]);
});
