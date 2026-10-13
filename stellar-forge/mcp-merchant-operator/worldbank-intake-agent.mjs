// MIT. Complete registered source files on the existing programme provider.
import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { join } from 'node:path';
import { workflowSeriesPrivateDirectory, readWorkflowSeriesPrivateFile } from './workflow-series-connection.mjs';
import { writeConsoleWorkflowFile, inspectConsoleWorkflowFile } from './console/client-files.mjs';
import { INTAKE_MANIFEST, INTAKE_ORIGINAL, INTAKE_REGISTRATION, INTAKE_INTENT,
  INTAKE_DELIVERY_SCHEMA, intakeIdentity, parseIntakeDelivery } from './worldbank-intake-contracts.mjs';
import { WORLDBANK_SHA, encodeWorldBank, digest, worldBankNeed as need } from './worldbank-programme-contracts.mjs';
export class WorldBankIntakeAgent {
  #config; #reads; #using; #definition; #closing; #captures=new Map();
  constructor({config,reads,using,definition,isClosing}) {
    this.#config=config; this.#reads=reads; this.#using=using; this.#definition=definition; this.#closing=isClosing;
  }
  #scope(workspace,exportId) { this.#definition(workspace); need(WORLDBANK_SHA.test(exportId),'Keep the complete intake export hash.'); return workspace+'\0intake\0'+exportId; }
  async #directory(exportId,create=false) {
    need(WORLDBANK_SHA.test(exportId),'Select the exact registered source export.');
    await workflowSeriesPrivateDirectory(this.#config.exportsDirectory);
    const root=await workflowSeriesPrivateDirectory(join(this.#config.exportsDirectory,'worldbank-intakes'),create);
    return workflowSeriesPrivateDirectory(join(root,exportId),create);
  }
  async #manifest(workspace,exportId) {
    const definition=this.#definition(workspace),directory=await this.#directory(exportId);
    const bytes=await readWorkflowSeriesPrivateFile(join(directory,INTAKE_MANIFEST),65000);
    const manifest=parseIntakeDelivery(bytes,exportId);
    need(manifest.workspace===workspace&&manifest.workspaceId===definition.workspaceId,
      'The original registered source belongs to another workspace.','WORLDBANK_INTAKE_CHANGED');
    return {directory,manifest,bytes,manifestFile:{name:INTAKE_MANIFEST,bytes:bytes.length,sha256:digest(bytes),contentType:'application/json'}};
  }
  async #capture(workspace,{intakeId,expectedSha256}) {
    return this.#using(workspace,undefined,async client=>{
      const status=intakeIdentity(await client.intakeStatus(intakeId),{id:intakeId,workspaceId:client.workspaceId});
      need(status.status==='REGISTERED'&&status.intent.sha256===expectedSha256,
        'Select the registered original intake and approved ZIP hash.','WORLDBANK_INTAKE_CHANGED');
      const registration=encodeWorldBank(status.result),intent=encodeWorldBank(status.intent);
      const files=[
        {name:INTAKE_ORIGINAL,bytes:status.intent.bytes,sha256:status.intent.sha256,contentType:'application/zip'},
        {name:INTAKE_REGISTRATION,bytes:registration.length,sha256:digest(registration),contentType:'application/json'},
        {name:INTAKE_INTENT,bytes:intent.length,sha256:digest(intent),contentType:'application/json'}
      ];
      const body={schema:INTAKE_DELIVERY_SCHEMA,workspace,workspaceId:client.workspaceId,intakeId,
        originalSha256:status.intent.sha256,registrationSha256:digest(registration),source:status.result.source,files};
      const exportId=digest(encodeWorldBank(body)),manifest={...body,exportId},bytes=encodeWorldBank(manifest);
      parseIntakeDelivery(bytes,exportId);
      const scope=this.#scope(workspace,exportId);
      if(this.#captures.has(scope))return this.#captures.get(scope);
      const pending=(async()=>{
        const directory=await this.#directory(exportId,true);
        need(!this.#closing(),'The original provider is closing.','WORLDBANK_CLOSING');
        await client.intakeDownload(intakeId,files[0],join(directory,INTAKE_ORIGINAL));
        await writeConsoleWorkflowFile(join(directory,INTAKE_REGISTRATION),registration);
        await writeConsoleWorkflowFile(join(directory,INTAKE_INTENT),intent);
        await writeConsoleWorkflowFile(join(directory,INTAKE_MANIFEST),bytes);
        return {state:'EXPORTED',workspace,exportId,intakeId,source:manifest.source,manifest,
          manifestFile:{name:INTAKE_MANIFEST,bytes:bytes.length,sha256:digest(bytes),contentType:'application/json'},files};
      })();
      this.#captures.set(scope,pending);
      try{return await pending;}finally{if(this.#captures.get(scope)===pending)this.#captures.delete(scope);}
    });
  }
  async #file(args) {
    const received=await this.#manifest(args.workspace,args.exportId);
    need(received.manifestFile.sha256===args.expectedManifestSha256,
      'Keep the selected complete registration manifest.','WORLDBANK_INTAKE_CHANGED');
    const file=args.file===INTAKE_MANIFEST?received.manifestFile:received.manifest.files.find(f=>f.name===args.file);
    need(file&&file.sha256===args.expectedSha256,'Select the exact registered original file.','WORLDBANK_FILE_CHANGED');
    const result=await this.#reads.read({scope:this.#scope(args.workspace,args.exportId),key:file.name,kind:'worldbank-intake',
      directory:received.directory,expectedSha256:file.sha256,readId:args.readId,offset:args.offset??0,limit:args.limit??65536,
      load:async()=>{
        const path=join(received.directory,file.name);
        const saved=await inspectConsoleWorkflowFile(path,file);
        need(saved.sha256===file.sha256&&saved.bytes===file.bytes,'The retained registered source changed.','WORLDBANK_FILE_CHANGED');
        const handle=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
        try {
          const stat=await handle.stat();
          need(stat.isFile()&&stat.size===file.bytes&&!(stat.mode&0o077)&&
            (typeof process.getuid!=='function'||stat.uid===process.getuid()),'Read the original private retained source.','WORLDBANK_FILE_CHANGED');
          return {readonlyFileHandle:handle,bytes:file.bytes,sha256:file.sha256,name:file.name,type:file.contentType};
        } catch(error) {await handle.close();throw error;}
      }});
    return {workspace:args.workspace,exportId:args.exportId,manifestSha256:received.manifestFile.sha256,...result};
  }
  async execute(action,args) {
    const {workspace,...input}=args;this.#definition(workspace);
    if(action==='intake_export')return this.#capture(workspace,input);
    if(action==='intake_manifest') {
      const value=await this.#manifest(workspace,input.exportId);
      return {state:'MANIFEST_RETAINED',workspace,exportId:input.exportId,manifestFile:value.manifestFile,manifest:value.manifest};
    }
    if(action==='intake_file')return this.#file(args);
    if(action==='intake_file_release') {
      await this.#reads.release(this.#scope(workspace,input.exportId),input.readId);
      return {state:'RELEASED',workspace,exportId:input.exportId,readId:input.readId};
    }
    return this.#using(workspace,undefined,async client=>{
      switch(action) {
        case 'intake_list':return client.intakeList(input);
        case 'intake_begin':return client.intakeBegin(input.request);
        case 'intake_status':return client.intakeStatus(input.intakeId);
        case 'intake_chunk':return client.intakeChunk(input.intakeId,input.request);
        case 'intake_register':await client.intakeRegister(input.intakeId,{resume:input.resume??false});return client.intakeStatus(input.intakeId);
        case 'intake_wait':{const {intakeId,...options}=input;return client.intakeWait(intakeId,options);}
        default:need(false,'Select the declared original intake method.');
      }
    });
  }
}
