// SPDX-License-Identifier: MIT
// Local interchange only: CSV cannot supply Qloo affinity or certify stock freshness.
export const COLUMNS=['sku','isbn','title','author','category','price_cents','currency','stock','observed_at','qloo_id','shelf_note'];
export function moneyToCents(value){
  const match=/^(\d{1,6})(?:\.(\d{1,2}))?$/.exec(String(value).trim());
  if(!match)throw Error('Enter a USD amount with at most two decimal places.');
  return Number(match[1])*100+Number((match[2]??'').padEnd(2,'0'));
}
export function parseCsv(raw){
  const rows=[];let row=[],field='',state='plain';const data=raw.replace(/^\uFEFF/,'');
  const cell=()=>{row.push(field);field='';state='plain';};
  const line=()=>{cell();if(row.some(v=>v.trim()))rows.push(row);row=[];if(rows.length>10001)throw Error('Catalog exceeds 10,000 records.');};
  for(let i=0;i<data.length;i++){
    const c=data[i];
    if(state==='quoted'){
      if(c==='"'&&data[i+1]==='"'){field+='"';i++;}
      else if(c==='"')state='after';else field+=c;
    }else if(c===',')cell();
    else if(c==='\r'||c==='\n'){if(c==='\r'&&data[i+1]==='\n')i++;line();}
    else if(c==='"'&&!field&&state==='plain')state='quoted';
    else if(state==='after')throw Error(`Unexpected character after closing quote near CSV record ${rows.length+1}.`);
    else if(c==='"')throw Error(`Unexpected quote near CSV record ${rows.length+1}.`);
    else field+=c;
  }
  if(state==='quoted')throw Error('Unclosed quoted CSV field.');line();
  if(rows.length<2)throw Error('Expected a CSV header and at least one inventory record.');
  const columns=rows.shift().map(x=>x.trim().toLowerCase());
  if(columns.some(x=>!x)||new Set(columns).size!==columns.length)throw Error('CSV column names must be nonempty and unique.');
  for(const name of ['sku','title','author','price_cents','stock'])if(!columns.includes(name))throw Error(`Missing CSV column: ${name}.`);
  return rows.map((r,i)=>{
    if(r.length!==columns.length)throw Error(`CSV record ${i+2}: expected ${columns.length} fields, found ${r.length}.`);
    return Object.fromEntries(columns.map((name,j)=>[name,r[j].trim()]));
  });
}
export function parseCatalog(text,name='catalog.csv'){
  if(/\.json$/i.test(name)){
    const value=JSON.parse(text);const inventory=Array.isArray(value)?value:value?.inventory;
    if(!Array.isArray(inventory))throw Error('JSON must be an inventory array or an exported ShelfConductor catalog.');
    const meta=value?.format==='shelfconductor-catalog/v1'&&value.meta&&typeof value.meta==='object'?value.meta:{};
    return {inventory,meta};
  }
  return {inventory:parseCsv(text),meta:{}};
}
function csvField(value){
  let text=String(value??'');
  // Spreadsheet-safe display; use JSON when exact byte identity is required.
  if(typeof value!=='number'&&/^[\s]*[=+\-@\t\r]/.test(text))text="'"+text;
  return '"'+text.replaceAll('"','""')+'"';
}
export function toCsv(rows,columns=COLUMNS){return [columns.map(csvField).join(','),...rows.map(r=>columns.map(c=>csvField(r[c])).join(','))].join('\r\n')+'\r\n';}
