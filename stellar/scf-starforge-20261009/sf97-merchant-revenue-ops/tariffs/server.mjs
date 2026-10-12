// MIT. Operator HTTP adapter; all writes use the original pricing workspace.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { randomBytes, timingSafeEqual } from 'node:crypto';

const POLICY = "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; frame-ancestors 'none'; form-action 'none'";
const error = (code,message,status=422) => Object.assign(new Error(message),{code,status});
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);

export async function handleTariffRequest({req,res,url,workspace,prefix='/api',authorize,json,reply,body}) {
  if (url.pathname !== prefix && !url.pathname.startsWith(prefix+'/')) return false;
  try {
    authorize();
    const path = url.pathname.slice(prefix.length);
    if (url.hash || (url.search && (!['/source','/repricing/source'].includes(path) ||
        [...url.searchParams.keys()].some(key=>key!=='version') || url.searchParams.getAll('version').length !== 1)))
      throw error('TARIFF_URL_INVALID','Use the selected tariff operation and its documented parameters.',400);
    if (req.method === 'GET' || req.method === 'HEAD') {
      if (path === '/state') json(200,await workspace.state());
      else if (path === '/source') json(200,await workspace.source(url.searchParams.get('version')));
      else if (path === '/repricing/source') json(200,await workspace.repricingSource(url.searchParams.get('version')));
      else if (path === '/plans') json(200,await workspace.list());
      else if (path === '/bundle') reply(200,'application/json; charset=utf-8',await workspace.bundle(),
        {'content-disposition':'attachment; filename="tariff-portfolio.json"'});
      else {
        const file = /^\/plans\/([a-f0-9-]{36})\/files\/([^/]+)$/.exec(path);
        const plan = /^\/plans\/([a-f0-9-]{36})$/.exec(path);
        const originalFile = /^\/(pricing|repricing)\/([a-f0-9-]{36})\/files\/(.+)$/.exec(path);
        if (file) {
          const name = decodeURIComponent(file[2]), bytes = await workspace.download(file[1],name);
          reply(200,name.endsWith('.csv')?'text/csv; charset=utf-8':'application/json; charset=utf-8',bytes,
            {'content-disposition':'attachment; filename="'+name.replace(/[^a-zA-Z0-9_.-]/g,'_')+'"'});
        } else if (originalFile) {
          const name = decodeURIComponent(originalFile[3]);
          const bytes = await (originalFile[1] === 'pricing' ? workspace.downloadPricing(originalFile[2],name)
            : workspace.downloadRepricing(originalFile[2],name));
          reply(200,'application/octet-stream',bytes,{'content-disposition':'attachment; filename="'+name.split('/').at(-1).replace(/[^a-zA-Z0-9_.-]/g,'_')+'"'});
        } else if (plan) json(200,await workspace.load(plan[1]));
        else throw error('TARIFF_ROUTE_NOT_FOUND','Tariff operation not found.',404);
      }
      return true;
    }
    if (req.method !== 'POST') {
      reply(405,'text/plain; charset=utf-8','Use GET or POST.',{allow:'GET, HEAD, POST'});
      return true;
    }
    const actions = {
      '/preview':'preview', '/plans':'save', '/selection':'selection', '/selection/commit':'commitSelection',
      '/receive':'receive', '/repricing/preview':'previewRepricing', '/repricing/save':'saveRepricing',
      '/repricing/stage':'stageRepricing'
    };
    if (!Object.hasOwn(actions,path)) throw error('TARIFF_ROUTE_NOT_FOUND','Tariff operation not found.',404);
    const input = await body(path === '/receive' ? 64*1024*1024 : 16*1024*1024);
    json(200,await workspace[actions[path]](input));
  } catch (failure) {
    json(failure.status ?? (failure instanceof TypeError || failure instanceof RangeError ? 422 : 500),
      {error:{code:failure.code ?? 'TARIFF_OPERATION_FAILED',message:failure.message ?? 'Tariff operation failed.'}});
  }
  return true;
}

