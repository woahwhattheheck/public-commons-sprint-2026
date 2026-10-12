// MIT. Reviewed SELECT templates, exact typed literals and native time-series reports.
import { QueryInputError, fail, object, own, exact, bounded, name, identifier, literal,
  utf8, canonical, decimalParts, compareDecimal, integralDecimal, timestampValue } from './common.mjs';
export { QueryInputError };
const TYPES = ['string','symbol','boolean','integer','long','number','decimal','timestamp','timestamp_ns'];
const QUERY_FIELDS = ['sql','parameters','parameterOrder','columns','maxRows','maxBytes','timeoutMs','probe','report'];
const PARAM_FIELDS = ['type','nullable','minimum','maximum','minLength','maxLength','enum','default','precision','scale'];
const integerText = (value, field) => {
  const text = typeof value === 'number' && Number.isSafeInteger(value) ? String(value) : value;
  if (typeof text !== 'string' || !/^-?(0|[1-9][0-9]*)$/.test(text)) throw new QueryInputError(field,'INTEGER_TEXT_REQUIRED');
  return text;
};
function scalar(value, spec, field) {
  if (value === null) { if (spec.nullable) return null; throw new QueryInputError(field,'NULL_NOT_ALLOWED'); }
  if (spec.type === 'string' || spec.type === 'symbol') {
    if (!utf8(value) || value.includes('\0')) throw new QueryInputError(field,'UTF8_STRING_REQUIRED');
    if (value.length < (spec.minLength ?? 0) || value.length > (spec.maxLength ?? 4096))
      throw new QueryInputError(field,'STRING_LENGTH_INVALID');
    return value;
  }
  if (spec.type === 'boolean') {
    if (value === 'true' || value === 'false') return value === 'true';
    if (typeof value !== 'boolean') throw new QueryInputError(field,'BOOLEAN_REQUIRED');
    return value;
  }
  if (spec.type === 'timestamp' || spec.type === 'timestamp_ns') {
    try { timestampValue(value,spec.type === 'timestamp_ns' ? 9 : 6); }
    catch (issue) { throw new QueryInputError(field,issue.code); }
    return value;
  }
  if (spec.type === 'integer' || spec.type === 'long') {
    const text = integerText(value,field), integer = BigInt(text);
    const lo = spec.type === 'integer' ? BigInt(Number.MIN_SAFE_INTEGER) : -9223372036854775807n;
    const hi = spec.type === 'integer' ? BigInt(Number.MAX_SAFE_INTEGER) : 9223372036854775807n;
    if (integer < lo || integer > hi) throw new QueryInputError(field,'INTEGER_OUT_OF_RANGE');
    return spec.type === 'integer' ? Number(text) : text;
  }
  if (spec.type === 'decimal' && typeof value !== 'string') throw new QueryInputError(field,'EXACT_DECIMAL_STRING_REQUIRED');
  const text = typeof value === 'number' && Number.isFinite(value) ? Object.is(value,-0) ? '-0' : String(value) : value;
  let parts;
  try { parts = decimalParts(text); } catch (issue) { throw new QueryInputError(field,issue.code); }
  if (spec.type === 'number' && !Number.isFinite(Number(text))) throw new QueryInputError(field,'NUMBER_NOT_FINITE');
  if (spec.type === 'decimal') {
    const precision = spec.precision, scale = spec.scale;
    const delta = scale - parts.scale;
    if (delta < 0 && parts.coefficient % 10n ** BigInt(-delta) !== 0n) throw new QueryInputError(field,'DECIMAL_SCALE_EXCEEDED');
    const coefficient = delta >= 0 ? parts.coefficient * 10n ** BigInt(delta) : parts.coefficient / 10n ** BigInt(-delta);
    if (coefficient.toString().replace('-','').length > precision) throw new QueryInputError(field,'DECIMAL_PRECISION_EXCEEDED');
  }
  return text;
}
function compare(a,b,spec) {
  if (spec.type === 'timestamp' || spec.type === 'timestamp_ns') {
    const x=timestampValue(a,spec.type==='timestamp_ns'?9:6),y=timestampValue(b,spec.type==='timestamp_ns'?9:6);
    return x<y?-1:x>y?1:0;
  }
  if (['integer','long','number','decimal'].includes(spec.type)) return compareDecimal(String(a),String(b));
  return a<b?-1:a>b?1:0;
}
function checkedValue(value,spec,field) {
  const result=scalar(value,spec,field);
  if (result!==null) {
    if (own(spec,'minimum') && compare(result,spec.minimum,spec)<0) throw new QueryInputError(field,'VALUE_BELOW_MINIMUM');
    if (own(spec,'maximum') && compare(result,spec.maximum,spec)>0) throw new QueryInputError(field,'VALUE_ABOVE_MAXIMUM');
    if (spec.enum && !spec.enum.some(item=>item===null?false:compare(result,item,spec)===0)) throw new QueryInputError(field,'VALUE_NOT_ALLOWED');
  } else if (spec.enum && !spec.enum.includes(null)) throw new QueryInputError(field,'VALUE_NOT_ALLOWED');
  return result;
}
function parameter(raw,field) {
  exact(raw,PARAM_FIELDS,'QUESTDB_PARAMETER_FIELDS_INVALID');
  if (!TYPES.includes(raw.type) || raw.nullable!==undefined && typeof raw.nullable!=='boolean') throw fail('QUESTDB_PARAMETER_TYPE_INVALID');
  const spec={...structuredClone(raw),nullable:raw.nullable??false};
  if (spec.type==='decimal') {
    bounded(spec.precision,1,76,'QUESTDB_DECIMAL_PRECISION_REQUIRED');
    bounded(spec.scale,0,spec.precision,'QUESTDB_DECIMAL_SCALE_REQUIRED');
  } else if (own(spec,'precision') || own(spec,'scale')) throw fail('QUESTDB_DECIMAL_FIELDS_ONLY');
  for(const key of ['minLength','maxLength']) if(own(spec,key)) {
    if(!['string','symbol'].includes(spec.type)) throw fail('QUESTDB_STRING_FIELDS_ONLY');
    bounded(spec[key],0,65536,'QUESTDB_STRING_LIMIT_INVALID');
  }
  if ((spec.minLength??0)>(spec.maxLength??4096)) throw fail('QUESTDB_STRING_LIMIT_INVALID');
  for(const key of ['minimum','maximum']) if(own(spec,key)) {
    if(spec[key]===null || spec.type==='boolean') throw fail('QUESTDB_BOUND_INVALID');
    spec[key]=scalar(spec[key],spec,field);
  }
  if(own(spec,'minimum') && own(spec,'maximum') && compare(spec.minimum,spec.maximum,spec)>0) throw fail('QUESTDB_BOUND_ORDER_INVALID');
  if(own(spec,'enum')) {
    if(!Array.isArray(spec.enum) || !spec.enum.length || spec.enum.length>256) throw fail('QUESTDB_ENUM_INVALID');
    spec.enum=spec.enum.map(value=>scalar(value,spec,field));
  }
  if(own(spec,'default')) spec.default=checkedValue(spec.default,spec,field);
  return spec;
}
// This template parser binds only values. The source account retains the database grants.
function tokens(sql,parameters) {
  if(!utf8(sql) || !sql.trim() || Buffer.byteLength(sql)>65536 || !/^\s*(SELECT|WITH)\b/i.test(sql)) throw fail('QUESTDB_SELECT_REQUIRED');
  let i=0,begin=0;const result=[],used=new Set();
  while(i<sql.length) {
    const ch=sql[i];
    if(sql.startsWith('--',i)){const end=sql.indexOf('\n',i+2);i=end<0?sql.length:end+1;continue;}
    if(sql.startsWith('/*',i)){
      const end=sql.indexOf('*/',i+2);if(end<0)throw fail('QUESTDB_SQL_COMMENT_UNCLOSED');i=end+2;continue;
    }
    if(ch==="'" || ch==='"') {
      const quote=ch;i++;let ended=false;
      while(i<sql.length){if(sql[i++]!==quote)continue;if(sql[i]===quote){i++;continue;}ended=true;break;}
      if(!ended)throw fail('QUESTDB_SQL_LITERAL_UNCLOSED');continue;
    }
    if(ch===';' || ch==='\0') throw fail('QUESTDB_ONE_SELECT_REQUIRED');
    if(ch==='$') {
      const match=/^\$([A-Za-z][A-Za-z0-9_]*)/.exec(sql.slice(i));
      if(!match || !own(parameters,match[1]))throw fail('QUESTDB_UNDECLARED_PARAMETER');
      result.push({text:sql.slice(begin,i)},{parameter:match[1]});used.add(match[1]);i+=match[0].length;begin=i;continue;
    }
    i++;
  }
  result.push({text:sql.slice(begin)});
  if(Object.keys(parameters).some(key=>!used.has(key)))throw fail('QUESTDB_UNUSED_PARAMETER');
  return result;
}
export function bindQuestDbParameters(query,input={}) {
  if(!object(input) || Object.keys(input).some(key=>!own(query.parameters,key)))throw new QueryInputError(null,'UNDECLARED_QUERY_INPUT');
  const values=Object.create(null);
  for(const field of query.parameterOrder) {
    const spec=query.parameters[field];let value;
    if(own(input,field))value=input[field];else if(own(spec,'default'))value=spec.default;else throw new QueryInputError(field,'QUERY_PARAMETER_REQUIRED');
    values[field]=checkedValue(value,spec,field);
  }
  const window=query.report?.window;
  if(window && values[window.start]!==null && values[window.end]!==null &&
      compare(values[window.start],values[window.end],query.parameters[window.start])>=0)
    throw new QueryInputError(window.end,'TIME_WINDOW_MUST_INCREASE');
  return values;
}
function sqlValue(value,spec) {
  if(value===null)return 'NULL';
  if(spec.type==='boolean')return value?'true':'false';
  if(spec.type==='string' || spec.type==='symbol')return literal(value);
  if(spec.type==='timestamp' || spec.type==='timestamp_ns')return 'cast('+literal(value)+' as '+spec.type+')';
  if(spec.type==='decimal')return 'cast('+literal(String(value))+' as decimal('+spec.precision+','+spec.scale+'))';
  if(spec.type==='long')return 'cast('+literal(value)+' as long)';
  if(spec.type==='number')return 'cast('+literal(value)+' as double)';
  return String(value);
}
export function questDbStatement(query,input) {
  const values=bindQuestDbParameters(query,input);
  const sql=query.tokens.map(token=>own(token,'text')?token.text:sqlValue(values[token.parameter],query.parameters[token.parameter])).join('');
  return {sql:'SELECT '+query.columns.map(identifier).join(', ')+'\nFROM (\n'+sql+'\n) AS sf30_questdb_source',values};
}
function compileOne(raw) {
  exact(raw,QUERY_FIELDS,'QUESTDB_QUERY_FIELDS_INVALID');
  if(!object(raw.parameters??{}))throw fail('QUESTDB_PARAMETERS_REQUIRED');
  const parameters=Object.fromEntries(Object.entries(raw.parameters??{}).map(([field,spec])=>[name(field),parameter(spec,field)]));
  if(Object.keys(parameters).length>48)throw fail('QUESTDB_PARAMETER_LIMIT');
  const order=raw.parameterOrder??Object.keys(parameters);
  if(!Array.isArray(order)||order.length!==Object.keys(parameters).length||new Set(order).size!==order.length||order.some(key=>!own(parameters,key)))
    throw fail('QUESTDB_PARAMETER_ORDER_INVALID');
  if(!Array.isArray(raw.columns)||!raw.columns.length||raw.columns.length>128||new Set(raw.columns).size!==raw.columns.length)
    throw fail('QUESTDB_COLUMNS_REQUIRED');
  raw.columns.forEach(identifier);
  const query={sql:raw.sql,parameters,parameterOrder:[...order],columns:[...raw.columns],
    maxRows:bounded(raw.maxRows??100,1,100000,'QUESTDB_QUERY_ROW_LIMIT_INVALID'),
    maxBytes:bounded(raw.maxBytes??1048576,1024,33554432,'QUESTDB_QUERY_BYTE_LIMIT_INVALID'),
    timeoutMs:bounded(raw.timeoutMs??30000,100,3600000,'QUESTDB_QUERY_TIMEOUT_INVALID'),
    probe:structuredClone(raw.probe??{})};
  query.tokens=tokens(query.sql,parameters);
  if(raw.report!==undefined) {
    const generated=compileQuestDbReport(raw.report);
    const keys=['sql','parameters','parameterOrder','columns','maxRows','maxBytes','timeoutMs','probe'];
    const expected=compileOne({...generated,report:undefined});
    for(const key of keys)if(canonical(query[key])!==canonical(expected[key]))throw fail('QUESTDB_REPORT_DECLARATION_CHANGED','Recompile the reviewed report after changing its declaration.');
    query.report=structuredClone(generated.report);
  }
  bindQuestDbParameters(query,query.probe);
  return query;
}
export function compileQuestDbQueries(raw) {
  if(!object(raw)||Object.keys(raw).length>128)throw fail('QUESTDB_NAMED_QUERIES_REQUIRED');
  return Object.fromEntries(Object.entries(raw).map(([key,value])=>[name(key,'QUESTDB_QUERY_NAME_INVALID'),compileOne(value)]));
}
export function describeQuestDbQueries(queries) {
  return Object.fromEntries(Object.entries(queries).map(([key,value])=>[key,Object.fromEntries(
    QUERY_FIELDS.filter(field=>value[field]!==undefined).map(field=>[field,structuredClone(value[field])]))]));
}
function interval(value,allowCalendar=false) {
  if(typeof value!=='string' || !(allowCalendar?/^[1-9][0-9]{0,8}[nUTsmhdwMy]$/:/^[1-9][0-9]{0,8}[nUTsmhdw]$/).test(value))
    throw fail('QUESTDB_INTERVAL_INVALID','Use a native interval such as 50T, 1s, 5m or 1h.');
  return value;
}
function filterSql(filters,parameters,alias) {
  if(!Array.isArray(filters)||filters.length>48)throw fail('QUESTDB_FILTERS_INVALID');
  const ops={eq:'=',ne:'<>',lt:'<',lte:'<=',gt:'>',gte:'>='};
  return filters.map(filter=>{
    exact(filter,['column','op','parameter'],'QUESTDB_FILTER_INVALID');
    if(!own(ops,filter.op)||!own(parameters,filter.parameter))throw fail('QUESTDB_FILTER_INVALID');
    return alias+'.'+identifier(filter.column)+' '+ops[filter.op]+' $'+filter.parameter;
  });
}
export function compileQuestDbReport(supplied) {
  exact(supplied,['kind','table','timestamp','timestampType','timestampAlias','window','parameters','columns','filters','sample','asof','maxRows','maxBytes','timeoutMs','probe'],'QUESTDB_REPORT_FIELDS_INVALID');
  const report=structuredClone(supplied);
  if(!['window','sample','asof'].includes(report.kind))throw fail('QUESTDB_REPORT_KIND_INVALID');
  identifier(report.table);identifier(report.timestamp);
  report.timestampType??='timestamp';
  if(!['timestamp','timestamp_ns'].includes(report.timestampType))throw fail('QUESTDB_TIMESTAMP_TYPE_INVALID');
  exact(report.window,['start','end'],'QUESTDB_TIME_WINDOW_REQUIRED');name(report.window.start);name(report.window.end);
  if(report.window.start===report.window.end)throw fail('QUESTDB_TIME_WINDOW_INVALID');
  const parameters=structuredClone(report.parameters??{});
  for(const field of [report.window.start,report.window.end]) {
    if(!own(parameters,field))parameters[field]={type:report.timestampType};
    if(parameters[field].type!==report.timestampType || parameters[field].nullable===true)throw fail('QUESTDB_TIME_WINDOW_PARAMETER_INVALID');
  }
  const filters=filterSql(report.filters??[],parameters,'l');
  const where=['l.'+identifier(report.timestamp)+' >= $'+report.window.start,'l.'+identifier(report.timestamp)+' < $'+report.window.end,...filters];
  let sql,columns;
  if(report.kind==='sample') {
    exact(report.sample,['interval','keys','aggregates','fill','alignment'],'QUESTDB_SAMPLE_REQUIRED');
    const sample=report.sample,keys=sample.keys??[],aggregates=sample.aggregates??[];
    if(!Array.isArray(keys)||keys.length>16||new Set(keys).size!==keys.length||!Array.isArray(aggregates)||!aggregates.length||aggregates.length>64)throw fail('QUESTDB_SAMPLE_COLUMNS_INVALID');
    keys.forEach(name);
    const timestampAlias=name(report.timestampAlias??'timestamp');
    const selects=['l.'+identifier(report.timestamp)+' AS '+identifier(timestampAlias),...keys.map(key=>'l.'+identifier(key))];
    columns=[timestampAlias,...keys];
    for(const aggregate of aggregates){
      exact(aggregate,['name','fn','column'],'QUESTDB_AGGREGATE_INVALID');name(aggregate.name);
      if(!['count','sum','avg','min','max','first','last'].includes(aggregate.fn))throw fail('QUESTDB_AGGREGATE_INVALID');
      if(aggregate.fn!=='count' && aggregate.column===undefined)throw fail('QUESTDB_AGGREGATE_COLUMN_REQUIRED');
      const arg=aggregate.column===undefined?'':'l.'+identifier(aggregate.column);
      selects.push(aggregate.fn+'('+arg+') AS '+identifier(aggregate.name));columns.push(aggregate.name);
    }
    const fill=sample.fill??'none',alignment=sample.alignment??'calendar';
    if(!['none','null','prev'].includes(fill)||!['calendar','first-observation'].includes(alignment))throw fail('QUESTDB_SAMPLE_OPTIONS_INVALID');
    sql='SELECT '+selects.join(', ')+'\nFROM '+identifier(report.table)+' l\nWHERE '+where.join(' AND ')+
      '\nSAMPLE BY '+interval(sample.interval,true)+(fill==='none'?'':' FILL('+fill.toUpperCase()+')')+
      '\nALIGN TO '+(alignment==='calendar'?'CALENDAR':'FIRST OBSERVATION');
  } else {
    if(!Array.isArray(report.columns)||!report.columns.length||report.columns.length>128)throw fail('QUESTDB_REPORT_COLUMNS_REQUIRED');
    columns=[];
    const projection=report.columns.map(column=>{
      exact(column,['name','column','side'],'QUESTDB_REPORT_COLUMN_INVALID');name(column.name);
      const side=column.side??'left';
      if(!['left','right'].includes(side)||side==='right'&&report.kind!=='asof')throw fail('QUESTDB_COLUMN_SIDE_INVALID');
      columns.push(column.name);return(side==='right'?'r':'l')+'.'+identifier(column.column)+' AS '+identifier(column.name);
    });
    if(report.kind==='asof') {
      exact(report.asof,['table','timestamp','timestampType','keys','tolerance','filters'],'QUESTDB_ASOF_REQUIRED');
      const asof=report.asof;identifier(asof.table);identifier(asof.timestamp);
      if(asof.timestampType!==undefined&&!['timestamp','timestamp_ns'].includes(asof.timestampType))throw fail('QUESTDB_TIMESTAMP_TYPE_INVALID');
      if(!Array.isArray(asof.keys)||!asof.keys.length||asof.keys.length>16)throw fail('QUESTDB_ASOF_KEYS_REQUIRED');
      const on=asof.keys.map(key=>{exact(key,['left','right'],'QUESTDB_ASOF_KEY_INVALID');return'l.'+identifier(key.left)+' = r.'+identifier(key.right);});
      // Explicit sorting selects the timestamp of each side; no unsorted timestamp() hint.
      // The right side retains history before the left window for a valid prevailing match.
      const left='(SELECT * FROM '+identifier(report.table)+' l WHERE '+where.join(' AND ')+' ORDER BY l.'+identifier(report.timestamp)+' ASC) l';
      const rightWhere=['r.'+identifier(asof.timestamp)+' < $'+report.window.end,...filterSql(asof.filters??[],parameters,'r')];
      const right='(SELECT * FROM '+identifier(asof.table)+' r WHERE '+rightWhere.join(' AND ')+' ORDER BY r.'+identifier(asof.timestamp)+' ASC) r';
      sql='SELECT '+projection.join(', ')+'\nFROM '+left+'\nASOF JOIN '+right+'\nON ('+on.join(' AND ')+')'+
        (asof.tolerance===undefined?'':' TOLERANCE '+interval(asof.tolerance));
    } else sql='SELECT '+projection.join(', ')+'\nFROM '+identifier(report.table)+' l\nWHERE '+where.join(' AND ')+'\nORDER BY l.'+identifier(report.timestamp)+' ASC';
  }
  if(new Set(columns).size!==columns.length)throw fail('QUESTDB_DUPLICATE_COLUMN');
  report.parameters=parameters;
  const declaration={sql,parameters,parameterOrder:Object.keys(parameters),columns,maxRows:report.maxRows??100,
    maxBytes:report.maxBytes??1048576,timeoutMs:report.timeoutMs??30000,probe:structuredClone(report.probe??{}),report};
  // Validate all generated literals/defaults and probe, without recursing into metadata.
  compileOne({...declaration,report:undefined});
  return declaration;
}
