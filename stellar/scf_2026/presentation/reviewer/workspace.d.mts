/** MIT. Host-side receiving API for the original grant demonstration. */
export interface PacketOptions {packetFile?:string; expectedSha256?:string; sourceRoot?:string}
export interface WorkspaceOptions {directory:string; sourceRoot?:string}
export interface NativeCheckpoint {
  sequence:number; at:number; status:string; phase:string|null;
  signedRequestDispatched:boolean; attempts:number;
}
export interface NativeQuote {
  quoteId:string; status:string; attempts:number; signedRequestDispatched:boolean;
  observation:string; result:{bytes:number;sha256:string}; checkpoints:NativeCheckpoint[];
}
export interface PacketDocument {
  path:string; contentType:'application/json'; bytes:number; sha256:string;
  origin?:Record<string,unknown>;
}
export interface GrantDemoInspection {
  schema:'stellar-forge.grant-reviewer-packet.v1'; packetId:string; sha256:string; bytes:number;
  operationId:string; primaryQuoteId:string; source:Record<string,unknown>;
  documents:PacketDocument[]; query:Record<string,unknown>;
  quotes:Array<{quoteId:string;invocation:Record<string,unknown>;accepted:Record<string,unknown>;
    status:string;attempts:number;observation:Record<string,unknown>;
    result:{path:string;bytes:number;sha256:string}}>;
}
export interface GrantDemoReceipt {
  schema:'stellar-forge.grant-reviewer-workspace.v1'; state:'READY'; packetId:string;
  packetSha256:string; operationId:string; primaryQuoteId:string; receivedAt:string;
  originalQuoteIds:string[]; newPayments:0; directory:string; reused:boolean; quotes:NativeQuote[];
}
export interface GrantDemoExport {
  schema:'stellar-forge.grant-reviewer-packet.v1'; packetId:string; sourcePacketId:string;
  exportedAt:string; path:string; bytes:number; sha256:string; quotes:NativeQuote[];
}
export interface GrantDemoApplication {
  address:string; consoleUrl:string; directory:string; packetId:string;
  accessToken:string; connectionFile:string; reviewFile:string;
  durable:true; paymentAdapterConnected:false; paymentReconciliationConnected:false;
  close():Promise<void>;
}
export const PACKET_SCHEMA:'stellar-forge.grant-reviewer-packet.v1';
export const WORKSPACE_SCHEMA:'stellar-forge.grant-reviewer-workspace.v1';
export const MAX_PACKET_BYTES:number;
export function inspectGrantDemo(options?:PacketOptions):Promise<GrantDemoInspection>;
export function receiveGrantDemo(options:WorkspaceOptions & PacketOptions):Promise<GrantDemoReceipt>;
export function inspectGrantDemoWorkspace(options:WorkspaceOptions):
  Promise<Omit<GrantDemoInspection,'quotes'> & {directory:string;receivedAt:string;quotes:NativeQuote[]}>;
export function exportGrantDemo(options:WorkspaceOptions & {output:string}):Promise<GrantDemoExport>;
export function startGrantDemo(options:WorkspaceOptions & {port?:number;accessToken?:string}):Promise<GrantDemoApplication>;

