import assert from "node:assert/strict";
import test, { after, before } from "node:test";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { NetlifyDB } from "@netlify/database-dev";
import { getDatabase } from "@netlify/database";
import { createService } from "../lib/service.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
let local;
let db;
let service;
const workerA = Object.freeze({ subject: "worker-a", roles: ["claim", "provider_evidence"] });
const workerB = Object.freeze({ subject: "worker-b", roles: ["claim", "provider_evidence"] });
const workerC = Object.freeze({ subject: "worker-c", roles: ["claim"] });
const humanRecorder = Object.freeze({ subject: "human-recorder", roles: ["human_evidence"] });

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

const claim = (eventId, route, leaseSeconds = 300) => ({
  event_id: eventId, org: "Northstar Labs", domain: "northstar.example", route,
  purpose: "initial outreach", opportunity: "builder fest", lease_seconds: leaseSeconds,
  reason: "receipt-bound refence proof",
});

const event = (eventId, kind, route, providerReceipt = null, humanEvidenceId = null) => ({
  event_id: eventId, kind, org: "Northstar Labs", domain: "northstar.example", route,
  purpose: "initial outreach", opportunity: "builder fest", provider_receipt: providerReceipt,
  human_evidence_id: humanEvidenceId, reason: "receipt-bound refence proof",
});

test("late provider result rolls back refence; next admissible claim persists refence with receipt", async () => {
  await service.claim(claim("evt-claim", "email:sales@northstar.example"), workerA);
  await service.record(event("evt-sent", "SENT", "email:sales@northstar.example", "provider-sent"), workerA);
  await service.record(event("evt-human", "HUMAN_EVENT", "email:sales@northstar.example", null, "human-reply"), humanRecorder);
  await service.claim(claim("evt-reopen", "email:founder@northstar.example", 30), workerB);
  await db.sql`UPDATE lanes SET lease_until = clock_timestamp() - interval '1 second'`;

  await assert.rejects(
    service.record(event("evt-late-provider", "SENT", "email:founder@northstar.example", "provider-late"), workerB),
    /lease expired; prior fence is effective/,
  );

  const persistedAfterReject = await db.sql`SELECT state, reopen_from_state, holder FROM lanes`;
  assert.equal(persistedAfterReject[0].state, "LEASED");
  assert.equal(persistedAfterReject[0].reopen_from_state, "HARD_DNR");
  assert.equal(persistedAfterReject[0].holder, "worker-b");
  const lateIds = await db.sql`SELECT identifier FROM workspace_identifiers WHERE identifier IN ('evt-late-provider','provider-late')`;
  assert.equal(lateIds.length, 0);

  const next = await service.claim(claim("evt-next", "email:partner@northstar.example"), workerC);
  assert.equal(next.receipt.reopen_expiry_refenced, true);
  assert.equal(next.receipt.prior_state, "HARD_DNR");
  assert.equal(next.receipt.decision, "DENIED_HARD_DNR");
  assert.equal(next.receipt.state, "HARD_DNR");

  const finalLane = await db.sql`SELECT state, reopen_from_state, holder FROM lanes`;
  assert.equal(finalLane[0].state, "HARD_DNR");
  assert.equal(finalLane[0].reopen_from_state, null);
  assert.equal(finalLane[0].holder, null);
});
