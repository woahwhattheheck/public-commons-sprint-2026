// MIT.
import type {CentralConnection,CentralRequestOptions,CentralAction,CentralCommissioningAction,CentralWarehouseAction,RecordValue} from './index.mjs';
export {CentralWorkspaceClient,connectCentralWorkspace,readCentralConnection,inspectCentralListener,
  ODK_CONNECTION_FILENAME,ODK_CONNECTION_SCHEMA,ODK_STARTUP_SCHEMA,
  centralOperationId,centralActionRoute,requestCentralAction,inspectCentralCommissioning,inspectCentralWarehouse} from './index.mjs';
export type {CentralConnection,CentralConnectionValue,CentralRequestOptions,CentralAction,
  CentralActionNamespace,CentralCommissioningAction,CentralCommissioningState,CentralWarehouseAction,
  CentralWarehouseState,CentralWarehouseRequest,CentralWarehousePrepareInput,CentralWarehouseConnectInput,
  CentralWarehouseInspectInput,CentralWarehouseReviewInput,CentralWarehouseImportInput,
  CentralWarehousePeriodReportInput,CentralWarehouseOperation,CentralWarehouseApproval} from './index.mjs';
export const ODK_MAX_RESPONSE_BYTES:number,ODK_MAX_INPUT_BYTES:number,ODK_MAX_CONTROL_BYTES:number;
export const ODK_HASH:RegExp,ODK_UUID:RegExp;
export const CENTRAL_READ_ACTIONS:Set<CentralAction>,CENTRAL_ACTIONS:Set<CentralAction>;
export const CENTRAL_COMMISSIONING_READ_ACTIONS:Set<CentralCommissioningAction>,CENTRAL_COMMISSIONING_ACTIONS:Set<CentralCommissioningAction>;
export const CENTRAL_WAREHOUSE_READ_ACTIONS:Set<CentralWarehouseAction>,CENTRAL_WAREHOUSE_ACTIONS:Set<CentralWarehouseAction>;
export function odkDigest(bytes:string|Uint8Array):string;
export function odkPlain(value:unknown):value is RecordValue;
export function odkFailure(code:string,message:string,status?:number,details?:RecordValue):Error&{code:string;status:number;details?:RecordValue;data?:RecordValue};
export function odkNeed(value:unknown,code:string,message?:string,status?:number):asserts value;
export function odkExact(value:unknown,allowed:string[],required?:string[]):asserts value is RecordValue;
export function odkAbsolute(value:string):string;
export function odkPrivateDirectory(path:string):Promise<{path:string;dev:string;ino:string}>;
export function odkReadPrivateFile(path:string,maximum?:number):Promise<{path:string;bytes:Uint8Array;sha256:string}>;
export function odkInspectPrivateFile(path:string,maximum?:number):Promise<{path:string;bytes:number;sha256:string;dev:number;ino:number;mtimeMs:number;ctimeMs:number}>;
export function odkParseJson(bytes:Uint8Array):unknown;
export function odkReadPrivateJson(path:string,maximum?:number):Promise<{path:string;bytes:Uint8Array;sha256:string;value:unknown}>;
export function odkWritePrivateJson(path:string,value:unknown,options?:{replace?:boolean}):Promise<{path:string;bytes:number;sha256:string}>;
export function odkConnectionView(connection:CentralConnection):{instanceId:string;workspaceId:string;operator:string;startedAt:string;origin:string;pid:number};
export function odkRequest(connection:CentralConnection,path:string,options:CentralRequestOptions&{method?:'GET'|'POST';body?:unknown;raw:true;readOnly?:boolean}):Promise<{response:Response;release():Promise<void>}>;
export function odkRequest<T=unknown>(connection:CentralConnection,path:string,options?:CentralRequestOptions&{method?:'GET'|'POST';body?:unknown;raw?:false;readOnly?:boolean}):Promise<T>;
