'use strict';
const core=require('./formward_commissioning.cjs');
const {validateConfiguration}=require('./configuration.cjs');
const json=v=>JSON.stringify(v).replace(/</g,'\\u003c').replace(/\u2028/g,'\\u2028').replace(/\u2029/g,'\\u2029');
const esc=v=>String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
/** Pure generation: no filesystem, network, provider account or submission operation. */
function renderKit({configuration,state=null,coreSource,browserSource,css,operator='',actualReturn=null}={}){
 const c=validateConfiguration(configuration),record=state===null?core.createKit(c):core.readState(state,c);
 for(const [name,value] of Object.entries({coreSource,browserSource,css,operator}))if(typeof value!=='string')throw new TypeError('Provide the complete '+name+'.');
 if(/<\/script/i.test(browserSource)||/<\/style/i.test(css))throw new TypeError('Keep standalone script/style sources without an HTML closing tag.');
 if(operator.length>200)throw new TypeError('Keep a readable operator identity.');
 if(actualReturn!==null&&(!actualReturn||typeof actualReturn!=='object'||Array.isArray(actualReturn)))throw new TypeError('Retain the actual return object or null.');
 return '<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>'+esc(c.title)+' — Formward commissioning</title><style>'+css+'</style></head><body><header><div><strong id="edition"></strong><div id="edition-id"></div><div id="revision"></div></div><label>Actual operator name<input id="operator" autocomplete="name" value="'+esc(operator)+'"></label></header><div id="notice" role="status" aria-live="polite"></div><div id="layout"><aside><nav id="navigation" aria-label="Form workflow"></nav></aside><main id="application"></main></div>'+
 '<script id="configuration" type="application/json">'+json(c)+'</script>'+
 '<script id="last-actual-return" type="application/json">'+json(actualReturn)+'</script>'+
 '<script id="initial-state" type="application/json">'+json(record)+'</script>'+
 '<script id="core-source" type="application/json">'+json(coreSource)+'</script>'+
 '<script id="browser-source">'+browserSource+'</script></body></html>\n';
}
module.exports={renderKit};
