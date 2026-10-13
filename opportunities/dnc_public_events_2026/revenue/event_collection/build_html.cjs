'use strict';
/* Copyright 2026 TokenJunkieLabs. Complete portable application assembly. */
function buildEventCollectionHtml({workspace,modelSource,storageSource,deskSource,exportSource,hashSource,codecSource,css,codec}) {
 const envelope=codec.encode(codec.utf8(JSON.stringify({schema:'tjlabs.event-collection-archive/v1',workspace})));
 const script=s=>s.replace(/<\/script/gi,'<\\/script');
 const json=o=>JSON.stringify(o).replace(/</g,'\\u003c').replace(/\u2028/g,'\\u2028').replace(/\u2029/g,'\\u2029');
 const code=[
 "(function(){'use strict';",
 'const hashes=(function(){const module={exports:{}};',hashSource,'return module.exports;})();',
 "const bytes=(function(){const module={exports:{}},require=name=>{if(name==='./connected_sha256.cjs')return hashes;throw Error('This portable application does not use '+name);};",codecSource,'return module.exports.createSourceBytes();})();',
 'const model=(function(){const module={exports:{}};',modelSource,'return module.exports.createEventCollectionModel(hashes);})();',
 'const storage=(function(){const module={exports:{}};',storageSource,'return module.exports.createCollectionStorage;})();',
 'const mount=(function(){const module={exports:{}};',deskSource,'return module.exports.mountEventCollection;})();',
 'const exporter=(function(){',exportSource.replace(/^export\s*\{[^}]*\};?\s*$/m,''),'return createEventExportAdapter(model);})();',
 "const initial=model.openArchive(bytes.textUtf8(bytes.decode(JSON.parse(document.getElementById('initial-source').textContent)).data));",
 "function portable(next){const clone=document.documentElement.cloneNode(true);clone.querySelector('#app').innerHTML='<p>Opening the complete event collection…</p>';clone.querySelector('#initial-source').textContent=JSON.stringify(bytes.encode(bytes.utf8(model.exportArchive(next)))).replace(/</g,'\\\\u003c');return '<!doctype html>\\n'+clone.outerHTML;}",
 "mount({model,exporter,initial,buildHtml:portable,storageFactory:storage}).catch(e=>{document.getElementById('app').textContent='The complete collection could not be opened: '+e.message;});",
 '})();'
 ].join('\n');
 return '<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Event collection desk · TJLabs</title><style>'+css+'</style></head><body><main id="app"><p>Opening the complete event collection…</p></main><script id="initial-source" type="application/json">'+json(envelope)+'</script><script>'+script(code)+'</script></body></html>';
}
module.exports={buildEventCollectionHtml};
