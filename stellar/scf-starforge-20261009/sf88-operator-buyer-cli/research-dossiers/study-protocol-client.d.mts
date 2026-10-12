// MIT. Registered protocol review on the existing Research attachment.
export interface ProtocolRequest {
  schema:'sf88-study-protocol-receive-request/v1';
  requestId:string; workspaceId:string; dossierId:string; questionId:string;
  bundleSha256:string; bundleBytes:number; expectedRevision:number; rawText:string;
}
export interface ProtocolInspection {
  schema:'sf88-study-protocol-inspection/v1'; nctId:string; operation:string;
  bundleSha256:string; bundleBytes:number; methodsSha256:string;
  sourceUrl:string; fileCount:number; pdfPages:number;
  registry:{filename:string; bytes:number; sha256:string; [key:string]:unknown};
  protocol:{name:string; bytes:number; sha256:string};
  methods:Record<string,unknown>;
  files:Array<{name:string; bytes:number; sha256:string; mediaType:string}>;
  provenance:{kind:'retained-original-capture'; http:Record<string,unknown>; text:Record<string,unknown>};
  sourceBundle:Record<string,unknown>;
}
export interface ProtocolPreview extends Record<string,unknown> {
  dossierId:string; questionId:string; bundleSha256:string; bundleBytes:number;
  expectedRevision:number; alreadyReceived:boolean; editionId?:string;
}
export interface ProtocolPrepared {
  request:ProtocolRequest; inspection:ProtocolInspection; preview:ProtocolPreview;
}
export interface ProtocolDossier extends Record<string,unknown> {
  id:string; revision:number; questions:Array<{id:string; [key:string]:unknown}>;
  editions:Array<Record<string,unknown>>;
}
export interface ProtocolCaptureInput {
  studyFile:string; directory:string; operation?:string;
  pdftotext?:string; pdfinfo?:string; fetch?:typeof globalThis.fetch; timeoutMs?:number;
}
export interface ProtocolReceivingInput {
  captureDirectory:string; directory:string; dossierId:string; questionId:string;
  baseRevision:number; operation?:string; expectedWorkspaceId?:string; engineSourceFile?:string;
}
export interface StudyProtocolClient {
  inspectBytes(bytes:Uint8Array):Promise<ProtocolInspection>;
  inspectFile(input:{file:string; sha256?:string}):Promise<ProtocolInspection>;
  inspectCapture(directory:string):Promise<{capture:Record<string,unknown>; inspection:ProtocolInspection}>;
  capture(input:ProtocolCaptureInput):Promise<Record<string,unknown>>;
  prepare(input:{dossierId:string; questionId:string; bytes:Uint8Array}):Promise<ProtocolPrepared>;
  prepareFile(input:{file:string; sha256?:string; dossierId:string; questionId:string}):Promise<ProtocolPrepared>;
  receive(request:ProtocolRequest):Promise<ProtocolDossier>;
  reconcile(request:ProtocolRequest):Promise<{
    schema:'sf88-study-protocol-receive-request/v1'; requestId:string;
    workspaceId:string; dossierId:string; questionId:string;
    state:'ALREADY_RECEIVED'|'NOT_RECEIVED';
    originalExpectedRevision:number; currentRevision:number; preview:ProtocolPreview;
  }>;
  receiveCapture(input:ProtocolReceivingInput):Promise<Record<string,unknown>>;
}
export const STUDY_PROTOCOL_RECEIVE_REQUEST:'sf88-study-protocol-receive-request/v1';
export function inspectStudyProtocolReceiveRequest(request:ProtocolRequest):{
  request:ProtocolRequest; bytes:Uint8Array; inspection:ProtocolInspection;
};
export function createStudyProtocolClient(input:{
  client:{
    status():Promise<{workspaceId:string; api:Record<string,unknown>}>;
    previewSourceBundleBytes(dossierId:string,input:{questionId:string; bytes:Uint8Array}):Promise<ProtocolPreview>;
    receiveSourceBundleBytes(dossierId:string,input:{questionId:string; bytes:Uint8Array;
      expectedBundleSha256:string; expectedRevision:number}):Promise<ProtocolDossier>;
    [key:string]:unknown;
  };
  run:<T>(work:()=>Promise<T>|T)=>Promise<T>;
}):StudyProtocolClient;
