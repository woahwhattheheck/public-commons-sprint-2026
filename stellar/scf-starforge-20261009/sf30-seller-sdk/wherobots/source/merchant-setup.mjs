// MIT. Initialize the shared merchant around existing original Wherobots workspaces.
import {mkdir} from "node:fs/promises";
import path from "node:path";
import {readWherobotsWorkspaceConfiguration} from "./merchant-provider.mjs";
import {exact,line,writePrivate} from "../../../../../stellar-forge/mcp-merchant-operator/host-files.mjs";

export async function initializeWherobotsMerchant(options){
  exact(options,["directory","connection","name"],["directory","connection"]);
  const root=path.resolve(options.directory),connection=path.resolve(options.connection),name=line(options.name??"Wherobots spatial operations","Merchant name");
  const selection=await readWherobotsWorkspaceConfiguration(connection);
  await mkdir(root,{mode:0o700});
  await (await import("../../../sf82-seller-pilot/releases.mjs")).initReleaseStore(path.join(root,"releases"));
  await mkdir(path.join(root,"customer-exports"),{mode:0o700});
  const configuration=path.join(root,"merchant-mcp.json");
  await writePrivate(configuration,{schema:"stellar-forge.merchant-mcp.v1",name,releaseStore:"./releases",
    exportsDirectory:"./customer-exports",sources:{},wherobotsWorkspaceConnection:connection});
  await (await import("../../../../../stellar-forge/mcp-merchant-operator/config.mjs")).readMerchantConfig(configuration);
  return {schema:"stellar-forge.merchant-mcp.v1",configuration,state:"INITIALIZED",
    workspaces:Object.entries(selection.workspaces).map(([workspace,value])=>({workspace,label:value.label,workspace_id:value.workspaceId}))};
}
