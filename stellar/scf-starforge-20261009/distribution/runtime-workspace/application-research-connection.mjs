// MIT. Private original Research connection selection for the maintained Applications providers.
import {join,dirname} from 'node:path';
import {pathToFileURL} from 'node:url';
import {absolute,need,digest} from './storage.mjs';

export const RESEARCH_ROOT='stellar/scf-starforge-20261009/sf88-operator-buyer-cli/research-dossiers';
export const RESEARCH_CONNECTION_FILES=['workspace-files.mjs','workspace-protocol.mjs','workspace-contracts.mjs'];
export const defaultResearchConnectionFile=directory=>join(absolute(directory),'research-connection.json');

export async function readResearchApplicationConnection(sourceRoot,file,directory,{sha256}={}) {
  absolute(sourceRoot);absolute(file);absolute(directory);
  const [{readResearchHostFile},{researchConnection,researchWorkspaceId}]=await Promise.all([
    import(pathToFileURL(join(sourceRoot,RESEARCH_ROOT,'workspace-files.mjs')).href),
    import(pathToFileURL(join(sourceRoot,RESEARCH_ROOT,'workspace-protocol.mjs')).href),
  ]);
  need(typeof readResearchHostFile==='function'&&typeof researchConnection==='function'&&
    typeof researchWorkspaceId==='function','APPLICATION_RESEARCH_CONNECTION_READER_REQUIRED');
  const bytes=await readResearchHostFile(file,65536,{privateFile:true,...(sha256?{sha256}:{})});
  const record=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
  const connection=researchConnection(record),workspaceId=researchWorkspaceId(directory);
  need((record.directory===directory||record.workspaceId===workspaceId)&&
    (record.directory===undefined||record.directory===directory)&&
    (connection.workspaceId===undefined||connection.workspaceId===workspaceId),
    'APPLICATION_RESEARCH_CONNECTION_CHANGED',
    'Start the original Research application with this directory and private connection file.');
  return {record,connection,workspaceId,sha256:digest(bytes)};
}

/** A new reviewed Research directory is created by the existing Applications save operation. */
export async function researchConnectionDestination(file,workspace,inputPath) {
  absolute(file);
  if(!workspace.exists&&dirname(file)===workspace.path)
    return {path:file,kind:'file',exists:false,parent:workspace.path};
  return inputPath(file,'file',true,true);
}
