// MIT. Merchant tools share the original native operator and original receiving owners.
import {RetainedFileReads} from '../../../../stellar-forge/mcp-merchant-operator/retained-file-reads.mjs';
import {nativeOperatorTools, nativeOperatorToolPrefix} from './merchant-tools.mjs';
import {openNativeOperatorConnection} from './merchant-connection.mjs';
import {NativeOperatorExports} from './merchant-exports.mjs';
import {plain, requireNative, nativeCanonicalJSON} from './merchant-export-contract.mjs';

const definitions = new Map(nativeOperatorTools((name,description,properties,required)=>
  ({name,description,properties,required})).map(value=>[value.name,value]));
function checked(value, schema) {
  if (schema.type==='string') requireNative(typeof value==='string' &&
    (schema.minLength===undefined||value.length>=schema.minLength) &&
    (schema.maxLength===undefined||value.length<=schema.maxLength) &&
    (!schema.pattern||new RegExp(schema.pattern).test(value)),'NATIVE_OPERATOR_TOOL_INPUT_INVALID');
  if (schema.type==='integer') requireNative(Number.isSafeInteger(value) &&
    value>=(schema.minimum??0) && value<=(schema.maximum??Number.MAX_SAFE_INTEGER),'NATIVE_OPERATOR_TOOL_INPUT_INVALID');
  if (schema.type==='object') requireNative(plain(value),'NATIVE_OPERATOR_TOOL_INPUT_INVALID');
  if (schema.enum) requireNative(schema.enum.includes(value),'NATIVE_OPERATOR_TOOL_INPUT_INVALID');
}
const small = value => {
  requireNative(Buffer.byteLength(JSON.stringify(value))<=1024*1024,'NATIVE_OPERATOR_TOOL_VIEW_TOO_LARGE',
    'Use a smaller original catalog page or its complete retained export and file receiving.');
  return value;
};

