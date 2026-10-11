/* Creator Pool — campaign workspace frontend.
   Vanilla JS against the exact backend contract in
   ch/outputs/creator-pool090091-stage-20261011/delivery/backend/API-CONTRACT.md.
   All server access lives in the Api adapter below; everything rendered comes
   from GET /api/state or a POST response echoed by it. Amounts are integer
   atomic strings end-to-end (BigInt math, never floats).

   Modes (server-declared):
     local  — server signs with unlocked loopback Ganache demo actors
              (sponsor / creatorA / creatorB). Demo actor selection is NOT
              authentication and is labelled as such.
     public — the server holds no keys. Every write POST returns HTTP 202
              {status:"wallet_signature_required", chainId, transactions[]}.
              The connected EIP-1193 wallet signs/broadcasts each transaction
              in order, then each real hash is POSTed to /api/reconcile. */
"use strict";

/* ============================ API adapter ============================ */

const Api = (() => {
  // Optional override for integration: index.html?api=http://127.0.0.1:8000
  const override = new URLSearchParams(location.search).get("api");
  const base = (override || "").replace(/\/+$/, "");

  class ApiError extends Error {
    constructor(message, status, code, detail) {
      super(message);
      this.name = "ApiError";
      this.status = status;
      this.code = code || null;
      this.detail = detail === undefined ? null : detail;
    }
  }

  async function request(path, opts = {}) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), opts.timeoutMs || (opts.method === "POST" ? 45000 : 15000));
    let res;
    try {
      res = await fetch(base + path, {
        method: opts.method || "GET",
        headers: opts.body ? { "Content-Type": "application/json", "Accept": "application/json" } : { "Accept": "application/json" },
        body: opts.body ? JSON.stringify(opts.body) : undefined,
        signal: ctl.signal,
      });
    } catch (err) {
      throw new ApiError(
        err.name === "AbortError" ? "Request timed out — the backend did not answer in time." : "Backend not reachable — the API request failed.",
        0, "unreachable"
      );
    } finally {
      clearTimeout(timer);
    }

    let data = null;
    const text = await res.text();
    if (text) {
      try { data = JSON.parse(text); }
      catch { data = null; }
    }
    if (!res.ok) {
      const code = data && typeof data.error === "string" ? data.error : null;
      const detail = data ? data.detail : null;
      const msg = (typeof detail === "string" && detail) ||
        code || (data && typeof data.message === "string" ? data.message : null) ||
        `Request failed (${res.status}${res.statusText ? " " + res.statusText : ""}).`;
      throw new ApiError(msg, res.status, code, detail);
    }
    if(path==="/api/state"){
       const x=data?.state && typeof data.state==="object" && !data.campaigns ? data.state:data;
       if(!x||typeof x!=="object"||Array.isArray(x)||!["local","public"].includes(x.mode)||
          !Array.isArray(x.campaigns)||!Array.isArray(x.submissions)||
          !(Array.isArray(x.ledger)||Array.isArray(x.events))||
          !x.network||typeof x.network!=="object"||!x.asset||typeof x.asset!=="object")
          throw new ApiError("Incomplete campaign state from API; prior data preserved.",502,"invalid_state");
    }
    return data; // may be {status:"wallet_signature_required", ...} on HTTP 202
  }

  return {
    ApiError,
    base,
    getState: () => request("/api/state"),
    reconcile: (txHash) => request("/api/reconcile", { method: "POST", body: { txHash } }),
    createCampaign: (p) => request("/api/campaigns", { method: "POST", body: {
      title: p.title, brief: p.brief, budgetAtomic: p.budgetAtomic, rewardAtomic: p.rewardAtomic,
      deadline: p.deadline, operationId: p.operationId,
    } }),
    fundCampaign: (id, p) => request(`/api/campaigns/${encodeURIComponent(id)}/fund`, { method: "POST", body: { operationId: p && p.operationId } }),
    createSubmission: (campaignId, p) => request(`/api/campaigns/${encodeURIComponent(campaignId)}/submissions`, { method: "POST", body: {
      creator: p.creator, title: p.title, workUrl: p.workUrl, notes: p.notes, operationId: p.operationId,
    } }),
    approveSubmission: (id, p) => request(`/api/submissions/${encodeURIComponent(id)}/approve`, { method: "POST", body: { operationId: p && p.operationId } }),
    claimSubmission: (id, p) => request(`/api/submissions/${encodeURIComponent(id)}/claim`, { method: "POST", body: {
      actor: p && p.actor, operationId: p && p.operationId,
    } }),
    closeCampaign: (id, p) => request(`/api/campaigns/${encodeURIComponent(id)}/close`, { method: "POST", body: { operationId: p && p.operationId } }),
  };
})();

/* ============================ normalization ============================
   The adapter maps API payloads into one internal shape. The emitted backend
   shape (see API-CONTRACT.md) is consumed directly; a few legacy aliases are
   tolerated so the UI does not break on mild naming drift. */

function pick(obj, keys) {
  if (!obj || typeof obj !== "object") return undefined;
  for (const k of keys) if (obj[k] !== undefined && obj[k] !== null) return obj[k];
  return undefined;
}

function toAtomic(v) {
  // Accept "123", 123, or {atomic:"123"}. Reject everything else / non-integers.
  if (v && typeof v === "object" && v.atomic !== undefined) v = v.atomic;
  if (typeof v === "number") {
    if (!Number.isSafeInteger(v)) return null;
    v = String(v);
  }
  if (typeof v !== "string") return null;
  const s = v.trim();
  if (!/^\d{1,78}$/.test(s)) return null;
  try { return BigInt(s).toString(10); } catch { return null; }
}

function atomicField(obj, keys) {
  for (const k of keys) {
    const v = toAtomic(obj && obj[k]);
    if (v !== null) return v;
  }
  return null;
}

function str(v, fallback = "") {
  if (v === undefined || v === null) return fallback;
  return typeof v === "string" ? v : String(v);
}

function idStr(v) {
  if (v === undefined || v === null) return null;
  if (typeof v === "object") return str(pick(v, ["id", "key", "campaignId", "submissionId"])) || null;
  return str(v) || null;
}

function shortAddr(a) {
  if (!a || typeof a !== "string") return "—";
  if (a.length <= 14) return a;
  if (/^0x[0-9a-fA-F]{6,}$/.test(a)) return a.slice(0, 8) + "…" + a.slice(-4);
  return a.slice(0, 10) + "…" + a.slice(-4);
}

function sameAddr(a, b) {
  return !!a && !!b && String(a).toLowerCase() === String(b).toLowerCase();
}

function actorKeyLabel(key) {
  // Pretty labels for the backend's fixed local-demo actor map keys.
  const known = { sponsor: "Sponsor", creatorA: "Creator A", creatorB: "Creator B" };
  if (known[key]) return known[key];
  return String(key).replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[_-]+/g, " ")
    .replace(/^./, (c) => c.toUpperCase());
}

function normalizeActor(a, i) {
  if (a === null || a === undefined) return null;
  if (typeof a === "string") return { id: a, address: a, label: shortAddr(a), role: null, balanceAtomic: null };
  if (typeof a !== "object") return null;
  const address = str(pick(a, ["address", "account", "wallet"]));
  const id = str(pick(a, ["id", "key", "name"])) || address || `actor-${i}`;
  const roleRaw = str(pick(a, ["role", "kind", "type"])).toLowerCase();
  return {
    id,
    address: address || null,
    label: str(pick(a, ["label", "name", "title"])) || actorKeyLabel(id),
    role: roleRaw.includes("sponsor") ? "sponsor" : roleRaw.includes("creator") || id !== "sponsor" && /^creator/i.test(id) ? "creator" : roleRaw || null,
    balanceAtomic: atomicField(a, ["balanceAtomic", "balance_atomic", "balance"]),
  };
}

// Backend state shape: actors is an OBJECT map {sponsor:"0x…", creatorA:"0x…",
// creatorB:"0x…"} and balances is a parallel {key:"atomic"} map.
function normalizeActors(srcActors, srcBalances) {
  const out = [];
  if (Array.isArray(srcActors)) {
    for (const [i, a] of srcActors.entries()) {
      const n = normalizeActor(a, i);
      if (n) out.push(n);
    }
  } else if (srcActors && typeof srcActors === "object") {
    for (const [key, address] of Object.entries(srcActors)) {
      const addr = str(address);
      if (!addr) continue;
      out.push({
        id: key,
        address: addr,
        label: actorKeyLabel(key),
        role: key === "sponsor" ? "sponsor" : "creator",
        balanceAtomic: srcBalances && typeof srcBalances === "object" ? toAtomic(srcBalances[key]) : null,
      });
    }
  }
  // Merge any separate balances map into matching actor rows.
  if (srcBalances && typeof srcBalances === "object") {
    for (const a of out) {
      if (a.balanceAtomic === null && srcBalances[a.id] !== undefined) a.balanceAtomic = toAtomic(srcBalances[a.id]);
    }
  }
  return out;
}

function normalizeTxMap(raw) {
  // {EventName: "0x…"} or {EventName: ["0x…", …]} -> lowercased-key map of arrays.
  const out = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [k, v] of Object.entries(raw)) {
    const key = String(k).toLowerCase();
    const list = Array.isArray(v) ? v : [v];
    const hashes = list.filter((t) => typeof t === "string" && /^0x[0-9a-fA-F]{8,}$/.test(t));
    if (hashes.length) (out[key] ||= []).push(...hashes);
  }
  return out;
}

function latestTxFromMap(txs, eventOrder) {
  // eventOrder lists preferred event keys (lowercased), latest-first.
  for (const ev of eventOrder) {
    const list = txs[ev];
    if (list && list.length) return list[list.length - 1];
  }
  for (const list of Object.values(txs)) if (list.length) return list[list.length - 1];
  return null;
}

function normalizeCampaign(c, i) {
  if (!c || typeof c !== "object") return null;
  const id = str(pick(c, ["id", "campaignId", "campaign_id", "key"])) || `campaign-${i}`;
  const funded = atomicField(c, ["fundedAtomic", "funded_atomic", "poolAtomic", "pool_atomic"]);
  const budget = atomicField(c, ["budgetAtomic", "budget_atomic", "budget"]);
  const reserved = atomicField(c, ["reservedAtomic", "reserved_atomic", "reserved"]);
  const paid = atomicField(c, ["paidAtomic", "paid_atomic", "paid", "claimedAtomic", "claimed_atomic"]);
  const refunded = atomicField(c, ["refundedAtomic", "refunded_atomic", "refunded"]);
  const committed = atomicField(c, ["committedAtomic", "committed_atomic", "committed"]);
  const unfunded = atomicField(c, ["unfundedAtomic", "unfunded_atomic", "unfunded"]);
  let available = atomicField(c, ["availableAtomic", "available_atomic", "available", "remainingAtomic", "remaining_atomic"]);
  if (available === null && [funded, reserved, paid, refunded].every(v => v !== null)) {
    // A requested campaign budget is not money observed in its pool.
    const remaining = BigInt(funded) - BigInt(reserved) - BigInt(paid) - BigInt(refunded);
    available = remaining >= 0n ? remaining.toString(10) : null;
  }
  const metadataMatches = c.metadataMatches === undefined ? null : Boolean(c.metadataMatches);
  const txs = normalizeTxMap(pick(c, ["txs", "transactions"]));
  return {
    id,
    title: str(pick(c, ["title", "name"])) || null,
    brief: str(pick(c, ["brief", "description", "creativeBrief", "creative_brief"])) || null,
    metadataMatches,
    status: str(pick(c, ["status", "state"])) || null,
    deadline: str(pick(c, ["deadline", "closesAt", "closes_at", "closeDate", "close_date", "endsAt", "ends_at"])) || null,
    deadlineUnix: str(pick(c, ["deadlineUnix", "deadline_unix"])) || null,
    rewardAtomic: atomicField(c, ["rewardAtomic", "reward_atomic", "reward", "rewardPerSubmissionAtomic", "perSubmissionAtomic"]),
    budgetAtomic: budget,
    fundedAtomic: funded,
    reservedAtomic: reserved,
    paidAtomic: paid,
    refundedAtomic: refunded,
    committedAtomic: committed,
    unfundedAtomic: unfunded,
    availableAtomic: available,
    remainingApprovals: str(pick(c, ["remainingApprovals", "remaining_approvals"])) || null,
    sponsor: str(pick(c, ["sponsor", "owner", "funder"])) || null,
    sponsorActor: str(pick(c, ["sponsorActor", "sponsor_actor"])) || null,
    createTx: str(pick(c, ["createTx", "create_tx"])) || null,
    createdAt: str(pick(c, ["createdAt", "created_at", "created"])) || null,
    closed: Boolean(pick(c, ["closed", "isClosed", "is_closed"])) ||
      str(pick(c, ["status", "state"])).toLowerCase() === "closed",
    txs,
    lastTx: latestTxFromMap(txs, ["campaignclosed", "campaignfunded", "campaigncreated"]),
    raw: c,
  };
}

function normalizeSubmission(s, i) {
  if (!s || typeof s !== "object") return null;
  const creatorAddr = str(pick(s, ["creator", "creatorAddress", "creator_address", "author", "submitter"]));
  const creatorActorKey = str(pick(s, ["creatorActor", "creator_actor"])) || null;
  const metadataMatches = s.metadataMatches === undefined ? null : Boolean(s.metadataMatches);
  const txs = normalizeTxMap(pick(s, ["txs", "transactions"]));
  return {
    id: idStr(pick(s, ["id", "submissionId", "submission_id", "key"])) || `submission-${i}`,
    campaignId: idStr(pick(s, ["campaignId", "campaign_id", "campaign"])),
    creator: creatorAddr || creatorActorKey
      ? { id: creatorActorKey || creatorAddr, address: creatorAddr || null,
          label: creatorActorKey ? actorKeyLabel(creatorActorKey) : shortAddr(creatorAddr), role: "creator",
          actorKey: creatorActorKey, balanceAtomic: null }
      : null,
    creatorActor: creatorActorKey,
    title: str(pick(s, ["title", "name", "label"])) || null,
    workUrl: str(pick(s, ["workUrl", "work_url", "url", "contentUrl", "content_url", "link"])) || null,
    notes: str(pick(s, ["notes", "note", "message", "description"])) || "",
    metadataMatches,
    status: str(pick(s, ["status", "state"])) || "submitted",
    createdAt: str(pick(s, ["createdAt", "created_at", "submittedAt", "submitted_at"])) || null,
    approvedAt: str(pick(s, ["approvedAt", "approved_at"])) || null,
    claimedAt: str(pick(s, ["claimedAt", "claimed_at", "paidAt", "paid_at"])) || null,
    txHash: str(pick(s, ["txHash", "tx_hash", "tx", "transactionHash", "transaction_hash"])) || null,
    claimable: pick(s, ["claimable", "canClaim", "can_claim"]),
    txs,
    lastTx: latestTxFromMap(txs, ["rewardclaimed", "submissionapproved", "submissioncreated"]),
    raw: s,
  };
}

function normalizeEvent(e, i) {
  if (!e || typeof e !== "object") return null;
  // Ledger rows: {id, txHash, logIndex, blockNumber, event, args:{…}} — the
  // meaningful fields are nested inside args.
  const args = (e.args && typeof e.args === "object") ? e.args : {};
  const rawType = str(pick(e, ["event", "type", "kind", "name"])) || "event";
  const blockNumber = Number.isSafeInteger(e.blockNumber) ? e.blockNumber
    : (e.blockNumber !== undefined && /^\d+$/.test(String(e.blockNumber)) ? Number(e.blockNumber) : null);
  const logIndex = Number.isSafeInteger(e.logIndex) ? e.logIndex
    : (e.logIndex !== undefined && /^\d+$/.test(String(e.logIndex)) ? Number(e.logIndex) : null);
  return {
    id: idStr(pick(e, ["id", "eventId", "event_id"])) ||
      (e.txHash !== undefined && logIndex !== null ? `${e.txHash}:${logIndex}` : `event-${i}`),
    type: rawType.toLowerCase(),
    rawType,
    campaignId: idStr(pick(args, ["campaignId", "campaign_id"])) || idStr(pick(e, ["campaignId", "campaign_id", "campaign"])),
    submissionId: idStr(pick(args, ["submissionId", "submission_id"])) || idStr(pick(e, ["submissionId", "submission_id", "submission"])),
    amountAtomic: atomicField(args, ["amount", "amountAtomic", "reward"]) || atomicField(e, ["amountAtomic", "amount_atomic", "amount"]),
    refundedAtomic: atomicField(args, ["refunded", "refundedAtomic"]) || atomicField(e, ["refundedAtomic", "refunded_atomic"]),
    txHash: str(pick(e, ["txHash", "tx_hash", "tx", "transactionHash", "transaction_hash"])) || null,
    blockNumber,
    logIndex,
    at: str(pick(e, ["at", "timestamp", "time", "createdAt", "created_at"])) || null,
    actor: str(pick(args, ["creator", "sponsor", "actor", "by"])) || str(pick(e, ["actor", "by", "from"])) || null,
    args,
    label: str(pick(e, ["label", "message", "title"])) || null,
    status: str(pick(e, ["status", "state"])) || null,
    raw: e,
  };
}

function eventOrderKey(e) {
  // Newest-first. Ledger rows carry block/log ordering, not wall time.
  const hasBlock = e.blockNumber !== null && e.blockNumber !== undefined;
  return [
    hasBlock ? 1 : 0,
    hasBlock ? e.blockNumber : 0,
    e.logIndex !== null && e.logIndex !== undefined ? e.logIndex : -1,
    e.at ? (Date.parse(e.at) || 0) : 0,
  ];
}
function cmpEvents(a, b) {
  const ka = eventOrderKey(a), kb = eventOrderKey(b);
  for (let i = 0; i < ka.length; i++) if (ka[i] !== kb[i]) return kb[i] - ka[i];
  return 0;
}

