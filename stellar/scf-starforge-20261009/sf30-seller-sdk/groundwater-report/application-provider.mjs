// SPDX-License-Identifier: MIT
// Source-owned registration; original Applications owns installation and process recovery.
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {inspectMerchantRuntime} from '../../sf46-release/runtime-package.mjs';
import {APPLICATION_PROVIDER_SCHEMA,observeApplicationStartup} from '../../distribution/runtime-workspace/application-provider.mjs';
import {REPORT_SOURCE,managedSelection,reportStartup,validateFacilitator} from './managed.mjs';

export default {
  schema:APPLICATION_PROVIDER_SCHEMA,id:'groundwater-reports',order:610,
  catalog({common,field}){
    return [{
      id:'groundwater-report-desk',command:'groundwater-report-managed',title:'Groundwater Report Desk',
      terminal:false,requiredSource:REPORT_SOURCE+'/managed-cli.mjs',
      description:'Open the original frozen-report merchant and buyer receiving desk, retained source and offers, exact response packages, named reviews, original Operations links and complete desk handover.',
      fields:[
        field('deskDirectory','Existing Report Desk','path',true,'Choose the original initialized or received directory containing desk.json and operations/.'),
        field('python','Python interpreter','path',true,'Select the actual Python 3.11+ executable used by the original report reader; no solver is started.'),
        field('scientificWorkspace','Original scientific workspace','path',false,'Optional existing directory containing groundwater.sqlite. Omit for a buyer receiving desk.'),
        field('operationsUrlFile','Private Operations access file','path',false,'Optional private JSON or text file with the current original Operations URL. It remains on this host.'),
        field('facilitator','Native facilitator URL','text',false,'Optional explicit HTTPS facilitator used only when an operator starts an existing reviewed publication.'),
        field('allowLocalFacilitator','Allow selected local facilitator','boolean',false,'Permit the explicitly selected local HTTP facilitator.'),
        ...common
      ]
    }];
  },
  validateSettings(type,settings){validateFacilitator(settings.facilitator,settings.allowLocalFacilitator===true);},
  async prepare(type,settings,context){
    const {inputPath,selectedExecutable,runtimeDirectory}=context;
    const runtime=await inspectMerchantRuntime(runtimeDirectory,{load:false});
    const native=await import(pathToFileURL(join(runtime.sourceRoot,REPORT_SOURCE,'managed.mjs')).href);
    const desk=await native.inspectReportDesk(settings.deskDirectory);
    const source=await native.inspectReportLaunchSource(runtime.sourceRoot);
    const python=await native.inspectReportPython(settings.python);
    const inputs=[await inputPath(desk.directory,'directory',false,true),
      await inputPath(desk.marker.path,'file'),...(await selectedExecutable(settings.python)).inputs];
    for(const row of source.files){
      const current=await inputPath(join(runtime.sourceRoot,row.path),'file');
      if(current.bytes!==row.bytes||current.sha256&&current.sha256!==row.sha256)
        throw Object.assign(new Error('The selected original report source changed.'),{code:'REPORT_SOURCE_CHANGED'});
      inputs.push(current);
    }
    const args=['serve','--desk',desk.directory,'--source-root',runtime.sourceRoot,
      '--python',settings.python,'--expected-desk',desk.sha256,'--expected-source',source.sha256,
      '--expected-python',python.identitySha256];
    if(settings.scientificWorkspace){
      const scientific=await native.inspectScientificWorkspace(settings.scientificWorkspace);
      inputs.push(await inputPath(scientific.directory,'directory',false,true));
      // Retain inode and native immutable metadata, never a mutable database byte hash.
      inputs.push({path:scientific.database.path,kind:'native-scientific-database',
        dev:scientific.database.dev,ino:scientific.database.ino,workspace:scientific.workspace});
      args.push('--scientific-workspace',scientific.directory,'--expected-scientific',scientific.sha256);
    }
    if(settings.operationsUrlFile){
      const access=await native.inspectReportAccessFile(settings.operationsUrlFile);
      inputs.push(await inputPath(access.path,'file'));
      args.push('--operations-url-file',access.path,'--expected-operations',access.sha256);
    }
    const facilitator=validateFacilitator(settings.facilitator,settings.allowLocalFacilitator===true);
    if(facilitator)args.push('--facilitator',facilitator);
    if(settings.allowLocalFacilitator)args.push('--allow-local-facilitator','true');
    return {args,inputs,createDirectories:[],resourceKey:(await import('./common.mjs')).sha(
      JSON.stringify({family:'groundwater-report-desk',directory:desk.directory,deskId:desk.desk.id}))};
  },
  runArguments({command,args,requestId}){
    if(command!=='groundwater-report-managed'||args.includes('--managed-operation'))
      throw Object.assign(new Error('Keep the one original Report Desk launch.'),{code:'REPORT_MANAGED_OPERATION'});
    const result=[...args,'--managed-operation',requestId];managedSelection(result);return result;
  },
  matchRequest(request){return !request.pythonCommand&&request.command==='groundwater-report-managed';},
  async verifyLaunch(request){
    const selected=managedSelection(request.args);
    const native=await import(pathToFileURL(join(selected.sourceRoot,REPORT_SOURCE,'managed.mjs')).href);
    await native.verifyManagedSelection(selected,{executedRoot:join(request.releaseDirectory,'source')});
  },
  createObserver(request,directory){
    return observeApplicationStartup(request,directory,line=>{
      if(!line.startsWith('{"schema":"stellar-forge.groundwater-report-startup.v1",'))return null;
      return ()=>reportStartup(request,line);
    },{lineLimit:65536});
  }
};
