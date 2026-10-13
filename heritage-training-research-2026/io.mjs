import {zipWorkspace} from './onboarding.mjs';
import {sha256,selectedEdition} from './source-table-workspace.mjs';
import {receiveResearch,rows,reportHtml} from './model.mjs';
const te=new TextEncoder(),td=new TextDecoder('utf-8',{fatal:true});
export async function archiveFiles(project,sourceFiles,html){
 await receiveResearch(project);
 
 const files=[...sourceFiles.map(x=>({path:x.path,content:x.content})),{path:'index.html',content:html},{path:'project.json',content:JSON.stringify(project,null,2)+'\n'}];
 for(const d of project.documents)files.push({path:'data/'+d.resourceId+'.csv',content:selectedEdition(d).sourceText});
 for(const r of rows(project,'runs')){files.push({path:'runs/'+r.id+'.json',content:JSON.stringify(r,null,2)+'\n'},{path:'runs/'+r.id+'.html',content:reportHtml(r)});}
 const names=new Set(),manifest={schema:'tjlabs.heritage-training-package.v1',projectId:project.id,createdAt:new Date().toISOString(),files:[]};
 let total=0;
 for(const f of files){if(!safe(f.path)||names.has(f.path.toLowerCase()))throw Error('Unsafe or repeated package path: '+f.path);names.add(f.path.toLowerCase());total+=te.encode(f.content).length;if(total>64*1024*1024)throw Error('This offline package supports at most64MiB uncompressed. Export the original project separately if larger.');manifest.files.push({path:f.path,bytes:te.encode(f.content).length,sha256:await sha256(f.content)});}
 files.push({path:'manifest.json',content:JSON.stringify(manifest,null,2)+'\n'});
 return {files,manifest,bytes:zipWorkspace(files)};
}
function safe(p){return typeof p==='string'&&p.length<=1000&&!p.includes('\\')&&!p.startsWith('/')&&!/[\x00-\x1f\x7f:]/.test(p)&&!p.split('/').some(x=>!x||x==='.'||x==='..');}
const crc32=bytes=>{let c=0xffffffff;for(const b of bytes){c^=b;for(let j=0;j<8;j++)c=(c>>>1)^((c&1)?0xedb88320:0);}return(c^0xffffffff)>>>0;};
export async function receiveArchive(bytes){
 if(!(bytes instanceof Uint8Array)||bytes.length>70*1024*1024||bytes.length<22)throw Error('Choose this application’s complete ZIP, at most70MiB.');
 const dv=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),u16=o=>dv.getUint16(o,true),u32=o=>dv.getUint32(o,true);let e=bytes.length-22;
 if(u32(e)!==0x06054b50||u16(e+20)!==0||u16(e+4)!==0||u16(e+6)!==0||u16(e+8)!==u16(e+10))throw Error('Use the original single-volume ZIP produced by this application.');
 const count=u16(e+10),start=u32(e+16),len=u32(e+12);if(!count||count>2048||start+len!==e)throw Error('ZIP directory bounds are invalid.');
 let pos=start,total=0,nextLocal=0;const entries=new Map(),folded=new Set();
 for(let i=0;i<count;i++){
 if(pos+46>e||u32(pos)!==0x02014b50)throw Error('Malformed central directory.');
 const flags=u16(pos+8),method=u16(pos+10),crc=u32(pos+16),size=u32(pos+24),compressed=u32(pos+20),n=u16(pos+28),x=u16(pos+30),c=u16(pos+32),local=u32(pos+42),end=pos+46+n+x+c;
 if(end>e||method!==0||compressed!==size||flags!==0x800||u16(pos+34)!==0)throw Error('Only unchanged, UTF-8, stored ZIP packages from this application are supported. Extract other ZIPs and choose their project.json.');
 const name=td.decode(bytes.slice(pos+46,pos+46+n));if(!safe(name)||folded.has(name.toLowerCase()))throw Error('Unsafe or repeated member path.');
 if(local!==nextLocal||local+30>start||u32(local)!==0x04034b50||u16(local+6)!==flags||u16(local+8)!==method||u32(local+14)!==crc||u32(local+18)!==size||u32(local+22)!==size)throw Error('ZIP local header differs from its original directory.');
 const ln=u16(local+26),lx=u16(local+28),begin=local+30+ln+lx,finish=begin+size;
 if(finish>start||td.decode(bytes.slice(local+30,local+30+ln))!==name)throw Error('ZIP member bounds differ.');
 const body=bytes.slice(begin,finish);if(crc32(body)!==crc)throw Error('ZIP member CRC mismatch: '+name);
 total+=size;if(total>64*1024*1024)throw Error('ZIP expanded source exceeds64MiB.');
 entries.set(name,body);folded.add(name.toLowerCase());nextLocal=finish;pos=end;
 }
 if(pos!==e||nextLocal!==start||!entries.has('manifest.json')||!entries.has('project.json'))throw Error('The complete source manifest or project is missing.');
 let manifest;try{manifest=JSON.parse(td.decode(entries.get('manifest.json')));}catch{throw Error('Invalid manifest JSON.');}
 if(manifest.schema!=='tjlabs.heritage-training-package.v1'||!Array.isArray(manifest.files)||manifest.files.length!==entries.size-1)throw Error('Manifest does not bind the complete archive.');
 const seen=new Set();
 for(const f of manifest.files){if(seen.has(f.path)||f.path==='manifest.json'||!entries.has(f.path))throw Error('Manifest has an absent or repeated member.');seen.add(f.path);const data=entries.get(f.path);if(data.length!==f.bytes||await sha256(data)!==f.sha256)throw Error('Manifest hash mismatch: '+f.path);}
 const project=await receiveResearch(td.decode(entries.get('project.json')));if(project.id!==manifest.projectId)throw Error('Project identity differs from manifest.');
 return {project,manifest};
}
