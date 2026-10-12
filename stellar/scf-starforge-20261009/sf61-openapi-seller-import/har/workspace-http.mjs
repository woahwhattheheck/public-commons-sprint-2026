// MIT. Authenticated HAR operations mounted in the original SF61 HTTP lifecycle.
import { openHarConsole, HAR_DECISION_LIMIT, HAR_UPLOAD_LIMIT } from './workspace.mjs';

function selector(url, prefix = '') {
  const get = key => url.searchParams.get(prefix + key);
  const kind = get('kind'), id = get('id'), revision = get('revision');
  return {kind,id,...(revision?{revision}:{})};
}
function page(url) {
  const limit = url.searchParams.get('limit');
  if (limit !== null && !/^[1-9][0-9]{0,2}$/.test(limit)) throw new TypeError('Page limit must be 1–100');
  return {after:url.searchParams.get('after')??'',limit:limit===null?25:Number(limit)};
}
function uploadHeaders(req, limit, types) {
  const type = String(req.headers['content-type']??'').split(';')[0].trim().toLowerCase();
  if (!types.includes(type)) throw Object.assign(new Error('Upload the original selected file bytes'), {status:415});
  if (req.headers['content-encoding'] && req.headers['content-encoding'] !== 'identity')
    throw Object.assign(new Error('Upload the original uncompressed file'),{status:415});
  const declared = req.headers['content-length'];
  if (declared !== undefined && (!/^[0-9]+$/.test(declared) || BigInt(declared)>BigInt(limit)))
    throw Object.assign(new Error('Selected file exceeds its upload limit'),{status:413});
}
function attachment(res, bytes, filename, contentType) {
  res.writeHead(200, {'Content-Type':contentType,'Content-Length':bytes.length,
    'Content-Disposition':'attachment; filename="'+filename+'"',
    'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
  res.end(bytes);
}

/** Call only after the original workspace's Host, Origin and token checks. */
export async function createHarConsoleRoutes({parent}) {
  const app = await openHarConsole({parent});
  return {
    app,
    async get(pathname,url,send,res) {
      if (pathname==='/api/har/library') return send(200,await app.entries(page(url)));
      if (pathname==='/api/har/inspect') return send(200,await app.inspect(selector(url),page(url)));
      if (pathname==='/api/har/source') return send(200,await app.source(selector(url)));
      // Review generation uses a private temporary file and belongs to the
      // original mutation/drain path even though the resulting HTML is a download.
      return send(404,{error:'Unknown capture operation'});
    },
    async upload(req,url,send) {
      if (url.pathname==='/api/har/upload') {
        uploadHeaders(req,HAR_UPLOAD_LIMIT,['application/json','application/octet-stream','application/har+json']);
        const previous = url.searchParams.has('previousKind') ? {
          kind:url.searchParams.get('previousKind'),id:url.searchParams.get('previousId'),
          revision:url.searchParams.get('previousRevision')} : undefined;
        if (!previous && ['previousId','previousRevision'].some(key=>url.searchParams.has(key)))
          throw new TypeError('Select the complete previous capture and saved review');
        return send(201,await app.receive(req,{label:url.searchParams.get('label'),previous}));
      }
      if (url.pathname==='/api/har/decisions') {
        uploadHeaders(req,HAR_DECISION_LIMIT,['application/json','application/octet-stream']);
        const chunks=[]; let size=0;
        for await (const bytes of req) {
          size+=bytes.length;
          if(size>HAR_DECISION_LIMIT)throw Object.assign(new Error('Reviewed decisions exceed 4 MiB'),{status:413});
          chunks.push(bytes);
        }
        return send(201,await app.saveDecisions(selector(url),Buffer.concat(chunks)));
      }
      return send(404,{error:'Unknown capture upload'});
    },
    async post(pathname,body,send,res) {
      if (pathname==='/api/har/adopt') return send(201,await app.adopt(body));
      if (pathname==='/api/har/copy') return send(201,await app.copy(body.selection,body.destination));
      if (pathname==='/api/har/locate') return send(200,{capturedSource:await app.locate(body.specText)});
      if (pathname==='/api/har/reviewer') {
        const result=await app.reviewer(body.selection);
        return attachment(res,result.bytes,result.filename,result.contentType);
      }
      if (pathname==='/api/har/export') {
        const result=await app.source(body.selection), bytes=Buffer.from(result.specText);
        return attachment(res,bytes,'har-'+result.capturedSource.sourceSha256.slice(0,12)+'-openapi.json','application/json; charset=utf-8');
      }
      return send(404,{error:'Unknown capture operation'});
    },
  };
}
