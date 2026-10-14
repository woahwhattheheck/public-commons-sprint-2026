/* Request-driven local opening recovery. Never cache API, workspaces or tokens. */
const EDITION='upstate.workbench-links/1';
const CACHE='upstate-workbench-opening-1';
const ASSETS=['/web/workbench_reopen.html','/web/workbench_links.mjs','/web/workbench_links.css'];
self.addEventListener('install',event=>event.waitUntil((async()=>{
 const cache=await caches.open(CACHE);
 // Validate the complete fixed set before replacing any cached opening asset.
 const responses=await Promise.all(ASSETS.map(async path=>{
  const response=await fetch(path,{cache:'no-store',credentials:'omit',redirect:'error'});
  if(!response.ok||response.headers.get('X-Upstate-Recovery-Edition')!==EDITION)throw Error('Opening help is not ready.');
  return response;
 }));
 await Promise.all(ASSETS.map((path,index)=>cache.put(path,responses[index])));
 await self.skipWaiting();
})()));
self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));
self.addEventListener('fetch',event=>{
 const request=event.request,url=new URL(request.url);
 if(request.method!=='GET'||url.origin!==self.location.origin)return;
 if(url.pathname==='/web/workbench_reopen.html'&&url.search==='?download=1'){
  event.respondWith((async()=>{
   try{return await fetch(request);}catch{
    const cache=await caches.open(CACHE);
    const items=await Promise.all(ASSETS.map(path=>cache.match(path)));
    if(items.some(item=>!item))return Response.error();
    const [html,script,style]=await Promise.all(items.map(item=>item.text()));
    const body=html.replace('<link rel="stylesheet" href="/web/workbench_links.css">','<style>'+style.replaceAll('</style','<\\/style')+'</style>')
      .replace('<script type="module" src="/web/workbench_links.mjs"></script>','<script type="module">'+script.replaceAll('</script','<\\/script')+'</script>');
    return new Response(body,{headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store',
      'Content-Disposition':'attachment; filename="Reopen_Workbench.html"','Referrer-Policy':'no-referrer'}});
   }
  })());return;
 }
 // Offline assets are served only for these exact, non-secret paths, not query
 // variants other than the explicit portable download, nor for the status probe.
 if(!url.search&&ASSETS.includes(url.pathname)){
  event.respondWith((async()=>{
   try{return await fetch(request);}catch{
    return await (await caches.open(CACHE)).match(url.pathname)||Response.error();
   }
  })());return;
 }
 if(request.mode!=='navigate')return;
 event.respondWith((async()=>{
  try{return await fetch(request);}catch{
   const saved=await (await caches.open(CACHE)).match('/web/workbench_reopen.html');
   if(!saved)return Response.error();
   const headers=new Headers(saved.headers);
   headers.set('Cache-Control','no-store');
   return new Response(await saved.arrayBuffer(),{status:503,statusText:'Workbench not running',headers});
  }
 })());
});
