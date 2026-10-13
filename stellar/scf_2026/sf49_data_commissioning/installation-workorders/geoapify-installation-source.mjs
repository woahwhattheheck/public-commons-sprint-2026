// MIT. Select unchanged frozen customer files from the original fully validated workspace.
import {inspectGeoapifyPackage} from '../../../scf-starforge-20261009/sf30-seller-sdk/geoapify/package.mjs';
import {GEOAPIFY_INSTALLATION_SCHEMA as SCHEMA,hash,need,identity} from './geoapify-installation-core.mjs';
export async function inspectGeoapifyInstallationSource(archive,{editionId,expectedArchiveSha256}={}){
  need(Buffer.isBuffer(archive)&&typeof editionId==='string'&&editionId.length>0&&/^[a-f0-9]{64}$/.test(expectedArchiveSha256??''),
    'Select the complete original workspace archive, its SHA-256 and one retained frozen edition.');
  const inspected=await inspectGeoapifyPackage(archive,{expectedArchiveSha256});
  const state=inspected.state,edition=state.editions.find(e=>e.id===editionId);
  need(edition,'The selected original frozen edition is not in this complete archive.');
  const sha=edition.intakeSha256??inspected.sources[0]?.intake.sha256;
  const intake=inspected.sources.find(e=>e.intake.sha256===sha),original=inspected.sourceIntakes.get(sha);
  need(intake&&original,'Keep the selected edition’s original source intake.');
  const files=new Map();
  for(const [name,key]of [['dataset.csv','csv'],['dataset.json','config'],['dataset.geojson','geojson'],
    ['address-review.json','review'],['review.html','report'],['basis.json','basis']]){
    const descriptor=edition[key],body=inspected.files.get(descriptor.file);
    need(body&&hash(body)===descriptor.sha256,'Keep every original selected edition file.');files.set(name,body);
  }
  if(intake.comparison)files.set('source-comparison.json',inspected.files.get(intake.comparison.file));
  if(edition.comparisonReport)files.set('source-comparison.html',inspected.files.get(edition.comparisonReport.file));
  const source={schema:SCHEMA+'.source',workspaceId:state.id,workspaceRevision:state.revision,
    archive:{name:'starforge-geoapify.json.gz',...inspected.archive},edition:structuredClone(edition),intake:structuredClone(intake),
    source:{provider:'Geoapify',originalSource:original.source,mapping:original.mapping,
      providerDocs:'https://apidocs.geoapify.com/docs/batch',termsURL:'https://www.geoapify.com/terms-and-conditions/',
      coordinatePolicy:'Original source and provider coordinates remain separate; the original retained reviewer decision selects the delivered pair.'},
    activeIntakeSha256:state.intake?.sha256??null,activeEditionId:state.activeEditionId??null,
    files:[...files].map(([name,body])=>identity(name,body)),
    history:{sources:inspected.sources.length,jobs:state.jobs.length,responses:state.jobs.reduce((n,j)=>n+j.events.length,0),
      decisions:state.decisions.length,editions:state.editions.length,savedSourceEditors:Object.keys(state.editors??{}).length}};
  return {source,files,workspaceArchive:archive};
}
