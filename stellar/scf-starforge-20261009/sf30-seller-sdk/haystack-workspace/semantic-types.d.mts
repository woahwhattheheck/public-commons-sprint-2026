import type { Json, Revision, Mutation, Paging, Envelope, Outcome, Page, ByteRange } from "./client.mjs";

export type SemanticKind = "site" | "equip" | "point" | "other";
export interface SemanticSourceRef { kind: "native" | "intake"; sourceId: string; rowIndex: number }
export interface SemanticSelection { nativeSourceIds: string[]; intakeIds: string[] }
export interface SemanticMapping {
  intakeId: string; idColumn: number | null; nameColumn: number | null; kind: SemanticKind;
  kindColumn?: number | null; equipmentColumn?: number | null; siteColumn?: number | null; unitColumn?: number | null; defaultClass?: string;
}
export interface SemanticNaming { template: string; case: "preserve" | "lower" | "upper"; separator: string; description: string }
export interface SemanticObservation {
  status: "unreviewed" | "observed-live" | "observed-offline" | "configured-only" | "not-observed";
  date: string; author: string; evidence: string;
}
export interface SemanticAttribute { predicate: string; kind: "iri" | "literal"; value: string; datatype?: string; language?: string }
export interface SemanticEntity {
  id: string; sourceRefs: SemanticSourceRef[]; name: string; label: string; kind: SemanticKind;
  classes: string[]; tags: string[]; attributes: SemanticAttribute[]; observation: SemanticObservation; note: string;
}
export interface SemanticRelation { id: string; subjectId: string; predicate: string; objectId: string; note: string }
export interface SemanticDictionaryRow {
  id: string; term: string; iri: string; kind: "class" | "tag" | "relation" | "unit" | "attribute" | "naming";
  definition: string; sourceUrl: string; note: string;
}
export interface SemanticContent {
  title: string; namespace: string; naming: SemanticNaming; mappings: SemanticMapping[];
  entities: SemanticEntity[]; relations: SemanticRelation[]; dictionary: SemanticDictionaryRow[]; notes: string;
}
export interface SemanticAssessment {
  sourceRows: number; entities: number; relations: number; dictionaryTerms: number;
  mappedSourceRows: number; unmappedSourceRows: number; unclassified: number; unreviewedObservations: number;
  observations: Array<{ code: string; message: string; entityId?: string; entityIds?: string[]; name?: string; sourceRef?: SemanticSourceRef }>;
}
export interface SemanticIntake {
  id: string; name: string; format: "csv" | "tsv"; delimiter: string; assetId: string; bytes: number;
  importedAt: string; importedRevision: number; columns: string[]; rowCount: number; encoding: string;
  diagnostics: Json[]; inspection: Record<string, unknown>; sourceUrl: string; contentSha256: string;
}
export interface SemanticModel { id: string; createdAt: string; createdBy: string; headId: string }
export interface SemanticVersionMeta {
  format: "commons.haystack.semantic-version.v1"; id: string; modelId: string; parents: string[];
  contextId: string; contentSha256: string; createdAt: string; author: string; note: string;
}
export interface SemanticVersion extends SemanticVersionMeta { content: SemanticContent }
export interface SemanticReview {
  format: "commons.haystack.semantic-review.v1"; id: string; modelId: string; versionId: string;
  decision: "ready" | "changes"; author: string; note: string; validationId: string | null; reviewedAt: string;
}
export interface SemanticOutput { name: string; mediaType: string; bytes: number; sha256: string }
export interface SemanticValidationSummary {
  id: string; format: "commons.haystack.semantic-validation.v1"; modelId: string; versionId: string; contentSha256: string;
  contextId: string; conforms: boolean; createdAt: string; author: string; execution: Record<string, unknown>;
  outputs: SemanticOutput[]; results: number | null; mappingObservations: number | null;
}
export interface SemanticValidation extends Omit<SemanticValidationSummary, "results" | "mappingObservations"> {
  native: Record<string, unknown>; assessment: SemanticAssessment;
}
export interface SemanticModelSummary extends SemanticModel {
  title: string; contextId: string; contentSha256: string; entities: number; relations: number;
  review: Pick<SemanticReview, "id" | "decision" | "author" | "reviewedAt"> | null;
  validation: Pick<SemanticValidationSummary, "id" | "conforms" | "createdAt"> | null;
}
export interface SemanticContext {
  format: "commons.haystack.semantic-context.v1"; id: string; workspaceId: string;
  materialSha256: string; selection: SemanticSelection; nativeSources: Json[]; intakes: Json[]; records: Json[];
  [name: string]: unknown;
}
export interface SemanticModelRead extends Envelope {
  model: SemanticModel; version: SemanticVersion; contextId: string; assessment: SemanticAssessment;
  latestReview: SemanticReview | null; latestValidation: SemanticValidation | null; context: SemanticContext;
  history: Array<Pick<SemanticVersionMeta, "id" | "parents" | "contextId" | "contentSha256" | "createdAt" | "author" | "note">>;
  reviews: SemanticReview[]; validations: SemanticValidationSummary[];
}
export interface SemanticModelOutcome extends Outcome {
  model: SemanticModel; version: SemanticVersionMeta; contextId: string; assessment: Omit<SemanticAssessment, "observations">;
  latestReview: SemanticReview | null; latestValidation: SemanticValidationSummary | null;
}
export interface SemanticTerm { iri: string; label: string; definition: string; parents: string[]; kind: string }
export interface SemanticCatalogue {
  schema: "commons.haystack.semantic-native-result.v1"; ok: true; action: "catalog";
  classes: SemanticTerm[]; properties: SemanticTerm[]; tags: SemanticTerm[]; units: SemanticTerm[];
  standard?: Record<string, unknown>; runtime: Record<string, unknown> & { standard: Record<string, unknown> }; catalogueSha256: string; catalogueBytes: number;
  [name: string]: unknown;
}
export interface SemanticDifference { kind: "model" | "order" | "entities" | "relations" | "dictionary"; id: string; before: Json; after: Json }
export interface SemanticReturnModel {
  modelId: string; title: string; localHeadId: string | null; incomingHeadId: string;
  same: boolean; localContextId: string | null; incomingContextId: string; changes: SemanticDifference[];
  incomingAssessment: SemanticAssessment;
}
export interface SemanticReturnPreview extends Envelope {
  packageSha256: string; incomingRevision: number; comparisonMeaning: string; models: SemanticReturnModel[];
}
export interface SemanticReturnDecision {
  modelId: string; decision: "keep" | "adopt"; expectedLocalHeadId: string | null; expectedIncomingHeadId: string;
}
export interface SemanticReturnReceipt {
  format: "commons.haystack.semantic-return.v1"; id: string; packageSha256: string; payloadSha256: string;
  incomingRevision: number; incomingStateSha256: string; incomingModels: SemanticModel[]; application: Array<Pick<SemanticOutput, "name" | "bytes" | "sha256">>;
  receivedAt: string; author: string; note: string; decisions: Array<SemanticReturnDecision & { headId: string | null }>;
  comparisons: Array<{ modelId: string; localHeadId: string | null; incomingHeadId: string; changes: SemanticDifference[] }>;
}
export type SemanticModelArguments = { contextId: string; selection?: SemanticSelection; content: SemanticContent; author: string; note?: string };
export type SemanticDeliveryArguments = Mutation & (
  { kind: "semantic-report"; modelId: string; versionId?: string; format?: "json" | "csv" | "html" } |
  { kind: "semantic-dictionary"; modelId: string; versionId?: string; format?: "json" | "csv" } |
  { kind: "semantic-output"; validationId: string; name: string }
);
export interface SemanticActionMap {
  "semantic.catalog": { args: Record<string, never>; result: SemanticCatalogue };
  "semantic.intakes.list": { args: Revision & Paging; result: Page<SemanticIntake> };
  "semantic.intake.read": { args: Revision & Paging & { intakeId: string }; result: Page<{ rowIndex: number; cells: string[]; physicalEndLine: number }> & { intake: SemanticIntake } };
  "semantic.source.read": { args: { intakeId: string; offset?: number; length?: number }; result: ByteRange & { intakeId: string } };
  "semantic.intake.import": { args: Mutation & { name: string; format: "csv" | "tsv"; base64: string; delimiter?: "," | "\t" | ";"; sourceUrl?: string }; result: Outcome & { intake: SemanticIntake } };
  "semantic.model.preview": { args: Revision & { title: string; namespace: string; selection: SemanticSelection; contextId?: string; mappings: SemanticMapping[]; naming: SemanticNaming; defaultClasses?: Partial<Record<SemanticKind, string>> }; result: Envelope & { contextId: string; selection: SemanticSelection; content: SemanticContent; sourceRows: Json[]; assessment: SemanticAssessment; materialSha256: string } };
  "semantic.model.assess": { args: Revision & { contextId: string; selection?: SemanticSelection; content: SemanticContent }; result: Envelope & { contextId: string; contentSha256: string; assessment: SemanticAssessment } };
  "semantic.models.list": { args: Revision & Paging; result: Page<SemanticModelSummary> };
  "semantic.model.read": { args: Revision & { modelId: string; versionId?: string }; result: SemanticModelRead };
  "semantic.model.create": { args: Mutation & SemanticModelArguments & { modelId?: string }; result: SemanticModelOutcome };
  "semantic.model.save": { args: Mutation & SemanticModelArguments & { modelId: string; expectedHeadId: string }; result: SemanticModelOutcome };
  "semantic.model.review": { args: Mutation & { modelId: string; expectedHeadId: string; decision: "ready" | "changes"; author: string; note: string; validationId?: string }; result: SemanticModelOutcome & { review: SemanticReview } };
  "semantic.model.compare": { args: Revision & Paging & { modelId: string; beforeVersionId: string; afterVersionId: string }; result: Page<SemanticDifference> & { modelId: string; beforeVersionId: string; afterVersionId: string; beforeContextId: string; afterContextId: string; totalChanges: number } };
  "semantic.validate": { args: Mutation & { modelId: string; expectedHeadId: string; author: string }; result: SemanticModelOutcome & { validation: SemanticValidationSummary } };
  "semantic.validations.list": { args: Revision & Paging & { modelId?: string }; result: Page<SemanticValidationSummary> };
  "semantic.validation.read": { args: Revision & { validationId: string }; result: Envelope & { validation: SemanticValidation } };
  "semantic.output.read": { args: { validationId: string; name: string; offset?: number; length?: number }; result: ByteRange & { validationId: string } };
  "semantic.return.preview": { args: Revision & { base64: string }; result: SemanticReturnPreview };
  "semantic.return.apply": { args: Mutation & { base64: string; decisions: SemanticReturnDecision[]; author: string; note: string }; result: Outcome & { return: Omit<SemanticReturnReceipt, "comparisons">; models: SemanticModelSummary[] } };
  "semantic.returns.list": { args: Revision & Paging; result: Page<Omit<SemanticReturnReceipt, "comparisons">> };
  "semantic.return.read": { args: Revision & { returnId: string }; result: Envelope & { return: SemanticReturnReceipt } };
}
