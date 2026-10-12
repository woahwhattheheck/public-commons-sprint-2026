import type {HostConfiguration} from './mcp-client.mjs';
export {readServiceConfigurationWorkspaceConfiguration} from './mcp-client.mjs';
export {initializeServiceConfigurationMerchantWorkspace} from './mcp-setup.mjs';
export {serviceConfigurationWorkspaceTools} from './mcp-tools.mjs';
export class MerchantOpen311ServiceConfigurationWorkspaces {
  constructor(config:{open311ServiceConfigurationWorkspaces?:HostConfiguration;exportsDirectory:string});
  readonly summary:Record<string,unknown>;
  call(name:string,args?:Record<string,unknown>):Promise<unknown>;
  close():Promise<void>;
}
