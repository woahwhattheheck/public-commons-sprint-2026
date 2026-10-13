export type JSONPrimitive = string | number | boolean | null;
export type JSONValue = JSONPrimitive | JSONValue[] | { [key: string]: JSONValue };
export type DecisionChoice = 'BID' | 'NO_BID' | 'INVESTIGATE' | 'PARK';
export type CodeFamily = 'GSIN' | 'UNSPSC' | 'UNSPECIFIED';
export type RegionFamily = 'CANADABUYS' | 'SOSA' | 'TEXT' | 'UNSPECIFIED';
export type RequirementKind = 'MANDATORY' | 'RATED' | 'CONTRACTUAL' | 'INFORMATIONAL' | 'UNKNOWN';
export type RequirementApplicability = 'APPLIES' | 'DOES_NOT_APPLY' | 'UNKNOWN';
export type RequirementResult = 'UNREVIEWED' | 'MET' | 'NOT_MET' | 'UNKNOWN' | 'NOT_APPLICABLE';
export type FitCheckStatus = 'MATCH' | 'GAP' | 'UNKNOWN' | 'NOT_APPLICABLE';
export type EvidenceKind = 'SOLICITATION' | 'AMENDMENT' | 'ANNEX' | 'QUESTIONS_AND_ANSWERS' |
  'SUPPLIER' | 'REGISTRATION' | 'CERTIFICATION' | 'SECURITY' | 'PAST_PERFORMANCE' | 'OTHER';
export type EvidenceAccessState = 'CAPTURED' | 'LINK_ONLY' | 'ACCESS_RESTRICTED' | 'RETRIEVAL_FAILED' | 'NOT_YET_REVIEWED';

export const CAPABILITY_PROFILE_SCHEMA: 'starforge.canadabuys.capability-profile.v1';
export const EVIDENCE_DOCUMENT_SCHEMA: 'starforge.canadabuys.evidence-document.v1';
export const REQUIREMENT_ASSESSMENT_SCHEMA: 'starforge.canadabuys.requirement-assessment.v1';
export const CAPABILITY_FIT_SCHEMA: 'starforge.canadabuys.capability-fit.v1';
export const DECISION_CONTEXT_CHANGE_SCHEMA: 'starforge.canadabuys.decision-context-change.v1';
export const DECISION_CHOICES: readonly DecisionChoice[];
export const CODE_FAMILIES: readonly CodeFamily[];
export const REGION_FAMILIES: readonly RegionFamily[];
export const EVIDENCE_KINDS: readonly EvidenceKind[];
export const EVIDENCE_ACCESS_STATES: readonly EvidenceAccessState[];
export const REQUIREMENT_KINDS: readonly RequirementKind[];
export const REQUIREMENT_APPLICABILITY: readonly RequirementApplicability[];
export const REQUIREMENT_RESULTS: readonly RequirementResult[];
export const FIT_CHECK_STATUSES: readonly FitCheckStatus[];

/** Optional metadata is assigned by the original workspace persistence layer, never by these pure functions. */
export interface SavedRecordMetadata {
  id?: string;
  noticeId?: string | null;
  /** Complete saved-edition digest assigned and checked by persistence. */
  editionSha256?: string;
  revision?: number;
  createdAt?: string | null;
  updatedAt?: string | null;
  operator?: JSONValue;
}
export interface CommodityDeclaration { family: CodeFamily; code: string; label: string; }
export interface RegionDeclaration { family: RegionFamily; code: string; label: string; note: string; }
export interface QualificationClaim {
  id: string;
  label: string;
  state: 'DECLARED' | 'SUPPORTED' | 'NOT_HELD' | 'UNKNOWN';
  evidenceIds: string[];
  /** Offset timestamp or YYYY-MM-DD. A date-only expiry runs through that UTC date. */
  expiresAt: string | null;
  note: string;
}
export interface SupplierCapacity {
  state: 'AVAILABLE' | 'LIMITED' | 'UNAVAILABLE' | 'UNKNOWN';
  /** Delivery availability, compared with expected performance start, never substituted for tender closing. */
  availableFrom: string | null;
  minimumLeadDays: number | null;
  note: string;
}
export interface CommercialPreferences {
  currency: string;
  /** Nullable, nonnegative decimal strings. Exact zero is retained; no binary-float arithmetic. */
  minimumContractValue: string | null;
  maximumContractValue: string | null;
  maximumBidCost: string | null;
  note: string;
}
export interface CapabilityProfile extends SavedRecordMetadata {
  schema: typeof CAPABILITY_PROFILE_SCHEMA;
  label: string;
  legalName: string;
  operatingNames: string[];
  description: string;
  keywords: string[];
  excludedKeywords: string[];
  categories: string[];
  commodityCodes: CommodityDeclaration[];
  deliveryRegions: RegionDeclaration[];
  opportunityRegions: RegionDeclaration[];
  qualificationClaims: QualificationClaim[];
  capacity: SupplierCapacity;
  commercial: CommercialPreferences;
  evidenceIds: string[];
  notes: string;
}
export type CapabilityProfileInput =
  Partial<Omit<CapabilityProfile, 'capacity' | 'commercial' | 'commodityCodes' | 'deliveryRegions' |
    'opportunityRegions' | 'qualificationClaims'>> & {
    capacity?: Partial<SupplierCapacity>;
    commercial?: Partial<CommercialPreferences>;
    commodityCodes?: Partial<CommodityDeclaration>[];
    deliveryRegions?: Partial<RegionDeclaration>[];
    opportunityRegions?: Partial<RegionDeclaration>[];
    qualificationClaims?: (Pick<QualificationClaim, 'id' | 'label'> & Partial<Omit<QualificationClaim, 'id' | 'label'>>)[];
  };
