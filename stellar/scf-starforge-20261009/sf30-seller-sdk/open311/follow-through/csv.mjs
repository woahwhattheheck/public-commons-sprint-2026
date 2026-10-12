// MIT. Reversible CSV cells using the maintained municipal GIS encoding.
import { canonical, fail, MAX_ROWS } from '../gis/shared.mjs';
const columnText=value=>value==null?'':typeof value==='object'?canonical(value):String(value);
const CSV_MARKER='open311_csv_encoding', CSV_ENCODING='apostrophe-v1';
const formula = value => /^[ \t\r\n]*[=+\-@]/.test(value);
const protect = value => formula(value)||value.startsWith("'")?"'"+value:value;
const unprotect = value => value.startsWith("'")&&(value.slice(1).startsWith("'")||formula(value.slice(1)))?value.slice(1):value;
export function csvEncode(columns, rows, { protectCells=true }={}) {
  if(!Array.isArray(columns)||new Set(columns).size!==columns.length||protectCells&&columns.includes(CSV_MARKER))fail('INVALID_CSV_COLUMNS','Choose distinct CSV columns; open311_csv_encoding is reserved for the declared reversible cell encoding.');
  const escape=value=>'"'+String(value).replace(/"/g,'""')+'"';
  const headers=protectCells?[...columns,CSV_MARKER]:columns;
  return [headers.map(escape).join(','),...rows.map(row=>[...columns.map(key=>{
    const value=columnText(row[key]);return protectCells?protect(value):value;
  }),...(protectCells?[CSV_ENCODING]:[])].map(escape).join(','))].join('\r\n')+'\r\n';
}
export function csvDecode(originalText) {
  const value=originalText.charCodeAt(0)===0xFEFF?originalText.slice(1):originalText;
  const records=[];let row=[],cell='',quoted=false,closed=false,index=0;
  const field=()=>{row.push(cell);cell='';closed=false;};
  const record=()=>{field();records.push(row);row=[];};
  while(index<value.length){
    const c=value[index++];
    if(quoted){if(c==='"'){if(value[index]==='"'){cell+='"';index++;}else{quoted=false;closed=true;}}else cell+=c;continue;}
    if(c==='"'){if(cell||closed)fail('INVALID_CSV','A CSV quote appears outside a quoted field.');quoted=true;continue;}
    if(c===','){field();continue;}
    if(c==='\n'||c==='\r'){if(c==='\r'&&value[index]==='\n')index++;record();if(records.length>MAX_ROWS+1)fail('RETURN_ROW_LIMIT','The CSV exceeds 100,000 rows.',413);continue;}
    if(closed)fail('INVALID_CSV','Unexpected text follows a quoted CSV field.');
    cell+=c;
  }
  if(quoted)fail('INVALID_CSV','A quoted CSV field is incomplete.');
  if(cell||closed||row.length)record();
  if(!records.length)fail('INVALID_CSV','The CSV needs a complete header row.');
  const headers=records.shift();
  if(headers.some(key=>!key)||new Set(headers).size!==headers.length)fail('INVALID_CSV_HEADER','CSV columns must have distinct nonempty names.');
  const encoded=headers.includes(CSV_MARKER);
  return records.map((values,i)=>{
    if(values.length!==headers.length)fail('INVALID_CSV_ROW','CSV row '+(i+2)+' has a different number of columns.');
    const row=Object.fromEntries(headers.map((key,n)=>[key,values[n]]));
    if(encoded&&row[CSV_MARKER]!==CSV_ENCODING)fail('INVALID_CSV_ENCODING','Keep the declared CSV encoding on each row.');
    if(encoded)for(const key of headers)if(key!==CSV_MARKER)row[key]=unprotect(row[key]);
    return row;
  });
}
