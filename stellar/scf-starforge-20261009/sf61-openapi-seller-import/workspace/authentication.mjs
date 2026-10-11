// MIT. OpenAPI authentication choices compiled by the original OAuth provider.
import { createOpenApiResolver } from '../importer.mjs';
import { compileOAuthClientCredentials } from '../../sf30-seller-sdk/oauth-client-credentials.mjs';

const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const own = (value, key) => Object.hasOwn(value, key);
const fail = message => { throw new TypeError(message); };
const scopeToken = /^[\x21\x23-\x5b\x5d-\x7e]+$/;

function describeScheme(spec, name) {
  if (!plain(spec.components?.securitySchemes) || !own(spec.components.securitySchemes, name))
    fail('Security scheme is absent: ' + name);
  const scheme = createOpenApiResolver(spec).reference(spec.components.securitySchemes[name]);
  if (!plain(scheme)) fail('Invalid security scheme: ' + name);
  if (scheme.type === 'apiKey' && scheme.in === 'header') {
    if (typeof scheme.name !== 'string' || !scheme.name) fail('Header API key needs a header name');
    return {name, type:'apiKey', header:scheme.name.toLowerCase()};
  }
  if (scheme.type === 'http' && ['bearer','basic'].includes(String(scheme.scheme).toLowerCase()))
    return {name, type:'http', scheme:String(scheme.scheme).toLowerCase(), header:'authorization'};
  if (scheme.type !== 'oauth2') fail('Use header API keys, HTTP bearer/basic or OAuth client credentials for ' + name);
  const flow = scheme.flows?.clientCredentials;
  if (!plain(flow)) fail('Security scheme ' + name + ' has no clientCredentials flow; choose another declared alternative');
  if (typeof flow.tokenUrl !== 'string' || !flow.tokenUrl || flow.tokenUrl.length > 2048 || !plain(flow.scopes))
    fail('Client credentials need a declared token URL and scope map');
  const scopes = Object.entries(flow.scopes).map(([scope, description]) => {
    if (!scopeToken.test(scope) || scope.length > 2048 || typeof description !== 'string')
      fail('Invalid declared OAuth scope in ' + name);
    return {name:scope, description:description.slice(0,512)};
  });
  return {name, type:'oauth2', flow:'clientCredentials', header:'authorization', tokenUrl:flow.tokenUrl, scopes};
}

/** Shared definitions appear once in inspection, rather than once per route. */
export function inspectBackendSecurity(spec) {
  if (spec.components?.securitySchemes === undefined) return [];
  if (!plain(spec.components.securitySchemes)) fail('Invalid OpenAPI security schemes');
  return Object.keys(spec.components.securitySchemes).map(name => {
    try { return {...describeScheme(spec,name), supported:true}; }
    catch (error) { return {name, supported:false, error:error.message}; }
  });
}

export function inspectAuthenticationRequirements(spec, operation, definitions=inspectBackendSecurity(spec)) {
  const requirements = operation.security ?? spec.security ?? [];
  if (!Array.isArray(requirements) || requirements.some(value=>!plain(value))) fail('Invalid OpenAPI security requirements');
  const byName = new Map(definitions.map(value=>[value.name,value]));
  return (requirements.length ? requirements : [{}]).map((requirement,index) => {
    const names = Object.keys(requirement), schemes = [];
    try {
      const headers = new Set();
      for (const name of names) {
        const requiredScopes = requirement[name], definition = byName.get(name);
        if (!definition) fail('Security scheme is absent: ' + name);
        if (!definition.supported) fail(definition.error);
        if (!Array.isArray(requiredScopes) || requiredScopes.some(scope=>typeof scope!=='string') || new Set(requiredScopes).size!==requiredScopes.length)
          fail('Security requirements need distinct scope names');
        if (definition.type !== 'oauth2' && requiredScopes.length) fail('Header authentication schemes require an empty scope list');
        if (definition.type === 'oauth2' && requiredScopes.some(scope=>!definition.scopes.some(available=>available.name===scope)))
          fail('Required OAuth scope is absent from the clientCredentials flow: ' + name);
        if (headers.has(definition.header)) fail('This alternative needs multiple credentials in ' + definition.header + '; choose another declared alternative');
        headers.add(definition.header);
        schemes.push({name, requiredScopes:[...requiredScopes]});
      }
      return {index, names, schemes, supported:true};
    } catch (error) { return {index, names, schemes, supported:false, error:error.message}; }
  });
}

