import type {JobWorkspace} from '../../stellar/scf-starforge-20261009/sf88-operator-buyer-cli/job-workspace/index.mjs';
import type {VerifiedDownload} from '../../stellar/scf-starforge-20261009/sf88-operator-buyer-cli/resource-library/verified-downloads.mjs';
import type {DocumentAssemblyRequest,DocumentAssemblyView,DocumentAssemblyCounts,DocumentAssemblyDelivery} from './assembly.mjs';
export const DOCUMENT_ASSEMBLY_WORKSPACE_SCHEMA:'stellar-forge.document-assembly-workspace.v1';
export interface DocumentAssemblyUpload {name:string;bytes:number;sha256:string;base64:string}
export interface DocumentAssemblyBrowserSource {id:string;name:string;directory:string;sourceSha256:string;
  sourceBytes:number;request:DocumentAssemblyRequest;counts:DocumentAssemblyCounts}
export type DocumentAssemblyBrowserAction='stage'|'restore'|'materialize'|'prepare'|'run'|'receive'|'export';
export interface DocumentAssemblyBrowserOperation {
  id:string;assemblyId:string;kind:DocumentAssemblyBrowserAction;
  state:'RUNNING'|'COMPLETE'|'CONTINUATION_REQUIRED'|'STOPPED'|'FAILED';
  startedAt:string;endedAt:string|null;progress:Record<string,unknown>|null;
  result:Record<string,unknown>|null;error:{code:string;message:string}|null;
}
export interface DocumentAssemblyBrowserStatus {
  schema:typeof DOCUMENT_ASSEMBLY_WORKSPACE_SCHEMA;workspaceDirectory:string;sourceRoot:string;
  merchantOrigin:string|null;uploadLimit:number;sourcePlanLimit:number;closing:boolean;
  active:DocumentAssemblyBrowserOperation[];
}
export interface DocumentAssemblyBrowserExport {
  id:string;complete:boolean;counts?:DocumentAssemblyCounts;files?:DocumentAssemblyDelivery['files'];
  native?:DocumentAssemblyDelivery['native'];archive?:DocumentAssemblyDelivery['archive'];error?:{code:string;message:string};
}
export type DocumentAssemblyBrowserView=Omit<DocumentAssemblyView,'schema'>&{
  schema?:DocumentAssemblyView['schema'];sourceState:'COMPLETE'|'CONTINUATION_REQUIRED';
  exports:DocumentAssemblyBrowserExport[];active:DocumentAssemblyBrowserOperation|null;
};
export interface DocumentAssemblyBrowserSelection {id:string;sourceSha256:string}
export type DocumentAssemblyBrowserDownload=DocumentAssemblyBrowserSelection&(
  {kind:'source'}|{kind:'original';fileId:string}|{kind:'pdf';volumeId:string}|
  {kind:'export';exportId:string;file:string});
export interface DocumentAssemblyWorkspace {
  readonly workspace:JobWorkspace;readonly sourceRoot:string;
  status():DocumentAssemblyBrowserStatus;
  list(options?:{offset?:number;limit?:number}):Promise<{
    total:number;offset:number;limit:number;items:Array<
      (DocumentAssemblyBrowserSource|{id:string;state:'SOURCE_REQUIRED'|'SOURCE_UNAVAILABLE';error:{code:string;message:string}})&{
        active:DocumentAssemblyBrowserOperation|null}>;
  }>;
  get(options:{id:string;sourceSha256?:string;signal?:AbortSignal}):Promise<DocumentAssemblyBrowserView>;
  operation(options:{operationId:string}):DocumentAssemblyBrowserOperation;
  start(kind:'stage',input:{id:string;request:DocumentAssemblyRequest;files:Array<DocumentAssemblyUpload&{id:string}>}):
    DocumentAssemblyBrowserOperation;
  start(kind:'restore',input:DocumentAssemblyBrowserSelection&(
    {source:DocumentAssemblyUpload;sourceFile?:never}|{sourceFile:string;source?:never})):DocumentAssemblyBrowserOperation;
  start(kind:'materialize'|'prepare'|'receive',input:DocumentAssemblyBrowserSelection):DocumentAssemblyBrowserOperation;
  start(kind:'run',input:DocumentAssemblyBrowserSelection&{planSha256:string}):DocumentAssemblyBrowserOperation;
  start(kind:'export',input:DocumentAssemblyBrowserSelection&{exportId?:string}):DocumentAssemblyBrowserOperation;
  cancel(options:{operationId:string}):Promise<DocumentAssemblyBrowserOperation>;
  download(input:DocumentAssemblyBrowserDownload,options?:{signal?:AbortSignal}):Promise<VerifiedDownload>;
  /** Drain only admitted work. The original customer retains its own lifetime. */
  close():Promise<void>;
}
export function openDocumentAssemblyWorkspace(options:{
  workspace:JobWorkspace;sourceRoot?:string;intakeAccessToken?:string|null;merchantOrigin?:string|null;
  deadlineMs?:number;pollMs?:number;
}):Promise<DocumentAssemblyWorkspace>;
