// MIT. Actual RisingWave catalogue identities and visible source columns.
import { fail, qualified, identity, now, object, identifier, canonical } from './common.mjs';
import { rowsAsObjects } from './transport.mjs';
const SUBSCRIPTIONS = 'SELECT s.id AS subscription_id,s.name AS subscription_name,s.schema_id AS subscription_schema_id,'+
 's.schema_name AS subscription_schema,s.owner AS subscription_owner,s.definition AS subscription_definition,'+
 's.retention_seconds,s.initialized_at,s.created_at,s.initialized_at_cluster_version,s.created_at_cluster_version,'+
 'd.refobjid AS relation_id,r.name AS relation_name,r.schema_id AS relation_schema_id,r.relation_type,r.definition AS relation_definition '+
 'FROM rw_catalog.rw_subscriptions s JOIN rw_catalog.rw_depend d ON d.objid=s.id '+
 'JOIN rw_catalog.rw_relations r ON r.id=d.refobjid ';
const BOOL=value=>{
  if(value==='t'||value==='true'||value===true)return true;
  if(value==='f'||value==='false'||value===false)return false;
  throw fail('RISINGWAVE_CATALOGUE_BOOLEAN_INVALID');
};
function decimalId(value){
  if(typeof value!=='string'||!/^[0-9]+$/.test(value))throw fail('RISINGWAVE_CATALOGUE_ID_INVALID');
  return value;
}
function boundedCatalogue(result){
  if(result.rows.length>20000||Buffer.byteLength(JSON.stringify(result))>16777216)throw fail('RISINGWAVE_CATALOGUE_TOO_LARGE','Select explicit schemas or relations for this source.');
  return rowsAsObjects(result);
}
export async function relationColumns(connection,id){
  const result=await connection.query('SELECT relation_id,name,position,is_hidden,is_primary_key,is_distribution_key,is_generated,'+
    'is_nullable,generation_expression,data_type,type_oid,type_len,udt_type FROM rw_catalog.rw_columns WHERE relation_id=$1 ORDER BY position',[id]);
  return boundedCatalogue(result).map(row=>({name:row.name,position:Number(row.position),type:row.data_type,
    typeOid:decimalId(row.type_oid),nullable:BOOL(row.is_nullable),hidden:BOOL(row.is_hidden),
    primaryKey:BOOL(row.is_primary_key),distributionKey:BOOL(row.is_distribution_key),generated:BOOL(row.is_generated),
    generationExpression:row.generation_expression,udtType:row.udt_type,typeLength:row.type_len}));
}
async function normalizedRelation(connection,row){
  const all=await relationColumns(connection,decimalId(row.id));
  if(!all.length||new Set(all.map(column=>column.name)).size!==all.length)throw fail('RISINGWAVE_CATALOGUE_COLUMNS_INVALID');
  const visible=all.filter(column=>!column.hidden);
  return {id:row.id,schema:row.schema,name:row.name,type:row.relation_type,definition:row.definition,
    columns:visible,hiddenColumns:all.filter(column=>column.hidden),
    primaryKey:visible.filter(column=>column.primaryKey).map(column=>column.name)};
}
export async function readRelation(connection,reference){
  const rows=boundedCatalogue(await connection.query('SELECT r.id,r.name,r.schema_id,s.name AS schema,r.relation_type,r.definition '+
    'FROM rw_catalog.rw_relations r JOIN rw_catalog.rw_schemas s ON s.id=r.schema_id '+
    "WHERE s.name=$1 AND r.name=$2 AND r.relation_type IN ('table','materialized view')",[reference.schema,reference.name]));
  if(rows.length!==1)throw fail('RISINGWAVE_RELATION_NOT_FOUND','Select one existing table or materialized view.',{relation:reference,count:rows.length});
  return normalizedRelation(connection,rows[0]);
}
function normalizedSubscription(row,relationSchema){
  return {id:decimalId(row.subscription_id),schema:row.subscription_schema,name:row.subscription_name,
    relationId:decimalId(row.relation_id),relationSchema,relationName:row.relation_name,
    retentionSeconds:decimalId(row.retention_seconds),definition:row.subscription_definition,
    owner:row.subscription_owner,createdAt:row.created_at,initializedAt:row.initialized_at,
    createdVersion:row.created_at_cluster_version,initializedVersion:row.initialized_at_cluster_version};
}
export async function readSubscription(connection,reference,sourceRelation=undefined){
  const rows=boundedCatalogue(await connection.query(SUBSCRIPTIONS+
    "WHERE s.schema_name=$1 AND s.name=$2 AND r.relation_type IN ('table','materialized view') ORDER BY r.id",
    [reference.schema,reference.name]));
  if(!rows.length){
    const exists=boundedCatalogue(await connection.query('SELECT id,name FROM rw_catalog.rw_subscriptions WHERE schema_name=$1 AND name=$2',[reference.schema,reference.name]));
    if(exists.length)throw fail('RISINGWAVE_SUBSCRIPTION_DEPENDENCY_INVALID','The existing subscription has no unique table or materialized-view dependency.');
    return null;
  }
  if(rows.length!==1)throw fail('RISINGWAVE_SUBSCRIPTION_DEPENDENCY_AMBIGUOUS');
  let schema=sourceRelation?.schema;
  if(sourceRelation&&rows[0].relation_id!==sourceRelation.id)throw fail('RISINGWAVE_SUBSCRIPTION_SOURCE_CHANGED','The named subscription belongs to another source relation.');
  if(!schema){
    const schemas=boundedCatalogue(await connection.query('SELECT name FROM rw_catalog.rw_schemas WHERE id=$1',[rows[0].relation_schema_id]));
    if(schemas.length!==1)throw fail('RISINGWAVE_SUBSCRIPTION_SCHEMA_MISSING');schema=schemas[0].name;
  }
  return normalizedSubscription(rows[0],schema);
}
export function sourceIdentity(connection,relation,subscription){
  if(!subscription)throw fail('RISINGWAVE_SUBSCRIPTION_REQUIRED','Review and create or select the subscription before capturing changes.');
  const value={version:connection.identity.version,database:connection.identity.database,connection:connection.identity.endpoint,relation,subscription};
  return {...value,catalogueHash:identity(value)};
}
export async function inspectQuerySource(connection,query){
  const relation=await readRelation(connection,query.relation);
  const subscription=await readSubscription(connection,query.subscription,relation);
  return {relation,subscription,identity:subscription?sourceIdentity(connection,relation,subscription):null};
}
export async function discoverRisingWave(connection,options={}){
  if(!object(options)||Object.keys(options).some(key=>!['schemas','relations','subscriptions'].includes(key)))throw fail('RISINGWAVE_DISCOVERY_OPTIONS_INVALID');
  const schemas=options.schemas;
  if(schemas!==undefined&&(!Array.isArray(schemas)||schemas.length>100||schemas.some(value=>typeof value!=='string')))throw fail('RISINGWAVE_DISCOVERY_SCHEMAS_INVALID');
  if(schemas)schemas.forEach(identifier);
  const requested=options.relations;
  if(requested!==undefined&&(!Array.isArray(requested)||requested.length>200||requested.some(value=>!object(value)||typeof value.schema!=='string'||typeof value.name!=='string')))
    throw fail('RISINGWAVE_DISCOVERY_RELATIONS_INVALID');
  let sql='SELECT r.id,r.name,r.schema_id,s.name AS schema,r.relation_type,r.definition FROM rw_catalog.rw_relations r '+
    "JOIN rw_catalog.rw_schemas s ON s.id=r.schema_id WHERE r.relation_type IN ('table','materialized view')";
  const parameters=[];
  if(schemas?.length){parameters.push(schemas);sql+=' AND s.name=ANY($'+parameters.length+'::varchar[])';}
  if(requested?.length){
    sql+=' AND ('+requested.map(value=>{
      parameters.push(value.schema,value.name);return '(s.name=$'+(parameters.length-1)+' AND r.name=$'+parameters.length+')';
    }).join(' OR ')+')';
  }
  sql+=' ORDER BY s.name,r.name';
  const rows=boundedCatalogue(await connection.query(sql,parameters)),relations=[];
  for(const row of rows)relations.push(await normalizedRelation(connection,row));
  const known=new Map(relations.map(relation=>[relation.id,relation]));
  const subscriptionRows=boundedCatalogue(await connection.query(SUBSCRIPTIONS+
    "WHERE r.relation_type IN ('table','materialized view') ORDER BY s.schema_name,s.name,r.id"));
  const subscriptions=[];
  const seen=new Set();
  for(const row of subscriptionRows){
    const relation=known.get(row.relation_id);if(!relation)continue;
    if(seen.has(row.subscription_id))throw fail('RISINGWAVE_SUBSCRIPTION_DEPENDENCY_AMBIGUOUS');
    seen.add(row.subscription_id);subscriptions.push(normalizedSubscription(row,relation.schema));
  }
  if(options.subscriptions!==undefined){
    if(!Array.isArray(options.subscriptions)||options.subscriptions.some(value=>!object(value)||typeof value.schema!=='string'||typeof value.name!=='string'))
      throw fail('RISINGWAVE_DISCOVERY_SUBSCRIPTIONS_INVALID');
    const names=new Set(options.subscriptions.map(qualified));
    return {version:connection.identity.version,observedAt:now(),complete:true,relations,
      subscriptions:subscriptions.filter(value=>names.has(qualified(value)))};
  }
  return {version:connection.identity.version,observedAt:now(),complete:true,relations,subscriptions};
}
export const columnsSignature=fields=>identity(fields.map(field=>({name:field.name,typeOid:String(field.typeOid)})));
