/** Lossless field strings; strict CSV syntax with physical source-line provenance. */
export class InputError extends Error {
  constructor(message, status = 400) { super(message); this.name = 'InputError'; this.status = status; }
}
export const clean = value => value == null ? '' : String(value).trim();
export function number(value) {
  const text = clean(value);
  if (!text || !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(text)) return null;
  const result = Number(text); return Number.isFinite(result) ? result : null;
}
export function day(value) {
  const text = clean(value), match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!match) throw new InputError(`Expected an ISO calendar date, received ${text.slice(0,80)}`);
  const parsed = new Date(text + 'T00:00:00Z');
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0,10) !== text) throw new InputError('Invalid calendar date: ' + text);
  return text;
}
export function parseCSV(text, {maxRows = 1_000_000, maxCell = 1_000_000} = {}) {
  if (typeof text !== 'string') throw new InputError('CSV content must be UTF-8 text');
  text = text.replace(/^\uFEFF/, '');
  let field = '', record = [], inQuotes = false, afterQuote = false, line = 1, startLine = 1;
  const records = [];
  const endField = () => { record.push(field); field = ''; afterQuote = false; };
  const endRecord = () => {
    endField();
    if (record.some(v => v !== '')) records.push({line:startLine, values:record});
    record = []; startLine = line + 1;
    if (records.length > maxRows + 1) throw new InputError(`CSV exceeds ${maxRows} rows`,413);
  };
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (inQuotes) {
      if (char === '"') { if (text[i+1] === '"') { field += '"'; i++; } else {inQuotes=false;afterQuote=true;} }
      else {field += char; if (char === '\n') line++;}
    } else if (char === ',') endField();
    else if (char === '\n' || char === '\r') {endRecord();if(char==='\r'&&text[i+1]==='\n') i++;line++;}
    else if (afterQuote) throw new InputError(`Unexpected character after closing quote at line ${line}`);
    else if (char === '"') {if(field) throw new InputError(`Quote inside unquoted field at line ${line}`);inQuotes=true;}
    else field += char;
    if(field.length > maxCell) throw new InputError(`Field too large at line ${line}`,413);
  }
  if(inQuotes) throw new InputError(`Unclosed quoted field starting at line ${startLine}`);
  if(field || record.length || afterQuote) endRecord();
  if(!records.length) throw new InputError('CSV is empty');
  const headers = records.shift().values.map(clean);
  if(headers.some(x=>!x) || new Set(headers).size !== headers.length) throw new InputError('CSV header names must be nonempty and unique');
  const rows=[], rejected=[];
  for(const item of records) {
    if(item.values.length !== headers.length) rejected.push({line:item.line,reason:`Expected ${headers.length} fields; received ${item.values.length}`,values:item.values});
    else rows.push({line:item.line,raw:Object.fromEntries(headers.map((h,i)=>[h,item.values[i]]))});
  }
  return {headers,rows,rejected};
}
export function csv(rows, fields) {
  // Spreadsheet consumers must not execute raw station names, notes, or formulas.
  const quote = value => {
    if(value == null) return '""';
    let text = typeof value === 'object' ? JSON.stringify(value) : String(value);
    if(typeof value !== 'number' && /^[\s]*[=+\-@\t\r]/.test(text)) text = "'" + text;
    return '"' + text.replaceAll('"','""') + '"';
  };
  return [fields.map(quote).join(','), ...rows.map(r=>fields.map(f=>quote(r[f])).join(','))].join('\r\n') + '\r\n';
}
export function safeJSON(text) {
  try{return JSON.parse(text);}catch{throw new InputError('The source is not valid JSON');}
}