export interface EvidenceReview {
  state: 'UNREVIEWED' | 'REVIEWED';
  reviewedBy: string;
  reviewedAt: string | null;
  note: string;
}
export interface EvidenceDocument extends SavedRecordMetadata {
  schema: typeof EVIDENCE_DOCUMENT_SCHEMA;
  title: string;
  kind: EvidenceKind;
  sourceUrl: string;
  localOrigin: string;
  accessState: EvidenceAccessState;
  sha256: string | null;
  bytes: number | null;
  language: 'en' | 'fr' | 'bilingual' | 'other' | 'unknown';
  capturedAt: string | null;
  issuedAt: string | null;
  version: string;
  pageOrSection: string;
  relatedNoticeIdentifiers: string[];
  supersedes: string | null;
  review: EvidenceReview;
  accessFailure: string;
  notes: string;
}
export type EvidenceDocumentInput = Partial<Omit<EvidenceDocument, 'review'>> & { review?: Partial<EvidenceReview> };
/** Revision and digest identify the exact saved document; a newer revision is never an automatic substitute. */
export interface RequirementEvidenceReference {
  evidenceId: string;
  revision?: number;
  sha256?: string;
  pageOrSection: string;
  quote: string;
  note: string;
}
export type RequirementEvidenceReferenceInput =
  Pick<RequirementEvidenceReference, 'evidenceId'> & Partial<Omit<RequirementEvidenceReference, 'evidenceId'>>;
export interface RequirementAssessment extends SavedRecordMetadata {
  schema: typeof REQUIREMENT_ASSESSMENT_SCHEMA;
  kind: RequirementKind;
  applicability: RequirementApplicability;
  requirementText: string;
  sourceEvidence: RequirementEvidenceReference[];
  assessment: RequirementResult;
  supplierEvidence: RequirementEvidenceReference[];
  applicabilityBasis: string;
  reviewedBy: string;
  reviewedAt: string | null;
  owner: string;
  dueAt: string | null;
  clarificationQuestion: string;
  notes: string;
}
export type RequirementAssessmentInput = Partial<Omit<RequirementAssessment, 'sourceEvidence' | 'supplierEvidence'>> & {
  sourceEvidence?: RequirementEvidenceReferenceInput[];
  supplierEvidence?: RequirementEvidenceReferenceInput[];
};

