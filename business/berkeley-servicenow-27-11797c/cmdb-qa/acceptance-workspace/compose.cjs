/* SPDX-License-Identifier: MIT */
(function(root,factory){if(typeof module==="object"&&module.exports)module.exports=factory();else root.CmdbCompose=factory();})(typeof globalThis!=="undefined"?globalThis:this,function(){
 "use strict";
 const json=value=>JSON.stringify(value).replace(/</g,"\\u003c").replace(/\u2028/g,"\\u2028").replace(/\u2029/g,"\\u2029");
 function build(files,working=null){
  for(const name of ["index.template.html","style.css","original-adapter.cjs","workspace.cjs","example.cjs","app.js","compose.cjs","vendor/connected_sha256.cjs","vendor/zip-original.js","OPERATOR.md"])
   if(typeof files[name]!=="string")throw Error("Complete source is missing "+name);
  const wrapped=(name,out)=>"globalThis."+out+"=(function(){let module={exports:{}},exports=module.exports;\n"+files[name]+"\nreturn module.exports;})();\n";
  const runtime=wrapped("vendor/connected_sha256.cjs","CmdbHash")+files["original-adapter.cjs"]+"\n"+files["workspace.cjs"]+"\n"+files["example.cjs"]+"\n"+files["compose.cjs"]+"\n"+files["vendor/zip-original.js"]+"\n"+files["app.js"];
  const replacements={"/*STYLE*/":files["style.css"],"/*SOURCE*/":json({schema:"cmdb-acceptance-complete-source/1",files}),"/*WORKING*/":json(working),"/*RUNTIME*/":runtime.replace(/<\/script/gi,"<\\/script")};
  const template=files["index.template.html"];
  for(const needle of Object.keys(replacements))if(template.split(needle).length!==2)throw Error("The template requires one "+needle);
  return template.replace(/\/\*(?:STYLE|SOURCE|WORKING|RUNTIME)\*\//g,key=>replacements[key]);
 }
 return {build};
});
