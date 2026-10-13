import type {DocumentCompositionWorkspace,DocumentCompositionStageInput,DocumentCompositionSelection,
  DocumentCompositionDownloadInput,DocumentCompositionOperation,DocumentUploadedSource}
  from './composition-workspace.mjs';
import type {DocumentAssemblyWorkspace,DocumentAssemblyBrowserSelection,DocumentAssemblyBrowserOperation,
  DocumentAssemblyBrowserDownload,DocumentAssemblyUpload} from './assembly-workspace.mjs';
import type {DocumentCorrectionDraft,DocumentCorrectionSelection} from './corrections.mjs';
import type {DocumentAssemblyRequest} from './assembly.mjs';
import type {DocumentProviderId} from './index.mjs';
import type {IncomingMessage,ServerResponse} from 'node:http';
import type {VerifiedDownload} from '../../stellar/scf-starforge-20261009/sf88-operator-buyer-cli/resource-library/verified-downloads.mjs';
export const DOCUMENT_AGENT_PATH:'/api/document-composition/mcp';
export const DOCUMENT_AGENT_SCHEMA:'stellar-forge.document-agent.v1';
export const DOCUMENT_AGENT_REQUEST_BYTES:number;
export const DOCUMENT_AGENT_TOOLS:readonly DocumentAgentTool[];
export const DOCUMENT_AGENT_INSTRUCTIONS:string;
export interface DocumentAgentTool {
  name:DocumentAgentToolName;description:string;inputSchema:Record<string,unknown>;
  annotations:{readOnlyHint:boolean;destructiveHint:false;idempotentHint:boolean;openWorldHint:boolean};
}
export interface DocumentAgentPage {offset?:number;limit?:number}
export interface DocumentAgentOperationInput {operationId:string}
export type DocumentAgentRestore=DocumentCompositionSelection&(
  {source:DocumentUploadedSource;sourceFile?:never}|{sourceFile:string;source?:never});
export type DocumentAgentApproval=DocumentCompositionSelection&{approvedPlanSha256:string};
export type DocumentAgentAssembly=DocumentCompositionSelection&{assemblyId:string;assemblySha256:string};
export interface DocumentAgentArguments {
  documents_status:DocumentAgentPage;
  documents_example:{kind?:'orders'|'grouped'|'reports';provider?:DocumentProviderId};
  documents_get:{id:string;sourceSha256?:string;offset?:number;limit?:number};
  documents_stage:DocumentCompositionStageInput;
  documents_restore:DocumentAgentRestore;
  documents_correction_draft:DocumentCompositionSelection&Omit<DocumentCorrectionSelection,'id'>&{newId:string};
  documents_correct:{id:string;draft:DocumentCorrectionDraft};
  documents_quote:DocumentCompositionSelection;
  documents_execute:DocumentAgentApproval;
  documents_receive:DocumentCompositionSelection;
  documents_export:DocumentCompositionSelection&{exportId?:string};
  documents_operation:DocumentAgentOperationInput;
  documents_cancel:DocumentAgentOperationInput;
  documents_download:DocumentCompositionDownloadInput;
  document_assembly_get:DocumentAgentAssembly;
  document_assembly_stage:DocumentCompositionSelection&{assemblyId:string;request:DocumentAssemblyRequest;documentIds:string[]};
  document_assembly_quote:DocumentAgentAssembly;
  document_assembly_execute:DocumentAgentAssembly&{approvedPlanSha256:string};
  document_assembly_receive:DocumentAgentAssembly;
  document_assembly_export:DocumentAgentAssembly&{exportId?:string};
  pdf_bundles_status:DocumentAgentPage;
  pdf_bundle_get:{id:string;sourceSha256?:string};
  pdf_bundle_stage:{id:string;request:DocumentAssemblyRequest;files:Array<DocumentAssemblyUpload&{id:string}>};
  pdf_bundle_restore:DocumentAgentRestore;
  pdf_bundle_materialize:DocumentAssemblyBrowserSelection;
  pdf_bundle_quote:DocumentAssemblyBrowserSelection;
  pdf_bundle_execute:DocumentAgentApproval;
  pdf_bundle_receive:DocumentAssemblyBrowserSelection;
  pdf_bundle_export:DocumentAssemblyBrowserSelection&{exportId?:string};
  pdf_bundle_operation:DocumentAgentOperationInput;
  pdf_bundle_cancel:DocumentAgentOperationInput;
  pdf_bundle_download:DocumentAssemblyBrowserDownload;
}
export type DocumentAgentToolName=keyof DocumentAgentArguments;
export interface DocumentAgentAccepted {
  schema:typeof DOCUMENT_AGENT_SCHEMA;accepted:true;continuation:string;
  operation:DocumentCompositionOperation|DocumentAssemblyBrowserOperation;
}
export interface DocumentAgentDownloadTicket {
  schema:typeof DOCUMENT_AGENT_SCHEMA;url:string;bytes:number;sha256:string;method:'GET';
  singleUse:true;expiresInMs:60000;receiving:string;
}
export type DocumentAgentStartedTool=
  |'documents_stage'|'documents_restore'|'documents_correct'|'documents_quote'|'documents_execute'|'documents_receive'|'documents_export'
  |'document_assembly_stage'|'document_assembly_quote'|'document_assembly_execute'|'document_assembly_receive'|'document_assembly_export'
  |'pdf_bundle_stage'|'pdf_bundle_restore'|'pdf_bundle_materialize'|'pdf_bundle_quote'|'pdf_bundle_execute'|'pdf_bundle_receive'|'pdf_bundle_export';