/** Resolve against the selected original backend, never the public paid facade. */
export function prepareBackendAuthentication(spec, operation, row, backend, {allowLoopback=false}={}) {
  const definitions = inspectBackendSecurity(spec), byName = new Map(definitions.map(value=>[value.name,value]));
  const alternatives = inspectAuthenticationRequirements(spec,operation,definitions), choice = row.securityAlternative ?? 0;
  if (!Number.isSafeInteger(choice) || choice<0 || !alternatives[choice]) fail('Choose a declared security alternative');
  const alternative = alternatives[choice];
  if (!alternative.supported) fail(alternative.error);
  const headers = row.headerEnv ?? {};
  if (!plain(headers)) fail('headerEnv maps header names to environment-variable names');
  const mapped = new Map(Object.entries(headers).map(([name,value])=>[name.toLowerCase(),value]));
  const authentication = [], environment = new Set(Object.values(headers));
  let oauth2;
  for (const selection of alternative.schemes) {
    const definition = byName.get(selection.name);
    if (definition.type !== 'oauth2') {
      if (!mapped.has(definition.header)) fail('Map the ' + definition.header + ' header to an environment variable for security scheme ' + definition.name);
      authentication.push({scheme:definition.name, type:definition.type, header:definition.header, environment:mapped.get(definition.header)});
      continue;
    }
    if (!plain(row.oauth2)) fail('Set OAuth client ID and client secret environment-variable references for ' + definition.name);
    if (mapped.has('authorization')) fail('OAuth supplies authorization; remove its static header environment mapping');
    let tokenEndpoint;
    try { tokenEndpoint = new URL(definition.tokenUrl,backend).href; }
    catch { fail('The declared OAuth token URL cannot resolve against the selected backend'); }
    if (row.oauth2.tokenEndpoint !== undefined && row.oauth2.tokenEndpoint !== tokenEndpoint)
      fail('OAuth token endpoint must match the selected original server and declared clientCredentials flow');
    const scope = row.oauth2.scope ?? (selection.requiredScopes.length ? selection.requiredScopes.join(' ') : undefined);
    const selected = scope === undefined ? [] : typeof scope === 'string' ? scope.split(' ') : fail('OAuth scope must be a space-separated string');
    if (new Set(selected).size !== selected.length || selected.some(value=>!definition.scopes.some(available=>available.name===value)))
      fail('Select distinct scopes declared by this clientCredentials flow');
    if (selection.requiredScopes.some(value=>!selected.includes(value))) fail('OAuth scope must include every scope required by this operation');
    const declaration = {...row.oauth2, tokenEndpoint, ...(scope===undefined?{}:{scope})};
    // The provider remains the only policy validator. These values are sent to
    // neither a token endpoint nor the saved package; compilation reads no env.
    const env = Object.fromEntries([declaration.clientIdEnv,declaration.clientSecretEnv].filter(name=>typeof name==='string').map(name=>[name,'SET_IN_LAUNCH_ENVIRONMENT']));
    oauth2 = compileOAuthClientCredentials(declaration,{allowLoopback,env});
    environment.add(oauth2.clientIdEnv); environment.add(oauth2.clientSecretEnv);
    authentication.push({scheme:definition.name,type:'oauth2',flow:'clientCredentials',header:'authorization',
      tokenEndpoint:oauth2.tokenEndpoint,authMethod:oauth2.authMethod,requiredScopes:[...selection.requiredScopes],
      scopes:oauth2.scope?.split(' ')??[],clientIdEnv:oauth2.clientIdEnv,clientSecretEnv:oauth2.clientSecretEnv});
  }
  if (row.oauth2 !== undefined && !oauth2) fail('The selected security alternative does not use OAuth client credentials');
  return {authentication,environment:[...environment].sort(),...(oauth2?{oauth2}:{})};
}
