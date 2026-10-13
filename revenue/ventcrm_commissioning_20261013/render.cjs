'use strict';
const escape=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const safeJSON=x=>JSON.stringify(x).replace(/</g,'\\u003c').replace(/\u2028/g,'\\u2028').replace(/\u2029/g,'\\u2029');
function render({seed,guide_markdown,guide_html,core_source,sha_source,app_source,styles}){
 if([core_source,sha_source,app_source].some(x=>/<\/script/i.test(x)))throw Error('A source body contains a closing script element.');
 const bootstrap="window.CommissioningEngine=(()=>{const sh={exports:{}};((module)=>{\n"+sha_source+"\n})(sh);const co={exports:{}};((module)=>{\n"+core_source+"\n})(co);return co.exports.createEngine(s=>sh.exports.sha256Utf8(s).sha256);})();";
 return '<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><title>'+escape(seed.title)+' — commissioning</title><style id="programme-styles">'+styles+'</style></head><body><div id="app"></div><script id="programme-data" type="application/json">'+safeJSON({seed,guide_markdown,guide_html})+'</script><script>'+bootstrap+'</script><script>'+app_source+'</script></body></html>\n';
}
module.exports={render};
