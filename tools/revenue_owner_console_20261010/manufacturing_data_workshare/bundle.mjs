/** Build an offline browser attachment from the complete source modules. */
export function bundleDataDesk({coreSource,controllerSource,style,config={},base64Utf8}){
 if(typeof coreSource!=='string'||typeof controllerSource!=='string'||typeof style!=='string'||typeof base64Utf8!=='function')throw Error('Supply the complete core, controller, stylesheet and UTF-8 encoder.');
 const declaration="import * as core from './data_readiness.mjs';";
 if(controllerSource.split(declaration).length!==2)throw Error('The controller must contain its exact original core import.');
 const dataURL=source=>'data:text/javascript;base64,'+base64Utf8(source);
 const bundledController=controllerSource.replace(declaration,'import * as core from '+JSON.stringify(dataURL(coreSource))+';');
 const escape=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const title=String(config.title||'Manufacturing data preparation');
 const script="import {mountDataReadinessDesk} from "+JSON.stringify(dataURL(bundledController))+";\nmountDataReadinessDesk(document.getElementById('desk'),"+JSON.stringify(config).replace(/</g,'\\u003c')+");";
 return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>'+escape(title)+'</title><style>'+style+'</style></head><body><main id="desk"></main><noscript>Open this file in a browser with JavaScript enabled to use the data desk.</noscript><script type="module">'+script+'</script></body></html>\n';
}
