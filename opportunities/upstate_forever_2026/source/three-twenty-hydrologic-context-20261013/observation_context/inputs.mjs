export function makeObservationInput(files, descriptor) {
 if(descriptor.schema!=="upstate.network-observation-inputs/v1")throw Error("Observation input descriptor schema");
 const byPath=new Map();
 for(const f of files){if(byPath.has(f.path)&&byPath.get(f.path).sha256!==f.sha256)throw Error("Conflicting observation input "+f.path);byPath.set(f.path,f);}
 const seen=new Set(),selected=descriptor.files.map(d=>{
  if(seen.has(d.path))throw Error("Duplicate declared observation input "+d.path);seen.add(d.path);
  const f=byPath.get(d.path);
  if(!f||f.bytes!==d.bytes||f.sha256!==d.sha256||typeof f.content!=="string")throw Error("Missing or different observation input "+d.path);
  return {...d,content:f.content};
 });
 for(const k of ["historical","current","current_measurements","network"]){
  const d=descriptor[k],f=byPath.get(d?.path);if(!d||!f||f.bytes!==d.bytes||f.sha256!==d.sha256)throw Error("Unbound observation input "+k);
 }
 return {historical:descriptor.historical,current:descriptor.current,current_measurements:descriptor.current_measurements,network:descriptor.network,files:selected};
}
export function parseObservationCSV(text){
 const rows=[];let row=[],cell="",quoted=false;
 for(let i=0;i<text.length;i++){
  const ch=text[i];
  if(quoted){if(ch==='"'&&text[i+1]==='"'){cell+='"';i++;}else if(ch==='"')quoted=false;else cell+=ch;}
  else if(ch==='"')quoted=true;
  else if(ch===","){row.push(cell);cell="";}
  else if(ch==="\n"||ch==="\r"){if(ch==="\r"&&text[i+1]==="\n")i++;row.push(cell);if(row.some(x=>x!==""))rows.push(row);row=[];cell="";}
  else cell+=ch;
 }
 if(quoted)throw Error("Unterminated CSV field");
 if(cell!==""||row.length){row.push(cell);rows.push(row);}
 const headers=rows.shift()??[];
 if(new Set(headers).size!==headers.length)throw Error("Duplicate CSV headers");
 return rows.map((r,i)=>{if(r.length!==headers.length)throw Error("CSV width at data row "+(i+1));return Object.fromEntries(headers.map((k,j)=>[k,r[j]]));});
}
