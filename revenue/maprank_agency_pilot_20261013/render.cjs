'use strict';
const safe=x=>JSON.stringify(x).replace(/</g,'\\u003c').replace(/\u2028/g,'\\u2028').replace(/\u2029/g,'\\u2029');
function render({seed,files}){
 const names=['pilot-core.cjs','host/connected_sha256.cjs','app.js','styles.css'];for(const name of names)if(typeof files[name]!=='string')throw Error('Missing whole source '+name);
 for(const name of names.filter(n=>n!=='styles.css'))if(/<\/script/i.test(files[name]))throw Error('Closing script found in source '+name);
 for(const name of ['pilot-core.cjs','host/connected_sha256.cjs'])if(/\/\*PILOT_(?:SHA|CORE)_(?:BEGIN|END)\*\//.test(files[name]))throw Error('Original source marker collision.');
 const runtime="(()=>{const sh={exports:{}};((module,exports)=>{\n/*PILOT_SHA_BEGIN*/\n"+files['host/connected_sha256.cjs']+"\n/*PILOT_SHA_END*/\n})(sh,sh.exports);window.PilotSha=sh.exports;const co={exports:{}};((module,exports,require)=>{\n/*PILOT_CORE_BEGIN*/\n"+files['pilot-core.cjs']+"\n/*PILOT_CORE_END*/\n})(co,co.exports,name=>{if(name!=='./host/connected_sha256.cjs')throw Error('Unknown dependency');return sh.exports;});window.MapRankPilot=co.exports;})();";
 const source={schema:'maprank.pilot-source.v1',seed,files:Object.fromEntries(['render.cjs','MAPRANK-PILOT-OPERATOR.md','MAPRANK-METRIC-RULES.md','maprank-pilot-fields.json','MAPRANK-SOURCES.json'].map(p=>[p,files[p]]))};
 return '<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><title>MapRank agency pilot desk</title><style id="pilot-styles">'+files['styles.css']+'</style></head><body><div id="app"></div><script id="pilot-seed" type="application/json">'+safe(seed)+'</script><script id="pilot-source" type="application/json">'+safe(source)+'</script><script id="pilot-runtime">'+runtime+'</script><script id="pilot-app-source">'+files['app.js']+'</script></body></html>\n';
}
module.exports={render};
