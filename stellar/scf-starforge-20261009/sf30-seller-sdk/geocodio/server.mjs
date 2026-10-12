// MIT. Local operator UI over the retained address workspace.
import {createServer} from 'node:http';
import {readFile,stat} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {randomBytes,timingSafeEqual} from 'node:crypto';
import {resolve,join} from 'node:path';
import {openGeocodioWorkspace} from './workspace.mjs';
export const GEOCODIO_ACTIONS=new Set(['status','intake.import','provider.import','provider.prepare','provider.request','provider.run',
  'policy.save','review.list','review.query','review.decide','review.acceptQualified','edition.build','edition.activate',
  'dataset.query','merchant.configure','package.export','package.import',
  "publisher.status","publisher.prepare","publisher.preview","publisher.reviewDraft","publisher.publish","publisher.activateSnapshot","publisher.collect","publisher.release.stage","publisher.release.inspect","publisher.release.activate","publisher.release.rollback","publisher.release.start","publisher.release.stop","publisher.buyer.review","publisher.buyer.prepare","publisher.buyer.session","publisher.buyer.run","publisher.buyer.recover","publisher.buyer.account","publisher.buyer.export"]);
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const headers={'cache-control':'no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer',
  'content-security-policy':"default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' blob:; base-uri 'none'; frame-ancestors 'none'; form-action 'none'"};
async function body(request){
  const chunks=[];let length=0;
  for await(const chunk of request){length+=chunk.length;if(length>1024*1024)throw Object.assign(new Error('Operator request exceeds one MiB.'),{status:413});chunks.push(chunk);}
  const raw=Buffer.concat(chunks);
  try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw));}catch{throw Object.assign(new Error('Use a complete JSON action payload.'),{status:400});}
}
function requireModel(value, name, methods) {
  if (!object(value) || methods.some(method => typeof value[method] !== 'function'))
    throw new TypeError(name + ' must expose ' + methods.join(', ') + '.');
}

/** Compose original models once. Supplied models are borrowed; only owned models close. */
export async function openGeocodioOperator({directory, workspace: suppliedWorkspace,
  publisher: suppliedPublisher, apiKey = process.env.GEOCODIO_API_KEY, ...backendOptions} = {}) {
  if (typeof directory !== 'string' || !directory.trim()) throw new TypeError('A workspace directory is required.');
  if (suppliedWorkspace !== undefined)
    requireModel(suppliedWorkspace, 'workspace', ['state', 'act', 'readExport', 'close']);
  if (suppliedPublisher !== undefined)
    requireModel(suppliedPublisher, 'publisher', ['state', 'act', 'readExport', 'close']);
  const base = suppliedWorkspace ?? await openGeocodioWorkspace({...backendOptions, directory: resolve(directory), apiKey});
  const ownsWorkspace = suppliedWorkspace === undefined, ownsPublisher = suppliedPublisher === undefined;
  let publisher = suppliedPublisher, openingPublisher, closing;
  const pending = new Set();
  const run = operation => {
    if (closing) return Promise.reject(Object.assign(new Error('The operator is closing.'), {code: 'OPERATOR_CLOSING', status: 409}));
    const job = Promise.resolve().then(operation);
    pending.add(job); job.then(() => pending.delete(job), () => pending.delete(job));
    return job;
  };
  const getPublisher = async () => {
    if (publisher) return publisher;
    if (!openingPublisher) openingPublisher = import('../socrata/publisher.mjs')
      .then(({openSocrataPublisher}) => openSocrataPublisher({directory: join(resolve(directory), 'publisher')}))
      .then(value => { publisher = value; return value; })
      .catch(error => { openingPublisher = undefined; throw error; });
    return openingPublisher;
  };
  const view = async () => ({...await base.state(), publisher: publisher ? await publisher.state() : null});
  return {
    state: () => run(view),
    act: (action, payload = {}) => run(async () => {
      if (!GEOCODIO_ACTIONS.has(action) || !object(payload))
        throw Object.assign(new TypeError('Choose a supported operator action and an object payload.'), {code: 'INVALID_ACTION'});
      if (action.startsWith('publisher.')) {
        const model = await getPublisher(), response = await model.act(action, payload);
        return {...response, state: {...await base.state(), publisher: response.state ?? await model.state()}};
      }
      const response = await base.act(action, payload);
      return {...response, state: {...response.state, publisher: publisher ? await publisher.state() : null}};
    }),
    readExport: (exportId, filename) => run(() => base.readExport(exportId, filename)),
    readPublisherExport: (kind, id) => run(async () => {
      if (!['draft-csv', 'draft-review', 'buyer-config', 'session-manifest', 'session-csv', 'session-jsonl', 'session-review'].includes(kind))
        throw Object.assign(new TypeError('Choose an original publisher export kind.'), {code: 'INVALID_DOWNLOAD'});
      return (await getPublisher()).readExport(kind, id);
    }),
    close() {
      if (!closing) closing = (async () => {
        await Promise.allSettled([...pending]);
        let originalError;
        if (publisher && ownsPublisher) try { await publisher.close(); } catch (error) { originalError = error; }
        if (ownsWorkspace) try { await base.close(); } catch (error) { if (!originalError) originalError = error; }
        if (originalError) throw originalError;
      })();
      return closing;
    }
  };
}

