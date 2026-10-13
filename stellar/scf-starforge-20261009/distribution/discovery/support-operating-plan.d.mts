import type {CommandCatalog} from './catalog.mjs';
import type {OperatingPlan, OperatingStep} from './operating-plan.mjs';

export const SUPPORT_OPERATING_SOURCE_SCHEMA: 'stellar-forge.oauth-support-operating-source.v1';
export type SupportOperatingPhase = 'sources' | 'authority' | 'observation' | 'response' | 'recovery' | 'case' | 'handover';
export const SUPPORT_OPERATING_PHASES: readonly SupportOperatingPhase[];
export interface SupportOperatingArtifact {path:string; bytes:number; sha256:string}
export type SupportOperatingJSON = null | boolean | number | string | SupportOperatingJSON[] | {[key:string]:SupportOperatingJSON};
export interface SupportOperatingCapture {
  kind:'OAUTH_RESOURCE'; routeId:string; registration:{id:string; label:string}; resource:string|null;
  configurationSha256:string|null; sessionId:string|null; startedAt:string|null; capturedAt:string|null; sequence:number|null;
  collectionStartedAt:string; collectedAt:string;
  coverage:{state:'COMPLETE'|'SOURCE_UNAVAILABLE'|'IDENTITY_CHANGED'|'OBSERVER_INCOMPLETE';
    windowComplete:boolean|null; sourceError:SupportOperatingJSON; identityContradiction:SupportOperatingJSON};
  files:{'oauth-observation.json':SupportOperatingArtifact; 'oauth-source.json':SupportOperatingArtifact};
}
export interface SupportOperatingSource {
  schema:typeof SUPPORT_OPERATING_SOURCE_SCHEMA; id:string; capturedAt:string;
  case:{id:string; revision:string; currentRevision:string; createdAt:string; updatedAt:string; ancestors:string[]};
  artifacts:{
    caseSnapshot:SupportOperatingArtifact; workspace:SupportOperatingArtifact; runtime:SupportOperatingArtifact;
    handoff?:SupportOperatingArtifact; report?:SupportOperatingArtifact; html?:SupportOperatingArtifact;
  };
  captures:{before:SupportOperatingCapture|null; after:SupportOperatingCapture|null};
  actions:Array<{source:string; routeId:string; kind:string; action:string}>;
  incidentSource:{id:string; configurationRevision:string}|null;
  nativeDelivery:SupportOperatingArtifact|null;
  evidence:Array<{id:string; role:string; artifact:SupportOperatingArtifact}>;
}
export interface CreateSupportOperatingPlanOptions {
  source:SupportOperatingSource; catalog?:CommandCatalog; id:string; title?:string; customer?:string;
  owner?:string; period?:string; savedAt?:string;
  registrations?:Partial<Record<SupportOperatingPhase,string>>;
  argvByPhase?:Partial<Record<SupportOperatingPhase,string[]>>;
}
export interface RecordSupportOperatingResultOptions {
  source:SupportOperatingSource;
  stepId:`support-${SupportOperatingPhase}`;
  status:OperatingStep['status'];
  result:{summary:string; evidenceIds:string[]};
  owner?:string; savedAt?:string;
}
/** Returns an independent descriptor after structural and cross-file identity validation.
 * Full original artifact bytes and case histories are checked by the native SF74 source receiver. */
export function inspectSupportOperatingSource(value:unknown):SupportOperatingSource;
/** Creates an ordinary OperatingPlan, using actual catalog snapshots and planned initial steps. */
export function createSupportOperatingPlan(options:CreateSupportOperatingPlanOptions):OperatingPlan;
/** Appends a reviewed outcome to the original full history; completion requires a returned artifact reference. */
export function recordSupportOperatingResult(plan:OperatingPlan, options:RecordSupportOperatingResultOptions):OperatingPlan;
