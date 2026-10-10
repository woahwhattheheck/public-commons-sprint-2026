// SPDX-License-Identifier: MIT
const $=s=>document.querySelector(s);
let inventory=[],exclusions=[];
const money=n=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(n/100);
function node(tag,cls,text){const el=document.createElement(tag);if(cls)el.className=cls;if(text!==undefined)el.textContent=text;return el;}
function recordError(e){$('#status').className='error';$('#status').textContent=e?.message??String(e);}
function parseCsv(raw){
  // Handles quoted commas, doubled quotes, and CRLF without dependencies.
  const rows=[];let row=[],field='',quoted=false;
  const data=raw.replace(/^\uFEFF/,'');
  for(let i=0;i<data.length;i++){const c=data[i];if(c==='"'){if(quoted&&data[i+1]==='"'){field+='"';i++;}else if(!quoted&&!field){quoted=true;}else if(quoted){quoted=false;}else throw Error('Malformed quote in CSV');}
    else if(c===','&&!quoted){row.push(field);field='';}else if((c==='\n'||c==='\r')&&!quoted){if(c==='\r'&&data[i+1]==='\n')i++;row.push(field);if(row.some(x=>x.trim()))rows.push(row);row=[];field='';}
    else field+=c;}
  if(quoted)throw Error('Unclosed quoted CSV field');row.push(field);if(row.some(x=>x.trim()))rows.push(row);
  if(rows.length<2)throw Error('Expected CSV header and at least one inventory row');
  const cols=rows.shift().map(c=>c.trim().toLowerCase());for(const key of ['sku','title','author','price_cents','stock','qloo_id'])if(!cols.includes(key))throw Error(`Missing CSV column ${key}`);
  return rows.map((r,i)=>{if(r.length!==cols.length)throw Error(`CSV row ${i+2} has ${r.length} cells, expected ${cols.length}`);const x=Object.fromEntries(cols.map((k,j)=>[k,r[j].trim()]));return {...x,price_cents:Number(x.price_cents),stock:Number(x.stock)};});
}
function inventoryStatus(){
  $('#inventoryState').textContent=`${inventory.length} retailer rows · ${inventory.filter(x=>x.qloo_id).length} Qloo-linked · ${inventory.filter(x=>Number(x.stock)>0).length} in stock`;
}
function render(result){
  $('#status').className='status';$('#resultsTag').textContent=result.provenance.mode==='SYNTHETIC_DEMO'?'SYNTHETIC DEMO':'LIVE QLOO';
  $('#status').textContent=result.explanation;
  const cards=$('#cards');cards.replaceChildren();
  for(const book of result.selected){const box=node('article','book');
    box.append(node('div','category',book.category),node('h3',null,book.title),node('p','author',book.author),node('p','price',money(book.price_cents)),node('p','footnote',`SKU ${book.sku} · ${book.stock_available} retailer copies · Qloo order ${book.qloo_rank}`));
    if(book.shelf_note)box.append(node('p','footnote',`Store note: ${book.shelf_note}`));
    const btn=node('button',null,'Exclude and replan');btn.addEventListener('click',()=>{if(!exclusions.includes(book.sku))exclusions.push(book.sku);executePlan();});box.append(btn);cards.append(box);
  }
  $('#totals').textContent=`${result.selected.length} books · ${money(result.total_cents)} of ${money(result.input.budget_cents)} · ${money(result.remaining_cents)} remaining`;
  $('#evidence').textContent=JSON.stringify({provenance:result.provenance,candidate_count:result.candidate_count,unresolved_inventory:result.unresolved_inventory,excluded:result.excluded},null,2);
}
async function executePlan(){
  if(!inventory.length){recordError(Error('No inventory loaded'));return;}
  $('#status').className='status';$('#status').textContent='Reconciling real stock and taste evidence…';
  $('#run').disabled=true;
  try{
    const input={mode:$('#mode').value,seed_titles:$('#seeds').value.split(',').map(x=>x.trim()).filter(Boolean),inventory,budget_cents:Math.round(Number($('#budget').value)*100),max_books:Number($('#qty').value),exclude_skus:exclusions};
    const response=await fetch('/api/plan',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)});
    const output=await response.json();if(!response.ok)throw Error(`${output.error}: ${output.message}`);
    render(output);
  }catch(e){recordError(e);}finally{$('#run').disabled=false;}
}
$('#run').addEventListener('click',executePlan);
$('#mode').addEventListener('change',()=>{$('#notice').textContent=$('#mode').value==='demo'?'SYNTHETIC DEMO — all books, Qloo identifiers and rankings in demo mode are invented fixtures. Never interpret them as live Qloo evidence.':'LIVE — requires a real QLOO_API_KEY configured on the server and retailer-supplied exact Qloo book IDs in inventory. No fallback to synthetic data if provider fails.';});
$('#csv').addEventListener('change',async e=>{try{const file=e.target.files?.[0];if(!file)return;if(file.size>150000)throw Error('CSV is too large');inventory=parseCsv(await file.text());exclusions=[];inventoryStatus();$('#status').textContent='Retailer inventory imported; review IDs and build.';}catch(err){recordError(err);}});
$('#demo').addEventListener('click',async()=>{const response=await fetch('/api/demo-inventory');const r=await response.json();inventory=r.inventory;exclusions=[];$('#mode').value='demo';$('#mode').dispatchEvent(new Event('change'));inventoryStatus();$('#status').textContent='Synthetic inventory loaded. Ready to build.';});
$('#demo').click();