export async function startTariffServer({workspace,port=0}={}) {
  if (!workspace || !Number.isInteger(port) || port < 0 || port > 65535)
    throw error('TARIFF_SERVER_INPUT_REQUIRED','Supply an opened tariff workspace and a port from 0 to 65535.');
  const token = randomBytes(32).toString('hex'), expected = Buffer.from(token);
  const assets = new Map(await Promise.all([
    ['/','index.html','text/html; charset=utf-8'],
    ['/browser.mjs','browser.mjs','text/javascript; charset=utf-8'],
    ['/style.css','style.css','text/css; charset=utf-8']
  ].map(async([path,name,type])=>[path,{type,bytes:await readFile(new URL('./public/'+name,import.meta.url))}])));
  let hosts = new Set(), origins = new Set(), closing;
  const running = new Set();
  const server = createServer((req,res)=>{
    const reply = (status,type,data,extra={})=>{
      if (res.destroyed) return;
      const bytes = Buffer.isBuffer(data) ? data :
        Buffer.from(typeof data === 'string' ? data : JSON.stringify(data));
      res.writeHead(status,{'content-type':type,'content-length':String(bytes.length),'cache-control':'no-store',
        'x-content-type-options':'nosniff','referrer-policy':'no-referrer','cross-origin-resource-policy':'same-origin',
        'content-security-policy':POLICY,...extra});
      res.end(req.method === 'HEAD' ? undefined : bytes);
    };
    const json = (status,value)=>reply(status,'application/json; charset=utf-8',value);
    const authorize = ()=>{
      const supplied = Buffer.from(String(req.headers.authorization ?? '').replace(/^Bearer /,''));
      if (supplied.length !== expected.length || !timingSafeEqual(supplied,expected))
        throw error('TARIFF_SESSION_REQUIRED','Open the private launch URL for this workspace.',403);
    };
    const body = async(maximum)=>{
      if (req.headers['content-type']?.split(';')[0].trim().toLowerCase() !== 'application/json')
        throw error('TARIFF_JSON_REQUIRED','Use application/json.',415);
      let length = 0; const chunks = [];
      for await (const chunk of req) {
        length += chunk.length;
        if (length > maximum) throw error('TARIFF_INPUT_TOO_LARGE','The request exceeds the supported size.',413);
        chunks.push(chunk);
      }
      let value;
      try { value = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
      catch { throw error('TARIFF_JSON_INVALID','Use a complete JSON object.'); }
      if (!object(value)) throw error('TARIFF_JSON_INVALID','Use a JSON object.');
      return value;
    };
    const task = (async()=>{
      if (!hosts.has(req.headers.host) || (req.headers.origin && !origins.has(req.headers.origin)) ||
          ['cross-site','same-site'].includes(req.headers['sec-fetch-site']))
        throw error('TARIFF_ORIGIN_REQUIRED','Open the local tariff workspace directly.',403);
      const url = new URL(req.url,'http://'+req.headers.host);
      if (await handleTariffRequest({req,res,url,workspace,authorize,json,reply,body})) return;
      if (url.search || url.hash) throw error('TARIFF_URL_INVALID','Use the workspace page URL.',400);
      const asset = assets.get(url.pathname);
      if (asset && (req.method === 'GET' || req.method === 'HEAD')) return reply(200,asset.type,asset.bytes);
      throw error('TARIFF_PAGE_NOT_FOUND','Tariff page not found.',404);
    })().catch(failure=>json(failure.status ?? 500,
      {error:{code:failure.code ?? 'TARIFF_OPERATION_FAILED',message:failure.message ?? 'Tariff operation failed.'}}));
    running.add(task);
    task.finally(()=>running.delete(task));
  });
  server.headersTimeout = 10000;
  server.requestTimeout = 10*60*1000;
  server.keepAliveTimeout = 2000;
  await new Promise((done,fail)=>{
    const onError = failure=>{server.removeListener('listening',onListen);fail(failure);};
    const onListen = ()=>{server.removeListener('error',onError);done();};
    server.once('error',onError);server.once('listening',onListen);server.listen(port,'127.0.0.1');
  });
  const assigned = server.address().port;
  hosts = new Set(['127.0.0.1:'+assigned,'localhost:'+assigned]);
  origins = new Set([...hosts].map(host=>'http://'+host));
  return {url:'http://127.0.0.1:'+assigned+'/#token='+token,server,workspace,
    close() {
      return closing ??= (async()=>{
        await new Promise((done,fail)=>{
          server.close(failure=>failure?fail(failure):done());
          server.closeIdleConnections?.();
        });
        await Promise.allSettled([...running]);
      })();
    }};
}
