// SF87: original Soroban simulation -> bounded operator assessment.
// Importable with Node 22+, and directly accepts the official Stellar SDK's
// DiagnosticEvent XDR serialization. Never broadcasts or signs transactions.
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const CONTRACT = /^C[A-Z2-7]{55}$/;
const ACCOUNT = /^[GC][A-Z2-7]{55}$/;
const POSITIVE = /^[1-9][0-9]*$/;
const NONNEGATIVE = /^(?:0|[1-9][0-9]*)$/;
const FINANCIAL_SYMBOLS = new Set(["transfer", "mint", "burn", "clawback", "approve", "increase_allowance", "decrease_allowance"]);
const I128_MAX = 170141183460469231731687303715884105727n;
const MAX_EVENTS = 512;
const MAX_FILE_BYTES = 1_048_576;

function plain(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function boundedInteger(value, label, allowZero = false) {
  if (typeof value !== "string" || value.length > 18 ||
      !(allowZero ? NONNEGATIVE : POSITIVE).test(value)) {
    throw new TypeError(label + " must be an exact bounded decimal string");
  }
  const result = BigInt(value);
  if (result > 999_999_999_999n) throw new RangeError(label + " is too large");
  return result;
}
function positiveAtomic(value) {
  return typeof value === "string" && value.length <= 39 &&
    POSITIVE.test(value) && BigInt(value) <= I128_MAX;
}
function canonicalAmount(value) {
  let amount = value;
  if (amount instanceof Map) {
    if (![...amount.keys()].every(k => k === "amount" || k === "to_muxed_id") ||
        amount.get("to_muxed_id") != null) return null;
    amount = amount.get("amount");
  } else if (plain(amount)) {
    if (!Object.hasOwn(amount, "amount") ||
        Object.keys(amount).some(k => k !== "amount" && k !== "to_muxed_id") ||
        amount.to_muxed_id != null) return null;
    amount = amount.amount;
  }
  if (typeof amount === "bigint") amount = amount.toString();
  if (typeof amount === "number") {
    if (!Number.isSafeInteger(amount)) return null;
    amount = String(amount);
  }
  return positiveAtomic(amount) ? amount : null;
}

function validateCapture(capture) {
  if (!plain(capture) || !plain(capture.source) || !plain(capture.expected) ||
      !plain(capture.simulation) || !plain(capture.fee))
    throw new TypeError("source, expected, simulation and fee objects are required");
  const expected = capture.expected;
  if (expected.network !== "stellar:testnet" || !CONTRACT.test(expected.asset) ||
      !ACCOUNT.test(expected.payer) || !ACCOUNT.test(expected.payTo) ||
      !positiveAtomic(expected.amount)) {
    throw new TypeError("exact Stellar testnet asset, payer, recipient and i128 atomic amount required");
  }
  if (expected.payer === expected.payTo) throw new TypeError("payer and payTo cannot coincide");
  if (!Array.isArray(expected.approvedPolicyContracts) ||
      expected.approvedPolicyContracts.length > 8 ||
      expected.approvedPolicyContracts.some(x => !CONTRACT.test(x)) ||
      new Set(expected.approvedPolicyContracts).size !== expected.approvedPolicyContracts.length ||
      expected.approvedPolicyContracts.includes(expected.asset)) {
    throw new TypeError("explicit unique non-asset policy contract allowlist required (zero to eight)");
  }
  if (!Array.isArray(capture.simulation.events) ||
      capture.simulation.events.length < 1 || capture.simulation.events.length > MAX_EVENTS) {
    throw new TypeError("one to " + MAX_EVENTS + " original simulation events required");
  }
  const min = boundedInteger(String(capture.simulation.minResourceFee), "minResourceFee", true);
  const inclusion = boundedInteger(capture.fee.inclusionFeeStroops, "inclusionFeeStroops");
  const cap = boundedInteger(capture.fee.operatorMaxTransactionFeeStroops,
    "operatorMaxTransactionFeeStroops");
  return { expected, min, inclusion, cap };
}

/** Normalize actual DiagnosticEvent XDR with the native official SDK. */
export async function decodeOriginalXdrEvents(eventXdrs, stellarSdk) {
  if (!Array.isArray(eventXdrs) || eventXdrs.length > MAX_EVENTS) {
    throw new TypeError("Invalid diagnostic events array");
  }
  const sdk = stellarSdk ?? await import("@stellar/stellar-sdk");
  return eventXdrs.map((encoded, index) => {
    if (typeof encoded !== "string" || encoded.length < 8 || encoded.length > 262144 ||
        encoded.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded) ||
        Buffer.from(encoded, "base64").toString("base64") !== encoded) {
      throw new TypeError("Noncanonical original DiagnosticEvent XDR at index " + index);
    }
    const diagnostic = sdk.xdr.DiagnosticEvent.fromXDR(encoded, "base64");
    const event = diagnostic.event();
    if (event.type().name !== "contract") return { type: event.type().name };
    const contractHash = event.contractId();
    if (!contractHash) throw new TypeError("Missing event contract ID at " + index);
    const contractId = sdk.Address.fromScAddress(
      sdk.xdr.ScAddress.scAddressTypeContract(contractHash)
    ).toString();
    const body = event.body().v0();
    const topics = body.topics();
    if (!topics.length || topics[0].switch().name !== "scvSymbol")
      throw new TypeError("Unrecognized event topic at " + index);
    const name = topics[0].sym().toString();
    const values = topics.slice(1).map(value => {
      const native = sdk.scValToNative(value);
      return typeof native === "string" ? native : null;
    });
    const amount = name === "transfer" ? canonicalAmount(sdk.scValToNative(body.data())) : null;
    return { type: "contract", contractId, name, topics: values, amount };
  });
}

