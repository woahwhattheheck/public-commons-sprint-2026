'use strict';
const safe=x=>JSON.stringify(x).replace(/</g,'\\u003c').replace(/\u2028/g,'\\u2028').replace(/\u2029/g,'\\u2029');
function render({seed,files}){
 const names=['commissioning-core.cjs','host/connected_sha256.cjs','app.js','styles.css'];for(const name of names)if(typeof files[name]!=='string')throw Error('Missing whole source '+name);
 for(const name of names.filter(n=>n!=='styles.css'))if(/<\/script/i.test(files[name]))throw Error('Closing script found in source '+name);
 for(const name of ['commissioning-core.cjs','host/connected_sha256.cjs'])if(/\/\*BROOM_(?:SHA|CORE)_(?:BEGIN|END)\*\//.test(files[name]))throw Error('Original source marker collision.');
 const runtime="(()=>{const sh={exports:{}};((module,exports)=>{\n/*BROOM_SHA_BEGIN*/\n"+files['host/connected_sha256.cjs']+"\n/*BROOM_SHA_END*/\n})(sh,sh.exports);window.BroomSha=sh.exports;const co={exports:{}};((module,exports,require)=>{\n/*BROOM_CORE_BEGIN*/\n"+files['commissioning-core.cjs']+"\n/*BROOM_CORE_END*/\n})(co,co.exports,name=>{if(name!=='./host/connected_sha256.cjs')throw Error('Unknown dependency');return sh.exports;});window.BroomCommissioning=co.exports;})();";
 if(files['BROOMDESK-OPERATOR.md']!==seed.guide)throw Error('The original operator guide differs from its selected seed.');
 const source={schema:'broomdesk.commissioning-source.v1',files:Object.fromEntries(['render.cjs','BROOMDESK-CRITERIA.json','BROOMDESK-SOURCES.json'].map(p=>[p,files[p]]))};
 return '<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><title>BroomDesk commissioning desk</title><style id="desk-styles">'+files['styles.css']+'</style></head><body><div id="app"></div><script id="desk-seed" type="application/json">'+safe(seed)+'</script><script id="desk-source" type="application/json">'+safe(source)+'</script><script id="desk-runtime">'+runtime+'</script><script id="desk-app-source">'+files['app.js']+'</script></body></html>\n';
}
module.exports={render};
