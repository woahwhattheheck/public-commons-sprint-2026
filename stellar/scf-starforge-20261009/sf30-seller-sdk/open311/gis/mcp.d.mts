import type { HostConfiguration } from './mcp-client.mjs';
export { readGISWorkspaceConfiguration } from './mcp-client.mjs';
export { initializeGISMerchantWorkspace } from './mcp-setup.mjs';
export function gisWorkspaceTools<T>(tool:(name:string,description:string,properties:Record<string,unknown>,required:string[],annotations?:Record<string,boolean>)=>T):T[];
export class MerchantOpen311GISWorkspaces { constructor(config:{open311GISWorkspaces?:HostConfiguration;exportsDirectory:string}); readonly summary:Record<string,unknown>; call(name:string,args?:Record<string,unknown>):Promise<unknown>; close():Promise<void>; }
