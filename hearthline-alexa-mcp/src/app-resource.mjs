export const APP_URI = 'ui://hearthline/mission-dashboard.html';
export const APP_MIME = 'text/html;profile=mcp-app';

export function dashboardHtml() {
  return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Hearthline Mission Dashboard</title>
<style>
:root{font-family:system-ui,sans-serif;color-scheme:light dark}body{margin:0;padding:18px;background:Canvas;color:CanvasText}.wrap{max-width:760px;margin:auto}.hero{display:flex;justify-content:space-between;gap:12px;align-items:center}.badge{border:1px solid color-mix(in srgb,CanvasText 25%,transparent);border-radius:999px;padding:5px 10px;font-size:12px}.card{border:1px solid color-mix(in srgb,CanvasText 18%,transparent);border-radius:14px;padding:14px;margin:12px 0}.muted{opacity:.7}.actions{display:grid;gap:8px}.action{padding:10px;border-radius:10px;background:color-mix(in srgb,CanvasText 6%,Canvas)}pre{white-space:pre-wrap;word-break:break-word;font-size:12px}.err{color:crimson}</style>
</head><body><div class="wrap"><div class="hero"><div><h1>Hearthline</h1><div class="muted">Stateful household mission control</div></div><span id="status" class="badge">connecting</span></div><div id="root" class="card"><p>Connecting to the MCP Apps host…</p></div></div>
<script>
const root=document.getElementById('root'), status=document.getElementById('status');
const INIT_ID='hearthline-ui-init-1';
function post(message){window.parent.postMessage(message,'*')}
function pickMission(value){
 if(!value||typeof value!=='object')return null;
 if(value.mission)return value.mission;
 if(value.structuredContent?.mission)return value.structuredContent.mission;
 if(value.params?.structuredContent?.mission)return value.params.structuredContent.mission;
 if(value.result?.structuredContent?.mission)return value.result.structuredContent.mission;
 return null;
}
function render(m){
 status.textContent=m.status||'active';
 root.innerHTML='<h2>'+escapeHtml(m.title||m.id)+'</h2><p class="muted">'+escapeHtml(m.type||'mission')+' · '+escapeHtml(m.id||'')+'</p><div class="actions">'+(m.actions||[]).map(a=>'<div class="action"><strong>'+escapeHtml(a.kind)+'</strong> · '+escapeHtml(a.status)+'<br>'+escapeHtml(a.summary||'')+'</div>').join('')+'</div><details><summary>Mission receipt</summary><pre>'+escapeHtml(JSON.stringify({planHash:m.planHash,alertsSummary:m.alertsSummary},null,2))+'</pre></details>';
}
function escapeHtml(s){return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
window.addEventListener('message',ev=>{
 if(ev.source!==window.parent)return;
 const msg=ev.data;
 if(!msg||msg.jsonrpc!=='2.0')return;
 if(msg.id===INIT_ID){
   if(msg.error){status.textContent='host error';root.innerHTML='<p class="err">Host rejected MCP Apps initialization.</p>';return}
   status.textContent='ready';
   post({jsonrpc:'2.0',method:'ui/notifications/initialized',params:{}});
   return;
 }
 if(msg.method==='ui/notifications/tool-result'){
   const mission=pickMission(msg);
   if(mission)render(mission);
 }
});
post({jsonrpc:'2.0',id:INIT_ID,method:'ui/initialize',params:{protocolVersion:'2026-01-26',appInfo:{name:'Hearthline Mission Dashboard',version:'0.1.0'},appCapabilities:{}}});
</script></body></html>`;
}
