// MIT. Typed access to the complete original Property Operations MCP surface.
import type {JSONObject,PropertyWorkspaceState,PreparedPropertyRequest,NativeResult,PropertyGroup,PropertyFileSelection,PublisherFileSelection} from '../../stellar/scf-starforge-20261009/sf30-seller-sdk/property-operations/client.mjs';
export interface MerchantRequestOptions {requestSignal?:AbortSignal;timeoutMs?:number}
export interface PropertyMerchantOptions {url:string;tokenEnv?:string;environment?:Record<string,string>;workspace?:string;signal?:AbortSignal}
export interface FileIdentity {name:string;bytes:number;sha256:string}
export interface PropertyReceivingResult {state:string;workspace:string;createdAt:string;exportId:string;manifestFile:FileIdentity;files:number;bytes:number;native:JSONObject}
export interface PropertyDownloadOptions {workspace:string;client?:PropertyMerchantClient;url?:string;tokenEnv?:string;environment?:Record<string,string>;signal?:AbortSignal;directory:string;exportId:string;expectedManifestSha256?:string}
export interface PropertyMerchantClient {
  readonly endpoint:string;
  call(action:string,args?:JSONObject,options?:MerchantRequestOptions):Promise<unknown>;
  workspaces(args?:JSONObject,options?:MerchantRequestOptions):Promise<unknown>;
  status(args?:{workspace?:string},options?:MerchantRequestOptions):Promise<{workspace:string;native:PropertyWorkspaceState}>;
  records(args:{workspace?:string;group:PropertyGroup;offset?:number;limit?:number;expectedRevision?:number},options?:MerchantRequestOptions):Promise<unknown>;
  record(args:{workspace?:string;group:PropertyGroup;id:string},options?:MerchantRequestOptions):Promise<{workspace:string;native:NativeResult}>;
  operation(args:{workspace?:string;key:string},options?:MerchantRequestOptions):Promise<{workspace:string;native:NativeResult}>;
  prepare(args:{workspace?:string;action:string;input:JSONObject;key:string},options?:MerchantRequestOptions):Promise<{workspace:string;prepared:PreparedPropertyRequest}>;
  fileImportPrepare(args:{workspace?:string;fileAlias:string;bytes:number;sha256:string;key:string;actor:string;note:string},options?:MerchantRequestOptions):Promise<{workspace:string;fileAlias:string;prepared:PreparedPropertyRequest}>;
  inspectRequest(args:{workspace?:string;prepared:PreparedPropertyRequest},options?:MerchantRequestOptions):Promise<unknown>;
  invoke(args:{workspace?:string;prepared:PreparedPropertyRequest;resumeIssued?:boolean},options?:MerchantRequestOptions):Promise<{workspace:string;native:NativeResult}>;
  action(args:{workspace?:string;action:string;payload:JSONObject},options?:MerchantRequestOptions):Promise<{workspace:string;native:NativeResult}>;
  files(args?:{workspace?:string;offset?:number;limit?:number;expectedRevision?:number},options?:MerchantRequestOptions):Promise<unknown>;
  file(args:{workspace?:string;selection:PropertyFileSelection},options?:MerchantRequestOptions):Promise<unknown>;
  fileRead(args:{workspace?:string;selection:PropertyFileSelection;expectedSha256:string;offset?:number;limit?:number;readId?:string},options?:MerchantRequestOptions):Promise<unknown>;
  fileRelease(args:{workspace?:string;readId:string},options?:MerchantRequestOptions):Promise<unknown>;
  publisherFile(args:PublisherFileSelection&{workspace?:string},options?:MerchantRequestOptions):Promise<unknown>;
  publisherFileRead(args:PublisherFileSelection&{workspace?:string;bytes:number;expectedSha256:string;offset?:number;limit?:number;readId?:string},options?:MerchantRequestOptions):Promise<unknown>;
  exportPrepare(args:{workspace?:string;createdAt:string;selection:{kind:'source-export';exportId:string}|{kind:'property-resource';resourceId:string}},options?:MerchantRequestOptions):Promise<PropertyReceivingResult>;
  exportManifest(args:{workspace?:string;exportId:string},options?:MerchantRequestOptions):Promise<unknown>;
  exportInventory(args:{workspace?:string;exportId:string;offset?:number;limit?:number},options?:MerchantRequestOptions):Promise<unknown>;
  exportFile(args:{workspace?:string;exportId:string;file:string;expectedManifestSha256:string;expectedSha256:string;offset?:number;limit?:number;readId?:string},options?:MerchantRequestOptions):Promise<unknown>;
  exportFileRelease(args:{workspace?:string;exportId:string;readId:string},options?:MerchantRequestOptions):Promise<unknown>;
  reconnect(args:{workspace?:string;createdAt:string;propertyId?:string|null},options?:MerchantRequestOptions):Promise<unknown>;
  toolDefinitions():Array<{name:string;description:string;inputSchema:JSONObject;annotations:JSONObject}>;
  close():Promise<void>;
  download(args:Omit<PropertyDownloadOptions,'client'|'workspace'>&{workspace?:string}):Promise<unknown>;
  inspectDownload(args:Omit<PropertyDownloadOptions,'client'|'workspace'>&{workspace?:string}):Promise<unknown>;
}
export const propertyActions:Readonly<Record<string,{name:string;description:string;inputSchema:JSONObject;annotations:JSONObject}>>;
export function openPropertyClient(options:PropertyMerchantOptions):Promise<PropertyMerchantClient>;
export function downloadPropertyExport(options:PropertyDownloadOptions):Promise<unknown>;
export function inspectPropertyExport(options:PropertyDownloadOptions):Promise<unknown>;
export function reopenPropertyExport(options:{directory:string;exportId:string;expectedManifestSha256?:string}):Promise<unknown>;
