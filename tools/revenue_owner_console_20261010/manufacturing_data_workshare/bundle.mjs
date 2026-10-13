/** Build an offline browser attachment from the complete source modules. */
export function bundleDataDesk({coreSource,comparisonSource,controllerSource,style,config={},base64Utf8}){
 if(typeof coreSource!=='string'||typeof comparisonSource!=='string'||typeof controllerSource!=='string'||typeof style!=='string'||typeof base64Utf8!=='function')throw Error('Supply the complete core, comparison, controller, stylesheet and UTF-8 encoder.');
 const declaration="import * as core from './data_readiness.mjs';",comparisonDeclaration="import * as comparison from './data_comparison.mjs';";
 const comparisonCoreSpecifier="from './data_readiness.mjs';";
 if(controllerSource.split(declaration).length!==2||controllerSource.split(comparisonDeclaration).length!==2||comparisonSource.split(comparisonCoreSpecifier).length!==2)throw Error('The complete controller and comparison must retain their original module imports.');
 const dataURL=source=>'data:text/javascript;base64,'+base64Utf8(source),coreURL=dataURL(coreSource);
 const bundledComparison=comparisonSource.replace(comparisonCoreSpecifier,'from '+JSON.stringify(coreURL)+';');
 const bundledController=controllerSource.replace(declaration,'import * as core from '+JSON.stringify(coreURL)+';').replace(comparisonDeclaration,'import * as comparison from '+JSON.stringify(dataURL(bundledComparison))+';');
 const escape=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const title=String(config.title||'Manufacturing data preparation');
 const script="import {mountDataReadinessDesk} from "+JSON.stringify(dataURL(bundledController))+";\nmountDataReadinessDesk(document.getElementById('desk'),"+JSON.stringify(config).replace(/</g,'\\u003c')+");";
 return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>'+escape(title)+'</title><style>'+style+'</style></head><body><main id="desk"></main><noscript>Open this file in a browser with JavaScript enabled to use the data desk.</noscript><script type="module">'+script+'</script></body></html>\n';
}
