import type {HostConfiguration} from './mcp-client.mjs';
export {readFieldDeskWorkspaceConfiguration} from './mcp-client.mjs';
export {initializeFieldDeskMerchantWorkspace} from './mcp-setup.mjs';
export {fieldDeskWorkspaceTools} from './mcp-tools.mjs';
export class MerchantOpen311FieldDeskWorkspaces {
  constructor(config:{open311FieldDeskWorkspaces?:HostConfiguration;exportsDirectory:string});
  readonly summary:Record<string,unknown>;
  call(name:string,args?:Record<string,unknown>):Promise<unknown>;
  close():Promise<void>;
}
