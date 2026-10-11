// MIT. Original public worksheet values are retained separately from private responses.
import {readFile,mkdir,writeFile,rename,rm} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
export const REFERENCE_DIRECTORY=fileURLToPath(new URL('../reference/',import.meta.url));
const files=['acceptance-requirements.json','acceptance-response-contract.json','interfaces.json',
  'interface-response-instructions.json','staffing-response-template.json','price-response-template.json','engineering-pages.json'];
const sha=b=>createHash('sha256').update(b).digest('hex');
export async function loadCatalog(referenceDirectory=REFERENCE_DIRECTORY) {
  const manifest=JSON.parse(await readFile(join(referenceDirectory,'SOURCE_PINS.json'),'utf8'));
  const data={},pins=[];
  for(const file of files) {
    const bytes=await readFile(join(referenceDirectory,file));
    const pin=manifest.files.find(x=>x.file===file);
    if(!pin||pin.sha256!==sha(bytes)||pin.bytes!==bytes.length)throw new Error('The retained Burbank source changed: '+file);
    data[file]=JSON.parse(bytes);pins.push(pin);
  }
  const requirements=data[files[0]].items.map(x=>({id:x.id,sheet:x.worksheet,number:x.requirement_number,
    area:x.functional_area,process:x.process,text:x.requirement,continuations:x.continuations,
    row:x.source_row,sourceRecord:x.source_record_id,sourceUrl:x.source_url}));
  const interfaces=data['interfaces.json'].interfaces.map(x=>({id:x.id,application:x.application,
    description:x.application_description,interface:x.interface_description,comments:x.city_comments,
    row:x.source_row,sourceRecord:x.source_record_id,sourceUrl:x.source_url}));
  if(requirements.length!==977||interfaces.length!==23||new Set(requirements.map(x=>x.id)).size!==977)
    throw new Error('The original source census changed. Review the source update before using it.');
  return {schema:'erp-burbank.catalog.v1',referenceDirectory,pins,catalogSha256:sha(Buffer.from(JSON.stringify(pins))),
    requirements,interfaces,requirementIds:new Set(requirements.map(x=>x.id)),interfaceIds:new Set(interfaces.map(x=>x.id)),
    responseContract:data[files[1]],interfaceInstructions:data['interface-response-instructions.json'],
    raw:data,publicView(){return {schema:this.schema,pins:this.pins,catalogSha256:this.catalogSha256,
      requirements,interfaces,responseContract:this.responseContract,interfaceInstructions:this.interfaceInstructions};}};
}

export async function retainWorkspaceCatalog(directory,referenceDirectory=REFERENCE_DIRECTORY) {
  const root=join(directory,'burbank'),target=join(root,'catalog');
  try{return await loadCatalog(target);}catch(error){if(error.code!=='ENOENT')throw error;}
  await loadCatalog(referenceDirectory);await mkdir(root,{recursive:true,mode:0o700});
  const temporary=join(root,'catalog-'+randomUUID()+'.tmp');await mkdir(temporary,{mode:0o700});
  try {
    for(const file of [...files,'SOURCE_PINS.json'])await writeFile(join(temporary,file),await readFile(join(referenceDirectory,file)),{mode:0o600,flag:'wx'});
    await rename(temporary,target);
  }catch(error){await rm(temporary,{recursive:true,force:true});if(!['EEXIST','ENOTEMPTY'].includes(error.code))throw error;}
  return loadCatalog(target);
}