/**
 * Inspect normalized Soroban events, rejecting every non-allowlisted extra
 * contract event. This is a simulation compatibility gate, not payment proof.
 * Only the original facilitator can verify the signed auth and settle.
 */
export function assessDecodedEvents(events, capture) {
  const { expected, min, inclusion, cap } = validateCapture({
    ...capture, simulation: { ...capture.simulation, events },
  });
  const result = {
    status: "BLOCKED", reason: null, canSettleNow: false,
    source: "CALLER_SUPPLIED_SIMULATION_EVENTS_NOT_A_SETTLEMENT",
    asset: expected.asset, payer: expected.payer, payTo: expected.payTo,
    amountAtomic: expected.amount, eventCount: events.length, transferCount: 0,
    acceptedPolicyEvents: [], fee: {
      minimumResourceStroops: min.toString(),
      inclusionStroops: inclusion.toString(),
      requiredTotalStroops: (min + inclusion).toString(),
      operatorMaximumStroops: cap.toString(),
      referenceDefaultMaximumStroops: "50000"
    }
  };
  function reject(reason) { result.reason = reason; return result; }
  const policySet = new Set(expected.approvedPolicyContracts);
  const policyCount = new Map();
  for (const event of events) {
    if (!plain(event)) return reject("EVENT_MALFORMED");
    if (event.type !== "contract") {
      if (event.type === "system" || event.type === "diagnostic") continue;
      return reject("UNEXPECTED_EVENT_TYPE");
    }
    if (!CONTRACT.test(event.contractId) || typeof event.name !== "string" ||
        !Array.isArray(event.topics)) return reject("CONTRACT_EVENT_MALFORMED");

    if (event.contractId !== expected.asset) {
      if (FINANCIAL_SYMBOLS.has(event.name)) return reject("SIDE_FINANCIAL_EVENT");
      if (event.name !== "spending_limit_enforced" ||
          !policySet.has(event.contractId) ||
          event.topics.length !== 1 || event.topics[0] !== expected.payer)
        return reject("UNAPPROVED_NON_ASSET_EVENT");
      const count = (policyCount.get(event.contractId) || 0) + 1;
      if (count > 1) return reject("DUPLICATE_POLICY_EVENT");
      policyCount.set(event.contractId, count);
      result.acceptedPolicyEvents.push({ contractId: event.contractId, name: event.name });
      continue;
    }
    if (event.name !== "transfer" || event.topics.length !== 2 ||
        event.topics[0] !== expected.payer || event.topics[1] !== expected.payTo)
      return reject("ASSET_EVENT_NOT_EXACT_TRANSFER");
    if (event.amount !== expected.amount) return reject("TRANSFER_AMOUNT_MISMATCH");
    result.transferCount += 1;
    if (result.transferCount > 1) return reject("MULTIPLE_ASSET_TRANSFERS");
  }
  if (result.transferCount !== 1) return reject("EXPECTED_ASSET_TRANSFER_MISSING");
  if (min + inclusion > cap) return reject("SIMULATED_FEE_EXCEEDS_OPERATOR_CAP");
  result.status = result.acceptedPolicyEvents.length ?
    "EVENT_COMPATIBLE_UPSTREAM_PATCH_REQUIRED" : "EVENT_SHAPE_COMPATIBLE";
  result.reason = result.acceptedPolicyEvents.length ?
    "REFERENCE_FACILITATOR_REJECTS_NON_TRANSFER_POLICY_EVENT" :
    "SIGNED_AUTH_AND_FINALITY_NOT_CHECKED";
  return result;
}

