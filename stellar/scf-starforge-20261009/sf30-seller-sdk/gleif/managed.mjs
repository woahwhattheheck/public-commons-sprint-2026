// SPDX-License-Identifier: MIT
import { readFile, lstat, realpath } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join, resolve } from 'node:path';
import { readJson, identity, digest, absolute } from '../postgres/publisher/files.mjs';
import { SCHEMA, need } from './core.mjs';
export const GLEIF_SOURCE='stellar/scf-starforge-20261009/sf30-seller-sdk/gleif';
export const SOURCE_FILES=['core.mjs','source.mjs','workspace.mjs','server.mjs','client.mjs','client.d.mts','managed.mjs','cli.mjs',
  'application-provider.mjs','operator.mjs','operator-tools.mjs','operator-provider.mjs','browser-assets.json','public/index.html','public/app.mjs','public/style.css','monitoring-portfolio.mjs','public/monitoring.mjs','MONITORING_FIELD_MAPPING.md','MONITORING_HANDOVER.md','receiving/monitoring.mjs'];
export async function inspectGleifSource(directory=fileURLToPath(new URL('.',import.meta.url)),expected) {
  directory=await realpath(resolve(directory));const files=[];
  for(const path of SOURCE_FILES){const absolutePath=join(directory,path),stat=await lstat(absolutePath);
    need(stat.isFile()&&!stat.isSymbolicLink()&&await realpath(absolutePath)===absolutePath,'GLEIF_SOURCE_FILE');
    const raw=await readFile(absolutePath),after=await lstat(absolutePath);need(stat.size===after.size&&stat.mtimeMs===after.mtimeMs&&stat.ctimeMs===after.ctimeMs,'GLEIF_SOURCE_CHANGED');
    files.push({path,bytes:raw.length,sha256:digest(raw)});}
  const result={directory,files,sha256:identity(files)};if(expected!==undefined)need(result.sha256===expected,'GLEIF_SOURCE_CHANGED');return result;
}
export async function inspectGleifWorkspace(directory,expected) {
  directory=absolute(directory);const metadata=await readJson(join(directory,'workspace.json'));
  need(metadata.schema===SCHEMA&&typeof metadata.id==='string','GLEIF_WORKSPACE_IDENTITY');const workspaceIdentity=identity(metadata);
  if(expected!==undefined)need(workspaceIdentity===expected,'GLEIF_WORKSPACE_CHANGED');
  return {directory,workspaceId:metadata.id,workspaceIdentity};
}
