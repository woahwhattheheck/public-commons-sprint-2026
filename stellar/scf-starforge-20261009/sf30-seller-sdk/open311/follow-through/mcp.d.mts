import type {HostConfiguration} from './mcp-client.mjs';
export {readFollowThroughWorkspaceConfiguration} from './mcp-client.mjs';
export {initializeFollowThroughMerchantWorkspace} from './mcp-setup.mjs';
export function followThroughWorkspaceTools(tool:(name:string,description:string,properties:Record<string,unknown>,required:string[],annotations:Record<string,boolean>)=>unknown):unknown[];
export class MerchantOpen311FollowThroughWorkspaces {
  constructor(config:{open311FollowThroughWorkspaces?:HostConfiguration;exportsDirectory:string});
  readonly summary:Record<string,unknown>;
  call(name:string,args?:Record<string,unknown>):Promise<unknown>;
  close():Promise<void>;
}
