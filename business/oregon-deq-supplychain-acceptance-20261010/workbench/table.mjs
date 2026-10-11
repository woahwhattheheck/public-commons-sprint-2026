// MIT. Delimited and JSON tables retained by the trace workbench.
export const FIELDS = Object.freeze({
  products: ['id', 'name', 'destinationNode'],
  nodes: ['id', 'stage', 'name', 'country', 'latitude', 'longitude'],
  links: ['id', 'productId', 'from', 'to', 'source', 'observedAt', 'evidenceJson'],
  risks: ['nodeId', 'category', 'disposition', 'source', 'observedAt', 'evidenceJson'],
  evidence: ['targetKind', 'targetId', 'nodeId', 'category', 'source', 'observedAt']
});
export const STAGES = ['extraction', 'processing', 'manufacturing', 'distribution', 'oregon-market'];
export const CATEGORIES = ['labor', 'human_rights', 'environmental_justice', 'hazardous_substances', 'environmental_impacts'];
export const DISPOSITIONS = ['risk_found', 'reviewed_clear', 'unknown'];
export const ENUMS = {stage: STAGES, category: CATEGORIES, disposition: DISPOSITIONS, targetKind: ['links', 'risks']};
const fail = message => { throw new TypeError(message); };
export const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
export const clone = value => JSON.parse(JSON.stringify(value));
export function stable(value) {
  if (Array.isArray(value)) return '[' + value.map(stable).join(',') + ']';
  if (plain(value)) return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + stable(value[k])).join(',') + '}';
  return JSON.stringify(value);
}
export function instant(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)) return false;
  const ms = Date.parse(value);
  return Number.isFinite(ms) && new Date(ms).toISOString().slice(0,19) === value.slice(0,19);
}
export function parseTable(text, format='csv') {
  if (typeof text !== 'string' || text.length > 16 * 1024 * 1024) fail('Table must be UTF-8 text up to 16 MiB');
  text = text.replace(/^\uFEFF/, '');
  if (format === 'json') {
    const values = JSON.parse(text);
    if (!Array.isArray(values) || !values.every(plain)) fail('JSON table must be an array of records');
    if (values.length > 100000) fail('Maximum 100,000 source rows per table');
    const columns = [...new Set(values.flatMap(Object.keys))];
    if (columns.length > 256) fail('Maximum 256 columns');
    return {columns, rows: values.map((value, index) => ({number:index+1, line:index+1,
      cells:columns.map(key => value[key] == null ? '' : typeof value[key] === 'string' ? value[key] : JSON.stringify(value[key]))}))};
  }
  if (!['csv','tsv'].includes(format)) fail('Choose CSV, TSV or JSON');
  const delimiter = format === 'tsv' ? '\t' : ',';
  const records = []; let row=[], field='', quoted=false, closed=false, line=1, firstLine=1;
  const pushField = () => { row.push(field); field=''; closed=false; };
  const pushRow = () => { pushField(); records.push({line:firstLine,cells:row}); row=[]; firstLine=line; };
  for (let i=0; i<text.length; i++) {
    const c=text[i];
    if (quoted) {
      if (c === '"') { if (text[i+1] === '"') { field+='"'; i++; } else { quoted=false; closed=true; } }
      else { field+=c; if(c === '\n') line++; else if(c === '\r' && text[i+1] !== '\n') line++; }
    } else if (c === delimiter) pushField();
    else if (c === '\r' || c === '\n') {
      if(c === '\r' && text[i+1] === '\n') i++;
      line++; pushRow();
    } else if (c === '"' && field === '' && !closed) quoted=true;
    else { if(closed || c === '"') fail('Unexpected character after a quoted field at line '+line); field+=c; }
    if(records.length > 100001 || row.length > 256) fail('Table exceeds 100,000 rows or 256 columns');
  }
  if(quoted) fail('Unclosed quoted field at line '+firstLine);
  if(field !== '' || row.length || closed) pushRow();
  if(!records.length) fail('Table needs a header row');
  const columns=records.shift().cells;
  if(columns.length > 256 || columns.some(c=>!c.trim() || c.length>256) || new Set(columns).size !== columns.length)
    fail('Column headings must be present, distinct and at most 256 characters');
  const rows=records.map((record,index) => {
    if(record.cells.length !== columns.length) fail('Line '+record.line+' has '+record.cells.length+' fields; expected '+columns.length);
    return {number:index+1,...record};
  });
  return {columns,rows};
}
export function suggestedMapping(columns, kind) {
  const result={}; for(const field of FIELDS[kind] || []) {
    const match=columns.find(c=>c.replace(/[\s_-]/g,'').toLowerCase() === field.toLowerCase());
    if(match) result[field]=match;
  }
  if(columns.includes('evidence') && FIELDS[kind]?.includes('evidenceJson')) result.evidenceJson='evidence';
  return result;
}
export function readMapped(row, table, config) {
  const value={};
  for(const field of FIELDS[config.kind] || []) {
    const index=table.columns.indexOf(config.mapping?.[field]);
    let item=index<0 ? '' : row.cells[index];
    const replacements=config.valueMaps?.[field];
    if(replacements && Object.hasOwn(replacements,item)) item=replacements[item];
    if(Object.hasOwn(config.corrections?.[row.number] || {}, field)) item=config.corrections[row.number][field];
    value[field]=String(item ?? '').trim();
  }
  return value;
}
export function csv(columns, rows) {
  const cell=value => {
    let text=value == null ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value);
    if (/^[\s]*[=+@\-\t\r]/.test(text)) text="'"+text;
    return /[",\r\n]/.test(text) ? '"'+text.replaceAll('"','""')+'"' : text;
  };
  return '\uFEFF'+[columns,...rows.map(row=>Array.isArray(row)?row:columns.map(key=>row[key]))].map(row=>row.map(cell).join(',')).join('\r\n')+'\r\n';
}