/** The existing source edition is structurally compatible; all original row fields remain present. */
export interface BilingualValue { en: string; fr: string; }
export interface BidderNoticeSummary {
  referenceNumber?: string;
  solicitationNumber?: string;
  title?: BilingualValue;
  description?: BilingualValue;
  buyer?: BilingualValue;
  noticeType?: BilingualValue;
  status?: BilingualValue;
  closing?: { raw: string; utc: string | null; offset: string; valid: boolean; past: boolean | null; daysRemaining: number | null; error?: string };
  publicationDate?: string;
  updatedDate?: string;
  amendmentNumber?: string;
  regions?: { delivery?: BilingualValue; opportunity?: BilingualValue };
  categories?: string[];
  commodityCodes?: string[];
  unspsc?: string[];
  documents?: { title: string; url: string; field: string; original: string }[];
  noticeURL?: string | null;
  noticeURLs?: { en: string | null; fr: string | null };
  instrumentType?: BilingualValue;
  contractValue?: { raw: string; cents: number | null; currency: string; rawCurrency?: string; currencyBasis?: string; includesTaxes?: boolean };
  totalContractValue?: { raw: string; cents: number | null; cumulative?: boolean };
  contractDates?: { awarded?: string; start?: string; end?: string };
  arrangement?: {
    agreementNumber: string;
    agreementType: BilingualValue;
    startDate: string;
    expiryDate: string;
    sourcePublicationDate: string;
    supplier: { legal: string; operating: string; standardized: string };
    commodity: { raw: string; codes: string[]; scheme: string; description: BilingualValue; definitionURL: string };
    delivery: { code: string; description: BilingualValue };
    endUser: BilingualValue;
    dictionaryURL: string;
  };
  stream?: string;
  [field: string]: unknown;
}
export interface BidderSourceEdition {
  id: string;
  sourceId: string;
  rowNumber: number;
  row: Record<string, JSONValue>;
  summary: BidderNoticeSummary;
  kind: 'tender' | 'award' | 'arrangement';
  noticeId: string | null;
  solicitationKey: string;
  referenceKey: string;
  importedAt: string;
  rowSha256: string;
}
export interface BidderSourceMetadata {
  id: string;
  stream: string;
  sha256: string;
  bytes: number;
  columns: string[];
  rowCount: number;
  label: string;
  url: string;
  retrievedAt: string;
  coverage: JSONValue;
  bodyKind: string;
  response: JSONValue;
  [field: string]: unknown;
}
export interface FitCheck {
  code: string;
  dimension: string;
  status: FitCheckStatus;
  reason: string;
  observed: JSONValue;
  declared: JSONValue;
}
export interface OriginalFieldObservation {
  field: string | null;
  raw: JSONValue;
  basis: string;
  present?: boolean;
}
export interface DeadlineObservation {
  raw: string;
  utc: string | null;
  offset: string;
  valid: boolean;
  past: boolean | null;
  daysRemaining: number | null;
  error?: string;
  source: OriginalFieldObservation;
  publisherStatus: { en: OriginalFieldObservation; fr: OriginalFieldObservation; classification: string };
  availability: 'OPEN' | 'CLOSED' | 'UNKNOWN' | 'NOT_APPLICABLE';
  conflict: boolean;
  timeBasis: string;
}
export interface CapabilityFit {
  schema: typeof CAPABILITY_FIT_SCHEMA;
  evaluatedAt: string;
  binding: {
    entryId: string | null;
    noticeId: string | null;
    sourceId: string | null;
    rowSha256: string;
    sourceCapturedAt: string | null;
    profileId: string | null;
    profileRevision: number | null;
    profileSha256: string;
  };
  overall: 'POTENTIAL_FIT' | 'GAPS' | 'INSUFFICIENT_INFORMATION' | 'HISTORICAL_CONTEXT';
  checks: FitCheck[];
  matches: FitCheck[];
  gaps: FitCheck[];
  unknowns: FitCheck[];
  mandatoryReview: { status: 'REQUIRED'; eligibility: 'NOT_DETERMINED'; reason: string; automaticDecision: null };
  deadline: DeadlineObservation;
}
export type SavedCapabilityProfile = CapabilityProfile & { id: string; revision: number };
export type SavedEvidenceDocument = EvidenceDocument & { id: string; revision: number };
export type SavedRequirementAssessment = RequirementAssessment & { id: string; revision: number };
export interface DecisionContext {
  entry: BidderSourceEdition;
  source: BidderSourceMetadata;
  profile: SavedCapabilityProfile;
  /** May contain both current and older exact document revisions needed by the selected assessments. */
  evidence: SavedEvidenceDocument[];
  requirements: SavedRequirementAssessment[];
  [field: string]: unknown;
}
export interface DecisionContextChange {
  path: string;
  component: string;
  category: string;
  material: boolean;
  beforePresent: boolean;
  afterPresent: boolean;
  before: JSONValue;
  after: JSONValue;
  reason: string;
}
export interface DecisionContextComparison {
  schema: typeof DECISION_CONTEXT_CHANGE_SCHEMA;
  initial: boolean;
  beforeSha256: string | null;
  afterSha256: string;
  changed: boolean;
  requiresReassessment: boolean;
  materialChangeCount: number;
  provenanceChangeCount: number;
  components: { component: string; beforeSha256: string | null; afterSha256: string; changed: boolean }[];
  reasons: { category: string; paths: string[]; reason: string }[];
  changes: DecisionContextChange[];
}

export function normalizeCapabilityProfile(input: CapabilityProfileInput, current?: Partial<CapabilityProfile>): CapabilityProfile;
export function normalizeEvidenceDocument(input: EvidenceDocumentInput, current?: Partial<EvidenceDocument>): EvidenceDocument;
export function normalizeRequirementAssessment(input: RequirementAssessmentInput, current?: Partial<RequirementAssessment>): RequirementAssessment;
export function assessCapabilityFit(input: {
  entry: BidderSourceEdition;
  profile: CapabilityProfileInput;
  /** Supply an explicit instant for reproducible saved assessments; omission uses Date.now(). */
  now?: number | string;
}): CapabilityFit;
export function compareDecisionContext(before: DecisionContext | null | undefined, after: DecisionContext): DecisionContextComparison;
