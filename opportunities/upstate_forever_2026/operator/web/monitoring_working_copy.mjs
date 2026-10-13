/* Sampling working-copy presentation. TJLabs. Native sources and solver remain authoritative. */
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const own=(value,key)=>Object.prototype.hasOwnProperty.call(value,key);
export function configurationChanges(before,after){
  const rows=[];
  function walk(a,b,path,hasA=true,hasB=true){
    if(hasA&&hasB&&JSON.stringify(a)===JSON.stringify(b))return;
    const objects=hasA&&hasB&&a&&b&&typeof a==='object'&&typeof b==='object'&&!Array.isArray(a)&&!Array.isArray(b);
    if(objects){for(const key of [...new Set([...Object.keys(a),...Object.keys(b)])].sort())walk(a[key],b[key],path.concat(key),own(a,key),own(b,key));return;}
    rows.push({path:path.join(' / '),before_present:hasA,before:hasA?a:null,after_present:hasB,after:hasB?b:null});
  }
  walk(before,after,[]);return rows;
}
export function exactValue(value,present=true){
  if(!present)return 'Not set';
  if(value===null)return 'Unknown (null)';
  if(value==='')return 'Empty text';
  if(typeof value==='object')return JSON.stringify(value);
  return String(value);
}
export function configurationChangeTable(before,after){
  const rows=configurationChanges(before,after);
  if(!rows.length)return '<p>The editable configuration matches this saved design exactly.</p>';
  return '<p>'+rows.length+' configuration values differ. These are authored input changes; they are not new calculated results.</p><div class="sampling-table"><table><thead><tr><th scope="col">Design setting</th><th scope="col">Saved design</th><th scope="col">Current editable input</th></tr></thead><tbody>'+rows.map(row=>'<tr><th scope="row">'+escape(row.path||'Complete configuration')+'</th><td>'+escape(exactValue(row.before,row.before_present))+'</td><td>'+escape(exactValue(row.after,row.after_present))+'</td></tr>').join('')+'</tbody></table></div>';
}
export function downloadSamplingText(content,filename,type='application/json;charset=utf-8'){
  const blob=new Blob([content],{type});if(blob.size>8*1024*1024)throw Error('The complete downloadable working JSON exceeds 8 MiB. Retain this editor and resolve or separately retain completed request history before downloading.');const url=URL.createObjectURL(blob),a=document.createElement('a');
  a.href=url;a.download=filename;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);
}
export function requestLabel(request){
  return ({prepare:'Save recommendation',design:'Prepare Monitoring design',export:'Export saved recommendation','working-save':'Save working copy','working-export':'Export working copy'})[request?.kind]||String(request?.kind||'Original request');
}
export function plainConfiguration(configuration){return JSON.parse(JSON.stringify(configuration||{}));}
