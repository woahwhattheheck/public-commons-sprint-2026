/** Build the complete offline desk with each source module included once. */
export function bundleDataDesk({coreSource,comparisonSource,controllerSource,style,config={},base64Utf8}){
 if(typeof coreSource!=='string'||typeof comparisonSource!=='string'||typeof controllerSource!=='string'||typeof style!=='string')throw Error('Supply the complete core, comparison, controller and stylesheet.');
 // Retain the existing caller shape; this edition no longer base64-nests modules.
 const coreDeclaration="import * as core from './data_readiness.mjs';",comparisonDeclaration="import * as comparison from './data_comparison.mjs';";
 if(controllerSource.split(coreDeclaration).length!==2||controllerSource.split(comparisonDeclaration).length!==2)throw Error('The complete controller must retain its original module imports.');
 const imports=[...comparisonSource.matchAll(/^import\s*\{([^}]+)\}\s*from\s*['"]\.\/data_readiness\.mjs['"];[ \t]*$/gm)];
 if(imports.length!==1)throw Error('The complete comparison must retain its original named core import.');
 const imported=imports[0][1].split(',').map(name=>name.trim());
 if(!imported.length||imported.some(name=>!/^[$A-Z_a-z][$\w]*$/.test(name)))throw Error('Unsupported comparison import binding.');
 const makeModule=(source,prelude='')=>{
  const declarations=[...source.matchAll(/^export\s+(?:const|function|class)\s+([$A-Z_a-z][$\w]*)/gm)],names=declarations.map(match=>match[1]);
  if(!names.length||new Set(names).size!==names.length)throw Error('The complete source module exports are missing or repeated.');
  const body=source.replace(/^export\s+(?=(?:const|function|class)\s)/gm,'');
  if(/^\s*(?:import|export)\s/m.test(body))throw Error('An unsupported module declaration remains in the complete source.');
  return {names,body:'(()=>{\n'+prelude+body+'\nreturn Object.freeze({'+names.join(',')+'});\n})()'};
 };
 const coreModule=makeModule(coreSource);
 if(imported.some(name=>!coreModule.names.includes(name)))throw Error('The comparison imports a missing core binding.');
 const comparisonModule=makeModule(comparisonSource.replace(imports[0][0],''),'const {'+imported.join(',')+'}=core;\n');
 const controllerModule=makeModule(controllerSource.replace(coreDeclaration,'').replace(comparisonDeclaration,''));
 if(!controllerModule.names.includes('mountDataReadinessDesk'))throw Error('The complete controller mount is missing.');
 const escape=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const title=String(config.title||'Manufacturing data preparation');
 const script=('const core='+coreModule.body+';\nconst comparison='+comparisonModule.body+';\nconst controller='+controllerModule.body+';\ncontroller.mountDataReadinessDesk(document.getElementById("desk"),'+JSON.stringify(config).replace(/</g,'\\u003c')+');').replace(/<\/script/gi,match=>'<\\/'+match.slice(2));
 return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>'+escape(title)+'</title><style>'+style+'</style></head><body><main id="desk"></main><noscript>Open this file in a browser with JavaScript enabled to use the data desk.</noscript><script type="module">'+script+'</script></body></html>\n';
}
