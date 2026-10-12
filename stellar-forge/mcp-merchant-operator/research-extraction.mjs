// MIT. The existing Research client owns the listener, store and request replay.
import {exact,failure} from './host-files.mjs';
import {readResearchExtraction,reviewResearchExtraction} from '../../stellar/scf-starforge-20261009/sf88-operator-buyer-cli/research-dossiers/research-extraction-transport.mjs';
import {
  RESEARCH_EXTRACTION_REQUEST_FIELDS,RESEARCH_EXTRACTION_EXPORTS
} from './catalog/research-extraction.mjs';
export {RESEARCH_EXTRACTION_PREFIX} from './catalog/research-extraction.mjs';

const selected=(value,keys)=>Object.fromEntries(keys.filter(key=>Object.hasOwn(value,key)).map(key=>[key,value[key]]));
export async function callResearchExtraction(client,name,args){
  if(name==='merchant_research_extraction'){
    exact(args,['workspace','dossierId','revision','formId','resultSetId','section','offset','limit'],
      ['workspace','dossierId']);
    return readResearchExtraction(client,args.dossierId,
      selected(args,['revision','formId','resultSetId','section','offset','limit']));
  }
  if(name==='merchant_research_extraction_source_values'){
    exact(args,['workspace','dossierId','revision','occurrenceId','pointers','fileName'],
      ['workspace','dossierId','revision','occurrenceId','pointers']);
    return readResearchExtraction(client,args.dossierId,
      selected(args,['revision','occurrenceId','pointers','fileName']),{sourceValues:true});
  }
  if(name==='merchant_research_extraction_publications'){
    exact(args,['workspace','dossierId','revision','tableId','publicationId','section','offset','limit',
      'fromPublicationId','toPublicationId','currentOnly','changeType'],['workspace','dossierId']);
    return readResearchExtraction(client,args.dossierId,
      selected(args,['revision','tableId','publicationId','section','offset','limit',
        'fromPublicationId','toPublicationId','currentOnly','changeType']),{publication:true});
  }
  if(name==='merchant_research_extraction_review'||name==='merchant_research_extraction_publication_review'){
    exact(args,['workspace','dossierId',...RESEARCH_EXTRACTION_REQUEST_FIELDS],
      ['workspace','dossierId',...RESEARCH_EXTRACTION_REQUEST_FIELDS]);
    return reviewResearchExtraction(client,args.dossierId,selected(args,RESEARCH_EXTRACTION_REQUEST_FIELDS),
      {publication:name==='merchant_research_extraction_publication_review'});
  }
  throw failure('TOOL_NOT_FOUND','Unknown original extraction operation.');
}
export async function exportResearchExtraction(client,args,{file,download}){
  const format=RESEARCH_EXTRACTION_EXPORTS[args.kind]?.format;
  if(!format)throw failure('INVALID_PARAMS','Select the original extraction or publication export format.');
  const publication=args.kind.startsWith('extraction-publication-');
  const keys=publication?['tableId','publicationId','againstPublicationId']:['formId','resultSetId'];
  exact(args,['workspace','dossierId','kind','revision',...keys,'expectedSha256'],
    ['workspace','dossierId','kind','revision']);
  const options={...selected(args,['revision',...keys,'expectedSha256']),format,file};
  const result=await download(()=>publication?
    client.exportExtractionPublication(args.dossierId,options):
    client.exportExtraction(args.dossierId,options));
  return {result,selection:{dossierId:args.dossierId,
    ...selected(args,['revision',...keys]),format}};
}
