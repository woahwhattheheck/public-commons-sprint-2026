/** Public contract of the merchant tariff HTTP client. Monetary values stay decimal strings. */

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
export interface JsonObject { [key: string]: JsonValue; }
export type QuantityInput = number | string;
export type TariffMode = 'graduated' | 'volume';

export interface TariffTier {
  /** Positive safe integer or canonical positive integer text; final tier is null. */
  readonly upTo: QuantityInput | null;
  /** Nonnegative decimal USD with at most six fractional digits. */
  readonly unitPriceUsd: string;
}

export interface TariffDefinition {
  readonly id: string;
  readonly label: string;
  readonly routeId: string;
  readonly mode: TariffMode;
  readonly tiers: readonly TariffTier[];
}

export interface TariffPreviewInput {
  readonly version: string;
  readonly tariffs: readonly TariffDefinition[];
  readonly volumes: readonly QuantityInput[];
}

export interface TariffSaveInput extends TariffPreviewInput {
  readonly requestId: string;
  readonly label: string;
  readonly tariffReviewSha256: string;
}

export interface TariffQuoteLine {
  readonly tierIndex: number;
  readonly lowerExclusiveQuantity: string;
  readonly upTo: string | null;
  readonly quantity: string;
  readonly unitPriceUsd: string;
  readonly subtotalUsd: string;
}

export interface RationalUnitUsd {
  readonly numerator: string;
  readonly denominator: string;
  /** Floor and ceiling display values use twelve decimal places. */
  readonly floorUsd: string;
  readonly ceilingUsd: string;
}

export interface TariffQuote {
  readonly schema: 'stellar-forge.merchant-tariff-quote.v1';
  readonly tariffId: string;
  readonly tariffSha256: string;
  readonly mode: TariffMode;
  readonly quantity: string;
  readonly totalMicroUsd: string;
  readonly totalUsd: string;
  readonly selectedTier: number | null;
  readonly lines: readonly TariffQuoteLine[];
  readonly effectiveUnitUsd: RationalUnitUsd | null;
  readonly chosenUniformQuoteUsd: string | null;
  readonly uniformGrossUsd: string | null;
  readonly roundingDeltaUsd: string | null;
  readonly rounding: 'CEILING_TO_MICRO_USD_PER_REQUEST';
  readonly nextQuantity: string | null;
  readonly nextTotalUsd: string | null;
  readonly nextGrossChangeUsd: string | null;
  readonly nextUnitPriceUsd: string | null;
}

export interface TariffComparison {
  readonly id: string;
  readonly tariffId: string;
  readonly routeId: string;
  readonly quantity: string;
  readonly method: string;
  readonly path: string;
  readonly quote: TariffQuote;
  readonly baseline: {
    readonly quoteUsd: string;
    readonly priceBasis: string;
    readonly totalUsd: string;
    readonly contributionBeforeFixedUsd: string | null;
    readonly marginBeforeFixedPct: string | null;
  };
  readonly costs: {
    readonly basis: 'FULFILLED_REQUESTS_ONLY';
    readonly perFulfilledUsd: string | null;
    readonly perChallengeUsd: string | null;
    readonly variableCostsUsd: string | null;
    readonly unknownInputs: readonly string[];
  };
  readonly contributionBeforeFixedUsd: string | null;
  readonly marginBeforeFixedPct: string | null;
  readonly grossDeltaUsd: string | null;
  readonly contributionDeltaUsd: string | null;
  readonly uniformProjection: JsonObject | null;
  /** Existing scenario patch, including routes; null when quantity is zero. */
  readonly scenario: JsonObject | null;
}

export interface TariffBoundary {
  readonly afterTierIndex: number;
  readonly beforeQuantity: string;
  readonly afterQuantity: string;
  readonly beforeTotalUsd: string;
  readonly afterTotalUsd: string;
  readonly grossChangeUsd: string;
  readonly decreasesGross: boolean;
}

export interface TariffReview {
  readonly schema: 'stellar-forge.merchant-tariff-review.v1';
  readonly tariffReviewSha256: string;
  readonly source: JsonObject;
  readonly tariffs: readonly TariffDefinition[];
  readonly volumes: readonly string[];
  readonly comparisons: readonly TariffComparison[];
  readonly tariffDetails: readonly {
    readonly tariffId: string;
    readonly tariffSha256: string;
    readonly boundaries: readonly TariffBoundary[];
  }[];
}

export interface TariffPreviewResult {
  readonly version: string;
  readonly sourceLabel: string;
  readonly sellerChanged: boolean;
  readonly review: TariffReview;
}

export interface TariffWorkspaceState {
  readonly schema: 'stellar-forge.merchant-tariff-workspace.v1';
  readonly pricing: JsonValue;
  readonly tariffs: JsonValue;
}

export interface TariffSource {
  readonly version: string;
  readonly label: JsonValue;
  readonly savedAt: JsonValue;
  readonly routes: JsonValue;
  readonly commercial: JsonValue;
  readonly provenance: JsonValue;
  readonly observation: JsonValue;
  readonly sellerChanged: JsonValue;
}