function normalizeOperation(o) {
  if (!o || typeof o !== "object") return null;
  return {
    operationId: str(pick(o, ["operationId", "operation_id", "id"])) || null,
    kind: str(pick(o, ["kind", "type"])) || "operation",
    status: str(pick(o, ["status", "state"])) || "pending",
    txHashes: Array.isArray(o.txHashes) ? o.txHashes.filter((t) => typeof t === "string") :
      (Array.isArray(o.tx_hashes) ? o.tx_hashes.filter((t) => typeof t === "string") : []),
    error: o.error === undefined || o.error === null ? null : (typeof o.error === "string" ? o.error : JSON.stringify(o.error)),
    raw: o,
  };
}

function normalizeState(raw) {
  const src = (raw && typeof raw === "object" && raw.state && typeof raw.state === "object" && !raw.campaigns)
    ? raw.state : (raw || {});
  const assetRaw = pick(src, ["asset", "token", "currency"]);
  let decimals = null;
  if (assetRaw && typeof assetRaw === "object") {
    const d = pick(assetRaw, ["decimals", "precision"]);
    if (Number.isSafeInteger(d) && d >= 0 && d <= 36) decimals = d;
  }
  if (decimals === null) {
    const d = pick(src, ["decimals", "assetDecimals", "asset_decimals"]);
    if (Number.isSafeInteger(d) && d >= 0 && d <= 36) decimals = d;
  }
  const mode = str(pick(src, ["mode", "environment", "executionMode", "execution_mode"])) || null;
  const networkRaw = pick(src, ["network", "chain"]);
  const campaigns = (Array.isArray(src.campaigns) ? src.campaigns : []).map(normalizeCampaign).filter(Boolean);
  const submissions = (Array.isArray(src.submissions) ? src.submissions : [])
    .map((s, i) => normalizeSubmission(s, i)).filter(Boolean);
  for (const c of campaigns) {
    if (Array.isArray(c.raw.submissions)) {
      for (const [j, nested] of c.raw.submissions.entries()) {
        const n = normalizeSubmission(nested, j);
        if (n && !submissions.some((s) => s.id === n.id)) {
          n.campaignId = n.campaignId || c.id;
          submissions.push(n);
        }
      }
    }
  }
  const events = (Array.isArray(src.ledger) ? src.ledger : Array.isArray(src.events) ? src.events : [])
    .map(normalizeEvent).filter(Boolean)
    .sort(cmpEvents);
  const actors = normalizeActors(pick(src, ["actors", "demoActors"]), pick(src, ["balances", "actorBalances"]));
  const operations = (Array.isArray(src.operations) ? src.operations : [])
    .map(normalizeOperation).filter(Boolean);
  const pending = Boolean(src.pending) ||
    operations.some((o) => o.status === "pending" || o.status === "unknown_send_state") ||
    campaigns.some((c) => /pend/i.test(c.status || "")) ||
    submissions.some((s) => /pend/i.test(s.status)) ||
    events.some((e) => /pend/i.test(e.status || "") || /pend/i.test(e.type));
  return {
    mode,                                     // "local" | "public" | other
    localDemo: mode === "local" || mode === "local-demo" || mode === "local_demo" || mode === "demo",
    networkName: str(networkRaw && typeof networkRaw === "object"
      ? pick(networkRaw, ["name", "label", "chainName", "chain_name"])
      : networkRaw) || null,
    chainId: networkRaw && typeof networkRaw === "object" ? str(pick(networkRaw, ["chainId", "chain_id", "id"])) || null : null,
    assetSymbol: str(assetRaw && typeof assetRaw === "object"
      ? pick(assetRaw, ["symbol", "ticker", "code"])
      : assetRaw) || (assetRaw && typeof assetRaw === "object" ? str(pick(assetRaw, ["name"])) || null : null),
    assetName: assetRaw && typeof assetRaw === "object" ? str(pick(assetRaw, ["name"])) || null : null,
    assetDecimals: decimals,
    assetAddress: assetRaw && typeof assetRaw === "object" ? str(pick(assetRaw, ["address", "contract", "tokenAddress", "token_address"])) || null : null,
    nonMonetaryDemo: !!(assetRaw && typeof assetRaw === "object" && assetRaw.nonMonetaryDemo),
    contracts: src.contracts && typeof src.contracts === "object"
      ? { pool: str(src.contracts.pool) || null, token: str(src.contracts.token) || null }
      : { pool: null, token: null },
    actorNotice: str(src.actorNotice) || null,
    poolBalanceAtomic: atomicField(src, ["poolBalanceAtomic", "pool_balance_atomic"]),
    blockNumber: Number.isSafeInteger(src.blockNumber) ? src.blockNumber : null,
    blockTime: str(src.blockTime) || null,
    actors,
    campaigns,
    submissions,
    events,
    operations,
    pending,
    fetchedAt: new Date(),
  };
}

/* ============================ atomic math ============================ */

const Amount = {
  parse(userInput, decimals) {
    // Exact decimal -> atomic string. Rejects exponent notation, signs, commas.
    const s = String(userInput).trim();
    if (!/^\d{1,40}(\.\d{0,36})?$/.test(s)) {
      throw new Error(decimals === 0 ? "Enter a whole number amount." : "Enter a numeric amount like 25 or 25.5.");
    }
    const [intPart, fracPart = ""] = s.split(".");
    if (fracPart.length > decimals) {
      throw new Error(`This asset supports at most ${decimals} decimal place${decimals === 1 ? "" : "s"}.`);
    }
    return BigInt(intPart + fracPart.padEnd(decimals, "0")).toString(10);
  },

  format(atomicStr, decimals, opts = {}) {
    // Exact atomic -> grouped decimal string. No float anywhere.
    if (atomicStr === null || atomicStr === undefined) return "—";
    let v;
    try { v = BigInt(atomicStr); } catch { return "—"; }
    const neg = v < 0n;
    if (neg) v = -v;
    const digits = v.toString(10).padStart(decimals + 1, "0");
    let intPart = decimals === 0 ? digits : digits.slice(0, -decimals);
    let fracPart = decimals === 0 ? "" : digits.slice(-decimals).replace(/0+$/, "");
    intPart = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    let out = intPart + (fracPart ? "." + fracPart : "");
    if (opts.trimZero && out === "0") out = "0";
    return (neg ? "-" : "") + out;
  },

  cmp(a, b) { const x = BigInt(a), y = BigInt(b); return x < y ? -1 : x > y ? 1 : 0; },
  isZero(a) { return a === null || a === undefined ? true : BigInt(a) === 0n; },
  min(a, b) { return this.cmp(a, b) <= 0 ? a : b; },
};

/* ============================ DOM helpers ============================ */

const $ = (sel) => document.querySelector(sel);

function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === null || v === undefined || v === false) continue;
      if (k === "class") el.className = v;
      else if (k === "text") el.textContent = v;
      else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === "dataset") Object.assign(el.dataset, v);
      else if (k in el && k !== "list" && k !== "form" && typeof v !== "string") el[k] = v;
      else el.setAttribute(k, v === true ? "" : v);
    }
  }
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return el;
}

const ICONS = {
  fund: '<svg viewBox="0 0 20 20" width="14" height="14" aria-hidden="true"><path d="M10 3v14M4.5 8.5 10 3l5.5 5.5" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  created: '<svg viewBox="0 0 20 20" width="14" height="14" aria-hidden="true"><path d="M10 4.5v11M4.5 10h11" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/></svg>',
  submission: '<svg viewBox="0 0 20 20" width="14" height="14" aria-hidden="true"><rect x="4" y="3" width="12" height="14" rx="2" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M7 8h6M7 11.5h4" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>',
  approve: '<svg viewBox="0 0 20 20" width="14" height="14" aria-hidden="true"><path d="M4 10.5 8.2 15 16 5.5" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  claim: '<svg viewBox="0 0 20 20" width="14" height="14" aria-hidden="true"><circle cx="10" cy="10" r="7" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M10 6.5v7M7.5 8.2c0-1 1.1-1.7 2.5-1.7s2.5.7 2.5 1.6-1 1.4-2.5 1.7-2.5.7-2.5 1.7 1.1 1.6 2.5 1.6 2.5-.7 2.5-1.6" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>',
  paid: '<svg viewBox="0 0 20 20" width="14" height="14" aria-hidden="true"><circle cx="10" cy="10" r="7" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M7 10.2 9.2 12.4 13.2 7.8" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  refund: '<svg viewBox="0 0 20 20" width="14" height="14" aria-hidden="true"><path d="M4.5 11a5.7 5.7 0 1 0 .4-4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M4.3 3.5v4h4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  close: '<svg viewBox="0 0 20 20" width="14" height="14" aria-hidden="true"><rect x="3.5" y="5" width="13" height="11" rx="2" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M3.5 8.5h13" stroke="currentColor" stroke-width="1.7"/></svg>',
  link: '<svg viewBox="0 0 20 20" width="12" height="12" aria-hidden="true"><path d="M8 5H5a2.5 2.5 0 0 0 0 5h3M12 5h3a2.5 2.5 0 0 1 0 5h-3M7 10h6" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>',
  wallet: '<svg viewBox="0 0 20 20" width="14" height="14" aria-hidden="true"><rect x="3" y="5.5" width="14" height="10" rx="2.2" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M3 8.5h14" stroke="currentColor" stroke-width="1.7"/><circle cx="14" cy="12.2" r="1.15" fill="currentColor"/></svg>',
  event: '<svg viewBox="0 0 20 20" width="14" height="14" aria-hidden="true"><circle cx="10" cy="10" r="3.2" fill="currentColor"/></svg>',
};

function icon(name) {
  const span = h("span", { class: "ic", "aria-hidden": "true" });
  span.style.display = "inline-flex";
  span.innerHTML = ICONS[name] || ICONS.event; // static markup only, never user data
  return span;
}

function svgDeco(markup) {
  // Decorative inline SVG from a fixed literal string — never user data.
  const span = h("span", { "aria-hidden": "true" });
  span.style.display = "inline-flex";
  span.innerHTML = markup;
  return span;
}

function shortTx(t) {
  if (!t || typeof t !== "string") return null;
  return t.length > 16 ? t.slice(0, 10) + "…" + t.slice(-6) : t;
}

function safeHttpUrl(u) {
  if (!u || typeof u !== "string") return null;
  try {
    const url = new URL(u.trim());
    return (url.protocol === "https:" || url.protocol === "http:") ? url : null;
  } catch { return null; }
}

