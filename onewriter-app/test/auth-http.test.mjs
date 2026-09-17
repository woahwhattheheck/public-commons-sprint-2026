import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { createAuthenticator, requireRole } from "../lib/auth.mjs";
import { createHttpHandler } from "../lib/http.mjs";

const token = "test-session-token-0123456789abcdef";
const registry = JSON.stringify([{
  token_sha256: createHash("sha256").update(token).digest("hex"),
  subject: "worker-alpha",
  roles: ["state", "claim", "provider_evidence"],
}]);
const auth = createAuthenticator(registry);

function request(path, { method = "GET", body, authorization } = {}) {
  const headers = {};
  if (authorization) headers.authorization = authorization;
  if (body !== undefined) headers["content-type"] = "application/json";
  return new Request(`https://onewriter.example${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
}

test("valid bearer token derives immutable server-side subject and roles", () => {
  const principal = auth.authenticate(`Bearer ${token}`);
  assert.equal(principal.subject, "worker-alpha");
  assert.deepEqual(principal.roles, ["state", "claim", "provider_evidence"]);
  assert.throws(() => requireRole(principal, "human_evidence"), /role human_evidence required/);
});

test("missing and wrong bearer tokens fail closed", () => {
  assert.throws(() => auth.authenticate(null), /authentication required/);
  assert.throws(() => auth.authenticate("Bearer wrong-token-0123456789"), /authentication required/);
});

test("unauthenticated state and mutation requests never construct or invoke service", async () => {
  let serviceConstructions = 0;
  const handler = createHttpHandler({
    getAuthenticator: () => auth,
    getService: () => {
      serviceConstructions += 1;
      throw new Error("service must not be reached");
    },
  });
  for (const req of [
    request("/api/state"),
    request("/api/claim", { method: "POST", body: { actor: "attacker" } }),
    request("/api/event", { method: "POST", body: { actor: "attacker" } }),
  ]) {
    const response = await handler(req);
    assert.equal(response.status, 401);
    assert.equal(response.headers.get("www-authenticate"), "Bearer realm=OneWriter");
  }
  assert.equal(serviceConstructions, 0);
});

test("authenticated HTTP passes derived principal, not an ambient cookie identity", async () => {
  let observed = null;
  const handler = createHttpHandler({
    getAuthenticator: () => auth,
    getService: () => ({
      async snapshot(principal) {
        observed = principal;
        return { status: "OK", principal, lanes: [], events: [], impact: {}, authority: {} };
      },
    }),
  });
  const response = await handler(new Request("https://onewriter.example/api/state", {
    headers: {
      authorization: `Bearer ${token}`,
      cookie: "actor=attacker; session=forged",
    },
  }));
  assert.equal(response.status, 200);
  assert.equal(observed.subject, "worker-alpha");
});

test("authenticated claim body is forwarded without any server-synthesized caller actor field", async () => {
  let observed = null;
  const handler = createHttpHandler({
    getAuthenticator: () => auth,
    getService: () => ({
      async claim(body, principal) {
        observed = { body, principal };
        return { receipt: { decision: "GRANTED", actor: principal.subject } };
      },
    }),
  });
  const body = {
    event_id: "evt-1", org: "Northstar", domain: "northstar.example",
    route: "email:sales@northstar.example", purpose: "initial outreach",
    opportunity: "builder fest", lease_seconds: 300, reason: "proof",
  };
  const response = await handler(request("/api/claim", {
    method: "POST", body, authorization: `Bearer ${token}`,
  }));
  assert.equal(response.status, 201);
  assert.equal(observed.principal.subject, "worker-alpha");
  assert.equal(Object.hasOwn(observed.body, "actor"), false);
});
