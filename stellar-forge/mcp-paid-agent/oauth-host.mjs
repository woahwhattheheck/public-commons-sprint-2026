// MIT. One OAuth configuration and metadata seam for the original MCP launchers.
import { readFile, stat } from 'node:fs/promises';
import { isAbsolute } from 'node:path';

/** Fixed operator tokens remain dependency-free; OAuth loads only when selected. */
export async function loadOAuthResourceHost({configPath,bearerToken,fetchImpl}={}) {
  if (!configPath) {
    if (fetchImpl !== undefined) throw new TypeError('oauthFetchImpl requires an explicit OAuth resource configuration');
    return Object.freeze({transportOptions:Object.freeze({bearerToken}),wrap:handler=>handler,
      describe:()=>({mode:'fixed-bearer'}),close:async()=>{}});
  }
  if (typeof configPath!=='string' || !isAbsolute(configPath))
    throw new TypeError('MCP_OAUTH_CONFIG / --oauth-config must be an absolute trusted configuration path');
  if (bearerToken!==undefined && bearerToken!=='')
    throw new TypeError('Select either an OAuth resource configuration or a fixed bearer token; clear the other setting');
  if ((await stat(configPath)).size > 262144) throw new TypeError('OAuth resource configuration exceeds 256 KiB');
  const bytes=await readFile(configPath);
  if (bytes.length > 262144) throw new TypeError('OAuth resource configuration exceeds 256 KiB');
  let config;
  try { config=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)); }
  catch { throw new TypeError('OAuth resource configuration must contain complete UTF-8 JSON'); }
  const {validateOAuthResourceConfig,createOAuthResourceAuthorization}=await import('./oauth-resource.mjs');
  config=validateOAuthResourceConfig(config);
  // Existing merchant/buyer launchers expose ONE shared operator workspace.
  // Their permitted subjects are explicit per issuer. Multi-user applications
  // embed the core with their own current host authority and state selection.
  if (config.authorizationServers.some(server=>!server.allowedSubjects.length))
    throw new TypeError('Each issuer needs explicit allowedSubjects for this shared operator workspace');
  const authorization=createOAuthResourceAuthorization(config,{...(fetchImpl===undefined?{}:{fetchImpl})});
  return Object.freeze({transportOptions:Object.freeze({authorization}),
    wrap:handler=>{
      if (typeof handler!=='function') throw new TypeError('Original MCP HTTP handler required');
      return (req,res)=>authorization.metadataHandler(req,res) ? undefined : handler(req,res);
    },
    describe:()=>({mode:'oauth',...authorization.describe()}),
    close:()=>authorization.close()});
}
