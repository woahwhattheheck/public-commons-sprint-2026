import type {OpportunityStore} from './model.mjs';
export interface IntakeProgress {
  key:string;action:string;projectId:string;revision:number;completedAt:string;sourceId?:string;
}
export interface IntakeResult {
  projectId:string;revision:number;journalPath:string;seedSha256:string;sources:number;
  requirements:number;capabilities:number;questions:number;completedSteps:number;resumed:boolean;
}
export interface OperatorSeed {
  schema:'tjlabs.lgndx.operator-seed.v1';title:string;description?:string;
  company?:Record<string,unknown>;opportunity?:Record<string,unknown>;
  sources:Array<{key:string;file:string;sha256:string;bytes:number;payload:Record<string,unknown>&{contentText:string}}>;
  requirements:Array<Record<string,unknown>>;capabilities:Array<Record<string,unknown>>;
  questions:Array<Record<string,unknown>>;responseRules?:Record<string,unknown>;sourceNotes?:string[];
}
export declare function seedOpportunityWorkspace(options:{
  store:OpportunityStore;directory:string;seed?:OperatorSeed;seedText?:string;operator?:string;
  onProgress?:(progress:IntakeProgress)=>void|Promise<void>;
}):Promise<IntakeResult>;
export declare function runOpportunityCli(argv?:string[],options?:{
  output?:(value:unknown)=>void;onProgress?:(progress:IntakeProgress)=>void|Promise<void>;waitForClose?:boolean;
}):Promise<unknown>;
