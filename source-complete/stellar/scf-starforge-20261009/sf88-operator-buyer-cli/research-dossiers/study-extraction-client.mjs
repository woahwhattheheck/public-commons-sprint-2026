// MIT. Complete extraction transport attached to the original Research client lifetime.
import {need,object} from '../node/store.mjs';
const id=value=>{
  need(typeof value==='string'&&value.length>0&&value.length<=160&&!/[\u0000-\u001f\u007f/\\]/.test(value),'RESEARCH_ID_INVALID');
  return encodeURIComponent(value);
};
const query=options=>{
  const params=new URLSearchParams();
  for(const [name,value]of Object.entries(options))if(value!==undefined&&value!==null)params.set(name,String(value));
  return params.size?'?'+params.toString():'';
};
const path=identifier=>'/api/dossiers/'+id(identifier)+'/extraction';
const selected=(value,keys)=>Object.fromEntries(keys.filter(key=>value[key]!==undefined).map(key=>[key,value[key]]));
const transport=value=>selected(value,['signal']);
function view(value,identifier,revision){
  need(object(value)&&value.dossierId===identifier&&Number.isSafeInteger(value.revision)&&value.revision>=1,
    'EXTRACTION_RESPONSE_IDENTITY_CHANGED');
  need(revision===undefined||value.revision===revision,'EXTRACTION_RESPONSE_REVISION_CHANGED');
  return value;
}
function reviewed(value,identifier,input){
  need(object(value)&&value.dossier?.id===identifier&&value.operation?.requestId===input.requestId&&
    typeof value.duplicate==='boolean'&&Number.isSafeInteger(value.dossier.revision),'EXTRACTION_REVIEW_RESPONSE_CHANGED');
  return value;
}
export function createStudyExtractionClient({request,download}){
  need(typeof request==='function'&&typeof download==='function','RESEARCH_CLIENT_TRANSPORT_REQUIRED');
  return Object.freeze({
    async extraction(identifier,options={}){
      return view(await request(path(identifier)+query(selected(options,['revision','section','formId','resultSetId','offset','limit'])),
        undefined,transport(options)),identifier,options.revision);
    },
    async extractionSourceValues(identifier,options={}){
      const result=await request(path(identifier)+'/source-values'+query(selected(options,['revision'])),
        selected(options,['occurrenceId','pointers','fileName']),{...transport(options),readOnly:true});
      return view(result,identifier,options.revision);
    },
    async reviewExtraction(identifier,input,options={}){
      return reviewed(await request(path(identifier)+'/reviews?projection=metadata',input,transport(options)),identifier,input);
    },
    exportExtraction(identifier,{file,revision,formId,resultSetId,format='json',...options}={}){
      need(['json','md','html'].includes(format),'EXTRACTION_EXPORT_FORMAT_INVALID');
      return download(path(identifier)+'/export'+query({revision,formId,resultSetId,format}),file,options);
    },
    async extractionPublications(identifier,options={}){
      return view(await request(path(identifier)+'/publications'+query(selected(options,['revision','section','tableId','publicationId','offset','limit','currentOnly','fromPublicationId','toPublicationId','againstPublicationId','changeType'])),
        undefined,transport(options)),identifier,options.revision);
    },
    async reviewExtractionPublication(identifier,input,options={}){
      return reviewed(await request(path(identifier)+'/publications/reviews?projection=metadata',input,transport(options)),identifier,input);
    },
    exportExtractionPublication(identifier,{file,revision,tableId,publicationId,format='json',againstPublicationId,fromPublicationId,toPublicationId,changeType,currentOnly,...options}={}){
      need(['json','csv','md','html'].includes(format),'EXTRACTION_PUBLICATION_FORMAT_INVALID');
      return download(path(identifier)+'/publications/export'+query({revision,tableId,publicationId,format,againstPublicationId,fromPublicationId,toPublicationId,changeType,currentOnly}),file,options);
    },
  });
}