export async function startGeocodioWorkspace({directory,port=0,operator:suppliedOperator,
  workspace:suppliedWorkspace,publisher:suppliedPublisher,apiKey,...options}={}){
  if(!Number.isInteger(port)||port<0||port>65535)throw new TypeError('Port must be an integer from 0 through 65535.');
  if(suppliedOperator!==undefined){
    requireModel(suppliedOperator,'operator',['state','act','readExport','readPublisherExport','close']);
    if(suppliedWorkspace!==undefined||suppliedPublisher!==undefined)throw new TypeError('Supply the original operator or its models.');
  }
  const ownsWorkspace=suppliedOperator===undefined;
  const workspace=suppliedOperator??await openGeocodioOperator({...options,directory,
    workspace:suppliedWorkspace,publisher:suppliedPublisher,apiKey});
  let assets;
  try{assets=await Promise.all([
    ...['index.html','app.mjs','style.css'].map(file=>readFile(new URL('./public/'+file,import.meta.url))),
    readFile(new URL('../socrata/public/publisher.mjs',import.meta.url))]);}
  catch(error){if(ownsWorkspace)await workspace.close().catch(()=>{});throw error;}
  const token=randomBytes(32).toString('base64url'),expected=Buffer.from('Bearer '+token);
  let origin,closing=false;
  const sockets=new Set();
  const server=createServer({maxHeaderSize:16384,requestTimeout:30000,headersTimeout:15000},async(request,response)=>{
    const send=(status,value,type='application/json; charset=utf-8')=>{
      if(response.destroyed)return;
      const bytes=Buffer.isBuffer(value)?value:Buffer.from(type.startsWith('application/json')?JSON.stringify(value):String(value));
      response.writeHead(status,{...headers,'content-type':type,'content-length':bytes.length});response.end(bytes);
    };
    try{
      if(closing)return send(503,{message:'The original operator is closing.'});
      if(!origin||request.headers.host!==new URL(origin).host)return send(421,{message:'Use this operator’s original local address.'});
      if(request.headers.origin&&request.headers.origin!==origin)return send(403,{message:'Use the original operator session.'});
      if(request.method==='GET'){
        if(request.url==='/')return send(200,assets[0],'text/html; charset=utf-8');
        if(request.url==='/app.mjs')return send(200,assets[1],'text/javascript; charset=utf-8');
        if(request.url==='/style.css')return send(200,assets[2],'text/css; charset=utf-8');
        if(request.url==='/publisher.mjs')return send(200,assets[3],'text/javascript; charset=utf-8');
      }
      const authorization=Buffer.from(request.headers.authorization??'');
      if(authorization.length!==expected.length||!timingSafeEqual(authorization,expected))
        return send(401,{message:'Open the private URL printed by this operator.'});
      if(request.method==='GET'&&request.url==='/api/state')return send(200,await workspace.state());
      const publisherDownload=/^\/api\/publisher\/exports\/([^/?]+)\/([^/?]+)$/.exec(request.url??'');
      if(request.method==='GET'&&publisherDownload){
        let kind,id;try{kind=decodeURIComponent(publisherDownload[1]);id=decodeURIComponent(publisherDownload[2]);}
        catch{return send(400,{message:'Choose the original publisher file.'});}
        const file=await workspace.readPublisherExport(kind,id);
        response.writeHead(200,{...headers,'content-type':file.contentType,'content-length':file.bytes.length,
          'content-disposition':"attachment; filename*=UTF-8''"+encodeURIComponent(file.filename)});
        response.end(file.bytes);return;
      }
      const download=/^\/api\/exports\/([^/?]+)\/([^/?]+)$/.exec(request.url??'');
      if(request.method==='GET'&&download){
        let id,name;try{id=decodeURIComponent(download[1]);name=decodeURIComponent(download[2]);}catch{return send(400,{message:'Choose the original exported file.'});}
        const file=await workspace.readExport(id,name),info=await stat(file.path);
        if(!info.isFile()||info.size!==file.bytes)return send(409,{message:'The retained delivery changed.'});
        response.writeHead(200,{...headers,'content-type':file.contentType,'content-length':file.bytes,
          'content-disposition':"attachment; filename*=UTF-8''"+encodeURIComponent(name)});
        const stream=createReadStream(file.path);stream.on('error',()=>response.destroy());stream.pipe(response);return;
      }
      if(request.method!=='POST'||request.url!=='/api/action')return send(404,{message:'Choose an original operator action.'});
      if(!String(request.headers['content-type']??'').startsWith('application/json'))return send(415,{message:'Use an application/json request.'});
      const input=await body(request);
      if(!object(input)||!GEOCODIO_ACTIONS.has(input.action)||!object(input.payload??{}))return send(400,{message:'Choose a supported address action and object payload.'});
      send(200,await workspace.act(input.action,input.payload??{}));
    }catch(error){send(Number.isInteger(error.status)&&error.status>=400&&error.status<=599?error.status:400,
      {code:error.code??'GEOCODIO_OPERATION',message:error.message});}
  });
  server.on('connection',socket=>{sockets.add(socket);socket.once('close',()=>sockets.delete(socket));});
  try{
    await new Promise((accept,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',()=>{server.removeListener('error',reject);accept();});});
    origin='http://127.0.0.1:'+server.address().port;
  }catch(error){server.close();if(ownsWorkspace)await workspace.close().catch(()=>{});throw error;}
  let closed;
  const close=()=>closed??(closed=(async()=>{
    closing=true;
    const stopped=new Promise(resolve=>server.close(resolve));
    server.closeIdleConnections?.();
    let primary;
    try{if(ownsWorkspace)await workspace.close();}catch(error){primary=error;}
    finally{for(const socket of sockets)socket.destroy();await stopped;}
    if(primary)throw primary;
  })());
  return {origin,url:origin+'/#token='+token,token,workspace,close};
}
