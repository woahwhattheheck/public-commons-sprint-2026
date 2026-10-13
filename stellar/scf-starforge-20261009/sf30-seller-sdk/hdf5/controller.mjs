import {join,resolve} from 'node:path';
import {mkdir,open,unlink} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {Hdf5Process} from './bridge.mjs';
import {MiB,sha,json,fail,only,id,hash,privateDirectory,exact,copyExact,read,verifiedFile,same,selectedPath} from './custody.mjs';
import {loadDatasetConfig} from '../dataset-handler.mjs';

export const ACTIONS=Object.freeze(['status','records','source.get','version.get','source.import','inspect','attributes','selection.get',
  'selection.save','selection.extract','edition.get','result.page','artifact','artifact.read','delivery.artifact','edition.export','edition.receive','operation.get','operation.resume','operation.cancel',
  'dataset.query','publisher.prepare','publisher.action','publisher.state','publisher.export']);
export class Hdf5Workbench {
  constructor(configuration){this.configuration=configuration;this.process=null;this.publisher=null;this.publisherOpen=null;this.opening=null;this.closing=null;this.draining=false;this.calls=new Set();}
  async start(){
    if(this.draining&&!this.opening)fail('This workbench is closing.','HDF5_CLOSING',409);
    return this.opening??=(async()=>{
      this.directory=await privateDirectory(this.configuration.directory,{create:true});
      this.inputRoots=await Promise.all((this.configuration.inputRoots??[]).map(path=>privateDirectory(path)));
      this.intake=await privateDirectory(join(this.directory,'intake'),{create:true});
      this.inputRoots.push(this.intake);
      this.buyerWorkspace=this.configuration.buyerWorkspace===undefined?undefined:await privateDirectory(this.configuration.buyerWorkspace);
      this.exports=await privateDirectory(join(this.directory,'deliveries'),{create:true});
      this.packages=await privateDirectory(join(this.directory,'publisher-packages'),{create:true});
      this.process=new Hdf5Process({directory:this.directory,python:this.configuration.python??'python3'});
      return this.process.ready;
    })();
  }
  async native(action,payload){await this.start();return this.process.call(action,payload);}
  async publisherInstance(){
    await this.start();
    return this.publisherOpen??=(async()=>{
      const {openSocrataPublisher}=await import('../socrata/publisher.mjs');
      return this.publisher=await openSocrataPublisher({directory:join(this.directory,'publisher')});
    })();
  }
  call(action,payload={}){
    if(this.draining)return Promise.reject(Object.assign(new Error('This workbench is closing.'),{code:'HDF5_CLOSING',status:409}));
    const promise=this.dispatch(action,payload);this.calls.add(promise);
    void promise.finally(()=>this.calls.delete(promise)).catch(()=>{});
    return promise;
  }
  async dispatch(action,payload){
    if(!ACTIONS.includes(action))fail('Unknown HDF5 workbench action.');
    await this.start();
    if(action==='operation.resume'){
      only(payload,['ident']);const original=await this.native('operation.get',{ident:id(payload.ident)}),r=original.request,operation=payload.ident;
      const actions={
        'source.import':()=>({operation,source_id:r.sourceId,path:r.path,label:r.label,expected_head:r.expectedHead,origin:r.origin}),
        'selection.save':()=>({operation,version:r.sourceVersion,selection:r.selection}),
        'selection.extract':()=>({operation,selection_id:r.selectionId}),
        'edition.export':()=>({operation,edition:r.editionId}),
        'edition.receive':()=>({operation,archive_path:r.archive,expected_sha:r.expectedSha256})
      };
      if(!actions[original.action])fail('This original operation has no native continuation.');
      return this.dispatch(original.action,actions[original.action]());
    }
    if(action==='source.import'){
      const path=await selectedPath(payload.path,this.inputRoots);
      return this.native(action,{...payload,path});
    }
    if(action==='edition.export'){
      only(payload,['operation','edition']);id(payload.operation);hash(payload.edition);
      return this.native(action,{...payload,destination:join(this.exports,payload.operation+'.hdf5.zip')});
    }
    if(action==='edition.receive'){
      const archive_path=await selectedPath(payload.archive_path,this.inputRoots);
      return this.native(action,{...payload,archive_path});
    }
    if(action==='delivery.artifact'){
      only(payload,['operation']);
      const original=await this.native('operation.get',{ident:id(payload.operation)});
      if(original.action!=='edition.export'||original.state!=='completed')fail('Select the original completed HDF5 delivery.','HDF5_DELIVERY_PENDING',409);
      const expected=join(this.exports,payload.operation+'.hdf5.zip');
      if(original.result.path!==expected)fail('Delivery belongs to another configured output directory.');
      return {name:payload.operation+'.hdf5.zip',path:expected,...original.result.archive,editionId:original.result.editionId};
    }
    if(action==='dataset.query'){
      only(payload,['edition','query']);const artifact=await this.native('artifact',{edition:payload.edition,name:'dataset.json'});
      const dataset=await loadDatasetConfig(artifact.path),query=new URLSearchParams(payload.query??'');
      const response=dataset.handle({query});
      return {editionId:payload.edition,native:response};
    }
    if(action==='publisher.prepare')return this.preparePublisher(payload);
    if(action==='publisher.state'){only(payload,[]);return (await this.publisherInstance()).state();}
    if(action==='publisher.action'){
      only(payload,['action','payload']);
      const allowed=new Set(['publisher.status','publisher.preview','publisher.reviewDraft','publisher.publish','publisher.activateSnapshot','publisher.collect',
        'publisher.release.stage','publisher.release.inspect','publisher.release.activate','publisher.release.rollback','publisher.release.start','publisher.release.stop',
        'publisher.buyer.review','publisher.buyer.prepare','publisher.buyer.session','publisher.buyer.run','publisher.buyer.recover','publisher.buyer.account','publisher.buyer.export']);
      if(!allowed.has(payload.action))fail('Choose an original dataset publisher/customer action.');
      const args=structuredClone(payload.payload??{});
      if(payload.action==='publisher.buyer.session'){
        if(!this.buyerWorkspace)fail('Configure the original independent buyer workspace on this host.','HDF5_BUYER_CONFIGURATION',409);
        if(args.workspaceDirectory!==undefined&&resolve(args.workspaceDirectory)!==this.buyerWorkspace)fail('Buyer workspace differs from the configured original owner.');
        args.workspaceDirectory=this.buyerWorkspace;
      }
      return (await this.publisherInstance()).act(payload.action,args);
    }
    if(action==='publisher.export'){
      only(payload,['kind','id']);const original=await (await this.publisherInstance()).readExport(payload.kind,payload.id);
      const exportId=sha(json({kind:payload.kind,id:payload.id,sha256:sha(original.bytes)}));
      const path=join(this.exports,exportId+'-'+original.filename);await exact(path,original.bytes);
      return {name:original.filename,path,bytes:original.bytes.length,sha256:sha(original.bytes),contentType:original.contentType,exportId};
    }
    if(action==='artifact.read'){
      only(payload,['edition','name','offset','length']);
      const descriptor=await this.native('artifact',{edition:payload.edition,name:payload.name});
      const offset=payload.offset??0,length=payload.length??262144;
      if(!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(length)||length<1||length>262144)fail('Choose a native file range of at most 262,144 bytes.');
      const original=await verifiedFile(descriptor.path,descriptor);
      try{
        if(offset>original.bytes)fail('Offset exceeds the original file.');
        const bytes=Buffer.alloc(Math.min(length,original.bytes-offset));let total=0;
        while(total<bytes.length){const result=await original.handle.read(bytes,total,bytes.length-total,offset+total);if(!result.bytesRead)fail('Source ended during range read.');total+=result.bytesRead;}
        if(!same(original.info,await original.handle.stat({bigint:true})))fail('Source changed during range read.');
        return {editionId:payload.edition,name:descriptor.name,bytes:original.bytes,sha256:original.sha256,offset,returned:bytes.length,
                rangeSha256:sha(bytes),base64:bytes.toString('base64'),next:offset+bytes.length<original.bytes?offset+bytes.length:null,
                verification:'whole_file_and_range'};
      }finally{await original.handle.close();}
    }
    return this.native(action,payload);
  }
  async preparePublisher(payload){
    only(payload,['edition','payment','origin','path']);
    hash(payload.edition);
    const edition=await this.native('edition.get',{ident:payload.edition});
    const projected=edition.array.datasetProjection?.maxRowJsonBytes;
    if(typeof projected!=='string'||!/^(0|[1-9][0-9]*)$/.test(projected)||Number(projected)>768*1024)
      fail('This exact typed row cannot fit the native dataset page budget. Retain the complete artifacts or select smaller compound fields/array values before publishing.','HDF5_PROJECTION_UNPAGEABLE',413);
    const selected=await this.native('selection.get',{ident:edition.selectionId});
    const version=await this.native('version.get',{ident:edition.sourceVersion});
    const configFile=await this.native('artifact',{edition:edition.id,name:'dataset.json'});
    const originalConfig=await read(configFile.path,65536),config=JSON.parse(originalConfig);
    const dataset=await loadDatasetConfig(configFile.path),description=dataset.describe();
    const [{buildDatasetSellerConfig},{DATASET_SNAPSHOT_PARAMETER}]=await Promise.all([
      import('../dataset-cli.mjs'),import('../dataset-refresh/versions.mjs')]);
    const seller=await buildDatasetSellerConfig(dataset,{payment:payload.payment,origin:payload.origin,path:payload.path??'/array'});
    if(seller.routes[0].definition.queryParameters.length>=32)fail('Native snapshot selector requires one query slot.');
    seller.routes[0].definition.queryParameters.push({...DATASET_SNAPSHOT_PARAMETER});
    const binding={schema:'stellar-forge.hdf5-publisher-request.v1',editionId:edition.id,sourceVersion:edition.sourceVersion,
                   payment:payload.payment,origin:payload.origin,path:payload.path??'/array'};
    const key=sha(json(binding)),out=await privateDirectory(join(this.packages,key),{create:true});
    await exact(join(out,'request.json'),json(binding));
    for(const name of ['dataset.csv','dataset.json']){
      const artifact=await this.native('artifact',{edition:edition.id,name});await copyExact(artifact.path,join(out,name),artifact);
    }
    await exact(join(out,'seller.json'),json(seller));
    const provenance=await privateDirectory(join(out,'provenance'),{create:true});const sourceFiles=[];
    for(const [name,value] of [['source-version.json',version],['selection.json',selected],['edition.json',edition]]){
      const bytes=json(value);await exact(join(provenance,name),bytes);sourceFiles.push({path:'provenance/'+name,bytes:bytes.length,sha256:sha(bytes)});
    }
    for(const name of ['source.h5','array.json','values.jsonl']){
      const artifact=await this.native('artifact',{edition:edition.id,name});
      await copyExact(artifact.path,join(provenance,name),artifact);
      sourceFiles.push({path:'provenance/'+name,bytes:artifact.bytes,sha256:artifact.sha256});
    }
    const source={schema:'stellar-forge.hdf5-merchant-source.v1',editionId:edition.id,sourceVersion:edition.sourceVersion,
                  sourceFile:edition.sourceFile,selectionId:edition.selectionId,selection:edition.selection,dtype:edition.array.dtype,
                  rowCount:description.rowCount,encoding:edition.array.encoding,sourceFiles};
    await exact(join(out,'source.json'),json(source));
    if(!(await read(configFile.path,65536)).equals(originalConfig))fail('Original dataset configuration changed.');
    const result=await (await this.publisherInstance()).act('publisher.prepare',{exportDirectory:out});
    return {schema:'stellar-forge.hdf5-publisher-prepared.v1',editionId:edition.id,sourceVersion:edition.sourceVersion,
            nativeDataset:description,packageDirectory:out,requestSha256:key,...result};
  }
  upload(stream,expectedSha,maximum=256*MiB){
    if(this.draining)return Promise.reject(Object.assign(new Error('This workbench is closing.'),{code:'HDF5_CLOSING',status:409}));
    const promise=this.acceptUpload(stream,expectedSha,maximum);this.calls.add(promise);
    void promise.finally(()=>this.calls.delete(promise)).catch(()=>{});return promise;
  }
  async acceptUpload(stream,expectedSha,maximum){
    await this.start();if(expectedSha!==undefined)hash(expectedSha);
    const path=join(this.intake,randomUUID()+'.upload');const file=await open(path,'wx',0o600);let total=0;
    const {createHash}=await import('node:crypto');const digest=createHash('sha256');
    try{
      for await(const chunk of stream){total+=chunk.length;if(total>maximum)fail('Upload exceeds its byte limit.','HDF5_UPLOAD_TOO_LARGE',413);digest.update(chunk);await file.writeFile(chunk);}
      await file.sync();const observed=digest.digest('hex');if(expectedSha&&observed!==expectedSha)fail('Uploaded bytes differ from the selected hash.');
      await file.close();const {syncDirectory}=await import('./custody.mjs');await syncDirectory(this.intake);
      return {path,bytes:total,sha256:observed};
    }catch(error){await file.close().catch(()=>{});await unlink(path).catch(()=>{});throw error;}
  }
  close(){
    this.draining=true;
    if(this.closing)return this.closing;
    const pending=(async()=>{
      await Promise.allSettled([...this.calls,...(this.opening?[this.opening]:[])]);
      const errors=[];
      try{if(this.publisherOpen)await (await this.publisherOpen).close();}catch(error){errors.push(error);}
      try{if(this.process)await this.process.close();}catch(error){errors.push(error);}
      if(errors.length)throw new AggregateError(errors,'The original workspace owners closed with an interrupted outcome; inspect retained operations.');
    })();
    this.closing=pending;
    void pending.catch(()=>{if(this.closing===pending)this.closing=null;});
    return pending;
  }
}
