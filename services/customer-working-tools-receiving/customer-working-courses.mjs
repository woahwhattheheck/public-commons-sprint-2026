import fs from 'node:fs';
import {join,resolve,isAbsolute,relative,sep} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';

const need=(ok,message)=>{if(!ok)throw Error(message);};
function pin(file){const s=fs.lstatSync(file);need(s.isFile()&&!s.isSymbolicLink(),'Select an ordinary complete source/output file.');
 const bytes=fs.readFileSync(file);return {path:file,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};}
function ordinaryDirectory(value,label){need(typeof value==='string'&&isAbsolute(value)&&resolve(value)===value,'Select the absolute '+label+'.');
 const stat=fs.lstatSync(value);need(stat.isDirectory()&&!stat.isSymbolicLink(),'Select the ordinary '+label+'.');return fs.realpathSync(value);}
function inside(root,file){const child=relative(root,file);return child!==''&&!child.startsWith('..'+sep)&&child!=='..'&&!isAbsolute(child);}
export function validateCustomerWorkingCourses(courses=[]){
 need(Array.isArray(courses)&&courses.length<=32,'Select the complete original customer operating courses.');
 const ids=new Set();
 for(const c of courses){
  need(c&&/^[a-z0-9][a-z0-9-]{2,79}$/.test(c.id||'')&&!ids.has(c.id),'Keep distinct saved customer course identities.');ids.add(c.id);
  need(typeof c.pack_id==='string'&&c.pack_id&&typeof c.export_name==='string'&&/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(c.export_name),'Select the original customer and exported operating function.');
  need(typeof c.module==='string'&&isAbsolute(c.module)&&typeof c.source_directory==='string'&&isAbsolute(c.source_directory),'Select absolute original module/source paths.');
  need(/^[a-f0-9]{64}$/.test(c.sha256||'')&&Array.isArray(c.source_files)&&c.source_files.length>0&&c.source_files.length<=100,'Retain the complete module and original source-file identities.');
  const paths=new Set();
  for(const f of c.source_files){
   need(f&&typeof f.path==='string'&&f.path&&!isAbsolute(f.path)&&!f.path.split(/[\\/]/).some(x=>x==='..'||x==='')&&!/[:\u0000-\u001f]/.test(f.path)&&!paths.has(f.path),'Retain each original relative source member once.');paths.add(f.path);
   need(Number.isSafeInteger(f.bytes)&&f.bytes>=0&&/^[a-f0-9]{64}$/.test(f.sha256||''),'Retain each complete source length and hash.');
  }
 }
 return courses;
}
function selectedSources(course){
 const root=ordinaryDirectory(course.source_directory,'customer source directory');
 const module=pin(resolve(course.module));need(module.sha256===course.sha256,'The selected complete operating module changed.');
 const files=course.source_files.map(f=>{const file=resolve(root,f.path);need(inside(root,file)&&inside(root,fs.realpathSync(file)),'Retain the original source directory.');
  const actual=pin(file);need(actual.bytes===f.bytes&&actual.sha256===f.sha256,'The complete selected customer source changed: '+f.path);return actual;});
 return {module,files,root};
}
export async function runCustomerWorkingCourses({browser,courses=[],outputDirectory,signal}){
 validateCustomerWorkingCourses(courses);const selected=[];const files=[];
 for(const course of courses){
  need(!signal?.aborted,'The original customer operating continuation was interrupted.');
  const sources=selectedSources(course),out=join(outputDirectory,'customer-courses',course.id);fs.mkdirSync(out,{recursive:true});
  const root=ordinaryDirectory(out,'customer receiving output');
  const module=await import(pathToFileURL(sources.module.path).href);
  need(typeof module[course.export_name]==='function','The selected full module lacks its original receiving export.');
  need(pin(sources.module.path).sha256===sources.module.sha256,'The operating module changed while loading.');
  const context=await browser.newContext({viewport:{width:1440,height:1000},acceptDownloads:true});
  let value;
  try{
   const page=await context.newPage();page.setDefaultTimeout(60000);page.setDefaultNavigationTimeout(60000);
   value=await module[course.export_name]({page,context,outputDirectory:root,sourceDirectory:sources.root});
   selectedSources(course);
   const resultPath=value?.result?.path||join(value?.run_directory||root,'receiving-result.json');
   const outputRows=[...(value?.files||[]),...(value?.outputs||[]),...(value?.screens||[]),{path:resultPath}];
   const actual=[],seen=new Set();
   for(const item of outputRows){
    const file=resolve(item.path||item.file||'');need(inside(root,file)&&inside(root,fs.realpathSync(file)),'Retain complete outputs beneath the original receiving directory.');
    if(seen.has(file))continue;seen.add(file);const receipt=pin(file);
    if(item.bytes!==undefined)need(receipt.bytes===item.bytes&&receipt.sha256===item.sha256,'The complete operated customer output changed.');
    actual.push(receipt);
   }
   const row={id:course.id,pack_id:course.pack_id,module:sources.module,sources:sources.files,state:value.state,result:pin(resultPath),files:actual};
   selected.push(row);files.push(...actual);
   need(value.state==='COMPLETE','Customer operating course did not complete: '+course.id+'; original result '+resultPath);
  }catch(error){
   error.details={...(error.details||{}),customer_course:course.id,output_directory:root,retained_result:value?.result?.path||null,completed_courses:selected};
   throw error;
  }finally{await context.close();}
 }
 return {schema:'commons.customer-working-courses.v1',courses:selected,files};
}