function fmtTime(iso) {
  const t = Date.parse(iso || "");
  if (Number.isNaN(t)) return iso ? str(iso) : "—";
  return new Date(t).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function fmtDate(iso) {
  const t = Date.parse(iso || "");
  if (Number.isNaN(t)) return iso ? str(iso) : null;
  return new Date(t).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

/* ============================ chain helpers ============================ */

const KNOWN_CHAINS = { "8453": "Base", "84532": "Base Sepolia" };

function chainName(chainIdDec, fallback) {
  // Only names we can assert; everything else renders as "chain <id>".
  const id = str(chainIdDec);
  if (!id) return fallback || "network unknown";
  if (KNOWN_CHAINS[id]) return KNOWN_CHAINS[id];
  return fallback || `chain ${id}`;
}

function explorerTxUrl(chainIdDec, txHash) {
  // Official explorers only for chains we can assert; unknown networks keep
  // the hash as plain text — no guessed explorer.
  if (chainIdDec === "84532") return `https://sepolia.basescan.org/tx/${txHash}`;
  if (chainIdDec === "8453") return `https://basescan.org/tx/${txHash}`;
  return null;
}

function chainIdDecFromHex(hex) {
  if (typeof hex !== "string" || !hex.startsWith("0x")) return null;
  try { return BigInt(hex).toString(10); } catch { return null; }
}

function toHexQuantity(v) {
  // Canonical 0x-quantity for transaction values ("0" -> "0x0", "0x0" -> "0x0").
  if (v === undefined || v === null || v === "") return "0x0";
  try { return "0x" + BigInt(v).toString(16); } catch { return "0x0"; }
}

function txLinkNode(txHash, extraClass) {
  // Explorer link when we can assert the official explorer for this chain,
  // plain text otherwise — never a guessed explorer.
  const cls = `sub-tx mono${extraClass ? " " + extraClass : ""}`;
  const url = ui.state ? explorerTxUrl(ui.state.chainId, txHash) : null;
  if (url) {
    return h("a", { class: cls, href: url, target: "_blank", rel: "noopener noreferrer", title: txHash },
      icon("link"), `tx ${shortTx(txHash)}`);
  }
  return h("span", { class: cls, title: txHash, text: `tx ${shortTx(txHash)}` });
}

/* ============================ wallet (EIP-1193) ============================ */

const Wallet = {
  address: null,
  chainIdDec: null,
  _wired: false,

  provider() {
    return (typeof window !== "undefined" && window.ethereum && typeof window.ethereum.request === "function")
      ? window.ethereum : null;
  },
  available() { return !!this.provider(); },

  async refresh() {
    const p = this.provider();
    if (!p) { this.address = null; this.chainIdDec = null; return; }
    try {
      const [accs, chain] = await Promise.all([
        p.request({ method: "eth_accounts" }),
        p.request({ method: "eth_chainId" }),
      ]);
      this.address = Array.isArray(accs) && accs.length ? accs[0] : null;
      this.chainIdDec = chainIdDecFromHex(chain) || null;
    } catch { /* provider may reject read-only calls; keep prior state */ }
  },

  async connect() {
    const p = this.provider();
    if (!p) throw new Error("No EIP-1193 wallet provider found — open this app in a compatible wallet browser or with a wallet extension installed.");
    const accs = await p.request({ method: "eth_requestAccounts" });
    if (!Array.isArray(accs) || !accs.length) throw new Error("The wallet did not return an account.");
    this.address = accs[0];
    await this.refresh();
    return this.address;
  },

  async ensureChain(requiredDec) {
    // Intentional, user-visible switch only — never silently mislabel chains.
    const p = this.provider();
    if (!p) throw new Error("No wallet provider available to switch networks.");
    if (this.chainIdDec === requiredDec) return;
    try {
      await p.request({ method: "wallet_switchEthereumChain", params: [{ chainId: toHexQuantity(requiredDec) }] });
    } catch (err) {
      if (err && (err.code === 4902 || (err.data && err.data.originalError && err.data.originalError.code === 4902))) {
        throw new Error(`The required network (chain ${requiredDec}) is not added to this wallet — add it in the wallet first, then switch.`);
      }
      throw new Error(walletErrText(err, `Network switch to chain ${requiredDec} was not completed in the wallet.`));
    }
    await this.refresh();
    if (this.chainIdDec !== requiredDec) {
      throw new Error(`Wallet is still on chain ${this.chainIdDec || "unknown"} — the action needs chain ${requiredDec}.`);
    }
  },

  async sendTransaction(tx) {
    // tx: {to, data, value} — actual calldata from the backend, canonical hex value.
    const p = this.provider();
    if (!p || !this.address) throw new Error("Connect a wallet before sending transactions.");
    const params = [{
      from: this.address,
      to: tx.to,
      data: tx.data,
      value: toHexQuantity(tx.value),
    }];
    return await p.request({ method: "eth_sendTransaction", params });
  },

  async receipt(txHash) {
    const p = this.provider();
    if (!p) return null;
    try { return await p.request({ method: "eth_getTransactionReceipt", params: [txHash] }); }
    catch { return null; }
  },

  wireEvents(onChange) {
    if (this._wired) return;
    const p = this.provider();
    if (!p || typeof p.on !== "function") return;
    this._wired = true;
    const handler = () => { this.refresh().then(onChange, onChange); };
    p.on("accountsChanged", handler);
    p.on("chainChanged", handler);
  },
};

function walletErrText(err, fallback) {
  if (err && (err.code === 4001 || err.code === "ACTION_REJECTED")) return "The request was rejected in the wallet.";
  if (err && err.code === -32002) return "A wallet request is already open — finish it in the wallet first.";
  const msg = err && (err.message || err.shortMessage);
  return msg ? `${fallback || "Wallet request failed."} ${String(msg).slice(0, 160)}` : (fallback || "Wallet request failed.");
}

/* ============================ wallet operation journal ============================
   Public-mode unsigned batches are tracked precisely: which transactions were
   sent, their real hashes, and reconcile state. The journal is kept in memory
   and mirrored to sessionStorage so an unresolved transaction stays
   recoverable across a page refresh (same tab). No keys, ever. */

const JOURNAL_KEY = "cpWalletOps.v1";
const TX_FINAL = new Set(["reconciled", "confirmed", "reverted"]);
const ENTRY_TERMINAL = new Set(["done", "failed", "rejected", "abandoned"]);

const TX_STATUS_TEXT = {
  unsent: "not sent yet",
  unsent_uncertain: "send outcome unknown — recover its transaction hash from wallet history",
  awaiting_wallet: "wallet request unresolved — recover its transaction hash before continuing",
  broadcast: "broadcast — receipt not seen yet",
  sent_pending: "sent — awaiting confirmation",
  mined_unreconciled: "mined — attaching metadata via reconcile",
  reconciled: "confirmed on chain",
  confirmed: "confirmed on chain",
  reverted: "reverted on chain",
  rejected: "rejected in wallet",
  reconcile_error: "reconcile check failed — will retry",
};

function journalLoad() {
  try {
    const raw = sessionStorage.getItem(JOURNAL_KEY);
    if (!raw) return new Map();
    const arr = JSON.parse(raw);
    const map = new Map();
    for (const e of Array.isArray(arr) ? arr : []) {
      if (!e || typeof e !== "object" || !e.id) continue;
      // A tx stuck in "awaiting_wallet" had no resolved hash — mark the
      // send outcome as uncertain rather than silently re-broadcasting.
      for (const t of e.txs || []) {
        if (t.status === "awaiting_wallet") {
          t.status = "unsent_uncertain";
          t.detail = "A previous send attempt did not return a hash — check wallet history before resuming.";
        }
      }
      // Recompute entry status from actual tx state — a reload can leave a
      // stale "sending"/"confirming" behind.
      const txs = Array.isArray(e.txs) ? e.txs : [];
      const allFinal = txs.length > 0 && txs.every((t) => TX_FINAL.has(t.status));
      const hasUnsent = txs.some((t) => !t.txHash && !TX_FINAL.has(t.status));
      if (allFinal) e.status = txs.some((t) => t.status === "reverted") ? "failed" : "done";
      else if (hasUnsent) e.status = "paused";
      else e.status = "confirming";
      map.set(e.id, e);
    }
    return map;
  } catch { return new Map(); }
}

function journalSave() {
  try {
    sessionStorage.setItem(JOURNAL_KEY, JSON.stringify([...ui.walletOps.values()]));
  } catch { /* storage may be unavailable; in-memory journal still works */ }
}

function validateUnsigned(payload){
  if(!payload||!/^[1-9]\d*$/.test(String(payload.chainId??""))||
     !Array.isArray(payload.transactions)||payload.transactions.length<1||payload.transactions.length>12)
     throw Error("Unsigned transaction batch incomplete. Nothing sent.");
  for(const tx of payload.transactions){
    if(!tx||typeof tx.to!=="string"||!/^0x[0-9a-fA-F]{40}$/.test(tx.to)||
       typeof tx.data!=="string"||!/^0x(?:[0-9a-fA-F]{2})*$/.test(tx.data)||
       tx.data.length>262146||!/^\d+$/.test(String(tx.value??"0")))
       throw Error("Invalid unsigned transaction fields. Nothing sent.");
  }
}

async function reviewPreparedStep(entry,tx,index){
  const host=document.getElementById("walletReviewHost");
  if(!host||!host.hidden)return false;
  const old=document.activeElement;
  return await new Promise(resolve=>{
    const cancel=h("button",{type:"button",class:"btn secondary"},"Keep unsigned");
    const confirm=h("button",{type:"button",class:"btn primary"},"Open wallet");
    const body=h("section",{class:"wallet-review-card",role:"dialog","aria-modal":"true","aria-labelledby":"walletReviewHeading"},
      h("p",{class:"wallet-review-step",text:`Step ${index+1}/${entry.txs.length} · unsigned`}),
      h("h2",{id:"walletReviewHeading",text:"Review prepared transaction"}),
      h("p",{text:"Inspect the actual API 202 transaction. No transaction has been sent."}),
      h("dl",{class:"wallet-review-grid"},
        h("dt",{text:"Operation"}),h("dd",{text:`${entry.kind}: ${tx.label}`}),
        h("dt",{text:"Network"}),h("dd",{text:`Chain ${entry.requiredChainId}`}),
        h("dt",{text:"Signing account"}),h("dd",{class:"mono",text:entry.wallet||"unknown"}),
        h("dt",{text:"Destination"}),h("dd",{class:"mono",text:tx.to}),
        h("dt",{text:"Native value (wei)"}),h("dd",{class:"mono",text:tx.value})),
      h("details",{},h("summary",{text:`Full calldata (${(tx.data.length-2)/2} bytes)`}),
        h("pre",{class:"wallet-review-hex",text:tx.data})),
      h("p",{class:"wallet-review-note",text:"Token approvals may authorize spending and transfers may move assets. The wallet must confirm the exact intended action; network fees are separate."}),
      h("div",{class:"wallet-review-buttons"},cancel,confirm));
    const scrim=h("div",{class:"wallet-review-scrim"},body);
    function done(yes){
      document.removeEventListener("keydown",key);
      host.replaceChildren();host.hidden=true;
      if(old?.isConnected && typeof old.focus==="function")old.focus({preventScroll:true});
      resolve(yes);
    }
    function key(e){
      if(e.key==="Escape"){e.preventDefault();done(false);}
      if(e.key==="Tab"){
        const ctrls=[cancel,...body.querySelectorAll("summary"),confirm];
        if(e.shiftKey&&document.activeElement===ctrls[0]){e.preventDefault();ctrls[ctrls.length-1].focus();}
        else if(!e.shiftKey&&document.activeElement===ctrls[ctrls.length-1]){e.preventDefault();ctrls[0].focus();}
      }
    }
    cancel.addEventListener("click",()=>done(false));
    confirm.addEventListener("click",()=>done(true));
    scrim.addEventListener("click",e=>{if(e.target===scrim)done(false)});
    document.addEventListener("keydown",key);
    host.replaceChildren(scrim);host.hidden=false;cancel.focus();
  });
}

async function verifyWalletAfterReview(entry){
  if(ui.staleError||ui.status!=="ready")stopWalletEntry(entry,"Campaign state stale; refresh before signing.");
  const p=Wallet.provider();
  if(!p||!entry.wallet||!entry.requiredChainId)stopWalletEntry(entry,"Original wallet/network missing. Nothing sent.");
  let accounts,chain;
  try{[accounts,chain]=await Promise.all([
    p.request({method:"eth_accounts"}),p.request({method:"eth_chainId"})]);}
  catch{stopWalletEntry(entry,"Wallet/network could not be read. Nothing sent.");}
  if(!Array.isArray(accounts)||!accounts.some(account=>sameAddr(account,entry.wallet))||
     chainIdDecFromHex(chain)!==entry.requiredChainId)
    stopWalletEntry(entry,"Wallet account/network changed during review; nothing sent.");
}

function journalNew(key, meta, payload) {
 validateUnsigned(payload);
  return {
    id: key,
    kind: meta.kind || "operation",
    ref: { campaignId: meta.campaignId || null, submissionId: meta.submissionId || null },
    createdAt: new Date().toISOString(),
    requiredChainId: str(payload.chainId) || null,
    wallet: Wallet.address,
    status: "open",            // open | waiting_chain | sending | confirming | done | failed | rejected | paused
    note: str(payload.note) || null,
    lastError: null,
    txs: (Array.isArray(payload.transactions) ? payload.transactions : []).map((t) => ({
      label: str(t.label) || "transaction",
      to: str(t.to),
      data: str(t.data),
      value: str(t.value === undefined ? "0" : t.value),
      txHash: null,
      status: "unsent",
      detail: null,
    })),
  };
}

function journalMerge(entry, payload) {
 validateUnsigned(payload);
 if(entry.requiredChainId && entry.requiredChainId!==String(payload.chainId))
  stopWalletEntry(entry,"Prepared network changed; no new step sent.");
 if(entry.txs.some(tx=>tx.txHash) &&
   (entry.txs.length!==payload.transactions.length || payload.transactions.some((t,i)=>{
     const old=entry.txs[i]; return !old || old.to.toLowerCase()!==t.to.toLowerCase() ||
       old.data.toLowerCase()!==t.data.toLowerCase() || old.value!==String(t.value??"0");
   }))) stopWalletEntry(entry,"Prepared steps changed after broadcast; no additional step sent.");
  if (hasUnknownWalletSend(entry)) {
    stopWalletEntry(entry, "Recover the previous transaction hash before requesting this action again.");
  }
  // A repeated identical intent returns the same calldata; keep hashes/status
  // of steps we already broadcast, adopt any new steps verbatim.
  const fresh = journalNew(entry.id, { kind: entry.kind, ...entry.ref }, payload);
  const seen = new Map(entry.txs.map((t) => [`${t.to}|${t.data}|${t.value}`, t]));
  entry.txs = fresh.txs.map((t) => {
    const old = seen.get(`${t.to}|${t.data}|${t.value}`);
    return old || t;
  });
  entry.requiredChainId = fresh.requiredChainId || entry.requiredChainId;
  return entry;
}

function isUnsignedResponse(res) {
  return !!(res && typeof res === "object" && res.status === "wallet_signature_required");
}

function isPoolTx(tx) {
  const pool = ui.state && ui.state.contracts && ui.state.contracts.pool;
  return !!(pool && tx.to && tx.to.toLowerCase() === String(pool).toLowerCase());
}

async function reconcileWalletTx(tx) {
  // One pass of "what do we actually know" for a broadcast transaction.
  if (!tx.txHash || TX_FINAL.has(tx.status)) return;
  if (isPoolTx(tx)) {
    try {
      const r = await Api.reconcile(tx.txHash);
      if (r && r.blockNumber !== undefined) { tx.status = "reconciled"; tx.detail = `block ${r.blockNumber}`; return; }
    } catch (e) {
      if (e.code === "tx_reverted") { tx.status = "reverted"; tx.detail = null; return; }
      if (e.code === "receipt_not_found_yet" || e.status === 404) {
        // Fall back to the wallet's own receipt view; keep retrying reconcile
        // while the receipt is absent so metadata can still attach later.
        const r = await Wallet.receipt(tx.txHash);
        if (r && r.status === "0x0") { tx.status = "reverted"; tx.detail = null; }
        else if (r && r.status === "0x1") { tx.status = "mined_unreconciled"; tx.detail = r.blockNumber ? `mined in ${r.blockNumber}` : null; }
        else tx.status = "sent_pending";
        return;
      }
      tx.status = "reconcile_error";
      tx.detail = e.message || "reconcile failed";
      return;
    }
  } else {
    // Non-pool transactions (e.g. token approve) can't be reconciled by the
    // API — it only accepts pool transactions — so the wallet receipt is the
    // source of truth for confirmation.
    const r = await Wallet.receipt(tx.txHash);
    if (r && r.status === "0x0") { tx.status = "reverted"; tx.detail = null; }
    else if (r && r.status === "0x1") { tx.status = "confirmed"; tx.detail = r.blockNumber ? `block ${r.blockNumber}` : null; }
    else tx.status = "sent_pending";
  }
}

async function reconcileWalletEntry(entry) {
  for (const tx of entry.txs) await reconcileWalletTx(tx);
  if (entry.txs.length && entry.txs.every((t) => t.status === "reconciled" || t.status === "confirmed")) {
    entry.status = "done";
  } else if (entry.txs.some((t) => t.status === "reverted")) {
    entry.status = "failed";
  } else if (entry.txs.every((t) => t.txHash)) {
    entry.status = "confirming";
  }
  journalSave();
}

function hasUnknownWalletSend(entry) {
  return entry.txs.some((tx) => !tx.txHash &&
    (tx.status === "unsent_uncertain" || tx.status === "awaiting_wallet"));
}

function stopWalletEntry(entry, message) {
  entry.status = "paused";
  entry.lastError = message;
  journalSave();
  throw new Error(message);
}

async function recoverWalletTransaction(entry, tx, hash) {
  if (!/^0x[0-9a-fA-F]{64}$/.test(hash || "")) {
    throw new Error("Enter the full transaction hash from wallet history.");
  }
  const p = Wallet.provider();
  if (!p) throw new Error("Open the wallet that sent this transaction.");
  const chain = chainIdDecFromHex(await p.request({ method: "eth_chainId" }));
  if (!entry.requiredChainId || chain !== entry.requiredChainId) {
    throw new Error("Switch the wallet to this operation's original network before recovery.");
  }
  const observed = await p.request({ method: "eth_getTransactionByHash", params: [hash] });
  if (!observed) throw new Error("Transaction is not visible yet on the original network. Keep this operation paused.");
  if (!entry.wallet || !sameAddr(observed.from, entry.wallet) ||
      !sameAddr(observed.to, tx.to) ||
      str(observed.hash).toLowerCase() !== hash.toLowerCase() ||
      str(observed.input === undefined ? observed.data : observed.input).toLowerCase() !== tx.data.toLowerCase() ||
      BigInt(observed.value) !== BigInt(tx.value)) {
    throw new Error("This transaction does not match the original account and prepared action.");
  }
  tx.txHash = observed.hash;
  tx.status = "broadcast";
  tx.detail = "Recovered from the original wallet's network.";
  entry.lastError = null;
  entry.status = "paused";
  journalSave();
  await reconcileWalletEntry(entry);
}

async function recoverWalletStep(entryId, index) {
  const entry = ui.walletOps.get(entryId), tx = entry && entry.txs[index];
  if (!tx || tx.txHash || ui.inflight.has(entryId)) return;
  const hash = window.prompt("Paste this action's transaction hash from the original wallet history. Recovery checks the account, network and action without sending another transaction.");
  if (hash === null) return;
  ui.inflight.add(entryId);
  try {
    await recoverWalletTransaction(entry, tx, hash.trim());
    toast("info", "Transaction recovered. Continue any remaining steps after confirmation.");
  } catch (err) {
    entry.lastError = err.message || "Transaction recovery failed.";
    journalSave();
    toast("error", entry.lastError);
  } finally {
    ui.inflight.delete(entryId);
    renderAll();
  }
}

async function continueWalletEntry(entry) {
  if (hasUnknownWalletSend(entry)) {
    stopWalletEntry(entry, "A previous send has no known hash. Recover it from the original wallet history before continuing; no transaction was resent.");
  }
  // Sends the still-unsent transactions in order, then reconciles. Throws a
  // precise error on rejection/failure; the journal keeps exact state.
  if (!Wallet.available()) {
    entry.status = "paused";
    entry.lastError = "No EIP-1193 wallet provider detected — open this app in a compatible wallet browser or install a wallet extension, then resume.";
    journalSave();
    throw new Error(entry.lastError);
  }
  await Wallet.refresh(); // re-read the real account + chain before acting
  if (!Wallet.address) await Wallet.connect();
  if (entry.wallet && !sameAddr(entry.wallet, Wallet.address)) {
    stopWalletEntry(entry, "Reconnect the original wallet account before continuing this operation.");
  }
  if (!entry.wallet) { entry.wallet = Wallet.address; journalSave(); }
  if (entry.requiredChainId && Wallet.chainIdDec !== entry.requiredChainId) {
    entry.status = "waiting_chain";
    journalSave();
    await Wallet.ensureChain(entry.requiredChainId); // user-visible switch
  }
  entry.status = "sending";
  entry.lastError = null;
  journalSave();
  for (const tx of entry.txs) {
    if (TX_FINAL.has(tx.status) || (tx.txHash && tx.status !== "rejected")) continue;
    if (!tx.txHash) {
      const approved = await reviewPreparedStep(entry,tx,entry.txs.indexOf(tx));
      if(!approved)stopWalletEntry(entry,"Unsigned review canceled; no wallet request sent. Resume to review again.");
      await verifyWalletAfterReview(entry);
      tx.status = "awaiting_wallet";
      tx.detail = null;
      journalSave();
      try {
        const hash = await Wallet.sendTransaction(tx);
        if (typeof hash !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(hash)) {
          throw new Error("The wallet returned no valid transaction hash.");
        }
        tx.txHash = hash;
        tx.status = "broadcast";
        tx.detail = null;
      } catch (err) {
        const rejected = err && (err.code === 4001 || err.code === "ACTION_REJECTED");
        tx.status = rejected ? "rejected" : "unsent_uncertain";
        tx.detail = walletErrText(err);
        entry.status = rejected ? "rejected" : "paused";
        entry.lastError = `${tx.label}: ${tx.detail} ${rejected ? "The wallet explicitly rejected this step." : "The send outcome is unknown. Recover its transaction hash from wallet history before continuing."}`;
        journalSave();
        throw new Error(entry.lastError);
      }
      journalSave();
    }
  }
  entry.status = "confirming";
  journalSave();
  await reconcileWalletEntry(entry);
}

function walletEntrySummary(entry) {
  const total = entry.txs.length;
  const done = entry.txs.filter((t) => t.status === "reconciled" || t.status === "confirmed").length;
  const reverted = entry.txs.filter((t) => t.status === "reverted").length;
 if(entry.status==="paused"||entry.status==="waiting_chain")
   return "Signing paused; unsigned steps await another review.";
  if (entry.status === "done") return `All ${total} transaction${total === 1 ? "" : "s"} confirmed on chain.`;
  if (reverted) return `${reverted} of ${total} transaction${total === 1 ? "" : "s"} reverted on chain — no payment completed.`;
  return `${done}/${total} transaction${total === 1 ? "" : "s"} confirmed; the workspace keeps checking the rest.`;
}

/* ============================ app state ============================ */

const ui = {
  status: "loading",          // loading | ready | offline
  state: null,                // normalized state
  staleError: null,           // last refresh error while we still show data
  role: "sponsor",            // sponsor | creator — a VIEW selector, never auth
  actorId: null,
  selectedCampaignId: null,
  inflight: new Set(),        // action keys currently in flight
  confirmClose: null,         // campaign id awaiting close confirmation
  offlineDetail: null,
  lastError: null,            // last write error, surfaced inside the open form
  drafts: new Map(),          // campaignId -> in-progress submission draft
  formError: null,            // {campaignId, msg} re-shown after a re-render
  opIds: new Map(),           // action key -> operationId (kept only while the outcome is uncertain)
  walletOps: journalLoad(),   // opKey -> wallet journal entry
  bootLink: null,             // {campaign, view} from the page URL, applied once
  linkApplied: false,
  pollMs: 8000,
  pollMsPending: 3000,
 refreshSeq: 0,
};

function assetUnit() {
  return ui.state && ui.state.assetSymbol ? ui.state.assetSymbol : "atomic units";
}
function decimals() {
  return ui.state && ui.state.assetDecimals !== null ? ui.state.assetDecimals : 6;
}
function decimalsKnown() {
  return !!(ui.state && ui.state.assetDecimals !== null);
}
function formDecimals() {
  return decimalsKnown() ? decimals() : 0;
}
function fmt(atomicStr) {
  const d = decimals();
  const s = Amount.format(atomicStr, decimalsKnown() ? d : 0);
  return decimalsKnown() ? s : (atomicStr !== null && atomicStr !== undefined ? `${atomicStr}` : "—");
}
function fmtWithUnit(atomicStr) {
  if (atomicStr === null || atomicStr === undefined) return "—";
  return `${fmt(atomicStr)} ${decimalsKnown() ? assetUnit() : "atomic"}`;
}

function isPublicMode() { return !!(ui.state && ui.state.mode === "public"); }
function isLocalDemo() { return !!(ui.state && ui.state.localDemo); }

function currentActor() {
  if (!ui.state || !ui.actorId) return null;
  return ui.state.actors.find((a) => a.id === ui.actorId) || null;
}
function sponsorActor() {
  if (!ui.state) return null;
  return ui.state.actors.find((a) => a.role === "sponsor") || null;
}
function creatorsForPicker() {
  if (!ui.state) return [];
  const creators = ui.state.actors.filter((a) => a.role === "creator" || a.role === null);
  return creators.length ? creators : ui.state.actors;
}

// Normalized snapshots are replaced together. Reuse their campaign joins
// across cards, selected detail, wallet references and the payment timeline.
let indexedState = null;
let campaignIndex = null;
function indexCampaignState() {
  if (indexedState === ui.state && campaignIndex) return campaignIndex;
  const campaigns = new Map(), submissions = new Map();
  for (const c of ui.state.campaigns) {
    if (!campaigns.has(c.id)) campaigns.set(c.id, c);
  }
  for (const s of ui.state.submissions) {
    if (!submissions.has(s.campaignId)) submissions.set(s.campaignId, []);
    submissions.get(s.campaignId).push(s);
  }
  indexedState = ui.state;
  campaignIndex = { campaigns, submissions };
  return campaignIndex;
}
function campaignSubmissions(campaignId) {
  return indexCampaignState().submissions.get(campaignId) || [];
}
function getCampaign(id) {
  return indexCampaignState().campaigns.get(id) || null;
}

// Local-mode submission creator parameter: the backend's actorAddr accepts the
// actor KEY (sponsor/creatorA/creatorB), not an address. Public mode omits it —
// the contract enforces the actual transaction sender.
function submissionCreatorParam(actorObj) {
  return actorObj ? actorObj.id : undefined;
}

/* ---------- action gating ---------- */

function walletGate() {
  // Shared public-mode gate facts. Role selection is presentation only; the
  // contract enforces the actual transaction sender.
  if (!Wallet.available()) return { ok: false, reason: "A wallet browser (EIP-1193 provider) is required — connect one to act." };
  if (!Wallet.address) return { ok: false, reason: "Connect a wallet to continue." };
  return { ok: true };
}

function sponsorGate(c) {
  if (isLocalDemo()) {
    return ui.role === "sponsor" ? { ok: true } : { ok: false, reason: "Switch to the sponsor view (demo)." };
  }
  const g = walletGate();
  if (!g.ok) return g;
  if (c && c.sponsor && !sameAddr(Wallet.address, c.sponsor)) {
    return { ok: false, reason: `Only the campaign sponsor wallet (${shortAddr(c.sponsor)}) can do this.` };
  }
  return { ok: true };
}

function creatorGate(sub) {
  if (isLocalDemo()) {
    if (ui.role !== "creator") return { ok: false, reason: "Switch to the creator view (demo)." };
    if (sub && sub.creatorActor && currentActor() && currentActor().id !== sub.creatorActor) {
      return { ok: false, reason: `Select the ${actorKeyLabel(sub.creatorActor)} demo actor.` };
    }
    return { ok: true };
  }
  const g = walletGate();
  if (!g.ok) return g;
  if (sub && sub.creator && sub.creator.address && !sameAddr(Wallet.address, sub.creator.address)) {
    return { ok: false, reason: "Only the creator wallet that made this submission can claim it." };
  }
  return { ok: true };
}

function anyWalletGate() {
  // For actions any connected wallet may legitimately do (e.g. submit work).
  if (isLocalDemo()) return { ok: true };
  return walletGate();
}

/* ---------- operation ids ---------- */

function opIdFor(key) {
  let id = ui.opIds.get(key);
  if (!id) {
    id = `ui-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    ui.opIds.set(key, id);
  }
  return id;
}
const UNCERTAIN_CODES = new Set([
  "tx_pending_reconcile", "operation_unknown_send_state", "operation_in_progress",
  "unreachable",
]);

const ERR_HINT = {
  tx_pending_reconcile: "A transaction is still confirming — re-checking state",
  operation_unknown_send_state: "The outcome of a previous send is unknown — re-read state before retrying",
  operation_in_progress: "This operation is already running on the server",
  operation_failed: "A previously recorded step of this operation failed on chain",
  chain_rejected: "The contract refused the transaction",
  not_campaign_sponsor: "Only the campaign sponsor can do this",
  not_submission_creator: "Only the submission creator can do this",
  invalid_deadline: "Deadline rejected",
};

/* ============================ render: header ============================ */

function renderChips() {
  const box = $("#envChips");
  box.replaceChildren();
  if (!ui.state) return;
  const s = ui.state;
  const net = h("span", { class: "chip net", title: s.chainId ? `chain id ${s.chainId}` : "" },
    h("span", { class: "dot" }), s.networkName || "network unknown");
  box.append(net);
  if (s.localDemo) {
    box.append(h("span", { class: "chip demo", title: s.actorNotice || "Local demonstration mode — demo actors, not real accounts" },
      h("span", { class: "dot" }), "Local demo"));
  } else if (s.mode === "public") {
    box.append(h("span", { class: "chip", title: "Public mode — the backend holds no keys; your wallet signs transactions" },
      h("span", { class: "dot" }), "Public · wallet-signed"));
  } else if (s.mode) {
    box.append(h("span", { class: "chip" }, h("span", { class: "dot" }), s.mode));
  }
  if (s.assetSymbol) {
    box.append(h("span", { class: "chip asset", title: s.assetAddress ? `${s.assetName || s.assetSymbol} · ${s.assetAddress}` : "campaign asset" },
      s.assetSymbol));
  }
  if (s.blockNumber !== null && s.blockNumber !== undefined) {
    box.append(h("span", { class: "chip", title: s.blockTime ? `latest block · ${s.blockTime}` : "latest block" },
      `block ${s.blockNumber}`));
  }
}

function renderWalletBox() {
  const box = $("#walletBox");
  const pub = isPublicMode();
  box.hidden = !pub;
  if (!pub) return;
  const id = $("#walletId"), btn = $("#walletBtn"), note = $("#walletNote");
  const connected = !!Wallet.address;
  const required = ui.state.chainId;
  const wrongChain = connected && required && Wallet.chainIdDec && Wallet.chainIdDec !== required;
  const chainKnown = connected && required && !Wallet.chainIdDec;
  id.hidden = !connected;
  if (connected) {
    $("#walletAddr").textContent = shortAddr(Wallet.address);
    $("#walletAddr").title = Wallet.address;
    $("#walletChain").textContent = Wallet.chainIdDec ? chainName(Wallet.chainIdDec, null) : "chain unknown";
    $("#walletSwitchBtn").hidden = !(wrongChain || chainKnown);
    $("#walletSwitchBtn").textContent = `Switch to ${chainName(required, "required chain")}`;
  }
  box.classList.toggle("wrong-chain", !!wrongChain);
  if (Wallet.available()) {
    btn.disabled = false;
    btn.textContent = connected ? "Wallet connected" : "Connect wallet";
    btn.title = connected ? Wallet.address : "Connect an EIP-1193 wallet to sign transactions";
    note.hidden = true;
  } else {
    btn.disabled = true;
    btn.textContent = "Connect wallet";
    btn.title = "";
    note.hidden = false;
    note.textContent = "No wallet provider detected — a compatible wallet browser or extension (EIP-1193) is required to sign transactions.";
  }
}

let actorPickerOptions = null;
function renderRoleControls() {
  const demo = isLocalDemo();
  const pub = isPublicMode();
  // Role switching exists in both modes: in local it picks the demo acting
  // role; in public it only changes presentation — the contract enforces the
  // actual wallet sender.
  $("#roleSwitch").hidden = !(demo || pub);
  const creators = creatorsForPicker();
  const showActor = demo && ui.role === "creator" && creators.length > 0;
  $("#actorPick").hidden = !showActor;
  const newBtn = $("#newCampaignBtn");
  newBtn.hidden = ui.role === "creator"; // sponsors own campaigns
  if (pub) {
    const g = walletGate();
    newBtn.disabled = !g.ok;
    newBtn.title = g.ok ? "" : g.reason;
  } else {
    newBtn.disabled = false;
    newBtn.title = "";
  }
  if (demo || pub) {
    $("#roleSponsor").classList.toggle("is-on", ui.role === "sponsor");
    $("#roleCreator").classList.toggle("is-on", ui.role === "creator");
    $("#roleSponsor").setAttribute("aria-pressed", String(ui.role === "sponsor"));
    $("#roleCreator").setAttribute("aria-pressed", String(ui.role === "creator"));
  }
  if (showActor) {
    const sel = $("#actorSelect");
    const keep = creators.some((a) => a.id === ui.actorId) ? ui.actorId : creators[0].id;
    ui.actorId = keep;
    const options = JSON.stringify(creators.map(a => [a.id, a.label, a.address]));
    if (options !== actorPickerOptions) {
      sel.replaceChildren(...creators.map((a) =>
        h("option", { value: a.id, text: `${a.label} (demo)${a.address ? " · " + shortAddr(a.address) : ""}`, selected: a.id === keep })));
      actorPickerOptions = options;
    }
    sel.value = keep;
  }
}

function setNotice(kind, text, withRetry) {
  const n = $("#notice");
  if (!text) { n.hidden = true; n.replaceChildren(); return; }
  n.className = `notice ${kind}`;
  n.replaceChildren(text);
  if (withRetry) {
    n.append(h("button", { type: "button", class: "btn small secondary", onClick: () => refresh(true) }, "Retry now"));
  }
  n.hidden = false;
}

function walletOpsPending() {
  for (const e of ui.walletOps.values()) {
    if (e.status === "sending" || e.status === "confirming") return true;
    if (e.txs.some((t) => t.txHash && !TX_FINAL.has(t.status))) return true;
  }
  return false;
}

function renderNotice() {
  if (!ui.state) { setNotice(null, null); return; }
  if (ui.staleError) {
    setNotice("error", `Connection lost; writes paused until successful refresh. Showing last confirmed state from ${ui.state.fetchedAt.toLocaleTimeString()}. ${ui.staleError}`, true);
  } else if (ui.state.pending) {
    setNotice("info", "A transaction is awaiting confirmation; the workspace refreshes automatically.");
  } else if (walletOpsPending()) {
    setNotice("info", "A wallet transaction is awaiting confirmation; the workspace keeps checking.");
  } else if (isLocalDemo()) {
    setNotice("info", `${ui.state.actorNotice || "Local demo actors — not authentication."} ${assetUnit()} is a non-monetary demo asset on ${ui.state.networkName || "the declared network"}.`);
  } else if (isPublicMode() && !Wallet.available()) {
    setNotice("warn", "Public mode — browsing works without a wallet, but every action needs an EIP-1193 wallet signature. No wallet provider was detected.");
   } else if(isPublicMode()&&Wallet.address&&ui.state.chainId&&Wallet.chainIdDec&&Wallet.chainIdDec!==ui.state.chainId){
   setNotice("warn",`Wrong network: wallet chain ${Wallet.chainIdDec}, required chain ${ui.state.chainId}. Switch before signing.`);
 } else if (isPublicMode() && !Wallet.address) {
    setNotice("info", "Public mode — connect a wallet to act. The Sponsor/Creator switch changes the view only; the contract enforces the actual wallet.");
  } else {
    setNotice(null, null);
  }
}

/* ============================ render: campaigns ============================ */

const CAMPAIGN_STATUS_TEXT = {
  open: "open",
  deadline_passed: "deadline passed",
  closed: "closed",
};

function campaignStatus(c) {
  const raw = (c.status || "").toLowerCase();
  if (/pend/.test(raw)) return "pending";
  if (c.closed) return "closed";
  return CAMPAIGN_STATUS_TEXT[raw] || raw ||
    (c.fundedAtomic !== null && !Amount.isZero(c.fundedAtomic) ? "funded" : "draft");
}

function statusPill(text) {
  const cls = String(text).toLowerCase().replace(/[^a-z]+/g, " ").trim().split(" ")[0];
  return h("span", { class: `pill ${cls}`, text: String(text).replace(/_/g, " ") });
}

function poolBalance(c) {
  const fields = ["fundedAtomic", "reservedAtomic", "paidAtomic", "refundedAtomic", "availableAtomic"];
  if (fields.some(key => c[key] === null || c[key] === undefined)) return { state: "incomplete" };
  const funded = BigInt(c.fundedAtomic), reserved = BigInt(c.reservedAtomic);
  const paid = BigInt(c.paidAtomic), refunded = BigInt(c.refundedAtomic), available = BigInt(c.availableAtomic);
  const committed = c.committedAtomic === null || c.committedAtomic === undefined ? null : BigInt(c.committedAtomic);
  const budget = c.budgetAtomic === null || c.budgetAtomic === undefined ? null : BigInt(c.budgetAtomic);
  if (funded !== reserved + paid + refunded + available ||
      (committed !== null && committed !== reserved + paid) ||
      (budget !== null && funded > budget)) return { state: "mismatch" };
  return { state: "balanced", funded, reserved, paid, refunded, available, budget };
}

function budgetMeter(c) {
  const model = poolBalance(c);
  const meter = h("div", { class: "meter", role: "img", "aria-label": "Pool allocation unavailable until complete on-chain readback" });
  if (model.state !== "balanced") return meter;
  const total = model.budget !== null ? model.budget : model.funded;
  if (total <= 0n) return meter;
  const pct = (atomic) => Number((atomic * 10000n) / total) / 100;
  const unfunded = total - model.funded;
  const parts = [
    ["m-paid", model.paid, "Claimed"],
    ["m-reserved", model.reserved, "Reserved"],
    ["m-refunded", model.refunded, "Refunded"],
    ["m-available", model.available, "Available"],
    ["m-unfunded", unfunded, "Not yet funded"],
  ];
  meter.setAttribute("aria-label", parts.map(([_, amount, name]) =>
    `${name}: ${fmtWithUnit(amount.toString(10))}`).join("; "));
  for (const [cls, amount, name] of parts) {
    const percent = Math.max(0, Math.min(100, pct(amount)));
    if (amount === 0n) continue;
    meter.append(h("span", { class: cls, title: `${name}: ${fmtWithUnit(amount.toString(10))}`, style: `width:${percent}%` }));
  }
  return meter;
}

function sponsorBudgetPanel(c) {
  if (ui.role !== "sponsor") return null;
  const m = poolBalance(c);
  const amounts = [
    ["Free to allocate", c.availableAtomic, c.closed ? "Campaign closed; this balance cannot approve new work." : "Funds not yet committed to creators; refundable on close."],
    ["Reserved for creators", c.reservedAtomic, "Approved work awaits creator-initiated claims, including after close."],
    ["Already claimed", c.paidAtomic, "Rewards paid out to creators, not remaining in the pool."],
    ["Returned to sponsor", c.refundedAtomic, "Unused funds returned by an on-chain campaign close."],
  ];
  const status = m.state === "balanced" ? "Allocation reconciles" :
    m.state === "incomplete" ? "Awaiting full readback" : "Check pool balances";
  const accounting = m.state === "balanced"
    ? `${fmtWithUnit(c.fundedAtomic)} funded = ${fmtWithUnit(c.reservedAtomic)} reserved + ${fmtWithUnit(c.paidAtomic)} claimed + ${fmtWithUnit(c.refundedAtomic)} refunded + ${fmtWithUnit(c.availableAtomic)} free.`
    : m.state === "incomplete"
    ? "Some pool balances are unavailable. Refresh to see the complete allocation; no missing value is treated as zero."
    : "The received balances do not reconcile with the recorded funded amount. Refresh before making a budget decision.";
  let decision = "The amount available for another approval is not yet known.";
  if (m.state === "balanced") {
    if (c.closed) {
      decision = `This campaign is closed. ${fmtWithUnit(c.reservedAtomic)} remains reserved for approved creators to claim.`;
    } else if (c.rewardAtomic !== null && c.rewardAtomic !== undefined && BigInt(c.rewardAtomic) > 0n) {
      const reward = BigInt(c.rewardAtomic);
      const affordable = m.available / reward;
      decision = `At ${fmtWithUnit(c.rewardAtomic)} per selection, the available balance covers up to ${affordable.toString(10)} more approval${affordable === 1n ? "" : "s"} by budget alone. Each approval moves that reward from free to reserved; it does not pay the creator yet. Closing instead refunds only the uncommitted ${fmtWithUnit(c.availableAtomic)}.`;
    } else {
      decision = `Closing now refunds the uncommitted ${fmtWithUnit(c.availableAtomic)}; ${fmtWithUnit(c.reservedAtomic)} remains claimable by approved creators.`;
    }
  }
  return h("section", { class: "sponsor-ledger", "aria-label": "Sponsor pool allocation and decisions" },
    h("div", { class: "sponsor-ledger-head" },
      h("h3", { text: "Where the campaign budget goes" }),
      h("span", { class: `sponsor-ledger-status ${m.state}`, text: status })),
    h("div", { class: "sponsor-ledger-legend" },
      amounts.map(([label, value, explanation]) => h("div", { class: "sponsor-ledger-item" },
        h("span", { class: "sponsor-ledger-label", text: label }),
        h("strong", { class: "sponsor-ledger-amount", text: fmtWithUnit(value) }),
        h("p", { text: explanation })))),
    h("p", { class: "sponsor-ledger-equation", text: accounting }),
    h("p", { class: "sponsor-ledger-decision", text: decision }),
    h("p", { class: "sponsor-ledger-footnote", text: "These are contract-reported balances in the selected network, not a wallet balance or a promise of a pending transaction. The campaign contract still enforces every approval, claim and close." }));
}

// Original contract readback controls eligibility; only a human chooses work.
function sponsorSelectionEligibility(c, s) {
  if (!c || !s || s.campaignId !== c.id) return { error: "Selection is missing from current state." };
  if (c.closed || s.status !== "submitted") return { error: "Only submitted work on an unclosed campaign may be approved." };
  const auth = sponsorGate(c);
  if (!auth.ok) return { error: auth.reason };
  const p = poolBalance(c);
  if (p.state !== "balanced") return { error: "Pool accounting is incomplete or inconsistent." };
  const reward = c.rewardAtomic === null ? 0n : BigInt(c.rewardAtomic);
  if (reward <= 0n) return { error: "Contract reward must be positive." };
  if (p.available < reward) return { error: "Insufficient available funds to reserve one reward." };
  return { free: p.available - reward, reserved: p.reserved + reward,
    fingerprint: JSON.stringify([ui.state.chainId, ui.state.assetAddress, ui.state.assetDecimals,
      c.id, c.sponsor, c.status, c.closed, c.rewardAtomic, c.fundedAtomic, c.availableAtomic,
      c.reservedAtomic, c.paidAtomic, c.refundedAtomic, s.id, s.status,
      s.creator && s.creator.address, s.metadataMatches, s.workUrl]) };
}

function sponsorApprovalReview(c, sub) {
  const panel = h("div", {}, h("p", { class: "action-note", text: "Reading original pool and submission state…" }));
  openDrawer("Sponsor work selection", panel);
  async function reload(note) {
    try {
      const state = normalizeState(await Api.getState());
      if (!panel.isConnected) return;
      ui.state = state; reconcileActor(); renderAll();
      const cc = state.campaigns.find(x => x.id === c.id);
      const ss = state.submissions.find(x => x.id === sub.id);
      const eligibility = sponsorSelectionEligibility(cc, ss);
      const view = [];
      if (note) view.push(h("p", { class: "action-note", role: "status", text: note }));
      if (eligibility.error) {
        view.push(h("p", { class: "action-note", role: "status", text: eligibility.error }));
      } else {
        const link = ss.metadataMatches === false ? null : safeHttpUrl(ss.workUrl);
        view.push(
          h("h3", { text: ss.metadataMatches === false ? "Submission details unavailable" : (ss.title || "Untitled work") }),
          h("p", { class: "muted small", text: "Campaign " + cc.id + " · submission " + ss.id }),
          h("p", { class: "muted small", text: "Creator " +
            (ss.creator && (ss.creator.address || ss.creator.label) || "not reported") }),
          link ? h("a", { href: link.href, target: "_blank", rel: "noopener noreferrer" }, "Inspect submitted work") :
            h("p", { class: "action-note", text: "The work link is unavailable. Review the original submission." }),
          h("div", { class: "sponsor-ledger-legend" },
            h("div", { class: "sponsor-ledger-item" }, "Available now: ",
              h("strong", { text: fmtWithUnit(cc.availableAtomic) })),
            h("div", { class: "sponsor-ledger-item" }, "Selecting reserves: ",
              h("strong", { text: fmtWithUnit(cc.rewardAtomic) })),
            h("div", { class: "sponsor-ledger-item" }, "Available after: ",
              h("strong", { text: fmtWithUnit(eligibility.free.toString()) })),
            h("div", { class: "sponsor-ledger-item" }, "Reserved after: ",
              h("strong", { text: fmtWithUnit(eligibility.reserved.toString()) }))),
          h("p", { class: "action-note", text: "Approval reserves the selected reward; it does NOT pay the creator. The creator claims separately, including after campaign close." })
        );
        const button = h("button", { type: "button", class: "btn primary",
          onClick: async () => {
            if (button.disabled) return;
            button.disabled = true;
            button.textContent = "Rechecking original state…";
            try {
              const latest = normalizeState(await Api.getState());
              if (!panel.isConnected) return;
              ui.state = latest; reconcileActor(); renderAll();
              const freshC = latest.campaigns.find(x => x.id === c.id);
              const freshS = latest.submissions.find(x => x.id === sub.id);
              const freshDecision = sponsorSelectionEligibility(freshC, freshS);
              if (freshDecision.error || freshDecision.fingerprint !== eligibility.fingerprint) {
                await reload("On-chain state or work details changed. Re-review before selecting.");
                return;
              }
              closeDrawer();
              await doApprove(freshC, freshS); // original idempotent contract and wallet path
            } catch (error) {
              if (panel.isConnected) await reload("Cannot confirm live state: " +
                (error && error.message || "unavailable") + ". Nothing approved.");
            } finally {
              if (button.isConnected) { button.disabled = false; button.textContent = "Confirm selection and reserve"; }
            }
          } }, "Confirm selection and reserve");
        view.push(button);
      }
      view.push(h("button", { type: "button", class: "btn ghost small",
        onClick: () => void reload() }, "Refresh balances"));
      view.push(h("button", { type: "button", class: "btn ghost small",
        onClick: closeDrawer }, "Keep unselected"));
      if (panel.isConnected) panel.replaceChildren(...view);
    } catch (error) {
      if (panel.isConnected) panel.replaceChildren(
        h("p", { role: "status", class: "action-note", text:
          "No action sent; source refresh failed: " + (error && error.message || "unavailable") }),
        h("button", { type: "button", class: "btn ghost", onClick: () => void reload() }, "Retry readback"),
        h("button", { type: "button", class: "btn ghost", onClick: closeDrawer }, "Keep unselected"));
    }
  }
  void reload();
}

function approvalReserveAction(c, sub) {
  return h("div", { class: "reserve-preview" },
    h("p", { class: "reserve-preview-copy", text: "Review work before reserving " +
      fmtWithUnit(c.rewardAtomic) + ". Selection never happens automatically." }),
    h("button", { type: "button", class: "btn primary small",
      "data-focus-key": "approve-review:" + sub.id,
      onClick: () => sponsorApprovalReview(c, sub) }, "Review selection"));
}

function figure(label, value, opts = {}) {
  return h("div", { class: `fig${opts.cls ? " " + opts.cls : ""}` },
    h("div", { class: "fig-label", text: label }),
    h("div", { class: `fig-value${opts.dim ? " dim" : ""}`, text: value }));
}

function campaignTitle(c) {
  return c.title || (c.metadataMatches === false ? "Details unavailable" : "Untitled campaign");
}

const campaignListView = { state: null, role: null, selected: null, cards: new Map() };
function updateCampaignSelection() {
  if (campaignListView.selected === ui.selectedCampaignId) return;
  for (const id of [campaignListView.selected, ui.selectedCampaignId]) {
    for (const card of campaignListView.cards.get(id) || []) {
      const selected = id === ui.selectedCampaignId;
      card.classList.toggle("selected", selected);
      card.setAttribute("aria-pressed", String(selected));
    }
  }
  campaignListView.selected = ui.selectedCampaignId;
}

function renderCampaignList() {
  const list = $("#campaignList"), s = ui.state;
  // Role/actor/detail changes do not change populated campaign cards. Keep
  // their nodes and keyboard position; a new API snapshot rebuilds the view.
  if (campaignListView.state === s &&
      (s.campaigns.length || campaignListView.role === ui.role)) {
    updateCampaignSelection();
    return;
  }
  list.replaceChildren();
  campaignListView.role = ui.role;
  campaignListView.selected = ui.selectedCampaignId;
  campaignListView.cards.clear();
  if (!s.campaigns.length) {
    const empty = h("div", { class: "empty-state" },
      svgDeco('<svg viewBox="0 0 56 56" width="46" height="46"><circle cx="28" cy="28" r="22" fill="none" stroke="currentColor" stroke-width="2.4" opacity=".45"/><path d="M28 18v20M19 24.5c0-2.5 4-4.5 9-4.5s9 2 9 4.5-3.5 4.1-9 5-9 2-9 5 4 4.5 9 4.5 9-2 9-4.5" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>'),
      h("h3", { text: "No campaigns yet" }),
      h("p", { text: ui.role === "creator"
        ? "The sponsor hasn't opened any campaigns. When a funded campaign exists it will appear here for submissions."
        : "Create a campaign, fund its pool on the declared network, then share it with creators." }),
      ui.role === "sponsor" ? h("button", { type: "button", class: "btn primary", onClick: openNewCampaign }, "Create the first campaign") : null);
    list.append(empty);
    campaignListView.state = s;
    return;
  }
  for (const c of s.campaigns) {
    const subs = campaignSubmissions(c.id);
    const approved = subs.filter((x) => /approved|reserved|claimed|paid/i.test(x.status)).length;
    const card = h("button", {
      type: "button",
      class: `campaign-card${c.id === ui.selectedCampaignId ? " selected" : ""}`,
      "data-campaign-id": c.id,
      onClick: () => { ui.selectedCampaignId = c.id; renderAll(); },
      "aria-pressed": c.id === ui.selectedCampaignId ? "true" : "false",
    },
      h("div", { class: "cc-top" },
        h("h3", { class: "cc-title", text: campaignTitle(c) }),
        statusPill(campaignStatus(c))),
      h("div", { class: "cc-meta" },
        c.rewardAtomic !== null ? h("span", {}, "Reward ", h("b", { text: fmtWithUnit(c.rewardAtomic) }), " / approval") : null,
        c.deadline ? h("span", {}, "Closes ", h("b", { text: fmtTime(c.deadline) })) : null),
      budgetMeter(c),
      h("div", { class: "cc-figures" },
        figure("Funded", fmt(c.fundedAtomic), { dim: Amount.isZero(c.fundedAtomic) }),
        figure("Reserved", fmt(c.reservedAtomic), { dim: Amount.isZero(c.reservedAtomic) }),
        figure("Paid", fmt(c.paidAtomic), { dim: Amount.isZero(c.paidAtomic) }),
        figure("Available", fmt(c.availableAtomic))),
      h("div", { class: "cc-foot" },
        h("span", { class: "cc-subs", text: `${subs.length} submission${subs.length === 1 ? "" : "s"}${approved ? ` · ${approved} approved` : ""}` }),
        h("span", { class: "muted small", text: "View →" })));
    if (!campaignListView.cards.has(c.id)) campaignListView.cards.set(c.id, []);
    campaignListView.cards.get(c.id).push(card);
    list.append(card);
  }
  campaignListView.state = s;
}

/* ============================ render: detail ============================ */

function captureDetailFocus(panel){
  const active=document.activeElement;
  if(!active || !panel.contains(active))return null;
  if(active.name){
    let start=null,end=null;
    try{start=active.selectionStart;end=active.selectionEnd}catch{}
    return {field:active.name,start,end};
  }
  const key=active.getAttribute("data-focus-key");
  return key?{key}:null;
}

function restoreDetailFocus(panel,snapshot,c){
  if(!snapshot)return;
  let target=null;
  if(snapshot.field){
    target=Array.from(panel.querySelectorAll("[name]")).find(el=>el.name===snapshot.field);
  }else if(snapshot.key){
    const keys=[snapshot.key];
    if(snapshot.key===`close-start:${c.id}`)keys.push(`close:${c.id}`);
    else if(snapshot.key===`cancel-close:${c.id}`)keys.push(`close-start:${c.id}`);
    target=Array.from(panel.querySelectorAll("[data-focus-key]")).find(el=>keys.includes(el.getAttribute("data-focus-key")));
  }
  if(!target || target.disabled || target.hidden)return;
  target.focus({preventScroll:true});
  if(snapshot.field && Number.isInteger(snapshot.start) && Number.isInteger(snapshot.end)){
    try{target.setSelectionRange(snapshot.start,snapshot.end)}catch{}
  }
}


function actionBusy(key) { return ui.inflight.has(key); }

function busyButton(key, label, cls, onClick, opts = {}) {
  const busy = actionBusy(key);
  const disabled = busy || opts.disabled;
  const btn = h("button", {
    type: "button",
    class: `btn ${cls || "secondary"}${opts.small ? " small" : ""}`,
    disabled,
    title: opts.title || null,
    "data-focus-key": key,
    onClick,
  });
  if (busy) btn.append(h("span", { class: "spin", "aria-hidden": "true" }), opts.busyLabel || "Working…");
  else btn.append(label);
  return btn;
}

function gateNote(gate) {
  return h("span", { class: "action-note", text: gate.reason || "Unavailable right now." });
}

function walletOpsFor(c) {
  const out = [];
  for (const e of ui.walletOps.values()) {
    if (!e.ref) continue;
    if (e.ref.campaignId === c.id) { out.push(e); continue; }
    if (e.ref.submissionId && campaignSubmissions(c.id).some((s) => s.id === e.ref.submissionId)) out.push(e);
  }
  return out;
}

const KIND_LABEL = {
  create: "Create campaign", fund: "Fund pool", submit: "Submit work",
  approve: "Approve submission", claim: "Claim reward", close: "Close campaign",
};

function walletEntryNode(entry) {
  const rows = entry.txs.map((tx, index) => h("li", { class: `wtx st-${tx.status.replace(/_/g, "-")}` },
    h("span", { class: "wtx-label", text: tx.label }),
    tx.txHash ? txLinkNode(tx.txHash) : h("span", { class: "wtx-hash muted", text: "—" }),
    h("span", { class: "wtx-st", text: TX_STATUS_TEXT[tx.status] || tx.status }),
    tx.detail ? h("span", { class: "wtx-detail muted", text: tx.detail }) : null,
    !tx.txHash && ["unsent_uncertain", "awaiting_wallet"].includes(tx.status)
      ? h("button", { type: "button", class: "btn secondary small",
          onClick: () => recoverWalletStep(entry.id, index) }, "Recover transaction")
      : null));
  const inProgress = !ENTRY_TERMINAL.has(entry.status) && entry.status !== "open" &&
    entry.txs.some((t) => !TX_FINAL.has(t.status));
  const resumable = !hasUnknownWalletSend(entry) && ["paused", "rejected", "waiting_chain"].includes(entry.status) &&
    entry.txs.some((t) => !TX_FINAL.has(t.status));
  return h("div", { class: `wallet-op st-${entry.status}` },
    h("div", { class: "wop-head" },
      h("span", { class: "wop-kind", text: `${KIND_LABEL[entry.kind] || entry.kind} · wallet signatures` }),
      h("span", { class: `pill ${entry.status === "done" ? "paid" : entry.status === "failed" || entry.status === "rejected" ? "failed" : "pending"}`,
        text: entry.status === "done" ? "confirmed" : entry.status === "confirming" ? "awaiting confirmation" : entry.status.replace(/_/g, " ") })),
    h("ul", { class: "wtx-list" }, rows),
    entry.lastError ? h("p", { class: "form-error", text: entry.lastError }) : null,
    resumable ? h("button", { type: "button", class: "btn secondary small",
      onClick: () => resumeWalletEntry(entry.id) }, "Resume signing") : null,
    entry.status === "confirming" && inProgress ? h("span", { class: "action-note", text: "Broadcast complete — checking receipts on each refresh." }) : null);
}

async function resumeWalletEntry(entryId) {
 if(ui.status!=="ready"||ui.staleError){toast("error","Refresh campaign state before resuming signing.");return;}
  const entry = ui.walletOps.get(entryId);
  if (!entry || ui.inflight.has(entryId)) return;
  ui.inflight.add(entryId);
  renderAll();
  try {
    await continueWalletEntry(entry);
    if (entry.status === "done") toast("ok", walletEntrySummary(entry));
    else toast("info", walletEntrySummary(entry));
    await refresh(false);
  } catch (err) {
    toast("error", err.message || "Wallet action did not complete.");
    await refresh(false);
  } finally {
    ui.inflight.delete(entryId);
    renderAll();
  }
}

function appBaseUrl() {
  const origin = location.origin && location.origin !== "null" ? location.origin : null;
  return origin ? origin + (location.pathname || "") : null;
}

function campaignLink(c, view) {
  const base = appBaseUrl();
  const params = new URLSearchParams();
  const api = new URLSearchParams(location.search).get("api");
  if (api) params.set("api", api);
  params.set("campaign", c.id);
  params.set("view", view || "creator");
  if (base) {
    const u = new URL(base);
    for (const [k, v] of params) u.searchParams.set(k, v);
    return u.toString();
  }
  // No real origin (e.g. file://) — a relative link still opens this app.
  return `${location.pathname || "index.html"}?${params.toString()}`;
}

function isLocalHost() {
  return /^(localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0)$/i.test(location.hostname || "");
}

function campaignLinkNode(c) {
  const url = campaignLink(c, "creator");
  const input = h("input", { class: "link-input mono", readonly: true, value: url,
    onFocus: (e) => e.target.select(), "aria-label": "Campaign link for creators" });
  return h("div", { class: "campaign-link" },
    h("div", { class: "campaign-link-row" },
      icon("link"),
      input,
      h("button", { type: "button", class: "btn secondary small", onClick: async (e) => {
        const btn = e.currentTarget;
        let ok = false;
        try {
          if (typeof navigator !== "undefined" && navigator.clipboard && navigator.clipboard.writeText) {
            await navigator.clipboard.writeText(url);
            ok = true;
          }
        } catch { ok = false; }
        if (!ok) { input.focus(); input.select(); }
        btn.textContent = ok ? "Copied" : "Select + copy";
        setTimeout(() => { if (btn.isConnected) btn.textContent = "Copy link"; }, 1800);
      } }, "Copy link"),
      h("a", { class: "btn ghost small", href: url, target: "_blank", rel: "noopener noreferrer" }, "Open")),
    h("p", { class: "link-note muted small", text: isLocalHost()
      ? "Opens this campaign in the creator view. This is a local app address — it works only where this app is reachable; it is not a public hosted link."
      : "Opens this campaign in the creator view, on this same app deployment." }));
}

let detailOverviewView = null;
function campaignOverview(c, status) {
  if (detailOverviewView?.state === ui.state && detailOverviewView.campaign === c) {
    return detailOverviewView;
  }
  // Keep the source-only overview across role/actor changes. Action gates,
  // wallet operations and creator forms are rebuilt from their current state.
  const nodes = [
    h("div", { class: "detail-head" },
      h("div", {},
        h("h2", { text: campaignTitle(c) }),
        h("div", { class: "detail-sub" },
          statusPill(status),
          c.deadline ? h("span", { title: `deadline (UTC): ${c.deadline}`, text: `Closes ${fmtTime(c.deadline)}` }) : null,
          c.sponsor ? h("span", { class: "mono", title: c.sponsor, text: `sponsor ${c.sponsorActor ? actorKeyLabel(c.sponsorActor) + " · " : ""}${shortAddr(c.sponsor)}` }) : null,
          c.createTx ? txLinkNode(c.createTx) : null,
          c.createdAt ? h("span", { text: `created ${fmtTime(c.createdAt)}` }) : null))),
    c.brief
      ? h("div", { class: "brief-box" }, h("span", { class: "brief-label", text: "Creative brief" }), c.brief)
      : (c.metadataMatches === false ? h("div", { class: "brief-box dim" }, h("span", { class: "brief-label", text: "Creative brief" }), "Details unavailable — the backend has no matching off-chain metadata for this campaign.") : null),
    h("div", { class: "budget-grid" },
      figure("Budget", fmt(c.budgetAtomic)),
      figure("Funded", fmt(c.fundedAtomic), { dim: Amount.isZero(c.fundedAtomic) }),
      c.unfundedAtomic !== null && !Amount.isZero(c.unfundedAtomic) ? figure("Unfunded", fmt(c.unfundedAtomic)) : null,
      figure("Reserved", fmt(c.reservedAtomic), { cls: c.reservedAtomic && !Amount.isZero(c.reservedAtomic) ? "accent" : "" }),
      figure("Available", fmt(c.availableAtomic), { cls: c.availableAtomic && !Amount.isZero(c.availableAtomic) ? "accent" : "" }),
      figure("Paid to creators", fmt(c.paidAtomic), { cls: c.paidAtomic && !Amount.isZero(c.paidAtomic) ? "good" : "" }),
      Amount.isZero(c.refundedAtomic) ? null : figure("Refunded", fmt(c.refundedAtomic))),
    c.remainingApprovals !== null ? h("p", { class: "muted small", text: `Room for ${c.remainingApprovals} more approval${c.remainingApprovals === "1" ? "" : "s"} at the current reward.` }) : null,
  ].filter(Boolean);
  const link = campaignLinkNode(c);
  detailOverviewView = { state: ui.state, campaign: c, nodes, link };
  return detailOverviewView;
}

function renderDetail() {
  const empty = $("#detailEmpty");
  const panel = $("#detailPanel");
  const c = ui.selectedCampaignId ? getCampaign(ui.selectedCampaignId) : null;
  if (!c) {
    if (ui.selectedCampaignId) ui.selectedCampaignId = null;
    panel.hidden = true;
    empty.hidden = false;
    return;
  }
  empty.hidden = true;
  panel.hidden = false;
  panel.className = "detail";
  // Preserve input and actionable-button keyboard focus across timed refresh.
  const focusSnapshot=captureDetailFocus(panel);
  panel.replaceChildren();

  const sponsorView = ui.role === "sponsor";
  const status = campaignStatus(c);
  const statusRaw = (c.status || "").toLowerCase();
  const isOpen = statusRaw === "open" || (!c.closed && !statusRaw);
  const canClose = sponsorView && !c.closed;
  const sg = sponsorGate(c);
  const gateBlocksSponsor = !sg.ok;

  const detailActions = [];
  if (sponsorView && !c.closed && isOpen) {
    if (c.fundedAtomic === null) {
      detailActions.push(h("span", { class: "action-note", text: "Pool funding status is unavailable. Refresh before funding." }));
    } else if (!decimalsKnown()) {
      detailActions.push(h("span", { class: "action-note", text: "Token precision is not reported by the backend — funding waits until asset decimals are known." }));
    } else {
      const remaining = c.unfundedAtomic !== null ? c.unfundedAtomic
        : (c.budgetAtomic !== null ? (BigInt(c.budgetAtomic) - BigInt(c.fundedAtomic)).toString(10) : null);
      const label = remaining !== null && !Amount.isZero(remaining)
        ? `Fund pool · ${fmtWithUnit(remaining)}`
        : `Fund pool`;
      if (remaining !== null && Amount.isZero(remaining)) {
        detailActions.push(h("span", { class: "action-note", text: "Fully funded." }));
      } else {
        detailActions.push(gateBlocksSponsor
          ? gateNote(sg)
          : busyButton(`fund:${c.id}`, label, "primary", () => doFund(c), { busyLabel: "Funding…" }));
      }
    }
  } else if (sponsorView && !c.closed && !isOpen) {
    detailActions.push(h("span", { class: "action-note", text: "The deadline has passed — no new funding or submissions; approvals and claims still work." }));
  }
  if (canClose && ui.confirmClose !== c.id) {
    detailActions.push(gateBlocksSponsor
      ? gateNote(sg)
      : h("button", { type: "button", class: "btn danger small", "data-focus-key": `close-start:${c.id}`, onClick: () => { ui.confirmClose = c.id; renderDetail(); } }, "Close campaign"));
  }
  if (canClose && ui.confirmClose === c.id) {
    const refundTxt = c.availableAtomic !== null ? fmtWithUnit(c.availableAtomic) : "an amount not yet reported";
    const reservedTxt = c.reservedAtomic !== null ? fmtWithUnit(c.reservedAtomic) : "reserved rewards";
    detailActions.push(h("span", { class: "action-note", text:
      `A confirmed close returns the unused ${refundTxt} to the sponsor wallet. ${reservedTxt} stays claimable by approved creators after close. The refund happens inside the close transaction itself.` }));
    detailActions.push(busyButton(`close:${c.id}`, "Confirm close", "danger small", () => doClose(c), { busyLabel: "Closing…" }));
    detailActions.push(h("button", { type: "button", class: "btn ghost small", "data-focus-key": `cancel-close:${c.id}`, onClick: () => { ui.confirmClose = null; renderDetail(); } }, "Keep open"));
  }

  const overview = campaignOverview(c, status);
  panel.append(...overview.nodes);
  const budgetPanel = sponsorBudgetPanel(c);
  if (budgetPanel) panel.append(budgetPanel);
  panel.append(h("div", { class: "detail-actions" }, detailActions), overview.link);

  /* wallet operations attached to this campaign */
  const wops = walletOpsFor(c);
  if (wops.length) {
    panel.append(h("div", { class: "wallet-ops" },
      h("h3", { text: "Wallet transactions" }),
      wops.map(walletEntryNode)));
  }

  /* submissions */
  panel.append(h("hr", { class: "hr" }), h("h3", { text: `Submissions (${campaignSubmissions(c.id).length})` }));
  const subs = campaignSubmissions(c.id);
  if (!subs.length) {
    panel.append(h("p", { class: "empty-line", text: ui.role === "creator"
      ? "No submissions yet — be the first to send work."
      : "Nothing submitted yet. Approvable work will appear here." }));
  } else {
    const list = h("div", { class: "sub-list" });
    for (const sub of subs) list.append(renderSubmission(c, sub));
    panel.append(list);
  }

  /* creator submit form — only while the campaign is actually open */
  if (ui.role === "creator" && isOpen) {
    panel.append(h("hr", { class: "hr" }), h("h3", { text: "Submit work" }), buildSubmissionForm(c));
  } else if (ui.role === "creator" && !isOpen) {
    panel.append(h("hr", { class: "hr" }), h("p", { class: "empty-line", text: c.closed ? "This campaign is closed to new work." : "The deadline has passed — this campaign is closed to new work." }));
  }

  restoreDetailFocus(panel,focusSnapshot,c);
}

function submissionIsMine(sub) {
  const me = currentActor();
  if (isLocalDemo()) {
    return !!(me && sub.creatorActor && me.id === sub.creatorActor) ||
      !!(me && me.address && sub.creator && sub.creator.address && sameAddr(me.address, sub.creator.address));
  }
  if (isPublicMode()) {
    return !!(Wallet.address && sub.creator && sub.creator.address && sameAddr(Wallet.address, sub.creator.address));
  }
  return !!(me && sub.creator && (
    sub.creator.id === me.id ||
    (sub.creator.address && me.address && sameAddr(sub.creator.address, me.address))));
}

function renderSubmission(c, sub) {
  const sponsorView = ui.role === "sponsor";
  const st = (sub.status || "").toLowerCase();
  const url = safeHttpUrl(sub.workUrl);
  const mine = submissionIsMine(sub);
  const approvedish = /^approved$|reserved/.test(st);
  const paidish = /claimed|paid|settled/.test(st);
  const submittedish = st === "submitted";

  let action = null;
  if (sponsorView && !c.closed && submittedish) {
    const balanceUnknown = c.availableAtomic === null || c.rewardAtomic === null;
    const underfunded = !balanceUnknown &&
      Amount.cmp(c.rewardAtomic, c.availableAtomic) > 0;
    const sg = sponsorGate(c);
    action = poolBalance(c).state !== "balanced"

      ? h("span", { class: "action-note", text: "Pool accounting must reconcile before approval." })

      : balanceUnknown
      ? h("span", { class: "action-note", text: "Waiting for the pool balance before approval." })
      : underfunded
      ? h("span", { class: "action-note", text: "Available budget is below the reward — cannot approve." })
      : !sg.ok
      ? gateNote(sg)
      : approvalReserveAction(c, sub);
  } else if (!sponsorView && approvedish && !paidish) {
    const cg = creatorGate(sub);
    const claimableByApi = sub.claimable !== undefined ? Boolean(sub.claimable) : true;
    if (claimableByApi && cg.ok) {
      action = busyButton(`claim:${sub.id}`, `Claim ${fmtWithUnit(c.rewardAtomic)}`, "primary small",
        () => doClaim(c, sub), { busyLabel: "Claiming…" });
    } else if (!cg.ok) {
      action = gateNote(cg);
    } else {
      action = h("span", { class: "action-note", text: "Not claimable yet." });
    }
  } else if (paidish) {
    // The backend emits "claimed" only after the claim transaction confirmed.
    action = h("span", { class: "action-note", text: sub.claimedAt ? `Paid ${fmtTime(sub.claimedAt)}` : "Paid" });
  }

  const txHash = sub.lastTx || sub.txHash;
  const card = h("div", { class: "sub-card" },
    h("div", { class: "sub-top" },
      h("div", {},
        h("h4", { class: "sub-title", text: sub.title || (sub.metadataMatches === false ? "Details unavailable" : "Untitled submission") }),
        h("div", { class: "sub-meta" },
          sub.creator ? h("span", { class: "mono", title: sub.creator.address || sub.creator.id, text: sub.creator.label }) : null,
          mine ? h("span", { class: "you-tag", text: "you" }) : null,
          sub.createdAt ? h("span", { text: fmtTime(sub.createdAt) }) : null)),
      statusPill(sub.status)),
    sub.notes ? h("p", { class: "sub-notes", text: sub.notes }) : null,
    url
      ? h("a", { class: "sub-link", href: url.href, target: "_blank", rel: "noopener noreferrer" }, icon("link"), url.host + (url.pathname === "/" ? "" : url.pathname))
      : (sub.workUrl ? h("span", { class: "sub-link plain", text: sub.workUrl }) : null),
    (action || txHash) ? h("div", { class: "sub-foot" },
      action || h("span"),
      txHash ? txLinkNode(txHash) : null) : null);
  return card;
}

/* ============================ render: forms ============================ */

function fieldWrap(labelText, control, opts = {}) {
  const label = h("label", { class: "field" },
    h("span", {}, labelText, opts.hint ? h("span", { class: "hint", text: " — " + opts.hint }) : null),
    control,
    h("span", { class: "err-text", hidden: true }));
  return label;
}
function setFieldError(fieldEl, msg) {
  const err = fieldEl.querySelector(".err-text");
  fieldEl.classList.toggle("invalid", Boolean(msg));
  if (err) { err.textContent = msg || ""; err.hidden = !msg; }
}

function amountInput(name) {
  const wrap = h("div", { class: "amount-wrap" });
  const input = h("input", {
    name, inputmode: "decimal", autocomplete: "off",
    placeholder: decimalsKnown() ? "0.00" : "precision unknown",
    required: true,
    disabled: !decimalsKnown(),
  });
  wrap.append(input, h("span", { class: "amount-unit", text: decimalsKnown() ? assetUnit() : "n/a" }));
  return { wrap, input };
}

// datetime-local can be interpreted in the sponsor's device timezone or explicitly as UTC; the chain receives ISO-8601 UTC.
function deadlineLocalToIso(v, mode = "UTC") {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?$/.test(v)) return null;
  const withSec = v.length === 16 ? v + ":00" : v;
  const ms = Date.parse(mode === "local" ? withSec : withSec + "Z");
  if (!Number.isFinite(ms)) return null;
  return new Date(ms).toISOString();
}

// The server requires: now+300s <= deadline <= now+400d.
function deadlineRangeError(iso, nowMs) {
  const s = Math.floor(Date.parse(iso) / 1000);
  const now = Math.floor((nowMs === undefined ? Date.now() : nowMs) / 1000);
  if (!Number.isFinite(s)) return "Enter a valid closing date and time.";
  if (s < now + 300) return "The deadline must be at least 5 minutes in the future.";
  if (s > now + 400 * 86400) return "The deadline must be within 400 days.";
  return null;
}

function buildNewCampaignForm() {
  const precisionKnown = decimalsKnown();
  const title = h("input", { name: "title", maxlength: "140", required: true, placeholder: "e.g. October product launch clips" });
  const brief = h("textarea", { name: "brief", maxlength: "4000", required: true, placeholder: "What should creators make? Deliverables, tone, required disclosures, do / don't." });
  const reward = amountInput("reward");
  const budget = amountInput("budget");
  const deadline = h("input", { name: "deadline", type: "datetime-local", required: true, step: "60" });
  const deadlineZone = h("select", { name: "deadlineZone", "aria-label": "Deadline input timezone" },
    h("option", { value: "local", text: "My device's local time" }),
    h("option", { value: "UTC", text: "UTC" }));
  const launchPlan = h("div", { class: "launch-plan", role: "status", "aria-live": "polite" });
  const echo = h("div", { class: "atomic-echo", "aria-live": "polite" });
  const dlEcho = h("div", { class: "atomic-echo", "aria-live": "polite" });
  const errBox = h("p", { class: "form-error", hidden: true });

  const fTitle = fieldWrap("Title", title);
  const fBrief = fieldWrap("Creative brief", brief, { hint: "shown to creators" });
  const fReward = fieldWrap("Reward per approved submission", reward.wrap,
    precisionKnown ? {} : { hint: "disabled until the backend reports token precision" });
  const fBudget = fieldWrap("Total pool budget", budget.wrap,
    precisionKnown ? {} : { hint: "disabled until the backend reports token precision" });
  const fDeadline = fieldWrap("Closing date and time", deadline, { hint: "The server requires 5 minutes to 400 days ahead." });
  const fDeadlineZone = fieldWrap("Interpret the closing time as", deadlineZone, { hint: "The exact UTC chain deadline appears below before creation." });


  // Only unsent sponsor fields are stored. This is never an authorization or
  // an on-chain record; choose an identity/asset-specific browser-tab key.
  const draftInputs = { title, brief, reward: reward.input, budget: budget.input, deadline, deadlineZone };
  const draftKey = [
    "creator-pool:sponsor-unsent-v1", ui.state.mode || "unknown",
    ui.state.chainId || "unknown", (ui.state.assetAddress || "").toLowerCase(),
    isPublicMode() ? (Wallet.address || "unconnected").toLowerCase() : "local-demo",
  ].join(":");
  const clearDraft = () => { try { sessionStorage.removeItem(draftKey); } catch {} };
  const saveDraft = () => {
    const data = Object.fromEntries(Object.entries(draftInputs).map(([key, element]) => [key, element.value]));
    try {
      if (Object.values(data).some((v) => v.trim())) sessionStorage.setItem(draftKey, JSON.stringify(data));
      else clearDraft();
    } catch { /* Form still works when tab storage is unavailable. */ }
  };
  try {
    const restored = JSON.parse(sessionStorage.getItem(draftKey) || "null");
    if (restored && typeof restored === "object" && !Array.isArray(restored)) {
      for (const [key, element] of Object.entries(draftInputs)) {
        if (typeof restored[key] !== "string") continue;
        if (key === "deadlineZone") {
          if (restored[key] === "local" || restored[key] === "UTC") element.value = restored[key];
        } else element.value = restored[key].slice(0, element.maxLength > 0 ? element.maxLength : 4000);
      }
    }
  } catch { /* Ignore damaged saved text. */ }
  for (const element of Object.values(draftInputs)) element.addEventListener("input", saveDraft);
  deadlineZone.addEventListener("change", saveDraft);
  const discardDraft = h("button", { type: "button", class: "btn ghost small", onClick: () => {
    for (const [key, element] of Object.entries(draftInputs)) element.value = key === "deadlineZone" ? "local" : "";
    clearDraft(); echoAtomic(); echoDeadline(); refreshPlan(); title.focus();
  } }, "Discard unsent draft");
  const draftControls = h("div", { class: "form-actions" }, discardDraft,
    h("span", { class: "hint", text: "This unsent proposal stays in this browser tab. Creating does not fund." }));

  function refreshPlan() {
    if (!precisionKnown) {
      launchPlan.textContent = "The live asset precision is unavailable. Budget preview is paused.";
      return;
    }
    try {
      const rewardAtomic = BigInt(Amount.parse(reward.input.value, formDecimals()));
      const budgetAtomic = BigInt(Amount.parse(budget.input.value, formDecimals()));
      if (rewardAtomic <= 0n || budgetAtomic <= 0n || rewardAtomic >= (1n << 128n) || budgetAtomic >= (1n << 128n)) {
        launchPlan.textContent = "Enter positive reward and budget amounts within the chain's range to preview this campaign.";
        return;
      }
      if (rewardAtomic > budgetAtomic) {
        launchPlan.textContent = "Increase the pool budget or lower the reward: one creator reward must fit inside the budget.";
        return;
      }
      const maxWinners = budgetAtomic / rewardAtomic;
      const leftover = budgetAtomic % rewardAtomic;
      const rewardLabel = fmtWithUnit(String(rewardAtomic));
      const remainderLabel = fmtWithUnit(String(leftover));
      launchPlan.replaceChildren(
        h("strong", { text: "Sponsor launch plan · if fully funded" }),
        h("p", { text: `Maximum ${maxWinners.toLocaleString("en-US")} approved creator ${maxWinners === 1n ? "piece" : "pieces"} at ${rewardLabel} each. Approvals reserve rewards; creators must claim their payouts.` }),
        h("p", { text: `Remaining after that many full rewards: ${remainderLabel}. Any still-uncommitted funding can be refunded when the campaign closes.` }),
        h("p", { class: "muted small", text: "Create records the campaign only. Funding is a separate transaction; this preview is a plan, not on-chain funding, awards or payments." })
      );
    } catch {
      launchPlan.textContent = "Enter a reward and total budget to preview how many pieces the pool can support.";
    }
  }

  function echoAtomic() {
    if (!precisionKnown) { echo.textContent = ""; return; }
    try {
      const r = Amount.parse(reward.input.value || "0", formDecimals());
      const b = Amount.parse(budget.input.value || "0", formDecimals());
      echo.textContent = `reward ${r} · budget ${b} (atomic)`;
      echo.style.color = "";
    } catch { echo.textContent = ""; }
  }
  function echoDeadline() {
    const iso = deadlineLocalToIso(deadline.value, deadlineZone.value);
    dlEcho.textContent = iso ? `On-chain close: ${iso} · your device: ${new Date(iso).toLocaleString()}` : "";
    dlEcho.style.color = "";
  }
  reward.input.addEventListener("input", echoAtomic);
  budget.input.addEventListener("input", echoAtomic);
  deadline.addEventListener("input", echoDeadline);
  deadlineZone.addEventListener("change", echoDeadline);
  reward.input.addEventListener("input", refreshPlan);
  budget.input.addEventListener("input", refreshPlan);
  refreshPlan();

  const form = h("form", { class: "stack", noValidate: false },
    fTitle, fBrief,
    h("div", { class: "field-row" }, fReward, fBudget),
    fDeadline, fDeadlineZone, dlEcho, echo, launchPlan, draftControls, errBox,
    h("div", { class: "form-actions" },
      h("button", { type: "submit", class: "btn primary", id: "createCampaignSubmit", disabled: !precisionKnown }, "Create campaign"),
      h("span", { class: "hint", text: precisionKnown ? "Metadata is created first — fund the pool next." : "Amount entry waits until the backend reports asset decimals." })));

  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    [fTitle, fBrief, fReward, fBudget, fDeadline].forEach((f) => setFieldError(f, null));
    errBox.hidden = true;
    let bad = false;
    if (!title.value.trim()) { setFieldError(fTitle, "Title is required."); bad = true; }
    if (!brief.value.trim()) { setFieldError(fBrief, "A short creative brief is required."); bad = true; }
    let deadlineIso = null;
    if (!deadline.value) { setFieldError(fDeadline, "Pick a closing date and time (UTC)."); bad = true; }
    else {
      deadlineIso = deadlineLocalToIso(deadline.value, deadlineZone.value);
      const rangeErr = deadlineIso ? deadlineRangeError(deadlineIso) : "Enter a valid date and time.";
      if (rangeErr) { setFieldError(fDeadline, rangeErr); bad = true; }
    }
    let rewardAtomic = null, budgetAtomic = null;
    if (!precisionKnown) { setFieldError(fReward, "Token precision is unknown — amounts can't be entered safely."); bad = true; }
    else {
      try { rewardAtomic = Amount.parse(reward.input.value, formDecimals()); if (rewardAtomic === "0") throw new Error("Reward must be greater than zero."); if (BigInt(rewardAtomic) >= (1n << 128n)) throw new Error("Reward exceeds the chain limit."); }
      catch (e) { setFieldError(fReward, e.message); bad = true; }
      try { budgetAtomic = Amount.parse(budget.input.value, formDecimals()); if (budgetAtomic === "0") throw new Error("Budget must be greater than zero."); if (BigInt(budgetAtomic) >= (1n << 128n)) throw new Error("Budget exceeds the chain limit."); }
      catch (e) { setFieldError(fBudget, e.message); bad = true; }
      if (!bad && rewardAtomic && budgetAtomic && Amount.cmp(rewardAtomic, budgetAtomic) > 0) {
        setFieldError(fReward, "Reward can't exceed the total budget."); bad = true;
      }
    }
    if (bad) return;
    await runAction(`create`, async () => {
      return await Api.createCampaign({
        title: title.value.trim(), brief: brief.value.trim(),
        rewardAtomic, budgetAtomic, deadline: deadlineIso,
        operationId: opIdFor("create"),
      });
    }, {
      busy: ["createCampaignSubmit"],
      ok: (res) => `Campaign created${res && res.campaign && res.campaign.id ? ` · #${res.campaign.id}` : ""}.`,
      okConfirmed: "Campaign created and confirmed on chain.",
      meta: { kind: "create" },
      onDone: (res) => {
        if (!isUnsignedResponse(res) || ui.walletOps.get("create")?.status === "done") clearDraft();
        closeDrawer();
        if (res && res.campaign && res.campaign.id) ui.selectedCampaignId = str(res.campaign.id);
      },
      onConfirmed: () => {
        if (ui.walletOps.get("create")?.status === "done") clearDraft();
        // After a wallet-signed create, select the campaign whose create tx
        // we broadcast.
        const entry = ui.walletOps.get("create");
        if (entry && ui.state) {
          const hashes = entry.txs.map((t) => t.txHash).filter(Boolean);
          const found = ui.state.campaigns.find((cc) => cc.createTx && hashes.includes(cc.createTx));
          if (found) {
            ui.selectedCampaignId = found.id;
            entry.ref.campaignId = found.id;
            journalSave();
          }
        }
      },
    });
    if (ui.lastError) { errBox.textContent = ui.lastError; errBox.hidden = false; }
  });
  return form;
}


const CREATOR_DRAFT_PREFIX = "creator-pool:work:v1";
function creatorDraftShape(v) {
  const d = v && typeof v === "object" ? v : {};
  return {
    title: typeof d.title === "string" ? d.title.slice(0, 140) : "",
    workUrl: typeof d.workUrl === "string" ? d.workUrl.slice(0, 2048) : "",
    notes: typeof d.notes === "string" ? d.notes.slice(0, 1000) : "",
  };
}
function creatorDraftEqual(a, b) {
  return JSON.stringify(creatorDraftShape(a)) === JSON.stringify(creatorDraftShape(b));
}
function creatorDraftKey(c, actor) {
  const net = ui.state && ui.state.chainId || "unknown-chain";
  const pool = ui.state && ui.state.contracts && ui.state.contracts.pool || "unknown-pool";
  const who = isLocalDemo() ? "demo:" + (actor || ui.actorId || "unknown")
    : isPublicMode() ? "wallet:" + (Wallet.address || "unconnected").toLowerCase() : "session";
  return [CREATOR_DRAFT_PREFIX, encodeURIComponent(net),
    encodeURIComponent(pool.toLowerCase()), encodeURIComponent(c.id),
    encodeURIComponent(who)].join(":");
}
function readCreatorDraft(key) {
  try {
    const raw = localStorage.getItem(key);
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && parsed.version === 1 ? creatorDraftShape(parsed.data) : null;
  } catch { return null; }
}
function storeCreatorDraft(key, data) {
  try {
    localStorage.setItem(key, JSON.stringify({ version: 1,
      savedAt: new Date().toISOString(), data: creatorDraftShape(data) }));
    return true;
  } catch { return false; }
}
function removeCreatorDraft(key) {
  try { localStorage.removeItem(key); } catch {}
}
function validCreatorWorkUrl(raw) {
  const value = typeof raw === "string" ? raw.trim() : "";
  if (value.length < 8 || value.length > 2048) return null;
  const parsed = safeHttpUrl(value);
  if (!parsed || parsed.username || parsed.password || !parsed.hostname) return null;
  const hostname = parsed.hostname.toLowerCase();
  if (hostname === "localhost" || hostname.endsWith(".local") ||
    hostname === "[::1]" || /^127\./.test(hostname) || /^10\./.test(hostname) ||
    /^192\.168\./.test(hostname) || /^172\.(1[6-9]|2[0-9]|3[01])\./.test(hostname)) return null;
  return parsed;
}
window.addEventListener("beforeunload", (event) => {
  for (const [key, draft] of ui.drafts) {
    if (!creatorDraftEqual(draft, readCreatorDraft(key))) {
      event.preventDefault();
      event.returnValue = "";
      break;
    }
  }
});


function buildSubmissionForm(c) {
  const demo = isLocalDemo();
  const pub = isPublicMode();
  const creators = creatorsForPicker();
  const me = currentActor();
  const gate = anyWalletGate();
  const title = h("input", { name: "title", maxlength: "140", required: true,
    placeholder: "What did you make?" });
  const url = h("input", { name: "workUrl", type: "url", maxlength: "2048",
    required: true, placeholder: "https://…", inputmode: "url" });
  const notes = h("textarea", { name: "notes", maxlength: "1000",
    placeholder: "Delivery context for the sponsor (optional)", style: "min-height:84px" });
  const errBox = h("p", { class: "form-error", hidden: true });
  const draftStatus = h("p", { class: "small muted", role: "status", "aria-live": "polite" });
  const preview = h("div", { class: "brief-box", role: "status", "aria-live": "polite" });
  const saveBtn = h("button", { type: "button", class: "btn secondary small" }, "Save draft locally");
  const discardBtn = h("button", { type: "button", class: "btn ghost small" }, "Discard draft");
  const sendBtn = h("button", { type: "submit", class: "btn primary", id: "submitWorkBtn" }, "Send submission");

  let creatorField;
  if (demo && creators.length > 1) {
    const sel = h("select", { name: "creator", required: true },
      creators.map((a) => h("option", { value: a.id,
        text: `${a.label} (demo)${a.address ? " · " + shortAddr(a.address) : ""}`,
        selected: me && a.id === me.id })));
    creatorField = fieldWrap("Submitting as (demo actor, not authentication)", sel);
    creatorField.sel = sel;
  } else if (demo && creators.length === 1) {
    creatorField = h("p", { class: "small muted",
      text: `Submitting as ${creators[0].label} (demo)` });
    creatorField.sel = { value: creators[0].id };
  } else if (pub) {
    creatorField = h("p", { class: "small muted", text: Wallet.address
      ? `Submitting as the connected wallet · ${shortAddr(Wallet.address)}`
      : "Connect a wallet before submitting; the view switch does not authorize payments." });
    creatorField.sel = { value: null };
  } else {
    creatorField = h("p", { class: "small muted", text: "Submitting as the session creator." });
    creatorField.sel = { value: null };
  }

  const fTitle = fieldWrap("Work title", title, { hint: "up to 140 characters" });
  const fUrl = fieldWrap("Public work URL", url, { hint: "a live http(s) link the sponsor can access" });
  const fNotes = fieldWrap("Delivery notes", notes, { hint: "optional, up to 1000 characters" });
  const key = creatorDraftKey(c, creatorField.sel.value);
  let saveFailed = false;
  const value = () => creatorDraftShape({ title: title.value, workUrl: url.value, notes: notes.value });
  function fill(keyToRead) {
    const d = ui.drafts.has(keyToRead) ? ui.drafts.get(keyToRead) : readCreatorDraft(keyToRead);
    const restored = creatorDraftShape(d);
    title.value = restored.title;
    url.value = restored.workUrl;
    notes.value = restored.notes;
  }
  function fieldProblem() {
    if (!title.value.trim() || title.value.trim().length > 140) return "Add a work title (up to 140 characters).";
    if (!validCreatorWorkUrl(url.value)) return "Enter a public http(s) URL with no credentials or local/private network address.";
    if (notes.value.trim().length > 1000) return "Keep notes under 1000 characters.";
    return null;
  }
  function drawPreview() {
    const saved = readCreatorDraft(key);
    const current = value();
    const dirty = !creatorDraftEqual(current, saved);
    const hasContent = !!(current.title || current.workUrl || current.notes || saved);
    const invalid = fieldProblem();
    const parsed = validCreatorWorkUrl(url.value);
    saveBtn.disabled = !dirty;
    discardBtn.disabled = !hasContent;
    sendBtn.disabled = !gate.ok || !!invalid || ui.inflight.has(`submit:${c.id}`);
    sendBtn.title = !gate.ok ? gate.reason : invalid || "";
    draftStatus.textContent = saveFailed
      ? "Local browser storage is unavailable. Unsaved changes remain only in this tab."
      : dirty ? "Unsaved changes in this tab. Choose Save draft locally before leaving."
      : saved ? "Saved on this device for this campaign and creator. Not submitted."
      : "No saved draft. Nothing has been sent.";
    const status = !gate.ok ? gate.reason : invalid
      ? invalid : "Ready for submission. Only the sponsor can approve a reward.";
    preview.replaceChildren(
      h("strong", { text: "Creator handoff preview" }),
      h("p", { class: "small", text: status }),
      parsed ? h("a", { href: parsed.href, target: "_blank", rel: "noopener noreferrer",
        class: "sub-link", text: parsed.href })
        : h("p", { class: "small muted", text: "No valid public work link to preview." }),
      h("p", { class: "small muted",
        text: "Submitted work is anchored to a content hash. Later edits require a new submission; sending never approves an award or pays a reward." })
    );
  }
  function changed() {
    ui.drafts.set(key, value());
    saveFailed = false;
    drawPreview();
  }
  fill(key);
  [title, url, notes].forEach((field) => field.addEventListener("input", changed));
  if (typeof creatorField.sel.addEventListener === "function") {
    creatorField.sel.addEventListener("change", () => {
      // Both demo pickers share the actor used by draft restoration and claims.
      ui.actorId = creatorField.sel.value;
      renderAll();
    });
  }
  saveBtn.addEventListener("click", () => {
    ui.drafts.set(key, value());
    saveFailed = !storeCreatorDraft(key, value());
    drawPreview();
  });
  discardBtn.addEventListener("click", () => {
    if (!window.confirm("Discard this local draft? Submitted work and rewards are unchanged.")) return;
    ui.drafts.delete(key);
    removeCreatorDraft(key);
    title.value = "";
    url.value = "";
    notes.value = "";
    saveFailed = false;
    drawPreview();
  });
  if (ui.formError && ui.formError.campaignId === c.id) {
    errBox.textContent = ui.formError.msg;
    errBox.hidden = false;
    ui.formError = null;
  }
  const form = h("form", { class: "stack", noValidate: true },
    creatorField, fTitle, fUrl, fNotes, draftStatus,
    h("div", { class: "form-actions" }, saveBtn, discardBtn),
    preview, errBox,
    h("div", { class: "form-actions" }, sendBtn,
      gate.ok ? null : h("span", { class: "hint", text: gate.reason })));
  drawPreview();

  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    [fTitle, fUrl, fNotes].forEach((field) => setFieldError(field, null));
    errBox.hidden = true;
    let bad = false;
    if (!title.value.trim() || title.value.trim().length > 140) {
      setFieldError(fTitle, "Work title must be 1–140 characters."); bad = true;
    }
    if (!validCreatorWorkUrl(url.value)) {
      setFieldError(fUrl, "Enter a public http(s) URL without login credentials or private hosts."); bad = true;
    }
    if (notes.value.trim().length > 1000) {
      setFieldError(fNotes, "Keep delivery notes within 1000 characters."); bad = true;
    }
    if (!gate.ok) bad = true;
    if (bad) { errBox.textContent = "Complete the highlighted fields to submit."; errBox.hidden = false; return; }

    const actorObj = demo && creatorField.sel.value
      ? (ui.state.actors.find((a) => a.id === creatorField.sel.value) || null)
      : null;
    const sendingKey = key, snapshot = value();
    function clearConfirmed() {
      if (creatorDraftEqual(ui.drafts.get(sendingKey), snapshot)) ui.drafts.delete(sendingKey);
      if (creatorDraftEqual(readCreatorDraft(sendingKey), snapshot)) removeCreatorDraft(sendingKey);
    }
    await runAction(`submit:${c.id}`, async () => {
      const body = {
        title: snapshot.title.trim(), workUrl: snapshot.workUrl.trim(),
        notes: snapshot.notes.trim(), operationId: opIdFor(`submit:${c.id}`),
      };
      if (demo) body.creator = submissionCreatorParam(actorObj);
      return await Api.createSubmission(c.id, body);
    }, {
      ok: "Submission recorded on chain; sponsor review follows.",
      okConfirmed: "Submission confirmed on chain; sponsor review follows.",
      meta: { kind: "submit", campaignId: c.id },
      busy: ["submitWorkBtn"],
      onDone: (res) => {
        if (res && res.submission && res.submission.id) clearConfirmed();
      },
      onConfirmed: (entry) => {
        if (entry.status === "done") clearConfirmed();
      },
    });
    if (ui.lastError) {
      ui.formError = { campaignId: c.id, msg: ui.lastError };
      renderAll();
    }
    // Pending/rejected/uncertain transactions retain their draft.
  });
  return form;
}

/* ============================ render: operations + timeline ============================ */

const OP_STATUS_TEXT = {
  pending: "transaction awaiting confirmation",
  unknown_send_state: "send outcome unknown — re-read state before retrying; do not start a new operation for the same intent",
  failed: "operation failed",
};

function opRow(op) {
  const statusText = OP_STATUS_TEXT[op.status] || op.status.replace(/_/g, " ");
  return h("li", { class: `op-row st-${op.status.replace(/_/g, "-")}` },
    h("div", { class: "op-main" },
      h("span", { class: "op-kind", text: KIND_LABEL[op.kind] || op.kind }),
      h("span", { class: "op-status", text: statusText }),
      op.error ? h("span", { class: "op-err", text: typeof op.error === "string" ? op.error : JSON.stringify(op.error) }) : null),
    op.txHashes && op.txHashes.length
      ? h("div", { class: "op-txs" }, op.txHashes.map((t) => txLinkNode(t)))
      : null);
}

function walletOpRow(entry) {
  return h("li", { class: `op-row st-${entry.status}` }, walletEntryNode(entry));
}

function renderOperations() {
  const block = $("#opsBlock");
  const list = $("#opsList");
  if (!block || !list) return;
  const ops = ui.state ? ui.state.operations : [];
  const globalWalletOps = [...ui.walletOps.values()].filter((e) => !e.ref || !e.ref.campaignId);
  const active = ops.filter((o) => o.status !== "done");
  const rows = [];
  for (const o of active) rows.push(opRow(o));
  for (const e of globalWalletOps) {
    if (!ENTRY_TERMINAL.has(e.status) || e.status === "rejected" || e.status === "paused") rows.push(walletOpRow(e));
  }
  block.hidden = rows.length === 0;
  list.replaceChildren(...rows);
}

const EVENT_LABELS = {
  campaigncreated: "Campaign created", campaign_created: "Campaign created", created: "Campaign created", create: "Campaign created",
  campaignfunded: "Pool funded", campaign_funded: "Pool funded", funded: "Pool funded", fund: "Pool funded", deposit: "Pool funded",
  submissioncreated: "Work submitted", submission_created: "Work submitted", submission: "Work submitted", submitted: "Work submitted",
  submissionapproved: "Submission approved", submission_approved: "Submission approved", approved: "Submission approved", approve: "Submission approved", reserved: "Reward reserved",
  rewardclaimed: "Reward claimed", reward_claimed: "Reward claimed", claimed: "Reward claimed", claim: "Reward claimed", paid: "Reward paid", payout: "Reward paid",
  campaignclosed: "Campaign closed", campaign_closed: "Campaign closed", closed: "Campaign closed", close: "Campaign closed",
  refunded: "Funds refunded", refund: "Funds refunded",
};

function eventKind(type) {
  if (/fund|deposit/.test(type)) return "fund";
  if (/submit/.test(type)) return "submission";
  if (/approv|reserv/.test(type)) return "approve";
  if (/claim/.test(type)) return "claim";
  if (/paid|payout|settle/.test(type)) return "paid";
  if (/refund/.test(type)) return "refund";
  if (/clos/.test(type)) return "close";
  if (/creat|open/.test(type)) return "created";
  return "event";
}
function eventIconName(kind) {
  return { fund: "fund", created: "created", submission: "submission", approve: "approve", reserve: "approve", claim: "claim", paid: "paid", refund: "refund", close: "close" }[kind] || "event";
}

let timelineState;
function renderTimeline() {
  // The timeline depends on the confirmed snapshot, not the selected role,
  // actor or campaign. Fresh API observations always replace this identity.
  if (timelineState === ui.state) return;
  const tl = $("#timeline");
  const emptyEl = $("#timelineEmpty");
  tl.replaceChildren();
  const events = ui.state ? ui.state.events.slice(0, 40) : [];
  emptyEl.hidden = events.length > 0;
  const total = ui.state ? ui.state.events.length : 0;
  const block = ui.state && ui.state.blockNumber !== null ? ` · block ${ui.state.blockNumber}` : "";
  $("#activityMeta").textContent = total ? `${total} event${total === 1 ? "" : "s"} reported by the backend${block}` : "";
  const campaignTitleFor = (id) => {
    const c = id && getCampaign(id);
    return c ? campaignTitle(c) : null;
  };
  for (const e of events) {
    const kind = eventKind(e.type);
    const label = e.label || EVENT_LABELS[e.type] || e.rawType.replace(/[_-]+/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2");
    const ctx = campaignTitleFor(e.campaignId) || (e.campaignId ? `campaign ${e.campaignId}` : null);
    const subCtx = e.submissionId ? `submission ${e.submissionId}` : null;
    // Ledger rows carry no wall time — show the block reference instead of an
    // invented timestamp.
    const when = e.at ? fmtTime(e.at)
      : e.blockNumber !== null && e.blockNumber !== undefined ? `block ${e.blockNumber}`
      : "";
    const amount = e.amountAtomic !== null ? e.amountAtomic : e.refundedAtomic;
    tl.append(h("li", {},
      h("span", { class: `tl-dot ${kind}` }, icon(eventIconName(kind))),
      h("div", { class: "tl-body" },
        h("div", { class: "tl-title", text: label }),
        h("div", { class: "tl-sub" },
          ctx ? h("span", { text: ctx }) : null,
          subCtx ? h("span", { text: subCtx }) : null,
          e.actor ? h("span", { class: "mono", title: e.actor, text: shortAddr(e.actor) }) : null,
          e.txHash ? txLinkNode(e.txHash) : null,
          e.status && /pend/i.test(e.status) ? h("span", { text: "pending" }) : null)),
      h("div", { class: "tl-amt" },
        amount !== null ? fmtWithUnit(amount) : "",
        h("span", { class: "tl-time", text: when }))));
  }
  timelineState = ui.state;
}

/* ============================ drawer / toast ============================ */

function nextDrawerTabTarget(items,active,backwards){
  if(!items.length)return null;
  if(backwards && (active===items[0] || !items.includes(active)))return items[items.length-1];
  if(!backwards && (active===items[items.length-1] || !items.includes(active)))return items[0];
  return null;
}

function handleDrawerKeys(event) {
  const dialog=$("#drawer");
  if(dialog.hidden)return;
  if(event.key==="Escape"){
    event.preventDefault();
    closeDrawer();
    return;
  }
  if(event.key!=="Tab")return;
  const focusables=Array.from(dialog.querySelectorAll('a[href],button:not([disabled]),input:not([disabled]),textarea:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])'))
    .filter(el=>!el.hidden && !el.closest("[hidden]") && el.getClientRects().length>0);
  if(!focusables.length){
    event.preventDefault();
    dialog.focus({preventScroll:true});
    return;
  }
  const next=nextDrawerTabTarget(focusables,document.activeElement,event.shiftKey);
  if(next){
    event.preventDefault();
    next.focus({preventScroll:true});
  }
}

let drawerReturnFocus=null;

function openDrawer(title,node){
  const dialog=$("#drawer");
  if(!dialog.hidden)return;
  drawerReturnFocus=document.activeElement;
  $("#drawerTitle").textContent=title;
  $("#drawerBody").replaceChildren(node);
  dialog.hidden=false;
  $("#drawerScrim").hidden=false;
  // The modal alone is interactive; the campaign workspace and header
  // cannot receive keyboard or assistive-tech focus until it is closed.
  $("#main").inert=true;
  $(".top").inert=true;
  $("#notice").inert=true;
  const first=$("#drawerBody").querySelector("input:not([disabled]),textarea:not([disabled]),select:not([disabled]),button:not([disabled])");
  (first||$("#drawerClose")).focus({preventScroll:true});
}
function closeDrawer(){
  const dialog=$("#drawer");
  if(dialog.hidden)return;
  dialog.hidden=true;
  $("#drawerScrim").hidden=true;
  $("#main").inert=false;
  $(".top").inert=false;
  $("#notice").inert=false;
  const prior=drawerReturnFocus;
  drawerReturnFocus=null;
  const target=prior && prior.isConnected && !prior.disabled ? prior : $("#newCampaignBtn");
  if(target && !target.disabled)target.focus({preventScroll:true});
}
function openNewCampaign() {
  openDrawer("New campaign", buildNewCampaignForm());
}

function toast(kind, text) {
  const box = $("#toasts");
  const t = h("div", { class: `toast ${kind}`, role: "status" },
    h("span", { text }),
    h("button", { type: "button", "aria-label": "Dismiss", onClick: () => t.remove() }, "×"));
  box.append(t);
  setTimeout(() => { if (t.isConnected) t.remove(); }, kind === "error" ? 9000 : 5000);
}

/* ============================ actions ============================ */

async function runAction(key, fn, opts = {}) {
 if(ui.status!=="ready"||ui.staleError){toast("error","Refresh stale campaign state before a new operation.");return;}
  if (ui.inflight.has(key)) return; // identical action already in flight
  ui.inflight.add(key);
  ui.lastError = null;
  (opts.busy || []).forEach((id) => { const el = document.getElementById(id); if (el) { el.disabled = true; } });
  renderDetail();
  let afterRefresh = null;
  try {
    const res = await fn();
    if (isUnsignedResponse(res)) {
      // HTTP 202: the backend prepared unsigned transactions — NOT success.
      // The wallet must sign/broadcast each in order, then reconcile.
      let entry = ui.walletOps.get(key);
      if (entry) entry = journalMerge(entry, res);
      else { entry = journalNew(key, opts.meta || {}, res); ui.walletOps.set(key, entry); }
      journalSave();
      await continueWalletEntry(entry); // throws precisely on rejection/failure
      if (entry.status === "done") toast("ok", opts.okConfirmed || walletEntrySummary(entry));
      else toast("info", walletEntrySummary(entry));
      ui.confirmClose = null;
      if (opts.onDone) opts.onDone(res);
      if (opts.onConfirmed) afterRefresh = () => opts.onConfirmed(entry);
    } else if (res && res.replayed) {
      applyMaybeState(res);
      toast("info", "This operation was already processed — showing the recorded result, not a new action.");
      ui.confirmClose = null;
      if (opts.onDone) opts.onDone(res);
    } else {
      applyMaybeState(res);
      if (opts.ok) toast("ok", typeof opts.ok === "function" ? opts.ok(res) : opts.ok);
      ui.confirmClose = null;
      if (opts.onDone) opts.onDone(res);
    }
    ui.opIds.delete(key);
    await refresh(false);
    if (afterRefresh) afterRefresh();
  } catch (err) {
    const hint = err && err.code && ERR_HINT[err.code];
    const detail = err && typeof err.detail === "string" ? err.detail : null;
    ui.lastError = hint
      ? `${hint}${detail ? `: ${detail}` : err.message && err.message !== err.code ? `: ${err.message}` : ""}.`
      : (err && err.message ? err.message : "The request failed.");
    // Keep the operationId only while the send outcome is uncertain — reusing
    // it re-reads the server's stored operation instead of double-sending.
    if (!(err && err.code && UNCERTAIN_CODES.has(err.code))) ui.opIds.delete(key);
    toast("error", ui.lastError);
    await refresh(false); // resync whatever the backend did record
  } finally {
    ui.inflight.delete(key);
    (opts.busy || []).forEach((id) => { const el = document.getElementById(id); if (el) { el.disabled = false; } });
    renderAll();
  }
}

function applyMaybeState(res) {
  if (!res || typeof res !== "object") return;
  const candidate = res.state && typeof res.state === "object" ? res.state : res;
  if (Array.isArray(candidate.campaigns) || Array.isArray(candidate.submissions)) {
    ui.state = normalizeState(candidate);
    reconcileActor();
  }
}

async function doFund(c) {
  await runAction(`fund:${c.id}`, () => Api.fundCampaign(c.id, { operationId: opIdFor(`fund:${c.id}`) }),
    { ok: "Pool funded.", okConfirmed: "Funding confirmed on chain.", meta: { kind: "fund", campaignId: c.id } });
}
async function doApprove(c, sub) {
  await runAction(`approve:${sub.id}`, () => Api.approveSubmission(sub.id, { operationId: opIdFor(`approve:${sub.id}`) }),
    { ok: `Approved — ${fmtWithUnit(c.rewardAtomic)} reserved.`, okConfirmed: `Approval confirmed — ${fmtWithUnit(c.rewardAtomic)} reserved.`, meta: { kind: "approve", campaignId: c.id, submissionId: sub.id } });
}
async function doClaim(c, sub) {
  await runAction(`claim:${sub.id}`, () => Api.claimSubmission(sub.id, {
    actor: isLocalDemo() ? (sub.creatorActor || (currentActor() && currentActor().id) || undefined) : undefined,
    operationId: opIdFor(`claim:${sub.id}`),
  }), { ok: "Reward claimed.", okConfirmed: `Claim confirmed — ${fmtWithUnit(c.rewardAtomic)} paid.`, meta: { kind: "claim", campaignId: c.id, submissionId: sub.id } });
}
async function doClose(c) {
  await runAction(`close:${c.id}`, () => Api.closeCampaign(c.id, { operationId: opIdFor(`close:${c.id}`) }),
    { ok: (res) => res && res.refundedAtomic !== undefined && res.refundedAtomic !== null
        ? `Campaign closed — ${fmtWithUnit(res.refundedAtomic)} refunded to the sponsor wallet.`
        : "Campaign closed.",
      okConfirmed: "Close confirmed on chain — unused funds refunded; approved rewards stay claimable.",
      meta: { kind: "close", campaignId: c.id } });
}

/* ============================ load / refresh ============================ */

function reconcileActor() {
  if (!ui.state) return;
  if (!ui.state.localDemo) { ui.actorId = null; return; }
  const actors = ui.state.actors;
  if (actors.length && !actors.some((a) => a.id === ui.actorId)) {
    const first = actors.find((a) => a.role === "creator") || actors[0];
    ui.actorId = first.id;
  }
  if (ui.selectedCampaignId && !ui.state.campaigns.some((c) => c.id === ui.selectedCampaignId)) {
    ui.selectedCampaignId = null;
  }
}

function applyBootLink() {
  // ?campaign=<id>&view=<sponsor|creator> — a real shareable link into this
  // app. Applied once, from the page URL only, after first successful state.
  if (ui.linkApplied || !ui.state || !ui.bootLink) return;
  ui.linkApplied = true;
  const p = ui.bootLink;
  if (p.view === "creator" || p.view === "sponsor") ui.role = p.view;
  if (p.campaign) {
    if (getCampaign(p.campaign)) {
      ui.selectedCampaignId = p.campaign;
    } else {
      toast("info", `The linked campaign (${p.campaign}) is not in the current state.`);
    }
  }
}

async function reconcilePendingWalletOps() {
  // Retry receipt/reconcile passes for broadcast-but-unresolved wallet txs.
  // Never re-sends anything — steps without a hash need a user resume.
  let attempted = false;
  for (const entry of ui.walletOps.values()) {
    if (ENTRY_TERMINAL.has(entry.status)) continue;
    if (!entry.txs.some((t) => t.txHash && !TX_FINAL.has(t.status))) continue;
    attempted = true;
    try { await reconcileWalletEntry(entry); } catch { /* keep state; retry next pass */ }
  }
  return attempted;
}

async function refresh(userInitiated){
  const ticket=++ui.refreshSeq;
  try{
    const raw=await Api.getState(),fresh=normalizeState(raw);
    if(ticket!==ui.refreshSeq)return;
    ui.state=fresh;ui.status="ready";ui.staleError=null;
    reconcileActor();applyBootLink();
  }catch(err){
    if(ticket!==ui.refreshSeq)return;
    if(ui.state)ui.staleError=err?.message||"Refresh failed.";
    else{ui.status="offline";ui.offlineDetail=`${err?.message||"Backend unavailable"} (${Api.base||"same origin"}/api/state)`;}
  }
  renderAll();
  if(userInitiated&&ui.status==="ready"&&!ui.staleError)toast("ok","State refreshed.");
  if(ui.status==="ready"&&!ui.staleError)void reconcilePendingWalletOps().then(attempted=>{if(attempted)renderAll();});
}

function renderAll() {
  const activeCard=document.activeElement && $("#campaignList").contains(document.activeElement)
    ? document.activeElement.getAttribute("data-campaign-id") : null;
  const ready = ui.status === "ready" && ui.state;
  $("#appLoading").hidden = ui.status !== "loading";
  $("#appOffline").hidden = ui.status !== "offline";
  if (ui.status === "offline" && ui.offlineDetail) $("#offlineDetail").textContent = ui.offlineDetail;
  $("#appMain").hidden = !ready;
  if (!ready) { renderChips(); renderWalletBox(); return; }
  renderChips();
  renderWalletBox();
  renderRoleControls();
  renderNotice();
  renderCampaignList();
  if(activeCard){
    const replacement=Array.from($("#campaignList").querySelectorAll("[data-campaign-id]"))
      .find(el=>el.getAttribute("data-campaign-id")===activeCard);
    if(replacement)replacement.focus({preventScroll:true});
  }
  renderDetail();
  renderOperations();
  renderTimeline();
}

/* ============================ boot ============================ */

function schedulePoll() {
  // Gentle refresh loop: faster while anything is pending, idle when the tab
  // is hidden or a write is in flight.
  const tick = async () => {
    if (document.visibilityState === "visible" && !ui.inflight.size) await refresh(false);
    const delay = (ui.state && ui.state.pending) || walletOpsPending() ? ui.pollMsPending : ui.pollMs;
    setTimeout(tick, delay);
  };
  setTimeout(tick, ui.pollMs);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && ui.status === "ready") refresh(false);
  });
}

function wireChrome() {
  $("#refreshBtn").addEventListener("click", () => refresh(true));
  $("#retryBtn").addEventListener("click", () => { ui.status = "loading"; renderAll(); refresh(true); });
  $("#newCampaignBtn").addEventListener("click", openNewCampaign);
  $("#drawerClose").addEventListener("click", closeDrawer);
  $("#drawerScrim").addEventListener("click", closeDrawer);
  document.addEventListener("keydown", handleDrawerKeys);
  $("#roleSponsor").addEventListener("click", () => { ui.role = "sponsor"; renderAll(); });
  $("#roleCreator").addEventListener("click", () => { ui.role = "creator"; renderAll(); });
  $("#actorSelect").addEventListener("change", (e) => { ui.actorId = e.target.value; renderAll(); });
  $("#walletBtn").addEventListener("click", async () => {
    try {
      await Wallet.connect();
      toast("ok", `Wallet connected · ${shortAddr(Wallet.address)}`);
    } catch (err) {
      toast("error", walletErrText(err, "Wallet connection did not complete."));
    }
    renderAll();
  });
  $("#walletSwitchBtn").addEventListener("click", async () => {
    const required = ui.state && ui.state.chainId;
    if (!required) return;
    try {
      await Wallet.ensureChain(required);
      toast("ok", `Wallet switched to ${chainName(required, "the required network")}.`);
    } catch (err) {
      toast("error", walletErrText(err));
    }
    renderAll();
  });
}

window.addEventListener("DOMContentLoaded", () => {
  // Read the share-link params from the real page URL once, at boot.
  const params = new URLSearchParams(location.search);
  const campaign = params.get("campaign");
  const view = params.get("view");
  if (campaign || view) ui.bootLink = { campaign, view };

  wireChrome();
  renderAll();
  Wallet.refresh().then(() => {
    Wallet.wireEvents(() => { renderAll(); void reconcilePendingWalletOps().then(attempted=>{if(attempted)renderAll();}); });
    renderAll();
  });
  refresh(false);
  schedulePoll();
});
