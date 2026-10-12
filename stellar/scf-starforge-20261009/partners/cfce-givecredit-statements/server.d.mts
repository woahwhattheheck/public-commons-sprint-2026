import type {GiveCreditWorkspace} from './index.mjs';
export const STARTUP_SCHEMA:'stellar-forge.givecredit-startup.v1';
export interface GiveCreditStartup {schema:typeof STARTUP_SCHEMA;directory:string;workspaceId:string;url:string}
export interface GiveCreditService {schema:typeof STARTUP_SCHEMA;server:unknown;workspace:GiveCreditWorkspace;url:string;startup:GiveCreditStartup;close():Promise<void>}
export function createGiveCreditServer(options:{directory:string;port?:number|string;expectedWorkspaceId?:string}):Promise<GiveCreditService>;
