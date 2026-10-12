/** MIT. Private workbench around the original grant demonstration. */
import type {PacketOptions, WorkspaceOptions, GrantDemoInspection, GrantDemoReceipt, GrantDemoExport} from './workspace.mjs';
export interface ReviewerSelection {
  schema:'stellar-forge.grant-reviewer-selection.v1'; id:string; revision:number;
  title:string; state:'REVIEWED'|'RECEIVED'; packet:GrantDemoInspection;
  createdAt:string; origin:Record<string,unknown>; receipt?:GrantDemoReceipt;
}
export interface ReviewerAction {
  schema:'stellar-forge.grant-reviewer-action.v1'; id:string; kind:string; input:Record<string,unknown>;
  inputHash:string; createdAt:string; attempts:number; state:'PREPARED'|'COMPLETED'|'CONTINUATION_REQUIRED';
  result?:Record<string,unknown>; error?:{code:string;message:string};
}
export interface ReviewerWorkbenchState {
  schema:'stellar-forge.grant-reviewer-workbench.v1'; id:string; instanceId:string; directory:string;
  selections:ReviewerSelection[]; operations:ReviewerAction[]; selected:{selectionId:string;packetId:string}|null;
  buyer:{active:boolean;selectionId?:string;packetId?:string;consoleUrl?:string;instanceId?:string};
  newPayments:0; signingConnected:false;
}
export interface ReviewerSelectionAction {requestId:string;selectionId:string;expectedRevision:number}
export interface ReviewerWorkbenchModel {
  directory:string; instanceId:string; workbenchId:string; sourceRoot:string;
  snapshot():Promise<ReviewerWorkbenchState>;
  review(input:{requestId:string;title?:string;source:'bundled'|'export'|'upload';exportId?:string;base64?:string;expectedSha256?:string}):
    Promise<{selection:ReviewerSelection;actionId:string;replayed:boolean}>;
  receive(input:ReviewerSelectionAction):Promise<{selection:ReviewerSelection;receipt:GrantDemoReceipt;actionId:string;replayed:boolean}>;
  openBuyer(input:ReviewerSelectionAction):Promise<Record<string,unknown>>;
  closeBuyer(input:{requestId:string}):Promise<Record<string,unknown>>;
  exportPacket(input:ReviewerSelectionAction):Promise<{export:GrantDemoExport;selectionId:string;actionId:string;replayed:boolean}>;
  inspectSelection(id:string):Promise<Record<string,unknown>>;
  close():Promise<void>;
}
export interface ReviewerWorkbenchApplication {
  model:ReviewerWorkbenchModel; address:string; url:string; accessToken:string; connectionFile:string;
  instanceId:string; workbenchId:string; startup:Record<string,unknown>; close():Promise<void>;
}
export const WORKBENCH_READY_SCHEMA:'stellar-forge.grant-reviewer-workbench-ready.v1';
export const WORKBENCH_CONNECTION_SCHEMA:'stellar-forge.grant-reviewer-workbench-connection.v1';
export function startReviewerWorkbench(options:WorkspaceOptions & PacketOptions & {port?:number}):Promise<ReviewerWorkbenchApplication>;
