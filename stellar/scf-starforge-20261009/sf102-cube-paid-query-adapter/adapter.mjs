// MIT. Narrow paid analytics adapter. The existing SF30 seller exclusively owns x402 settlement.
// Reuses the source-native upstream transport, including DNS pinning, TLS, budgets and concurrency.
import {createUpstreamHandlers} from '../sf30-seller-sdk/upstream.mjs';
import {compileCubeCatalog, renderCubeQuery} from './cube-template.mjs';

const plain = x => x !== null && typeof x === 'object' && !Array.isArray(x) &&
  [Object.prototype,null].includes(Object.getPrototypeOf(x));
const failure = (status, error) => ({status,
  headers:{'content-type':'application/json; charset=utf-8'},body:{error}});

/** Merchant-owned configuration contains NO secret values, only an environment variable name. */
export function createCubePaidHandler(config, options = {}) {
  if (!plain(config) || !plain(options) ||
      Object.keys(config).some(k => !['schema','origin','path','authEnv','timeoutMs',
        'maxResponseBytes','maxInFlight','maxRows','reports'].includes(k)) ||
      Object.keys(options).some(k => !['allowLoopback','env','lookup'].includes(k))) throw new TypeError('Invalid Cube adapter options');
  const catalog = compileCubeCatalog(config);
  const authEnv = config.authEnv;
  if (typeof authEnv !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(authEnv)) throw new TypeError('Server authorization environment variable required');
  const maxRows = config.maxRows ?? 1000;
  if (!Number.isSafeInteger(maxRows) || maxRows < 1 || maxRows > 10000) throw new TypeError('Invalid Cube row limit');
  const bindings = {schema:'stellar-forge.seller-upstreams.v1',bindings:{cube:{
    origin:config.origin,path:config.path ?? '/cubejs-api/v1/load',method:'POST',
    query:[],headerEnv:{Authorization:authEnv},responseMode:'json',
    timeoutMs:config.timeoutMs ?? 10000,maxResponseBytes:config.maxResponseBytes ?? 262144,
    maxInFlight:config.maxInFlight ?? 8,
  }}};
  const shared = createUpstreamHandlers(bindings,{
    allowLoopback:options.allowLoopback === true,
    ...(options.env === undefined ? {} : {env:options.env}),
    ...(options.lookup === undefined ? {} : {lookup:options.lookup}),
  }).cube;
  const handler = async context => {
    let query;
    try { query = renderCubeQuery(catalog,context); }
    catch { return failure(400,'REPORT_INPUT_INVALID'); }
    // All untrusted request headers, cookies, URLs and bodies are discarded.
    // The original upstream helper constructs the fixed POST and server-only authorization.
    const result = await shared({
      method:'POST',url:new URL('http://127.0.0.1/__approved-cube-query'),
      pathParams:{},headers:{},body:{query},
    });
    if (result.status !== 200) return result;
    try {
      const decoded = JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(result.body));
      if (!plain(decoded) || !Array.isArray(decoded.data) || decoded.data.length > maxRows ||
          Object.hasOwn(decoded,'error') || Object.hasOwn(decoded,'errorCode')) throw new TypeError('Invalid Cube result');
    } catch { return failure(502,'CUBE_RESULT_INVALID'); }
    return {status:200,headers:{'content-type':'application/json; charset=utf-8'},body:result.body};
  };
  handler.snapshot = () => Object.freeze({...shared.snapshot(),approvedReports:catalog.size});
  return handler;
}
