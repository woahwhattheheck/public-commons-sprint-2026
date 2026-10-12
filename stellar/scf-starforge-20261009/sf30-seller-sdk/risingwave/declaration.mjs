// MIT. Fixed native relations, visible keys and typed report declarations.
import { fail, QueryInputError, object, own, exact, name, identifier, qualified, bound, identity } from './common.mjs';
import { TYPES, SQL_TYPES, checkedValue, validateColumnType } from './scalars.mjs';
const compiledQueries=new WeakSet();
const QUERY_FIELDS=['relation','subscription','key','columns','parameters','filters','probe','maxRows','maxBytes','description','report'];
const PARAM_FIELDS=['type','required','nullable','default','min','max','enum','array','maxItems','maxLength'];
function relation(value,code){
  exact(value,['schema','name'],code);identifier(value.schema);identifier(value.name);
  return {schema:value.schema,name:value.name};
}
function parameter(value,field){
  exact(value,PARAM_FIELDS,'RISINGWAVE_PARAMETER_FIELDS_INVALID');
  if(!TYPES.includes(value.type))throw fail('RISINGWAVE_PARAMETER_TYPE_INVALID');
  const result={...structuredClone(value),required:value.required??true,nullable:value.nullable??false,array:value.array??false};
  if(['required','nullable','array'].some(key=>typeof result[key]!=='boolean'))throw fail('RISINGWAVE_PARAMETER_OPTIONS_INVALID');
  if(value.maxItems!==undefined)bound(value.maxItems,0,10000,'RISINGWAVE_PARAMETER_MAX_ITEMS_INVALID');
  if(value.maxLength!==undefined)bound(value.maxLength,1,1048576,'RISINGWAVE_PARAMETER_MAX_LENGTH_INVALID');
  if(value.enum!==undefined&&(!Array.isArray(value.enum)||!value.enum.length||value.enum.length>1000))throw fail('RISINGWAVE_PARAMETER_ENUM_INVALID');
  for(const key of ['default','min','max']){
    if(own(value,key))result[key]=checkedValue(value[key],{...result,enum:undefined,min:undefined,max:undefined,
      ...(key==='default'?{}:{array:false})},field);
  }
  if(value.enum)result.enum=value.enum.map(item=>checkedValue(item,{...result,array:false,enum:undefined,min:undefined,max:undefined},field));
  return result;
}
export function compileOne(raw){
  if(object(raw)&&compiledQueries.has(raw))return raw;
  exact(raw,QUERY_FIELDS,'RISINGWAVE_QUERY_FIELDS_INVALID');
  const result={relation:relation(raw.relation,'RISINGWAVE_RELATION_REQUIRED'),
    subscription:relation(raw.subscription,'RISINGWAVE_SUBSCRIPTION_REQUIRED')};
  if(!object(raw.columns)||!Object.keys(raw.columns).length||Object.keys(raw.columns).length>256)throw fail('RISINGWAVE_COLUMNS_REQUIRED');
  result.columns=Object.fromEntries(Object.entries(raw.columns).map(([alias,supplied])=>{
    name(alias);exact(supplied,['column','type','nullable'],'RISINGWAVE_COLUMN_FIELDS_INVALID');identifier(supplied.column);
    if(!TYPES.includes(supplied.type)||supplied.nullable!==undefined&&typeof supplied.nullable!=='boolean')throw fail('RISINGWAVE_COLUMN_TYPE_INVALID');
    return [alias,{column:supplied.column,type:supplied.type,nullable:supplied.nullable??false}];
  }));
  if(!Array.isArray(raw.key)||!raw.key.length||raw.key.length>32||new Set(raw.key).size!==raw.key.length||
      raw.key.some(alias=>!own(result.columns,alias)||result.columns[alias].nullable))throw fail('RISINGWAVE_VISIBLE_NON_NULL_KEY_REQUIRED');
  result.key=[...raw.key];
  if(new Set(result.key.map(alias=>result.columns[alias].column)).size!==result.key.length)throw fail('RISINGWAVE_KEY_COLUMN_REPEATED');
  if(!object(raw.parameters??{})||Object.keys(raw.parameters??{}).length>64)throw fail('RISINGWAVE_PARAMETERS_INVALID');
  result.parameters=Object.fromEntries(Object.entries(raw.parameters??{}).map(([field,value])=>[name(field),parameter(value,field)]));
  result.parameterOrder=Object.keys(result.parameters);
  if(!Array.isArray(raw.filters??[])||(raw.filters??[]).length>128)throw fail('RISINGWAVE_FILTERS_INVALID');
  result.filters=(raw.filters??[]).map(filter=>{
    exact(filter,['column','op','parameter'],'RISINGWAVE_FILTER_FIELDS_INVALID');
    const column=result.columns[filter.column];
    if(!column||!['eq','ne','lt','lte','gt','gte','in','notIn','isNull','isNotNull'].includes(filter.op))throw fail('RISINGWAVE_FILTER_INVALID');
    if(['isNull','isNotNull'].includes(filter.op)){
      if(filter.parameter!==undefined)throw fail('RISINGWAVE_FILTER_PARAMETER_NOT_USED');
      return {column:filter.column,op:filter.op};
    }
    const spec=result.parameters[filter.parameter];
    if(!spec||spec.type!==column.type||['json','bytes','interval'].includes(column.type))throw fail('RISINGWAVE_FILTER_TYPE_INVALID');
    if(['in','notIn'].includes(filter.op)!==spec.array)throw fail('RISINGWAVE_FILTER_ARRAY_TYPE_INVALID');
    if(column.type==='boolean'&&!['eq','ne','in','notIn'].includes(filter.op))throw fail('RISINGWAVE_BOOLEAN_FILTER_INVALID');
    return structuredClone(filter);
  });
  result.maxRows=bound(raw.maxRows??100,1,100000,'RISINGWAVE_PREVIEW_ROW_LIMIT_INVALID');
  result.maxBytes=bound(raw.maxBytes??1048576,1024,33554432,'RISINGWAVE_PREVIEW_BYTE_LIMIT_INVALID');
  result.probe=structuredClone(raw.probe??{});
  if(!object(result.probe))throw fail('RISINGWAVE_PROBE_INVALID');
  if(raw.description!==undefined){
    if(typeof raw.description!=='string'||raw.description.length>8192)throw fail('RISINGWAVE_DESCRIPTION_INVALID');
    result.description=raw.description;
  }
  if(raw.report!==undefined){
    if(!object(raw.report))throw fail('RISINGWAVE_REPORT_INVALID');
    result.report=structuredClone(raw.report);
  }
  result.compiledSchema='stellar-forge.risingwave-query.v1';
  compiledQueries.add(result);
  // An empty probe may deliberately await operator input.
  if(Object.keys(result.probe).length)result.probe=bindRisingWaveParameters(result,result.probe);
  result.queryHash=identity(describeOne(result));
  return result;
}
export function compileRisingWaveQueries(raw){
  if(!object(raw)||Object.keys(raw).length>128)throw fail('RISINGWAVE_QUERIES_INVALID');
  return Object.fromEntries(Object.entries(raw).map(([key,value])=>[name(key),compileOne(value)]));
}
function describeOne(query){
  return Object.fromEntries(QUERY_FIELDS.filter(key=>query[key]!==undefined).map(key=>[key,structuredClone(query[key])]));
}
export function describeRisingWaveQueries(queries){
  return Object.fromEntries(Object.entries(queries).map(([key,value])=>[key,describeOne(compileOne(value))]));
}
export function bindRisingWaveParameters(declaration,input={}){
  const query=compileOne(declaration);
  if(!object(input)||Object.keys(input).some(key=>!own(query.parameters,key)))throw new QueryInputError(null,'UNDECLARED_QUERY_INPUT');
  const output={};
  for(const field of query.parameterOrder){
    const spec=query.parameters[field];
    if(own(input,field))output[field]=checkedValue(input[field],spec,field);
    else if(own(spec,'default'))output[field]=checkedValue(spec.default,spec,field);
    else if(spec.required)throw new QueryInputError(field,'QUERY_PARAMETER_REQUIRED');
  }
  return output;
}
export function compileRisingWaveReport(report){
  exact(report,QUERY_FIELDS.filter(key=>key!=='report'),'RISINGWAVE_REPORT_FIELDS_INVALID');
  const declaration=structuredClone(report);declaration.report=structuredClone(report);
  compileOne(declaration);return declaration;
}
export function validateNativeColumns(query,fields){
  if(!Array.isArray(fields)||!fields.length||new Set(fields.map(field=>field.name)).size!==fields.length)throw fail('RISINGWAVE_NATIVE_COLUMNS_INVALID');
  const map=new Map(fields.map(field=>[field.name,field]));
  if(fields.some(field=>['op','rw_timestamp'].includes(field.name)))throw fail('RISINGWAVE_RESERVED_CHANGE_COLUMN','Rename native op/rw_timestamp columns before creating this subscription.');
  for(const spec of Object.values(query.columns)){
    const field=map.get(spec.column);if(!field)throw fail('RISINGWAVE_SOURCE_COLUMN_MISSING','The native relation no longer has a reviewed column.',{column:spec.column});
    validateColumnType(spec,field);
  }
}
export function risingWaveStatement(declaration,input,fields){
  const query=compileOne(declaration),normalized=bindRisingWaveParameters(query,input);
  validateNativeColumns(query,fields);
  const native=new Map(fields.map(field=>[field.name,field]));
  const expression=alias=>{
    const spec=query.columns[alias],column=identifier(spec.column);
    // Text output deliberately uses the same native ::text representation as raw PG wire values.
    return spec.type==='string'?'CAST('+column+' AS text)':column;
  };
  const values=[],where=[];
  const ops={eq:'=',ne:'<>',lt:'<',lte:'<=',gt:'>',gte:'>='};
  for(const filter of query.filters){
    const column=expression(filter.column),spec=query.columns[filter.column];
    if(filter.op==='isNull'||filter.op==='isNotNull'){where.push(column+(filter.op==='isNull'?' IS NULL':' IS NOT NULL'));continue;}
    if(!own(normalized,filter.parameter))continue;
    const nativeField=native.get(spec.column);
    let type=SQL_TYPES[spec.type];
    if(spec.type==='number'&&Number(nativeField.typeOid)===700)type='real';
    values.push(normalized[filter.parameter]);
    const parameter='$'+values.length+'::'+type+(['in','notIn'].includes(filter.op)?'[]':'');
    where.push(filter.op==='in'?column+' = ANY('+parameter+')':filter.op==='notIn'?column+' <> ALL('+parameter+')':column+' '+ops[filter.op]+' '+parameter);
  }
  const sql='SELECT '+Object.entries(query.columns).map(([alias,spec])=>identifier(spec.column)+' AS '+identifier(alias)).join(', ')+
    ' FROM '+qualified(query.relation)+(where.length?' WHERE '+where.join(' AND '):'')+
    ' ORDER BY '+query.key.map(alias=>identifier(query.columns[alias].column)+' ASC').join(', ')+
    ' LIMIT '+(query.maxRows+1);
  return {sql,values,input:normalized};
}
