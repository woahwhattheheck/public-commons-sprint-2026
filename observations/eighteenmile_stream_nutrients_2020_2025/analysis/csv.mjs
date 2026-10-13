// CSV routines retained from the published Eighteenmile original-observation normalizer.
export function parseCsv(text){const rows=[],row=[];let field="",quoted=false;for(let i=0;i<text.length;i++){const c=text[i];if(c==='"'){if(quoted&&text[i+1]==='"'){field+='"';i++;}else quoted=!quoted;}else if(c===","&&!quoted){row.push(field);field="";}else if((c==="\n"||c==="\r")&&!quoted){row.push(field);field="";rows.push(row.splice(0));if(c==="\r"&&text[i+1]==="\n")i++;}else field+=c;}if(quoted)throw Error("Unclosed CSV quote");if(field.length||row.length){row.push(field);rows.push(row);}const header=rows.shift();return rows.filter(r=>r.length!==1||r[0]!=="").map(r=>{if(r.length!==header.length)throw Error("CSV width mismatch");return Object.fromEntries(header.map((h,i)=>[h,r[i]]));});}

export function writeCsv(rows) {
 const fields=rows.length?Object.keys(rows[0]):[];
 const cell=value=>{const s=value===null||value===undefined?"":typeof value==="object"?JSON.stringify(value):String(value);return /[",\r\n]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s;};
 return fields.join(",")+"\n"+rows.map(row=>fields.map(k=>cell(row[k])).join(",")).join("\n")+(rows.length?"\n":"");
}