export type DocumentAgentResult<K extends DocumentAgentToolName>=
  K extends DocumentAgentStartedTool?DocumentAgentAccepted:
  K extends 'documents_download'|'pdf_bundle_download'?DocumentAgentDownloadTicket:
  K extends 'documents_operation'|'documents_cancel'?DocumentCompositionOperation:
  K extends 'pdf_bundle_operation'|'pdf_bundle_cancel'?DocumentAssemblyBrowserOperation:
  K extends 'documents_get'?Awaited<ReturnType<DocumentCompositionWorkspace['get']>>:
  K extends 'document_assembly_get'?Awaited<ReturnType<DocumentCompositionWorkspace['assembly']>>:
  K extends 'pdf_bundle_get'?Awaited<ReturnType<DocumentAssemblyWorkspace['get']>>:
  K extends 'documents_correction_draft'?DocumentCorrectionDraft:
  K extends 'documents_example'?{example:true;request:DocumentCompositionStageInput['request'];
    dataset:DocumentUploadedSource;templates:Record<string,DocumentUploadedSource>}:
  K extends 'documents_status'?ReturnType<DocumentCompositionWorkspace['status']>&{
    agent:{schema:typeof DOCUMENT_AGENT_SCHEMA;path:typeof DOCUMENT_AGENT_PATH};
    compositions:Awaited<ReturnType<DocumentCompositionWorkspace['list']>>}:
  ReturnType<DocumentAssemblyWorkspace['status']>&{assemblies:Awaited<ReturnType<DocumentAssemblyWorkspace['list']>>};
export interface DocumentAgentContext {
  signal?:AbortSignal;
  registerDownload?:(produce:(signal:AbortSignal)=>Promise<VerifiedDownload>)=>Promise<{url:string;bytes:number;sha256:string}>;
}
export interface DocumentAgent {
  readonly tools:readonly DocumentAgentTool[];
  call<K extends DocumentAgentToolName>(name:K,args:DocumentAgentArguments[K],context?:DocumentAgentContext):Promise<DocumentAgentResult<K>>;
}
export interface DocumentAgentOptions {
  example?:(kind:'orders'|'grouped'|'reports',provider:DocumentProviderId,options:{merchantOrigin:string|null})=>
    Promise<DocumentAgentResult<'documents_example'>>;
}
export function createDocumentAgent(controller:DocumentCompositionWorkspace,options?:DocumentAgentOptions):DocumentAgent;
export function documentAgentAuthenticatedRoute(controller:DocumentCompositionWorkspace,options?:DocumentAgentOptions):
  (context:DocumentAgentContext&{url:URL;request:IncomingMessage;response:ServerResponse})=>Promise<boolean>;
