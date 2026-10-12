// MIT. Private origin-selected references over the maintained SF31 authorization capabilities.
import { createSourceBearerAuth, createSourceApiKeyAuth } from '../../sf31-buyer-client/source-auth.mjs';
import { normalizeSourceAuthorization } from '../../sf31-buyer-client/public-transport.mjs';
import { need,plain } from './model.mjs';
export function createWfsSourceAuth(configuration,{environment=process.env}={}) {
  need(plain(configuration)&&configuration.schema==='stellar-forge.wfs-source-auth.v1'&&
    Object.keys(configuration).every(k=>['schema','bindings'].includes(k))&&Array.isArray(configuration.bindings)&&
    configuration.bindings.length>=1&&configuration.bindings.length<=64,'Select the private source authentication references.','WFS_SOURCE_AUTH_INVALID');
  const origins=new Map(),owned=[];let closed=false;
  for(const binding of configuration.bindings){
    need(plain(binding)&&['Bearer','ApiKey','Basic'].includes(binding.scheme),'Select a supported original source authorization scheme.');
    const capability=normalizeSourceAuthorization({origin:binding.origin,scheme:binding.scheme});
    need(!origins.has(capability.origin),'Keep one source credential binding per origin.');
    const key=binding.scheme==='Bearer'?'tokenEnv':binding.scheme==='ApiKey'?'apiKeyEnv':'authorizationEnv';
    need(Object.keys(binding).every(k=>['origin','scheme',key].includes(k))&&
      typeof binding[key]==='string'&&/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(binding[key]),
      'Use an environment reference for the assigned source credential.');
    if(binding.scheme==='Basic')origins.set(capability.origin,{capability,authorizationEnv:binding.authorizationEnv});
    else {
      const factory=binding.scheme==='Bearer'?createSourceBearerAuth:createSourceApiKeyAuth;
      const provider=factory({bindings:[{origin:binding.origin,[key]:binding[key]}],environment});
      owned.push(provider);origins.set(capability.origin,{capability,provider});
    }
  }
  return Object.freeze({
    origins:Object.freeze([...origins.keys()]),
    authorizationForOrigin(origin){need(!closed,'The source authentication session is closed.');return origins.get(origin)?.capability??null;},
    async requestHeaders(request){
      need(!closed,'The source authentication session is closed.');request.signal?.throwIfAborted();
      const url=new URL(request.url),selected=origins.get(url.origin);
      if(!selected)return {};
      need(url.protocol==='https:'&&!url.username&&!url.password&&!url.hash&&request.method==='GET',
        'Use the original selected HTTPS source request.','WFS_SOURCE_AUTH_REQUEST_INVALID');
      if(selected.provider)return selected.provider.requestHeaders(request);
      const value=environment[selected.authorizationEnv];
      need(typeof value==='string'&&value.length<=16384&&/^Basic [A-Za-z0-9+/]+={0,2}$/.test(value),
        'The assigned Basic authorization environment value is unavailable or invalid.','WFS_SOURCE_AUTH_CREDENTIAL_INVALID');
      return {authorization:value};
    },
    close(){if(closed)return;closed=true;for(const provider of owned)provider.close();}
  });
}
