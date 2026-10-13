// SPDX-License-Identifier: MIT
import {compileAcceptance} from '../../workbench/acceptance/index.mjs';
import {clone} from './project.mjs';
const need=(ok,message)=>{if(!ok)throw Error(message);};
/** Compile selected business rules through the original native acceptance writer.
 * Rules use destination table/column names. No matching rule is invented.
 * Object keys are the exact native primary keys. Required fields are the declared non-null columns.
 */
export function buildProviderAcceptance({pipelinePlan,prepared,rules={}}){
 need(pipelinePlan?.schema==='dlthub.pipeline-plan.v1'&&prepared?.manifest?.schema==='airtable-netsuite.prepared.v1','Select the complete compiled native plan and prepared provider input.');
 const lookup=new Map(pipelinePlan.acceptance.map(t=>[t.table,t]));
 need(lookup.size===prepared.manifest.tables.length&&prepared.manifest.tables.every(t=>lookup.has(t.name)),'Keep every selected provider table in the native acceptance plan.');
 const objects=prepared.manifest.tables.map(t=>{
  const native=lookup.get(t.name);
  need(JSON.stringify(native.primaryKey)===JSON.stringify(t.primaryKey),'The native key differs from its reviewed provider mapping.');
  return{id:t.name,streamId:native.id,key:clone(t.primaryKey),required:t.columns.filter(c=>c.nullable===false).map(c=>c.name)};
 });
 const relationships=clone(rules.relationships??[]),controls=clone(rules.controls??[]);
 need(Array.isArray(relationships)&&Array.isArray(controls),'Keep complete explicit relationship and control selections.');
 const input={schema:'definian.acceptance-input.v1',title:rules.title??'Provider migration business acceptance',pipelinePlan,objects,relationships,controls};
 const compiled=compileAcceptance(input);
 return{input,compiled};
}
