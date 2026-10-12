// SPDX-License-Identifier: MIT
import {constants} from 'node:fs';
import {open,lstat} from 'node:fs/promises';
import {resolve,dirname,isAbsolute,relative,sep} from 'node:path';
import {GroundwaterReportDesk} from './desk.mjs';
import {dispatchDesk} from './server.mjs';
import {privateAccess} from './cli.mjs';
import {reportTools,REPORT_ACTIONS} from './provider.mjs';
import {SCHEMA,fields,need,text,readJSON,directory} from './common.mjs';
import {RetainedFileReads,MAX_RETAINED_CHUNK_BYTES} from '../../../../stellar-forge/mcp-merchant-operator/retained-file-reads.mjs';

const ALIAS=/^[a-z0-9][a-z0-9_-]{0,63}$/;
export const CONNECTION_SCHEMA='stellar-forge.groundwater-report-connections.v1';
const definitions=new Map(reportTools((name,description,properties,required)=>({name,properties,required})).map(x=>[x.name,x]));
export async function readConfiguration(file){
  file=resolve(file);const stat=await lstat(file);
  need(stat.isFile()&&!stat.isSymbolicLink()&&(process.platform==='win32'||(stat.mode&0o077)===0&&stat.uid===process.getuid()),
    'PRIVATE_CONFIGURATION','Use a private original Groundwater report connection file.');
  const config=(await readJSON(file,1024*1024)).value;
  fields(config,['schema','desks'],'report desk configuration');
  need(config.schema===CONNECTION_SCHEMA&&config.desks&&Object.keys(config.desks).length>=1&&Object.keys(config.desks).length<=32,
    'CONFIGURATION_REQUIRED','Configure 1–32 original desks.');
  const desks={};
  for(const [alias,row]of Object.entries(config.desks)){
    need(ALIAS.test(alias),'CONFIGURATION_ALIAS','Use a valid original desk alias.');
    fields(row,['label','directory','expectedDeskId','sourceWorkspace','application','python','operationsUrlFile','inboxDirectory','exportsDirectory','receivingDirectory'],'configured original desk');
    text(row.expectedDeskId,'original desk ID',100);text(row.label??alias,'desk label',160);
    for(const key of ['directory','exportsDirectory','receivingDirectory'])text(row[key],key,4096);
    const path=key=>row[key]===undefined?undefined:resolve(dirname(file),row[key]);
    desks[alias]={label:row.label??alias,expectedDeskId:row.expectedDeskId,directory:path('directory'),
      sourceWorkspace:path('sourceWorkspace'),application:path('application'),python:row.python??'python3',
      operationsUrlFile:path('operationsUrlFile'),inboxDirectory:path('inboxDirectory'),
      exportsDirectory:path('exportsDirectory'),receivingDirectory:path('receivingDirectory')};
  }
  return {schema:CONNECTION_SCHEMA,desks};
}
function confined(path,root,label){
  need(typeof path==='string'&&isAbsolute(path)&&resolve(path)===path,'CONFIGURED_PATH','Use an explicit normalized '+label+'.');
  const rel=relative(root,path);
  need(rel&&!rel.startsWith('..'+sep)&&rel!=='..'&&!isAbsolute(rel),'CONFIGURED_PATH','Select '+label+' inside its configured private root.');
  return path;
}
export class MerchantGroundwaterReports{
  #config;#pending=new Set();#closing=false;#closed;#reads;
  constructor(config){
    this.#config=config.groundwaterReports??null;
    this.#reads=new RetainedFileReads({errorPrefix:'GROUNDWATER_REPORT'});
  }
  get summary(){return {configured:Boolean(this.#config),desks:Object.entries(this.#config?.desks??{}).map(([desk,c])=>({
    desk,label:c.label,deskId:c.expectedDeskId,sourceConfigured:Boolean(c.sourceWorkspace),operationsConfigured:Boolean(c.operationsUrlFile)}))};}
  async #selected(alias){
    need(ALIAS.test(alias??''),'DESK_ALIAS','Select a configured original desk.');
    const c=this.#config?.desks[alias];need(c,'DESK_NOT_CONFIGURED','Select a configured original desk.');
    const desk=new GroundwaterReportDesk({directory:c.directory,sourceWorkspace:c.sourceWorkspace,application:c.application,
      python:c.python,operationsAccess:c.operationsUrlFile?await privateAccess(c.operationsUrlFile):null});
    const opened=await desk.open();need(opened.meta.id===c.expectedDeskId,'DESK_CHANGED','The configured directory contains a different original desk.');
    return {desk,config:c};
  }
  async #execute(name,args){
    if(name==='merchant_groundwater_report_desks')return this.summary;
    const {desk,config}=await this.#selected(args.desk),scope=args.desk+':'+config.expectedDeskId;
    if(name==='merchant_groundwater_report_read'){
      const methods={state:()=>desk.state(),reports:()=>desk.reports(),report:()=>desk.report(args.id),
        publication:()=>desk.publication(args.id),receiving:()=>desk.receiving(args.id),operation:()=>desk.original(args.id),
        cases:()=>desk.cases(),case:()=>desk.case(args.id)};
      need(methods[args.kind],'READ_REQUIRED','Select an original desk read.');return {desk:args.desk,native:await methods[args.kind]()};
    }
    if(name==='merchant_groundwater_report_file_release'){
      await this.#reads.release(scope,args.readId);return {desk:args.desk,state:'RELEASED',readId:args.readId};
    }
    if(name==='merchant_groundwater_report_file'){
      const d=await desk.download(args.operationId,args.kind,args.format);
      need(d.sha256===args.expectedSha256,'FILE_CHANGED','Select the exact original file SHA-256.');
      return this.#reads.read({scope,key:args.operationId+':'+args.kind+':'+(args.format??''),kind:'GROUNDWATER_REPORT',
        directory:config.directory,expectedSha256:args.expectedSha256,offset:args.offset??0,
        limit:args.limit??65536,readId:args.readId,
        load:async()=>({readonlyFileHandle:await open(d.path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK),
          name:d.name,bytes:d.bytes,sha256:d.sha256,type:d.mime})});
    }
    need(REPORT_ACTIONS.includes(args.action),'ACTION_REQUIRED','Select an original report desk action.');
    const input=structuredClone(args.input);
    if(args.action==='buyer.capture'){
      need(config.inboxDirectory&&(!input.inboxDirectory||input.inboxDirectory===config.inboxDirectory),'INBOX_CONFIGURATION','Use the configured original Inbox.');
      input.inboxDirectory=config.inboxDirectory;
    }
    if(['buyer.prepare','buyer.prepare-catalog'].includes(args.action))confined(input.responseOut,config.receivingDirectory,'new buyer response path');
    if(args.action==='desk.export'){
      await directory(config.exportsDirectory,{create:true});
      confined(input.destination,config.exportsDirectory,'new complete export');
    }
    if(args.action==='desk.restore'){
      await directory(config.receivingDirectory,{create:true});
      confined(input.archive,config.exportsDirectory,'original complete archive');
      confined(input.destination,config.receivingDirectory,'new restore destination');
    }
    if(args.action==='continue'){
      const original=await desk.original(input.operationId),body=original.request.body;
      if(body.action==='export')confined(body.input.destination,config.exportsDirectory,'original export');
      if(body.action==='capture')need(body.input.inboxDirectory===config.inboxDirectory,'INBOX_CONFIGURATION','The original Inbox configuration changed.');
    }
    return {desk:args.desk,native:await dispatchDesk(desk,args.action,input)};
  }
  call(name,args={}){
    need(!this.#closing,'PROVIDER_CLOSING','The original provider is draining.');
    const definition=definitions.get(name);need(definition,'TOOL_NOT_FOUND','Choose a declared report desk tool.');
    fields(args,Object.keys(definition.properties),'report desk tool');
    need(definition.required.every(k=>Object.hasOwn(args,k)),'TOOL_FIELDS','Supply every original required field.');
    const promise=this.#execute(name,structuredClone(args));this.#pending.add(promise);
    return promise.finally(()=>this.#pending.delete(promise));
  }
  close(){
    this.#closing=true;
    return this.#closed??=(async()=>{await Promise.allSettled([...this.#pending]);await this.#reads.close();})();
  }
}
