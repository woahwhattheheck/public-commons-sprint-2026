/** A complete portable reader retaining the five original-derived tables byte for byte. */
export const tableNames=["subject-summary.csv","group-quantities.csv","criterion-pathways.csv","class-pathways.csv","analysis.json"];
function jsonAscii(v){return JSON.stringify(v).replace(/[\u007f-\uffff]/g,c=>"\\u"+c.charCodeAt(0).toString(16).padStart(4,"0"))}
function gzipAscii(input){
 for(let n=0;n<input.length;n++)if(input.charCodeAt(n)>127)throw Error("gzipAscii requires escaped ASCII text");
 const data=Uint8Array.from(input,c=>c.charCodeAt(0)),out=[31,139,8,0,0,0,0,0,0,255];let bits=0,used=0;
 function put(value,count){bits|=value<<used;used+=count;while(used>=8){out.push(bits&255);bits>>>=8;used-=8}}
 function reverse(value,n){let r=0;for(let i=0;i<n;i++){r=(r<<1)|(value&1);value>>>=1}return r}
 function sym(n){let code,size;if(n<=143){code=n+48;size=8}else if(n<=255){code=n-144+400;size=9}else if(n<=279){code=n-256;size=7}else{code=n-280+192;size=8}put(reverse(code,size),size)}
 const lb=[3,4,5,6,7,8,9,10,11,13,15,17,19,23,27,31,35,43,51,59,67,83,99,115,131,163,195,227,258],le=[0,0,0,0,0,0,0,0,1,1,1,1,2,2,2,2,3,3,3,3,4,4,4,4,5,5,5,5,0];
 const db=[1,2,3,4,5,7,9,13,17,25,33,49,65,97,129,193,257,385,513,769,1025,1537,2049,3073,4097,6145,8193,12289,16385,24577],de=[0,0,0,0,1,1,2,2,3,3,4,4,5,5,6,6,7,7,8,8,9,9,10,10,11,11,12,12,13,13];
 const head=new Int32Array(65536).fill(-1),prev=new Int32Array(data.length).fill(-1);function hash(i){return(data[i]*251+data[i+1]*31+data[i+2])&65535}
 function insert(i){if(i+2>=data.length)return;const h=hash(i);prev[i]=head[h];head[h]=i}
 put(3,3);let i=0;
 while(i<data.length){let best=0,distance=0;if(i+2<data.length){let at=head[hash(i)],tries=128,max=Math.min(258,data.length-i);while(at>=0&&i-at<=32768&&tries--){if(data[at]===data[i]&&data[at+1]===data[i+1]&&data[at+best]===data[i+best]){let n=2;while(n<max&&data[at+n]===data[i+n])n++;if(n>best){best=n;distance=i-at;if(n===max)break}}at=prev[at]}}
 if(best>=3){let lc=0;while(lc<lb.length-1&&lb[lc+1]<=best)lc++;sym(257+lc);put(best-lb[lc],le[lc]);let dc=0;while(dc<db.length-1&&db[dc+1]<=distance)dc++;put(reverse(dc,5),5);put(distance-db[dc],de[dc]);for(let k=0;k<best;k++)insert(i+k);i+=best}else{sym(data[i]);insert(i);i++}}
 sym(256);if(used)out.push(bits&255);
 let crc=0xffffffff;for(const byte of data){crc^=byte;for(let n=0;n<8;n++)crc=(crc>>>1)^((crc&1)?0xedb88320:0)}crc=(crc^0xffffffff)>>>0;
 for(const n of [crc,data.length>>>0])for(let k=0;k<4;k++)out.push((n>>>(k*8))&255);return Uint8Array.from(out);
}
function base64Ascii(s){const t="ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";let out="";for(let i=0;i<s.length;i+=3){const a=s.charCodeAt(i),b=i+1<s.length?s.charCodeAt(i+1):0,c=i+2<s.length?s.charCodeAt(i+2):0;const n=(a<<16)|(b<<8)|c;out+=t[(n>>>18)&63]+t[(n>>>12)&63]+(i+1<s.length?t[(n>>>6)&63]:"=")+(i+2<s.length?t[n&63]:"=");}return out;}
const downloadTemplate="\n<script type=\"application/octet-stream\" id=\"embedded-tables\">__TABLES_BASE64__</script>\n<script>\nlet tableFiles;\nasync function completeTables(){\n  if(!tableFiles)tableFiles=(async()=>{\n    const binary=atob(document.getElementById(\"embedded-tables\").textContent.trim());\n    const bytes=Uint8Array.from(binary,c=>c.charCodeAt(0));\n    return JSON.parse(await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream(\"gzip\"))).text());\n  })();\n  return tableFiles;\n}\nconst downloadStatus=document.createElement(\"p\");downloadStatus.setAttribute(\"role\",\"status\");\ndocument.querySelector(\".downloads\").append(downloadStatus);\nfor(const link of document.querySelectorAll(\".downloads a[download]\")){\n const filename=link.getAttribute(\"href\");\n link.addEventListener(\"click\",async event=>{\n  event.preventDefault();downloadStatus.textContent=\"Preparing \"+filename+\"…\";\n  try{\n   const files=await completeTables();\n   if(typeof files[filename]!==\"string\")throw Error(\"This table is missing from the saved reader.\");\n   const url=URL.createObjectURL(new Blob([files[filename]],{type:filename.endsWith(\".csv\")?\"text/csv;charset=utf-8\":\"application/json;charset=utf-8\"}));\n   const anchor=document.createElement(\"a\");anchor.href=url;anchor.download=filename;document.body.append(anchor);anchor.click();anchor.remove();\n   setTimeout(()=>URL.revokeObjectURL(url),10000);downloadStatus.textContent=filename+\" is ready.\";\n  }catch(error){downloadStatus.textContent=\"Unable to prepare \"+filename+\": \"+error.message;}\n });\n}\n</script>";
export function buildPortableReader(html, inputs){
 if(typeof html!=="string"||html.split("</body>").length!==2)throw Error("Expected one complete original HTML body");
 if(html.includes('id="embedded-tables"'))throw Error("Reader already contains tables");
 const files={};for(const name of tableNames){if(typeof inputs[name]!=="string"||!inputs[name].length)throw Error("Missing complete table: "+name);files[name]=inputs[name];}
 const bytes=gzipAscii(jsonAscii(files));let binary="";for(const byte of bytes)binary+=String.fromCharCode(byte);
 const boot=downloadTemplate.replace("__TABLES_BASE64__",base64Ascii(binary));
 return html.replace("</body>",boot+"</body>").replace("The groups overlap by design.","All five complete table files are included in this saved reader. The groups overlap by design.");
}
