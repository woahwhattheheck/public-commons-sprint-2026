import { createHash } from "node:crypto";
import { PRESETS, findPreset } from "./catalog.mjs";

export const SCHEMA = "meteora-dbc-preset-studio/v1";
const EDITABLE = new Set(["tokenSupply", "initialMarketCap", "migrationMarketCap",
  "startingFeeBps", "endingFeeBps", "creatorTradingFeePercentage",
  "creatorLiquidityPercent", "lockedLiquidityPercent"]);

function checkNumber(value, key, min, max) {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min || value > max) {
    throw new TypeError(key + " must be an integer between " + min + " and " + max);
  }
}
export function validateInput(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new TypeError("Expected object");
  for (const key of Object.keys(input)) {
    if (key !== "presetId" && key !== "overrides") throw new TypeError("Unexpected field: " + key);
  }
  const preset = findPreset(input.presetId);
  if (!preset) throw new TypeError("Unknown presetId");
  const overrides = input.overrides ?? {};
  if (!overrides || typeof overrides !== "object" || Array.isArray(overrides)) throw new TypeError("Bad overrides");
  for (const key of Object.keys(overrides)) if (!EDITABLE.has(key)) throw new TypeError("Unsafe override: " + key);
  const p = { ...preset, ...overrides };
  checkNumber(p.tokenSupply, "tokenSupply", 1000, 1000000000);
  if (!Number.isSafeInteger(p.tokenSupply * 1e6)) throw new TypeError("Unsafe atomic token supply");
  checkNumber(p.initialMarketCap, "initialMarketCap", 1, 999999999);
  checkNumber(p.migrationMarketCap, "migrationMarketCap", 2, 1000000000);
  if (p.migrationMarketCap <= p.initialMarketCap) throw new TypeError("Graduation cap must exceed initial cap");
  checkNumber(p.startingFeeBps, "startingFeeBps", 0, 1000);
  checkNumber(p.endingFeeBps, "endingFeeBps", 0, 1000);
  if (p.endingFeeBps > p.startingFeeBps) throw new TypeError("Increasing fee schedules unsupported");
  checkNumber(p.creatorTradingFeePercentage, "creatorTradingFeePercentage", 0, 100);
  checkNumber(p.creatorLiquidityPercent, "creatorLiquidityPercent", 0, 90);
  checkNumber(p.lockedLiquidityPercent, "lockedLiquidityPercent", 10, 100);
  if (p.creatorLiquidityPercent + p.lockedLiquidityPercent > 100) throw new TypeError("LP shares exceed 100%");
  if (p.quoteSymbol !== "USDC" || p.quoteDecimals !== 6) throw new TypeError("USDC quote only");
  return Object.freeze(p);
}
export function assessTradeoffs(p) {
  const notes = [];
  if (p.migrationMarketCap / p.initialMarketCap >= 10) notes.push("Wide market-cap range: review SDK swap slippage and graduation assumptions.");
  if (p.startingFeeBps >= 300) notes.push("Initial base fee is at least 3%; evaluate trader friction.");
  if (p.creatorTradingFeePercentage > 0) notes.push("Creator takes part of the trading fee; disclose recipient economics.");
  if (p.lockedLiquidityPercent < 25) notes.push("Less than one-quarter of LP allocation is permanently locked.");
  notes.push("These are example economic inputs, not a promised sale price, raise amount or investment result.");
  notes.push("The workbench never connects a wallet, sends RPC, signs a transaction or creates a pool.");
  return notes;
}
function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    const out = Object.create(null);
    for (const k of Object.keys(value).sort()) out[k] = stable(value[k]);
    return out;
  }
  return value;
}
export function hashConfig(value) {
  return createHash("sha256").update(JSON.stringify(stable(value))).digest("hex");
}
export function jsonFromSdk(value) {
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.map(jsonFromSdk);
  if (value && typeof value === "object") {
    if (value.constructor?.name === "BN" || value.constructor?.name === "PublicKey") return value.toString();
    if (value instanceof Uint8Array) return Array.from(value);
    const out = Object.create(null);
    for (const [k, v] of Object.entries(value)) if (v !== undefined) out[k] = jsonFromSdk(v);
    return out;
  }
  if (typeof value === "number" && !Number.isFinite(value)) throw new TypeError("Nonfinite SDK config value");
  return value;
}
function buildOptions(p, sdk) {
  const decreasing = p.startingFeeBps !== p.endingFeeBps;
  return {
    token: {
      tokenType: sdk.TokenType.SPLToken, tokenBaseDecimal: sdk.TokenDecimal.SIX,
      tokenQuoteDecimal: p.quoteDecimals, tokenAuthorityOption: sdk.TokenAuthorityOption.Immutable,
      totalTokenSupply: p.tokenSupply, leftover: 0
    },
    fee: {
      baseFeeParams: {
        baseFeeMode: sdk.BaseFeeMode.FeeSchedulerLinear,
        feeSchedulerParam: {
          startingFeeBps: p.startingFeeBps, endingFeeBps: p.endingFeeBps,
          numberOfPeriod: decreasing ? 10 : 0,
          totalDuration: decreasing ? 86400 : 0
        }
      },
      dynamicFeeEnabled: false, collectFeeMode: sdk.CollectFeeMode.QuoteToken,
      creatorTradingFeePercentage: p.creatorTradingFeePercentage,
      poolCreationFee: 1, enableFirstSwapWithMinFee: false
    },
    migration: {
      migrationOption: sdk.MigrationOption.MET_DAMM_V2,
      migrationFeeOption: sdk.MigrationFeeOption.FixedBps100,
      migrationFee: { feePercentage: 0, creatorFeePercentage: 0 }
    },
    liquidityDistribution: {
      partnerLiquidityPercentage: 100 - p.creatorLiquidityPercent - p.lockedLiquidityPercent,
      partnerPermanentLockedLiquidityPercentage: p.lockedLiquidityPercent,
      creatorLiquidityPercentage: p.creatorLiquidityPercent,
      creatorPermanentLockedLiquidityPercentage: 0
    },
    lockedVesting: {
      totalLockedVestingAmount: 0, numberOfVestingPeriod: 0,
      cliffUnlockAmount: 0, totalVestingDuration: 0,
      cliffDurationFromMigrationTime: 0
    },
    activationType: sdk.ActivationType.Slot,
    initialMarketCap: p.initialMarketCap, migrationMarketCap: p.migrationMarketCap
  };
}
export async function compilePreset(input) {
  const preset = validateInput(input);
  // First-party SDK math; intentionally no home-grown curve implementation.
  const sdk = await import("@meteora-ag/dynamic-bonding-curve-sdk");
  if (typeof sdk.buildCurveWithMarketCap !== "function") throw new Error("DBC SDK export missing");
  const config = jsonFromSdk(sdk.buildCurveWithMarketCap(buildOptions(preset, sdk)));
  if (!config || !config.migrationQuoteThreshold || !Array.isArray(config.curve) || !config.curve.length) {
    throw new Error("SDK returned an incomplete curve config");
  }
  return {
    schema: SCHEMA, sdkPackage: "@meteora-ag/dynamic-bonding-curve-sdk",
    sdkVersion: "1.5.13", preset, migration: "DAMM v2",
    unsigned: true, walletOrTradePerformed: false,
    sdkConfig: config, configSha256: hashConfig(config),
    migrationQuoteThresholdAtomic: String(config.migrationQuoteThreshold),
    notes: assessTradeoffs(preset)
  };
}
export function catalog() {
  return PRESETS.map((preset) => ({ ...preset, notes: assessTradeoffs(preset) }));
}
