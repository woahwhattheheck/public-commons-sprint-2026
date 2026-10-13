export interface GleifPlan { kind: 'name'|'lei'; query: string; pageSize?: number; country?: string; entityStatus?: string; registrationStatus?: string; }
export interface SourcePage { url:string; startedAt?:string; observedAt:string; status:number|null; headers:Record<string,string>|null; acquisition?:{kind:string;[key:string]:unknown}; sha256:string; bytes:number; records:number; }
export interface GleifCapture { schema:string; id:string; plan:GleifPlan; createdAt:string; completedAt?:string; state:'PENDING'|'FETCHING'|'INTERRUPTED'|'SOURCE_REVIEW'|'COMPLETE'; pages:SourcePage[]; attempts:SourcePage[]; next:string|null; notBefore:string|null; }
export interface ResearchReview { id:string; title:string; captureId:string; lei:string; decision:'include'|'exclude'|'research'; reviewer:string; rationale:string; useCase:string; nextWork:string; version:number; resourceSha256:string; originalResource:Record<string,unknown>; }
export interface RetainedFile { name:string; sha256:string; bytes:number; }
export interface Operation { id:string; action:string; state:'PENDING'|'RUNNING'|'INTERRUPTED'|'COMPLETE'; createdAt:string; updatedAt:string; error?:{code:string;message:string;status?:number}|null; input?:Record<string,unknown>; result?:unknown; }
export interface ProjectRequest { id:string; action:'capture'|'capture.resume'|'source.import'|'review.save'|'review.batch'|'report.prepare'|'dataset.prepare'|'monitoring.prepare'; input:Record<string,unknown>; expectedRevision?:number; }
export interface Connection { schema:string; origin:string; token:string; workspaceId:string; workspaceIdentity:string; instanceId:string; sourceIdentity:{sha256:string;files:Array<{path:string;sha256:string;bytes:number}>}; }
export interface EntityRecord { row:Record<string,string>; resource:Record<string,unknown>; page:number; review?:ResearchReview|null; needsReview?:boolean; }
export interface EntityPage { capture:GleifCapture; offset:number; total:number; nextOffset:number|null; items:EntityRecord[]; }
export interface ProjectStatus { schema:string; workspace:{id:string;title:string;createdAt:string}; revision:number; active:Operation|null; captures:GleifCapture[]; reviews:ResearchReview[]; reports:Array<{id:string;title:string;records:number;files:RetainedFile[]}>; datasets:Array<{id:string;name:string;rows:number;snapshot:string;files:RetainedFile[]}>; operations:Operation[]; }
export declare function readGleifConnection(path:string):Promise<Connection>;
export declare class GleifClient {
  binding:Connection;
  constructor(binding:Connection,options?:{fetchImpl?:typeof fetch});
  static connect(connectionFile:string,options?:{fetchImpl?:typeof fetch}):Promise<GleifClient>;
  request(path:string,options?:{method?:string;body?:unknown;raw?:boolean;signal?:AbortSignal}):Promise<any>;
  verify():Promise<{workspaceId:string;instanceId:string;workspaceIdentity:string;sourceIdentity:{sha256:string}}>;
  status():Promise<ProjectStatus>;
  rows(id:string,options?:{offset?:number;limit?:number;search?:string}):Promise<EntityPage>;
  capture(id:string):Promise<{capture:GleifCapture;records:EntityRecord[];complete:boolean;next:string|null}>;
  compare(before:string,after:string):Promise<Record<string,unknown>>;
  monitoringPreview(input:{title:string;portfolioKey:string;captureIds:[string];selection:'all'|'included';fields:Array<'aliases'|'registrationNumber'|'entityStatus'|'addresses'>}):Promise<Record<string,unknown>>;
  operation(id:string):Promise<Operation>;
  start(request:ProjectRequest):Promise<Operation>;
  pause(id:string):Promise<Operation>;
  wait(id:string):Promise<Operation>;
  run(request:ProjectRequest):Promise<Operation>;
  package():Promise<{schema:string;metadata:Record<string,unknown>;state:Record<string,unknown>;objects:Array<{sha256:string;bytes:number;base64:string}>;sha256:string}>;
  packageFile():Promise<RetainedFile>;
  query(id:string,query?:string):Promise<Record<string,unknown>>;
  object(sha256:string):Promise<Uint8Array>;
  chunk(sha256:string,offset?:number,limit?:number):Promise<{sha256:string;bytes:number;offset:number;returned:number;nextOffset:number|null;base64:string}>;
  close():void;
}