export class MerchantNativeFacilitatorOperators {
  #config; #exports; #directory; #environment; #fetch; #clients=new Map(); #pending=new Map();
  #reads=new RetainedFileReads({errorPrefix:'NATIVE_OPERATOR'});
  #scopes=new Map(); #disconnecting=new Map(); #closed=false; #closing;
  constructor(config,{environment=process.env,fetchImpl=globalThis.fetch}={}) {
    this.#config=config.nativeFacilitatorOperators;
    this.#exports=new NativeOperatorExports(config.exportsDirectory);this.#directory=config.exportsDirectory;
    this.#environment=environment;this.#fetch=fetchImpl;
  }
  get summary() {
    return {configured:Boolean(this.#config),operators:Object.keys(this.#config?.operators??{}),
      attachedAliases:[...this.#clients.keys()],...this.#reads.summary};
  }
  #entry(alias) {
    const entry=this.#config?.operators?.[alias];
    requireNative(entry,'NATIVE_OPERATOR_ALIAS_NOT_FOUND','Choose an original host-declared native operator alias.');
    return entry;
  }
  #connection(alias) {
    const entry=this.#entry(alias);
    if(!this.#clients.has(alias)){
      const promise=openNativeOperatorConnection(entry,{environment:this.#environment,fetchImpl:this.#fetch})
        .then(value=>Object.freeze({...value,timeoutMs:entry.timeoutMs}));
      this.#clients.set(alias,promise);
      promise.catch(()=>{if(this.#clients.get(alias)===promise)this.#clients.delete(alias);});
    }
    return this.#clients.get(alias);
  }
  #scope(alias,exportId) {
    const scope=alias+':'+exportId;
    if(!this.#scopes.has(alias))this.#scopes.set(alias,new Set());
    this.#scopes.get(alias).add(scope);return scope;
  }
  async #invoke(name,args) {
    const method=name.slice(nativeOperatorToolPrefix.length+1),alias=args.operator;
    if(method==='operators')return {...this.summary,operators:Object.entries(this.#config?.operators??{}).map(([operator,entry])=>
      ({operator,label:entry.label,connection:entry.operatorUrlFile?'ORIGINAL_PRIVATE_FILE':'ORIGINAL_HOST_ENVIRONMENT',
        expectedInstanceId:entry.instanceId??null}))};
    if(method==='exports')return this.#exports.list(alias,args);
    if(method==='manifest')return this.#exports.manifest(alias,args.exportId);
    if(method==='profile_export'||method==='catalog_export'){
      const kind=method==='profile_export'?'profile':'catalog';
      const selection=kind==='profile'?{name:args.name,sha256:args.sha256}:
        {runtimeId:args.runtimeId,expectedVersion:args.expectedVersion,query:args.query};
      return this.#exports.capture({operator:alias,exportId:args.exportId,kind,selection},()=>this.#connection(alias));
    }
    if(method==='file'){
      const scope=this.#scope(alias,args.exportId);
      const result=await this.#reads.read({scope,key:nativeCanonicalJSON({exportId:args.exportId,
        file:args.file,manifestSha256:args.expectedManifestSha256}),kind:'native-operator-'+args.file,directory:this.#directory,
        load:()=>this.#exports.file(alias,args.exportId,args.file,args.expectedManifestSha256),
        expectedSha256:args.expectedSha256,readId:args.readId,offset:args.offset,limit:args.limit});
      return {...result,operator:alias,exportId:args.exportId,manifestSha256:args.expectedManifestSha256};
    }
    if(method==='file_release'){
      await this.#reads.release(this.#scope(alias,args.exportId),args.readId);
      return {operator:alias,exportId:args.exportId,readId:args.readId,state:'READ_RELEASE_COMPLETE'};
    }
    const connected=await this.#connection(alias),client=connected.client;
    const options={signal:AbortSignal.timeout(connected.timeoutMs)};
    if(method==='status'){
      const state=await client.status(options);
      requireNative(nativeCanonicalJSON(state.workspace)===nativeCanonicalJSON(connected.identity),
        'NATIVE_OPERATOR_INSTANCE_CHANGED');
      return {...state,operator:alias,connection:connected.connection,
        receiving:{...this.#reads.summary,reads:[...(this.#scopes.get(alias)??[])].flatMap(scope=>this.#reads.status(scope).sessions)}};
    }
    if(method==='profiles')return client.profiles({after:args.after??'',limit:args.limit??30,...options});
    if(method==='profile')return client.profile(args.name,options);
    if(method==='review')return client.review(args.config,options);
    if(method==='save')return client.save({name:args.name,config:args.config,expectedSha256:args.expectedSha256},options);
    if(method==='probe'){
      const running=args.runtimeId!==undefined;
      requireNative(running?args.name===undefined&&args.sha256===undefined:
        args.name!==undefined&&args.sha256!==undefined,'NATIVE_OPERATOR_TOOL_INPUT_INVALID',
      'Select runtimeId alone, or the original profile name and SHA256.');
      return client.probe(running?{runtimeId:args.runtimeId}:{name:args.name,sha256:args.sha256},options);
    }
    if(method==='start')return client.start({name:args.name,sha256:args.sha256,port:args.port??0},options);
    if(method==='stop')return client.stop(args.runtimeId,options);
    if(method==='catalog')return client.catalog({runtimeId:args.runtimeId,query:args.query??'',
      expectedVersion:args.expectedVersion??null},options);
    requireNative(false,'NATIVE_OPERATOR_TOOL_UNKNOWN');
  }
  #disconnect(alias) {
    if(!this.#disconnecting.has(alias)){
      const pending=(async()=>{
        await Promise.allSettled([...(this.#pending.get(alias)??[])]);
        await Promise.all([...(this.#scopes.get(alias)??[])].map(scope=>this.#reads.closeScope(scope)));
        this.#clients.delete(alias);this.#scopes.delete(alias);
        return {operator:alias,state:'CLIENT_DETACHED'};
      })().finally(()=>this.#disconnecting.delete(alias));
      this.#disconnecting.set(alias,pending);
    }
    return this.#disconnecting.get(alias);
  }
  async call(name,args={}) {
    const definition=definitions.get(name);
    requireNative(definition&&plain(args)&&Object.keys(args).every(key=>Object.hasOwn(definition.properties,key))&&
      definition.required.every(key=>Object.hasOwn(args,key)),'NATIVE_OPERATOR_TOOL_INPUT_INVALID',
    'Supply the declared fields and their original native identifiers.');
    for(const [key,value]of Object.entries(args))checked(value,definition.properties[key]);
    const input=JSON.parse(JSON.stringify(args));
    requireNative(!this.#closed,'NATIVE_OPERATOR_AGENT_CLOSING');
    const alias=input.operator;
    if(alias!==undefined)this.#entry(alias);
    if(name===nativeOperatorToolPrefix+'_disconnect')return this.#disconnect(alias);
    requireNative(!this.#disconnecting.has(alias),'NATIVE_OPERATOR_AGENT_DISCONNECTING');
    const pending=Promise.resolve().then(()=>this.#invoke(name,input)).then(small);
    if(!this.#pending.has(alias))this.#pending.set(alias,new Set());
    this.#pending.get(alias).add(pending);
    try{return await pending;}
    finally{const active=this.#pending.get(alias);active?.delete(pending);if(!active?.size)this.#pending.delete(alias);}
  }
  close() {
    this.#closed=true;
    if(!this.#closing)this.#closing=(async()=>{
      await Promise.allSettled([...this.#pending.values()].flatMap(values=>[...values]));
      await Promise.allSettled([...this.#disconnecting.values()]);
      await this.#reads.close();this.#clients.clear();this.#scopes.clear();
    })().catch(error=>{this.#closing=null;throw error;});
    return this.#closing;
  }
}
