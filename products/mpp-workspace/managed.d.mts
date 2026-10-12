import type { MppProduct, OpenMppProduct, Environment, NativeVersions } from './workspace.mjs';
export const MPP_PRODUCT_LAUNCH_SCHEMA:'stellar-forge.mpp-product-launch.v1';
export const MPP_PRODUCT_READY_SCHEMA:'stellar-forge.mpp-product-ready.v1';
export interface MppLaunchOptions {directory:string;port?:number;mcpPort?:number;browserOnly?:boolean;tokenEnv?:string}
export interface MppLaunch {
  schema:'stellar-forge.mpp-product-launch.v1';profile:MppProduct;
  options:Required<MppLaunchOptions>;resourceId:string;binding:Record<string,unknown>;bindingSha256:string;
  files:Array<{role:string;path:string;referencePath?:string;bytes:number;sha256:string}>;
  directories:Array<{role:string;path:string;dev:string;ino:string}>;
  native:{workspace:string;createdAt:string;revision:number;profiles:Record<'merchant'|'buyer'|'customer',string|null>};
  customers:{revision:number;selections:Record<string,{label:string;configurationSha256:string}>};
  runtime:{directory:string;versions:NativeVersions;state:'PACKAGES_PRESENT'|'RECEIVING_REQUIRED'};
  authorization:{mode:'browser-only'|'oauth'|'fixed-bearer';tokenEnv:string;oauthPath:string|null;clientOrigins:string[]};
  review:Record<string,unknown>;
}
export interface MppProductReady {
  schema:'stellar-forge.mpp-product-ready.v1';state:'OPEN';bindingSha256:string;resourceId:string;
  name:string;directory:string;workspace:string;workspaceCreatedAt:string;revision:number;
  pid:number;ppid:number;versions:NativeVersions;console:'native';browserUrl:string;mcpUrl:string|null;
  browserOnly:boolean;port:number;mcpPort:number;tokenEnv:string;
}
export function mppLaunchOptions(options:MppLaunchOptions):Required<MppLaunchOptions>;
export function inspectMppLaunch(options:MppLaunchOptions,context?:{environment?:Environment}):Promise<MppLaunch>;
export function openMppProductManaged(options:MppLaunchOptions & {expectedBindingSha256:string},
  context?:{environment?:Environment}):Promise<OpenMppProduct & {startup:MppProductReady;bindingSha256:string;resourceId:string}>;