function reportMarkdown(result) {
  return [
    "# Stellar x402 smart-account compatibility review",
    "",
    "**Status:** " + result.status,
    "**Reason:** " + result.reason,
    "**Original capture SHA-256:** " + result.originalCaptureSha256,
    "**Transfer:** " + result.transferCount + " matching exact asset event",
    "**Policy events:** " + result.acceptedPolicyEvents.length + " explicitly allowlisted",
    "**Simulated resource + inclusion fee (stroops):** " + result.fee.requiredTotalStroops,
    "**Operator-authorized fee ceiling (stroops):** " + result.fee.operatorMaximumStroops,
    "",
    "This is an OFFLINE PRE-SETTLEMENT simulation check. It is NOT a receipt,",
    "an auth-signature check, an actual transaction, or proof of paid delivery.",
    "For the policy case, upstream @x402/stellar's current reference validator",
    "must be fixed while retaining exact asset-transfer protections. Its",
    "50,000-stroop default is independently insufficient for higher-cost smart accounts;",
    "any fee adjustment requires explicit operator approval.",
    "",
    "Original issue: https://github.com/x402-foundation/x402/issues/3764",
    "Actual upstream file: https://github.com/x402-foundation/x402/blob/main/typescript/packages/mechanisms/stellar/src/exact/facilitator/scheme.ts",
    ""
  ].join("\n");
}

/** Analyze a captured file, never post data or make any HTTP/payment request. */
export async function reviewCaptureFile(fileName, { outputDirectory } = {}) {
  const raw = await readFile(fileName);
  if (raw.length > MAX_FILE_BYTES) throw new RangeError("Capture exceeds 1 MiB");
  const input = JSON.parse(raw.toString("utf8"));
  validateCapture(input);
  const decoded = await decodeOriginalXdrEvents(input.simulation.events);
  const result = assessDecodedEvents(decoded, input);
  result.originalCaptureSha256 = createHash("sha256").update(raw).digest("hex");
  result.sourceLabel = String(input.source.label ?? "").slice(0, 120);
  result.captureKind = "ORIGINAL_STELLAR_SDK_DIAGNOSTIC_EVENT_XDR";
  if (outputDirectory) {
    const dir = resolve(outputDirectory);
    await mkdir(dir, { recursive: true, mode: 0o700 });
    await writeFile(resolve(dir, "policy-review.json"), JSON.stringify(result, null, 2) + "\n",
      { flag: "wx", mode: 0o600 });
    await writeFile(resolve(dir, "policy-review.md"), reportMarkdown(result),
      { flag: "wx", mode: 0o600 });
  }
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  if (!args.length || args.includes("--help") || args.includes("-h")) {
    console.log("Usage: node compat.mjs <original-simulation.json> [--out-dir <new-directory>]");
  } else {
    const at = args.indexOf("--out-dir");
    if (at >= 0 && (at !== 1 || !args[at + 1] || args.length !== 3)) {
      console.error("Expected: <file> --out-dir <directory>");
      process.exitCode = 2;
    } else if (at < 0 && args.length !== 1) {
      console.error("Expected a single capture filename");
      process.exitCode = 2;
    } else {
      reviewCaptureFile(args[0], { outputDirectory: at < 0 ? undefined : args[at + 1] })
        .then(value => {
          console.log(JSON.stringify(value, null, 2));
          if (value.status === "BLOCKED") process.exitCode = 1;
        }).catch(error => { console.error(error.message); process.exitCode = 2; });
    }
  }
}
