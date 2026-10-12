// MIT. Complete native text-table comparisons for Timescale commissioning.
// Values remain native text or explicit NULL. No numeric/date coercion or row sampling.
function issue(code,message){const error=new Error(message);error.code='TIMESCALE_COMMISSIONING_'+code;error.status=400;throw error;}
function object(value){return value!==null&&typeof value==='object'&&!Array.isArray(value);}
function text(value,label,maximum=256){if(typeof value!=='string'||!value.trim()||value.includes('\0')||value.length>maximum)issue('TEXT_REQUIRED','Provide '+label+'.');return value;}
function exactKeys(value,keys,label){if(!object(value)||Object.keys(value).some(k=>!keys.includes(k)))issue('SHAPE_INVALID','Use the declared '+label+' fields.');}
function nativeTable(value){
  if(!object(value)||!Array.isArray(value.columns)||!Array.isArray(value.rows)||!value.columns.length||value.columns.length>512)
    issue('TABLE_REQUIRED','Provide the complete native JSON table with columns and rows.');
  const names=value.columns.map(column=>typeof column==='string'?text(column,'a column name'):text(column?.name,'a native column name'));
  if(new Set(names).size!==names.length)issue('DUPLICATE_COLUMN','Native table column names must be unique.');
  if(value.rows.length>1000000)issue('TABLE_TOO_LARGE','This table exceeds one million rows; choose the full agreed source window before export.');
  for(let row=0;row<value.rows.length;row++){
    const cells=value.rows[row];
    if(!Array.isArray(cells)||cells.length!==names.length)issue('ROW_WIDTH','Native row '+(row+1)+' does not match its declared columns.');
    for(const cell of cells)if(cell!==null&&typeof cell!=='string')issue('NATIVE_TEXT_REQUIRED','Native row '+(row+1)+' must preserve every value as text or JSON null; export numbers as native strings.');
  }
  return {names,rows:value.rows};
}
function selectNativeTable(document,tableName=null){
  if(tableName===null||tableName==='')return nativeTable(document);
  text(tableName,'the original native table name');
  if(!object(document?.tables)||!Object.hasOwn(document.tables,tableName))issue('TABLE_NOT_FOUND','The original JSON file does not contain the selected native table.');
  return nativeTable(document.tables[tableName]);
}
function comparisonMapping(expected,observed,input){
  exactKeys(input,['columns','ignoredExpected','ignoredObserved'],'mapping');
  if(!Array.isArray(input.columns)||input.columns.length<1||input.columns.length>512)issue('MAPPING_REQUIRED','Map the complete agreed comparison columns.');
  const labels=new Set(),left=new Set(),right=new Set();
  const columns=input.columns.map(value=>{
    exactKeys(value,['name','expected','observed','key'],'column mapping');
    const name=text(value.name,'the mapped field name'),a=text(value.expected,'the expected native column'),b=text(value.observed,'the observed native column');
    if(labels.has(name)||left.has(a)||right.has(b)||!expected.names.includes(a)||!observed.names.includes(b))issue('MAPPING_COLUMN','Every mapped field needs one distinct existing column on each side.');
    if(value.key!==undefined&&typeof value.key!=='boolean')issue('KEY_INVALID','A comparison key must be a boolean.');
    labels.add(name);left.add(a);right.add(b);
    return {name,expected:a,observed:b,key:value.key??false};
  });
  function ignored(values,names,used,side){
    if(!Array.isArray(values))issue('IGNORED_COLUMNS_REQUIRED','Declare the '+side+' columns omitted from this comparison, with a reason, or use an empty array.');
    const selected=new Set();
    const rows=values.map(value=>{
      exactKeys(value,['column','reason'],'omitted-column');
      const column=text(value.column,'the omitted column'),reason=text(value.reason,'why that field is outside the selected comparison',2000);
      if(!names.includes(column)||used.has(column)||selected.has(column))issue('IGNORED_COLUMN','The '+side+' omitted-column selection is changed or duplicated.');
      selected.add(column);return {column,reason};
    });
    if(names.some(name=>!used.has(name)&&!selected.has(name)))issue('UNMAPPED_COLUMN','Map or explicitly explain every '+side+' source column.');
    return rows;
  }
  return {columns,ignoredExpected:ignored(input.ignoredExpected,expected.names,left,'expected'),
    ignoredObserved:ignored(input.ignoredObserved,observed.names,right,'observed')};
}
function compareNativeTables(expected,observed,mappingInput){
  // Validate callers' native table objects as well as files accepted through selectNativeTable.
  const a=nativeTable({columns:expected.names??expected.columns,rows:expected.rows});
  const b=nativeTable({columns:observed.names??observed.columns,rows:observed.rows});
  const mapping=comparisonMapping(a,b,mappingInput),columns=mapping.columns;
  const keyPositions=columns.map((column,index)=>column.key?index:-1).filter(index=>index>=0);
  const expectedPositions=columns.map(column=>a.names.indexOf(column.expected));
  const observedPositions=columns.map(column=>b.names.indexOf(column.observed));
  function counts(rows,positions){
    const bag=new Map();
    for(const original of rows){
      const values=positions.map(position=>original[position]),signature=JSON.stringify(values);
      const prior=bag.get(signature);
      if(prior)prior.count++;else bag.set(signature,{values,count:1});
    }
    return bag;
  }
  const left=counts(a.rows,expectedPositions),right=counts(b.rows,observedPositions);
  const expectedOnly=[],observedOnly=[];let matchedRows=0;
  const signatures=[...new Set([...left.keys(),...right.keys()])].sort();
  for(const signature of signatures){
    const l=left.get(signature),r=right.get(signature),matched=Math.min(l?.count??0,r?.count??0);
    matchedRows+=matched;
    const values=(l??r).values,key=keyPositions.map(position=>values[position]);
    if((l?.count??0)>matched)expectedOnly.push({key,values,count:l.count-matched});
    if((r?.count??0)>matched)observedOnly.push({key,values,count:r.count-matched});
  }
  const groups=new Map();
  function add(rows,side){for(const [index,row] of rows.entries()){const signature=JSON.stringify(row.key);let group=groups.get(signature);
    if(!group){group={key:row.key,expectedOnly:[],observedOnly:[]};groups.set(signature,group);}group[side].push(index);}}
  add(expectedOnly,'expectedOnly');add(observedOnly,'observedOnly');
  return {schema:'stellar-forge.timescale-commissioning-comparison.v1',mode:'EXACT_NATIVE_TEXT',
    complete:true,matches:expectedOnly.length===0&&observedOnly.length===0,mapping,
    counts:{expectedRows:a.rows.length,observedRows:b.rows.length,matchedRows,
      expectedOnlyRows:expectedOnly.reduce((n,row)=>n+row.count,0),observedOnlyRows:observedOnly.reduce((n,row)=>n+row.count,0)},
    keyColumns:columns.filter(column=>column.key).map(column=>column.name),
    expectedOnly,observedOnly,groups:[...groups.values()],
    interpretation:'Complete multiset comparison of the explicitly mapped native columns. Duplicate multiplicity, exact strings and JSON null are preserved. Named keys group differences; they never discard or merge source rows.'};
}
export { nativeTable, selectNativeTable, comparisonMapping, compareNativeTables };