export interface TariffSelectionInput {
  readonly planId: string;
  readonly comparisonId: string;
}

export interface TariffSelection {
  readonly selectionSha256: string;
  readonly scenarioPlanInput: JsonObject;
  readonly pricingInput: JsonObject;
  readonly pricingPreview: JsonValue;
  readonly scenarioReview: JsonObject;
  readonly currentPricing: {
    readonly revision: string | null;
    readonly latest: JsonValue;
    readonly commercial: JsonValue;
  };
  readonly planId?: string;
  readonly comparisonId?: string;
  readonly [key: string]: unknown;
}

export interface TariffCommitSelectionInput {
  readonly selection: TariffSelection;
  readonly planRequestId: string;
  readonly pricingRequestId: string;
}

export interface TariffCommitSelectionResult {
  readonly status: 'TARIFF_SELECTION_SAVED';
  readonly planId: string;
  readonly comparisonId: string;
  readonly scenarioPlan: JsonValue;
  readonly pricing: JsonValue;
}

/** Saved-plan, receiving and repricing envelopes are the original workspace JSON. */
export type TariffPlan = JsonObject;
export type TariffPlanList = JsonValue;
export type TariffBundle = JsonObject;
export type TariffRepricingInput = JsonObject;

export interface TariffRequestOptions {
  readonly signal?: AbortSignal;
}

export interface TariffClientOptions {
  /** Loopback launch URL with #token=HEX64, or the same origin with token supplied. */
  readonly url: string | URL;
  readonly token?: string;
  readonly fetch?: typeof globalThis.fetch;
}

export interface TariffDownload {
  readonly filename: string;
  readonly contentType: string;
  readonly bytes: Uint8Array;
  readonly headers: Readonly<Record<string, string>>;
}

export interface TariffHttpErrorOptions {
  readonly status: number;
  readonly method: string;
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly rawBody: string;
  readonly body: unknown;
}

export class TariffHttpError extends Error {
  constructor(options: TariffHttpErrorOptions);
  readonly name: 'TariffHttpError';
  readonly status: number;
  readonly method: string;
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly rawBody: string;
  readonly body: unknown;
  readonly code: string;
  readonly requestId: string | null;
}

export class TariffTransportError extends Error {
  constructor(options: { method: string; url: string; cause: unknown; status?: number | null });
  readonly name: 'TariffTransportError';
  readonly code: 'TARIFF_TRANSPORT_ERROR';
  readonly method: string;
  readonly url: string;
  readonly status: number | null;
  readonly outcome: 'READ_FAILED' | 'UNKNOWN';
}

export class TariffProtocolError extends Error {
  constructor(options: {
    method: string; url: string; status: number;
    headers: Readonly<Record<string, string>>; rawBody: string;
  });
  readonly name: 'TariffProtocolError';
  readonly code: 'TARIFF_PROTOCOL_ERROR';
  readonly method: string;
  readonly url: string;
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly rawBody: string;
  readonly outcome: 'READ_FAILED' | 'UNKNOWN';
}

export class TariffClient {
  constructor(options: TariffClientOptions);
  readonly origin: string;
  state(options?: TariffRequestOptions): Promise<TariffWorkspaceState>;
  source(version: string, options?: TariffRequestOptions): Promise<TariffSource>;
  preview(input: TariffPreviewInput, options?: TariffRequestOptions): Promise<TariffPreviewResult>;
  save(input: TariffSaveInput, options?: TariffRequestOptions): Promise<TariffPlan>;
  list(options?: TariffRequestOptions): Promise<TariffPlanList>;
  load(planId: string, options?: TariffRequestOptions): Promise<TariffPlan>;
  selection(input: TariffSelectionInput, options?: TariffRequestOptions): Promise<TariffSelection>;
  commitSelection(input: TariffCommitSelectionInput, options?: TariffRequestOptions): Promise<TariffCommitSelectionResult>;
  download(planId: string, name: string, options?: TariffRequestOptions): Promise<TariffDownload>;
  bundle(options?: TariffRequestOptions): Promise<TariffBundle>;
  receive(bundle: TariffBundle, options?: TariffRequestOptions): Promise<JsonValue>;
  previewRepricing(input: TariffRepricingInput, options?: TariffRequestOptions): Promise<JsonValue>;
  saveRepricing(input: TariffRepricingInput, options?: TariffRequestOptions): Promise<JsonValue>;
  stageRepricing(input: TariffRepricingInput, options?: TariffRequestOptions): Promise<JsonValue>;
  repricingSource(version: string, options?: TariffRequestOptions): Promise<JsonValue>;
  downloadRepricing(decision: string, name: string, options?: TariffRequestOptions): Promise<TariffDownload>;
  downloadPricing(version: string, name: string, options?: TariffRequestOptions): Promise<TariffDownload>;
}

export function createTariffClient(options: TariffClientOptions): TariffClient;
