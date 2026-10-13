// MIT. Exact original response collaboration routes and standalone recipient editor.
import { readFile } from 'node:fs/promises';
import { failure } from '../core.mjs';
import { responseStatus,getResponseReview,prepareResponseReview,exportResponseReview,compareResponseReturn,applyResponseReturn,responseMarkdown } from './workspace.mjs';
const files=new Map([['index.html',['index.html','text/html; charset=utf-8']],['app.js',['app.js','application/javascript; charset=utf-8']],
 ['model.js',['model.cjs','application/javascript; charset=utf-8']],['style.css',['style.css','text/css; charset=utf-8']]]);
const integer=value=>{if(value===null)return undefined;if(!/^[1-9]\d*$/.test(value)||!Number.isSafeInteger(Number(value)))throw failure('INVALID_REVISION','Select a positive saved response revision.');return Number(value);};
const inline=value=>value.replace(/<\/script/gi,'<\\/script');
const data=value=>JSON.stringify(value).replace(/</g,'\\u003c').replace(/\u2028/g,'\\u2028').replace(/\u2029/g,'\\u2029');
export async function responseEditorHTML(transfer){
 const [html,css,model,app]=await Promise.all(['index.html','style.css','model.cjs','app.js'].map(name=>readFile(new URL('./'+name,import.meta.url),'utf8')));
 const htmlWithoutAssets=html.replace(/<link\b[^>]*href=["'](?:\.\/)?style\.css["'][^>]*>/gi,'')
  .replace(/<script\b[^>]*src=["'](?:\.\/)?(?:model|app)\.js["'][^>]*>\s*<\/script>/gi,'');
 if(/<script\b[^>]*src=|<link\b[^>]*href=/i.test(htmlWithoutAssets))throw failure('RESPONSE_EDITOR_SOURCE','The standalone editor must include every selected local asset.');
 const head='<meta http-equiv="Content-Security-Policy" content="default-src &apos;none&apos;; script-src &apos;unsafe-inline&apos;; style-src &apos;unsafe-inline&apos;; img-src data:; connect-src &apos;none&apos;; base-uri &apos;none&apos;; form-action &apos;none&apos;">'
  +'<style>'+css.replace(/<\/style/gi,'<\\/style')+'</style>';
 const script='<script>window.CANADABUYS_RESPONSE_TRANSFER='+data(transfer)+';</script><script>'+inline(model)+'</script><script>'+inline(app)+'</script>';
 return htmlWithoutAssets.replace('</head>',head+'</head>').replace('</body>',script+'</body>');
}
export async function routeResponseReview({workspace,request,response,url,requestJSON,sendJSON,attachment}){
 if(url.pathname==='/response-review'||url.pathname.startsWith('/response-review/')){
  if(request.method!=='GET')throw failure('METHOD_NOT_ALLOWED','Open the response review with GET.',405);
  const leaf=url.pathname==='/response-review'?'index.html':url.pathname.slice('/response-review/'.length)||'index.html',chosen=files.get(leaf);
  if(!chosen)throw failure('NOT_FOUND','Response review asset does not exist.',404);
  const body=await readFile(new URL('./'+chosen[0],import.meta.url));
  response.writeHead(200,{'Content-Type':chosen[1],'Content-Length':body.length,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff',
   'Content-Security-Policy':"default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src data:; base-uri 'none'; form-action 'self'; frame-ancestors 'none'"});
  response.end(body);return true;
 }
 if(!url.pathname.startsWith('/api/response-review/'))return false;
 const path=url.pathname.slice('/api/response-review/'.length).split('/').map(decodeURIComponent),method=request.method;
 const read=()=>requestJSON(request,64*1024*1024);
 if(method==='GET'&&path.length===1&&path[0]==='status'){sendJSON(response,200,responseStatus(workspace));return true;}
 if(method==='POST'&&path.length===1){
  if(path[0]==='prepare'){sendJSON(response,200,prepareResponseReview(workspace,await read()));return true;}
  if(path[0]==='compare'){sendJSON(response,200,await compareResponseReturn(workspace,await read()));return true;}
  if(path[0]==='apply'){sendJSON(response,200,await applyResponseReturn(workspace,await read()));return true;}
 }
 if(method==='GET'&&path[0]==='records'&&(path.length===2||path.length===3)){
  const selected={revision:integer(url.searchParams.get('revision'))};
  if(path.length===2){sendJSON(response,200,getResponseReview(workspace,path[1],selected));return true;}
  if(path[2]==='markdown'){attachment(response,responseMarkdown(workspace,path[1],selected));return true;}
  if(path[2]==='export'||path[2]==='editor'){
   const transfer=await exportResponseReview(workspace,path[1],selected);
   const editor=path[2]==='editor';
   attachment(response,{body:editor?await responseEditorHTML(transfer):JSON.stringify(transfer,null,2)+'\n',
    mime:editor?'text/html; charset=utf-8':'application/json; charset=utf-8',
    filename:'response-review-'+path[1]+'-r'+transfer.base.record.revision+(editor?'.html':'.json')});return true;
  }
 }
 throw failure('NOT_FOUND','Response review route does not exist.',404);
}
