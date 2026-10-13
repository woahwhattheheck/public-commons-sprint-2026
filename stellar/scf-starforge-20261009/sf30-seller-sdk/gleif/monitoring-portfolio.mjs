// SPDX-License-Identifier: MIT
// Explicit, source-preserving company-research handover to the original Monitoring intake.
import { SCHEMA, SOURCE, stable, need, label, clone, reportHtml, csv } from './core.mjs';
import { bytes, digest, identity } from '../postgres/publisher/files.mjs';

export const MONITORING_SCHEMA='stellar-forge.gleif-monitoring-portfolio.v1';
export const MAPPING_VERSION='gleif-legalentity-20261013-v1';
export const OPTIONAL_FIELDS=Object.freeze(['aliases','registrationNumber','entityStatus','addresses']);
const unique=values=>[...new Set(values.filter(value=>typeof value==='string'&&value.trim()))];
function address(value={}) {
  if(!value||typeof value!=='object'||Array.isArray(value))value={};
  return unique([value.mailRouting,...(Array.isArray(value.addressLines)?value.addressLines:[]),value.city,value.region,value.postalCode,value.country]).join(', ');
}
export function monitoringOptions(value={}) {
  need(value&&typeof value==='object'&&!Array.isArray(value),'GLEIF_MONITORING_OPTIONS');
  const portfolioKey=label(value.portfolioKey,'stable Monitoring portfolio key',128);
  need(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(portfolioKey),'GLEIF_MONITORING_KEY','Use a stable portfolio key made from letters, numbers, dot, colon, underscore or hyphen.');
  const fields=value.fields??[];
  need(Array.isArray(fields)&&new Set(fields).size===fields.length&&fields.every(field=>OPTIONAL_FIELDS.includes(field)),'GLEIF_MONITORING_FIELDS','Choose supported optional fields explicitly.');
  return {portfolioKey,title:label(value.title,'portfolio title',160),fields:OPTIONAL_FIELDS.filter(field=>fields.includes(field))};
}
export function projectMonitoringEntity(resource,options) {
  const entity=resource?.attributes?.entity,lei=resource?.id,name=entity?.legalName?.name;
  need(resource?.type==='lei-records'&&typeof lei==='string'&&/^[A-Z0-9]{20}$/.test(lei)&&typeof name==='string'&&name.trim(),'GLEIF_MONITORING_RESOURCE','Use a complete original GLEIF legal-entity record.');
  const properties={name:[name],leiCode:[lei]};
  if(options.fields.includes('aliases')){
    const names=[...(Array.isArray(entity.otherNames)?entity.otherNames:[]),...(Array.isArray(entity.transliteratedOtherNames)?entity.transliteratedOtherNames:[])];
    const aliases=unique(names.filter(item=>item?.type!=='PREVIOUS_LEGAL_NAME').map(item=>item?.name)).filter(value=>value!==name);
    const previous=unique(names.filter(item=>item?.type==='PREVIOUS_LEGAL_NAME').map(item=>item?.name)).filter(value=>value!==name);
    if(aliases.length)properties.alias=aliases;
    if(previous.length)properties.previousName=previous;
  }
  if(options.fields.includes('registrationNumber')&&typeof entity.registeredAs==='string'&&entity.registeredAs.trim())properties.registrationNumber=[entity.registeredAs];
  if(options.fields.includes('entityStatus')&&['ACTIVE','INACTIVE'].includes(entity.status))properties.status=[entity.status];
  if(options.fields.includes('addresses')){
    const addresses=unique([address(entity.legalAddress),address(entity.headquartersAddress)]);
    if(addresses.length)properties.address=addresses;
  }
  return {id:'gleif:'+lei,schema:'LegalEntity',caption:name,properties};
}
export function monitoringPreview(selected,input,workspaceId) {
  const options=monitoringOptions(input);
  need(selected.captures.length===1,'GLEIF_MONITORING_CAPTURE','Select exactly one complete source capture. Choose the original edition explicitly for repeated LEIs.');
  need(selected.records.length>0,'GLEIF_MONITORING_EMPTY','Select at least one company; included-only selection requires a current include review for the chosen source.');
  const seen=new Set(),entities=[],records=[];
  for(const record of selected.records){
    const resource=record.original??record.resource??record.originalResource;
    need(resource,'GLEIF_MONITORING_RESOURCE','The original source resource is missing.');
    const entity=projectMonitoringEntity(resource,options);
    need(!seen.has(entity.id),'GLEIF_MONITORING_DUPLICATE','One original LEI may appear only once in the portfolio.');seen.add(entity.id);
    entities.push(entity);
    records.push({lei:resource.id,counterpartyId:entity.id,captureId:record.row.captureId,resourceSha256:identity(resource),sourcePage:clone(selected.captures[0].pages[record.page-1])});
  }
  const basis={schema:MONITORING_SCHEMA,mappingVersion:MAPPING_VERSION,workspaceId,options,selection:clone(selected.selection),
    captureIds:selected.captures.map(value=>value.id),reviews:selected.reviews.map(value=>({id:value.id,version:value.version,captureId:value.captureId,lei:value.lei,resourceSha256:value.resourceSha256})),records,entities};
  return {...basis,previewSha256:identity(basis),count:entities.length,
    interpretation:'Research counterparties only. Name and LEI are copied from the selected original records. Optional fields require explicit selection. LEI registration status, jurisdiction subdivisions, address roles, legal form and all unmapped fields remain in the original source. No identity match, sanctions relevance or provider dispatch is decided.'};
}
// A valid original native package with its existing identity as the final property.
// The consumer can verify the exact canonical body bytes without reserializing JS numbers in Python.
export function monitoringProjectBytes(pkg) {
  const {sha256,...body}=pkg;
  need(sha256===identity(body),'GLEIF_MONITORING_PROJECT','The original project identity differs.');
  return Buffer.from(stable(body).slice(0,-1)+',"sha256":"'+sha256+'"}\n');
}
export function buildMonitoringHandover(selected,input,{workspaceId,operationId,createdAt,projectBytes}) {
  const preview=monitoringPreview(selected,input,workspaceId);
  need(input.expectedPreviewSha256===preview.previewSha256,'GLEIF_MONITORING_PREVIEW_CHANGED','The source selection or review changed. Inspect a fresh mapping preview before preparing.',409);
  const report={schema:SCHEMA+'.report',id:operationId,title:preview.options.title,createdAt,workspaceId,source:SOURCE,...selected,comparison:null};
  const sources=selected.records.map((record,index)=>({binding:preview.records[index],originalResource:record.original??record.resource??record.originalResource,resourceText:stable(record.original??record.resource??record.originalResource),projected:preview.entities[index],originalRecord:record}));
  const mapping={...preview,createdAt,operationId,source:SOURCE,
    originalProject:{wire:'canonical-body-sha256-last/v1',name:'gleif-project.json',bytes:projectBytes.length,sha256:digest(projectBytes)},
    retainedMeanings:sources.map(row=>({lei:row.binding.lei,legalJurisdiction:row.originalResource.attributes.entity.jurisdiction??null,
      registrationAuthority:row.originalResource.attributes.entity.registeredAt??null,
      legalAddress:row.originalResource.attributes.entity.legalAddress??null,headquartersAddress:row.originalResource.attributes.entity.headquartersAddress??null,
      leiRegistration:row.originalResource.attributes.registration??null,otherNames:row.originalResource.attributes.entity.otherNames??[],transliteratedOtherNames:row.originalResource.attributes.entity.transliteratedOtherNames??[]}))};
  const data=[
    ['portfolio.ftm.json',Buffer.from(preview.entities.map(value=>JSON.stringify(value)).join('\n')+'\n')],
    ['mapping.json',bytes(mapping)],['gleif-project.json',projectBytes],['research-report.json',bytes(report)],
    ['research-report.html',Buffer.from(reportHtml(report))],['entities.csv',Buffer.from(csv(selected.records.map(value=>value.row)))],
    ['entities.spreadsheet.csv',Buffer.from(csv(selected.records.map(value=>value.row),{spreadsheet:true}))],
    ['original-records.jsonl',Buffer.from(sources.map(value=>JSON.stringify(value)).join('\n')+'\n')]
  ];
  const files=data.map(([name,raw])=>({name,bytes:raw.length,sha256:digest(raw),base64:raw.toString('base64')}));
  const manifest={schema:MONITORING_SCHEMA,mappingVersion:MAPPING_VERSION,workspaceId,operationId,createdAt,previewSha256:preview.previewSha256,
    portfolioKey:preview.options.portfolioKey,title:preview.options.title,count:preview.count,files:files.map(({base64,...value})=>value)};
  const manifestText=stable(manifest),handover={schema:MONITORING_SCHEMA,id:digest(manifestText),manifestText,files};
  return {preview,manifest,files:data.map(([name,raw])=>({name,raw})),handover:bytes(handover)};
}
