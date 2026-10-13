export function renderApplication(project,sourceFiles){
 const get=path=>{const f=sourceFiles.find(x=>x.path===path);if(!f)throw Error('Complete application source is missing '+path);return f.content;};
 const deps={'./onboarding.mjs':'onboarding','./source-document-tables.mjs':'docs','./source-table-intake.mjs':'intake','./source-table-workspace.mjs':'tables','./model.mjs':'model','./adapters.mjs':'adapters'};
 function bundle(path,name){
 const s=get(path),exports=[...s.matchAll(/export (?:async )?(?:function|const|class) (\w+)/g)].map(x=>x[1]),imports=[];
 for(const m of s.matchAll(/^import \{([^}]+)\} from '([^']+)';$/gm)){if(!deps[m[2]])throw Error('Unresolved application dependency '+m[2]);for(const part of m[1].split(',')){const k=part.trim();if(!/^\w+$/.test(k))throw Error('Original named import is unsupported.');imports.push({key:k,value:deps[m[2]]+'.'+k});}}
 const body=s.replace(/^import .*;\r?\n/gm,'').replace(/\bexport (?=(?:async )?(?:function|const|class) )/g,'');
 return 'const '+name+'=(('+imports.map(x=>x.key).join(',')+')=>{'+body+'\nreturn {'+exports.join(',')+'};})('+imports.map(x=>x.value).join(',')+');\n';
 }
 const script=bundle('onboarding.mjs','onboarding')+bundle('source-document-tables.mjs','docs')+bundle('source-table-intake.mjs','intake')+bundle('source-table-workspace.mjs','tables')+bundle('adapters.mjs','adapters')+bundle('model.mjs','model')+bundle('io.mjs','io')+bundle('render.mjs','render')+bundle('app.mjs','app')+"app.startResearchApp({model,tables,io,adapters,renderApplication:render.renderApplication,seed:JSON.parse(document.getElementById('seed').textContent),sourceFiles:JSON.parse(document.getElementById('source-files').textContent)}).catch(e=>{document.getElementById('status').textContent=e.message;});";
 const json=v=>JSON.stringify(v).replace(/</g,'\\u003c');
 return get('index-template.html').replace('__STYLE__',get('style.css')).replace('__SEED__',json(project)).replace('__FILES__',json(sourceFiles)).replace('__BUNDLE__',script.replace(/<\/script/gi,'<\\/script'));
}
