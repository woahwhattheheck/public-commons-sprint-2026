// MIT. Laboratory catalog and source selection on the original paid-job Applications lifecycle.
import { join, resolve } from 'node:path';
import originalJobProvider from '../jobs/managed/provider.mjs';
import { jobMerchantApplication, prepareJobMerchantApplication } from '../jobs/managed/application.mjs';
import { LABORATORY_APPLICATION_ID, LABORATORY_SOURCE_FILES } from './merchant-configuration.mjs';

const need=(condition,message)=>{if(!condition)throw Object.assign(new TypeError(message),{
  code:'APPLICATION_LABORATORY_SOURCE_REQUIRED',status:400});};

export function laboratoryApplication(context){
  const original=jobMerchantApplication(context);
  return {...original,id:LABORATORY_APPLICATION_ID,title:'Laboratory EDD',
    requiredSource:'stellar/scf-starforge-20261009/sf30-seller-sdk/lab-edd/application.mjs',
    description:'Receive complete EQuIS and DTS8D laboratory deliveries, review native fields and source lineage, reconcile original formats and return native files with portable editors.',
    fields:original.fields.map(field=>field.name==='configurationFile'?{...field,
      label:'Laboratory merchant configuration',
      description:'Select the complete configuration prepared by lab-edd merchant-config, with this installed laboratory application and your actual HTTPS origin and payment option.'
    }:field.name==='landing'?{...field,
      description:'Open jobs, inputs or resolutions for this same laboratory merchant. Use deliveries when a result-delivery configuration is selected.'
    }:field)};
}

export async function prepareLaboratoryApplication(settings,context){
  const prepared=await prepareJobMerchantApplication(settings,context);
  const laboratory=resolve(prepared.jobMerchant.runtimeDirectory,'../lab-edd');
  const application=await context.inputPath(join(laboratory,'application.mjs'),'file');
  need(prepared.jobMerchant.applicationPath===application.path,
    'Select the complete Laboratory EDD application from this same original installed runtime.');
  const functions=prepared.jobMerchant.summary?.functions;
  need(Array.isArray(functions)&&functions.length===1&&functions[0].id==='laboratoryReview'&&
    functions[0].output?.format==='bytes'&&functions[0].output?.contentType==='application/zip',
    'Select the complete laboratoryReview function and its native ZIP result.');
  const slots=functions[0].inputFiles?.slots;
  need(slots&&Object.keys(slots).sort().join(',')==='baseline,baseline_decisions,decisions,reconciliation,source'&&
    slots.source.required===true&&['baseline','baseline_decisions','decisions','reconciliation'].every(name=>slots[name].required===false),
    'Select the complete five-slot laboratory contract, including independent baseline decisions and correspondence.');
  for(const name of LABORATORY_SOURCE_FILES){
    const file=await context.inputPath(join(laboratory,name),'file');
    if(!prepared.inputs.some(value=>value.path===file.path))prepared.inputs.push(file);
  }
  const reader=await context.inputPath(resolve(laboratory,'../dataset-refresh/workbook/reader.py'),'file');
  if(!prepared.inputs.some(value=>value.path===reader.path))prepared.inputs.push(reader);
  return prepared;
}

// Catalog selection adds Lab's complete source and configuration checks. The
// unchanged jobs/serve request is owned by paid-job-merchant for its entire
// process, startup, resource lease, Stop and reopen lifetime.
export default {
  ...originalJobProvider,id:LABORATORY_APPLICATION_ID,order:112,
  catalog(context){return [laboratoryApplication(context)];},
  prepare(type,settings,context){return prepareLaboratoryApplication(settings,context);},
  matchRequest(){return false;},
};
