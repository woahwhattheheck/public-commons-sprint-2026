/* MIT. Escaped industrial views; exact report values remain text. */
export const esc=x=>String(x??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
export const pretty=x=>JSON.stringify(x,null,2);
export const label=x=>String(x).replace(/([a-z])([A-Z])/g,"$1 $2").replace(/_/g," ").replace(/^./,c=>c.toUpperCase());
export function displayValue(x){if(x&&typeof x==="object"&&Object.prototype.hasOwnProperty.call(x,"value")&&x.status){return "Value: "+(x.value===null?"Not available":x.value)+"\nStatus: "+x.status+"\nExact: "+(x.exact?x.exact.numerator+" / "+x.exact.denominator:"Not available")+(x.missing?.length?"\nMissing: "+x.missing.join("; "):"")+(x.sourceRefs?.length?"\nSources: "+x.sourceRefs.join("\n"):"");}if(x&&typeof x==="object"&&Object.prototype.hasOwnProperty.call(x,"value"))return String(x.value??"Unavailable")+(x.exact?"\nExact: "+x.exact.numerator+" / "+x.exact.denominator:"")+(x.approximate?"\nApproximate: "+(x.method||"Floating calculation"):"");return typeof x==="object"&&x!==null?JSON.stringify(x):x;}
export function table(headers,rows,caption=""){return '<div class="table-wrap"><table>'+(caption?'<caption>'+esc(caption)+'</caption>':"")+'<thead><tr>'+headers.map(h=>'<th>'+esc(label(h))+'</th>').join("")+'</tr></thead><tbody>'+rows.map(r=>'<tr>'+r.map(x=>'<td>'+esc(displayValue(x))+'</td>').join("")+'</tr>').join("")+'</tbody></table></div>';}
export function options(rows,value,blank="Choose…"){return '<option value="">'+esc(blank)+'</option>'+rows.map(x=>'<option value="'+esc(x[0])+'"'+(String(x[0])===String(value)?' selected':"")+'>'+esc(x[1])+'</option>').join("");}
export function field(key,value,title=label(key),type="text"){return '<label>'+esc(title)+'<input data-draft="'+esc(key)+'" type="'+esc(type)+'" value="'+esc(value)+'"></label>';}
export function area(key,value,title=label(key),code=false){return '<label class="wide">'+esc(title)+'<textarea data-draft="'+esc(key)+'" class="'+(code?"code":"")+'" spellcheck="false">'+esc(value)+'</textarea></label>';}
export function dataView(value,path="Report",depth=0){
 if(value===null||typeof value!=="object")return '<p><strong>'+esc(label(path))+':</strong> '+esc(value===null?"Not available":value)+'</p>';
 if(Array.isArray(value)){
  if(!value.length)return '<p class="muted">'+esc(label(path))+': no retained rows.</p>';
  if(value.every(x=>x&&typeof x==="object"&&!Array.isArray(x))){const keys=[...new Set(value.flatMap(x=>Object.keys(x)))];return table(keys,value.map(x=>keys.map(k=>x[k]===undefined?"":x[k])),label(path));}
  return table(["value"],value.map(x=>[x]),label(path));
 }
 let out="";const simple=Object.entries(value).filter(([k,v])=>v===null||typeof v!=="object");if(simple.length)out+=table(["field","value"],simple.map(([k,v])=>[label(k),v===null?"Not available":v]),label(path));
 for(const[k,v]of Object.entries(value))if(v!==null&&typeof v==="object"){out+='<section><h'+Math.min(3,depth+2)+'>'+esc(label(k))+'</h'+Math.min(3,depth+2)+'>'+dataView(v,k,depth+1)+'</section>';}return out;
}
export function recordCSV(value){
 const rows=[["path","value","type"]];function walk(x,path){if(x!==null&&typeof x==="object"){const entries=Object.entries(x);if(!entries.length)rows.push([path,JSON.stringify(x),Array.isArray(x)?"array":"object"]);for(const[k,v]of entries)walk(v,path+"/"+String(k).replace(/~/g,"~0").replace(/\//g,"~1"));}else rows.push([path,x===null?"":String(x),x===null?"null":typeof x]);}
 walk(value,"");const safe=x=>/^[=+\-@\t\r]/.test(x)?"'"+x:x;return rows.map(r=>r.map(x=>'"'+safe(String(x)).replace(/"/g,'""')+'"').join(",")).join("\r\n")+"\r\n";
}
export function sourceTable(rows,columns,page=0){const size=50,total=rows.length,max=Math.max(0,Math.ceil(total/size)-1),p=Math.min(page,max);return '<p>'+total+' original records · page '+(p+1)+' of '+(max+1)+'</p>'+table(["original row",...columns],rows.slice(p*size,(p+1)*size).map((r,i)=>[r.index,...columns.map(k=>r.values[k])]))+'<div class="actions"><button data-action="source-prev"'+(p===0?" disabled":"")+'>Previous</button><button data-action="source-next"'+(p===max?" disabled":"")+'>Next</button></div>';}
