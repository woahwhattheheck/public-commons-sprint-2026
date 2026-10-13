import { Hocuspocus } from '@hocuspocus/server';
import crossws from 'crossws/adapters/node';
import * as Y from 'yjs';
import { nativeSchema, validateJSON } from '../core/migration.mjs';
import { requireValue, publicError, sha, now, uuid, clone } from '../core/common.mjs';

/**
 * Owns original Hocuspocus instances inside the leased application process.
 * Yjs owns synchronization, merging, delete sets and binary updates throughout.
 */
export class NativeRuntime {
  constructor({store,auth,selection}){
    this.store=store;this.auth=auth;this.selection=selection;this.entries=new Map();this.closingEntries=new Map();this.origin=null;this.closing=false;
  }
  setOrigin(origin){this.origin=origin;}
  has(projectId){return this.entries.has(projectId);}
  status(projectId){
    const entry=this.entries.get(projectId);
    return {configured:true,ready:!!this.selection,selection:clone(this.selection),observedAt:now(),
      state:entry?.status??'stopped',deploymentId:entry?.deploymentId??null,
      error:entry?.lastError??null,documents:entry?.hocus.getDocumentsCount()??0};
  }
  connections(projectId,deploymentId){
    const entry=this.entries.get(projectId);if(!entry||entry.deploymentId!==deploymentId)return [];
    const rows=[];for(const doc of entry.hocus.documents.values())for(const connection of doc.getConnections()){
      const context=entry.contexts.get(connection)??connection.context?.nativeSession;
      if(context)rows.push({id:connection.socketId,actorId:context.actorId,documentId:context.documentId,
        epochId:context.epochId,access:connection.readOnly?'read':'write',connectedAt:entry.connectionTimes.get(connection)??entry.startedAt});
    }return rows;
  }
  track(entry,task){
    const promise=Promise.resolve(task);entry.tasks.add(promise);
    promise.finally(()=>entry.tasks.delete(promise)).catch(()=>{});return promise;
  }
  hook(entry,fn){return payload=>this.track(entry,Promise.resolve().then(()=>fn(payload)));}
  async verify(entry,token,documentName,{draining=false}={}){
    this.store.assert();
    requireValue(this.entries.get(entry.projectId)===entry&&
      (entry.status==='running'||draining&&entry.status==='stopping'),'DEPLOYMENT_NOT_RUNNING','The selected original collaboration deployment is not accepting this session.',409);
    const value=await this.auth.verify(token,documentName,id=>this.store.get(id));
    requireValue(value.projectId===entry.projectId&&value.deploymentId===entry.deploymentId,'SESSION_DEPLOYMENT','This native session belongs to another original deployment.',403);
    requireValue(this.entries.get(entry.projectId)===entry&&
      (entry.status==='running'||draining&&entry.status==='stopping'),'DEPLOYMENT_NOT_RUNNING','The selected deployment changed during authentication.',409);
    return {...value,token};
  }
  currentDocument(entry,documentName){
    const project=this.store.get(entry.projectId),document=project.documents.find(d=>d.documentName===documentName);
    requireValue(document,'DOCUMENT_EPOCH_CHANGED','The original native document epoch is no longer selected.',409);
    requireValue(document.schemaId===entry.edition.schemaId&&document.field===entry.edition.field,
      'SCHEMA_SELECTION','This document requires another original installed schema.',409);
    return document;
  }
  persist(entry,document){
    try{
      this.store.assert();const selected=this.currentDocument(entry,document.name);
      const bytes=Buffer.from(Y.encodeStateAsUpdate(document)),vector=Buffer.from(Y.encodeStateVector(document));
      requireValue(bytes.length<=entry.edition.config.maxDocumentBytes,'DOCUMENT_SIZE','The complete native Yjs document exceeds the selected edition limit.',413);
      const receipt=this.store.writeNative({projectId:entry.projectId,documentId:selected.id,epochId:selected.epochId,documentName:selected.documentName,bytes,vector});
      entry.persistenceErrors.delete(document.name);entry.lastError=entry.persistenceErrors.values().next().value??null;
      return receipt;
    }catch(error){entry.lastError=publicError(error);entry.persistenceErrors.set(document.name,entry.lastError);throw error;}
  }
  async start(project,deployment){
    this.store.assert();requireValue(!this.closing,'RUNTIME_CLOSING','The original application is closing.',503);
    const previous=this.entries.get(project.id);
    if(previous){requireValue(previous.deploymentId===deployment.id&&previous.status==='running','DEPLOYMENT_ACTIVE','Another native deployment already owns this project.',423);return this.startReceipt(previous);}
    const edition=project.editions.find(e=>e.id===deployment.editionId);
    requireValue(edition?.status==='frozen','EDITION_NOT_FROZEN','Native startup requires the retained frozen source edition.',409);
    requireValue(edition.runtimeSelection?.selectionSha256===this.selection.selectionSha256&&edition.runtimeSelection?.applicationSourceSha256===this.selection.applicationSourceSha256,'RUNTIME_EDITION_CHANGED','The frozen edition selects another original installed runtime. Freeze an explicitly reviewed current edition to change it.',409);
    const native=await nativeSchema();
    requireValue(edition.schemaId===native.shared.SCHEMA_ID&&edition.field===native.shared.FIELD_NAME,'SCHEMA_SELECTION','The frozen source needs a different installed native schema.',409);
    for(const document of project.documents){requireValue(document.schemaId===edition.schemaId&&document.field===edition.field,'SCHEMA_SELECTION','Native startup will not change an existing document schema silently.',409);
      const row=this.store.nativeRow(project.id,document.id,document.epochId);requireValue(row,'NATIVE_DOCUMENT_MISSING','The complete original native document is missing.',409);this.store.objects.verify(row.sha256,Number(row.bytes));
      requireValue(Number(row.bytes)<=edition.config.maxDocumentBytes,'DOCUMENT_SIZE','The selected configuration is smaller than a retained native document.',413);}
    const entry={projectId:project.id,deploymentId:deployment.id,edition:clone(edition),launchId:uuid('launch'),startedAt:now(),status:'running',
      peers:new Set(),sockets:new Map(),connections:new Set(),contexts:new WeakMap(),connectionTimes:new WeakMap(),messageLocks:new WeakMap(),
      tasks:new Set(),persistenceErrors:new Map(),lastError:null,stopPromise:null};
    const hook=fn=>this.hook(entry,fn);
    entry.hocus=new Hocuspocus({
      name:project.id,debounce:edition.config.debounceMs,maxDebounce:edition.config.maxDebounceMs,
      timeout:30000,unloadImmediately:true,quiet:true,
      onAuthenticate:hook(async payload=>{
        const context=await this.verify(entry,payload.token,payload.documentName);
        payload.connectionConfig.readOnly=context.access!=='write';
        return {nativeSession:context};
      }),
      onTokenSync:hook(async payload=>{
        const context=await this.verify(entry,payload.token,payload.documentName);
        payload.connectionConfig.readOnly=context.access!=='write';payload.connection.readOnly=context.access!=='write';
        entry.contexts.set(payload.connection,context);
        payload.connection.context={...payload.connection.context,nativeSession:context};
        return {nativeSession:context};
      }),
      onLoadDocument:hook(async payload=>{
        await this.verify(entry,payload.context.nativeSession.token,payload.documentName);
        const document=this.currentDocument(entry,payload.documentName),bytes=this.store.nativeData(document.documentName);
        requireValue(bytes,'NATIVE_DOCUMENT_MISSING','The retained original Yjs document is missing.',409);
        return new Uint8Array(bytes);
      }),
      afterLoadDocument:hook(async payload=>{this.persist(entry,payload.document);}),
      connected:hook(async payload=>{
        const context=await this.verify(entry,payload.context.nativeSession.token,payload.documentName);
        entry.connections.add(payload.connection);entry.contexts.set(payload.connection,context);
        entry.connectionTimes.set(payload.connection,now());payload.connection.readOnly=context.access!=='write';
      }),
      beforeHandleMessage:hook(async payload=>{
        const saved=entry.contexts.get(payload.connection)??payload.context.nativeSession;
        const current=await this.verify(entry,saved.token,payload.documentName,{draining:true});
        entry.contexts.set(payload.connection,current);payload.connection.readOnly=current.access!=='write';
      }),
      beforeSync:hook(async payload=>{
        if(![1,2].includes(payload.type)||payload.connection.readOnly)return;
        // The original document mutex also serializes native store hooks. Validate the
        // native candidate while that mutex is held through original MessageReceiver.apply.
        const release=await payload.document.saveMutex.acquire();
        entry.messageLocks.set(payload.connection,release);
        try{
          const saved=entry.contexts.get(payload.connection)??payload.context.nativeSession;
          const current=await this.verify(entry,saved.token,payload.documentName,{draining:true});
          requireValue(current.access==='write','DOCUMENT_READ_ONLY','This current native grant is read-only.',403);
          requireValue(payload.payload.byteLength<=edition.config.maxDocumentBytes,'DOCUMENT_SIZE','The native update exceeds the selected document limit.',413);
          const candidate=new Y.Doc();
          try{
            Y.applyUpdate(candidate,Y.encodeStateAsUpdate(payload.document));
            Y.applyUpdate(candidate,payload.payload);
            requireValue([...candidate.share.keys()].every(k=>k===edition.field),'UNSUPPORTED_NATIVE_FIELD','The native update contains an unselected document field.',422);
            validateJSON(native.prosemirror.yDocToProsemirrorJSON(candidate,edition.field),native.schema);
            requireValue(Y.encodeStateAsUpdate(candidate).byteLength<=edition.config.maxDocumentBytes,'DOCUMENT_SIZE','The complete native candidate exceeds this edition limit.',413);
          }finally{candidate.destroy();}
        }catch(error){entry.messageLocks.delete(payload.connection);release();throw error;}
      }),
      afterHandleMessage:hook(async payload=>{
        const release=entry.messageLocks.get(payload.connection);
        if(release){entry.messageLocks.delete(payload.connection);release();}
      }),
      onStoreDocument:hook(async payload=>{this.persist(entry,payload.document);}),
      beforeUnloadDocument:hook(async payload=>{this.persist(entry,payload.document);}),
      onDisconnect:hook(async payload=>{
        for(const connection of entry.connections)if(connection.socketId===payload.socketId&&connection.document.name===payload.documentName){
          await connection.waitForPendingMessages();entry.connections.delete(connection);
        }
      })
    });
    entry.adapter=crossws({serverOptions:{maxPayload:edition.config.maxDocumentBytes+65536},hooks:{
      open:peer=>{
        if(entry.status!=='running'){peer.websocket.close(1012,'Deployment is stopping');return;}
        entry.peers.add(peer);
        const client=entry.hocus.handleConnection(peer.websocket,peer.request,{projectId:project.id});
        peer._tjlabsClient=client;
        peer.websocket.on?.('pong',()=>client.touch());
      },
      message:(peer,message)=>{if(entry.status==='running')peer._tjlabsClient?.handleMessage(message.uint8Array());},
      close:(peer,event)=>{
        entry.peers.delete(peer);
        if(peer._tjlabsClient)this.track(entry,peer._tjlabsClient.handleClose({code:event.code,reason:event.reason}));
      },
      error:(_peer,_error)=>{entry.lastError={code:'NATIVE_SOCKET_ERROR',message:'The original native collaboration socket ended with an error.'};}
    }});
    this.entries.set(project.id,entry);
    this.store.setLocal(project.id,{instanceId:this.store.instanceId,status:'running',deploymentId:entry.deploymentId,launchId:entry.launchId,startedAt:entry.startedAt,selection:this.selection});
    entry.reauth=setInterval(()=>{if(entry.status==='running')this.track(entry,this.recheck(project.id)).catch(error=>{entry.lastError=publicError(error);});},1000);entry.reauth.unref();
    return this.startReceipt(entry);
  }
  startReceipt(entry){return {projectId:entry.projectId,deploymentId:entry.deploymentId,editionId:entry.edition.id,
    launchId:entry.launchId,startedAt:entry.startedAt,state:'running',runtime:this.selection};}
  async recheck(projectId){
    const entry=this.entries.get(projectId);if(!entry)return;
    for(const document of entry.hocus.documents.values())for(const connection of document.getConnections()){
      try{
        const saved=entry.contexts.get(connection)??connection.context?.nativeSession;
        const current=await this.verify(entry,saved?.token,document.name,{draining:true});
        entry.contexts.set(connection,current);connection.readOnly=current.access!=='write';
      }catch{
        // Original Connection.close sends the native document close and removes its
        // awareness/grant subscription; physical socket closure drains pending messages.
        connection.close({code:4403,reason:'The original document grant or session is no longer active.'});
        connection.webSocket.close?.(4403,'The original session is no longer active');
      }
    }
  }
  async upgrade(request,socket,head){
    try{
      requireValue(!this.closing,'RUNTIME_CLOSING','The application is closing.',503);
      const url=new URL(request.url,this.origin),match=/^\/collaboration\/([A-Za-z0-9_.:-]+)\/?$/.exec(url.pathname);
      requireValue(match&&!url.search,'NATIVE_ROUTE','Use the exact native project socket without query credentials.',404);
      const entry=this.entries.get(match[1]);requireValue(entry?.status==='running','DEPLOYMENT_NOT_RUNNING','The original selected deployment is not running.',409);
      // Observe the actual accepted TCP socket before any async upgrade hook.
      // It stays owned even if authentication/open never creates a peer.
      if(!entry.sockets.has(socket)){
        let done;const closed=new Promise(resolve=>{done=resolve;});
        entry.sockets.set(socket,closed);
        socket.once('close',()=>{entry.sockets.delete(socket);done();});
      }
      const origin=request.headers.origin,allowed=entry.edition.config.allowedOrigins;
      if(origin)requireValue((allowed.length?allowed:[this.origin]).includes(origin),'ORIGIN_FORBIDDEN','This origin is not selected for the native collaboration deployment.',403);
      this.store.assert();await entry.hocus.hooks('onUpgrade',{request,socket,head,instance:entry.hocus});
      requireValue(entry.status==='running','DEPLOYMENT_NOT_RUNNING','The original deployment is stopping.',409);
      entry.adapter.handleUpgrade(request,socket,head);
    }catch(error){
      if(!socket.destroyed){const status=error.status??500;socket.end('HTTP/1.1 '+status+' Rejected\r\nConnection: close\r\nContent-Length: 0\r\n\r\n',()=>socket.destroy());}
    }
  }
  async settle(entry){
    // This waits for original hook work, rather than releasing custody on a timer.
    while(entry.tasks.size)await Promise.allSettled([...entry.tasks]);
  }
  async stop(projectId){
    const entry=this.entries.get(projectId);
    if(!entry)return {projectId,stoppedAt:this.store.local(projectId)?.stoppedAt??now(),state:'stopped',alreadyStopped:true};
    if(entry.stopPromise)return entry.stopPromise;
    entry.stopPromise=this.drainEntry(entry).catch(error=>{entry.lastError=publicError(error);entry.stopPromise=null;throw error;});
    return entry.stopPromise;
  }
  async drainEntry(entry){
    entry.status='stopping';clearInterval(entry.reauth);
    this.store.setLocal(entry.projectId,{...this.store.local(entry.projectId),status:'stopping',observedAt:now()});
    for(const peer of entry.peers)peer.websocket.close(1012,'Original deployment is draining');
    const connections=new Set([...entry.connections,...[...entry.hocus.documents.values()].flatMap(d=>d.getConnections())]);
    await Promise.allSettled([...connections].map(c=>c.waitForPendingMessages()));
    entry.hocus.closeConnections();
    // These are the same application-owned sockets the HTTP owner previously
    // destroyed after workspace.close(). Accepted native messages have drained;
    // close their physical transports while the original Store is still open.
    for(const socket of entry.sockets.keys())socket.destroy();
    while(entry.sockets.size)await Promise.allSettled([...entry.sockets.values()]);
    await Promise.allSettled([...entry.hocus.loadingDocuments.values()]);
    await this.settle(entry);
    entry.hocus.closeConnections();
    await this.settle(entry);
    for(const document of [...entry.hocus.documents.values()]){
      if(document.isLoading)continue;
      await entry.hocus.storeDocumentHooks(document,{instance:entry.hocus,document,documentName:document.name,clientsCount:document.getConnectionsCount(),lastContext:{},lastTransactionOrigin:null},true);
    }
    await this.settle(entry);
    requireValue(!entry.persistenceErrors.size,'NATIVE_PERSISTENCE_FAILED','The original native document could not be durably stored. This deployment retains custody for the same stop recovery.',503,{documents:[...entry.persistenceErrors.keys()]});
    for(const document of [...entry.hocus.documents.values()]){
      const release=await document.saveMutex.acquire();
      try{const selected=this.currentDocument(entry,document.name),receipt=this.store.nativeReceipt(entry.projectId,selected.id,selected.epochId),body=Y.encodeStateAsUpdate(document),vector=Y.encodeStateVector(document);
        requireValue(receipt&&receipt.sha256===sha(body)&&receipt.bytes===body.byteLength&&receipt.stateVectorSha256===sha(vector),'NATIVE_DRAIN_UNSAVED','Original in-memory Yjs state has not reached its durable receipt.',503);
      }finally{release();}
      await entry.hocus.unloadDocument(document);
    }
    await this.settle(entry);await Promise.allSettled([...entry.hocus.unloadingDocuments.values()]);
    requireValue(entry.hocus.getDocumentsCount()===0,'NATIVE_DRAIN_BUSY','The original native document still has owned work; retry this same stop after it drains.',423);
    requireValue(!entry.sockets.size&&!entry.peers.size,'NATIVE_TRANSPORT_BUSY','The original native transport still owns a connection.',423);
    if(!entry.destroyed){await entry.hocus.hooks('onDestroy',{instance:entry.hocus});entry.destroyed=true;}
    const stoppedAt=entry.stoppedAt??=now();this.store.setLocal(entry.projectId,{...this.store.local(entry.projectId),status:'stopped',stoppedAt,observedAt:stoppedAt});
    this.entries.delete(entry.projectId);return {projectId:entry.projectId,deploymentId:entry.deploymentId,stoppedAt,state:'stopped',documentsPersisted:true};
  }
  async close(){
    this.closing=true;
    // A successful native stop followed by a failed history commit is still
    // this original close's work; keep its exact entry/receipt for retry.
    for(const entry of this.entries.values())this.closingEntries.set(entry.projectId,entry);
    let first=null;
    for(const entry of [...this.closingEntries.values()]){
      try{
        const stopped=entry.closeReceipt??=await this.stop(entry.projectId);
        this.store.internal(entry.projectId,'host-close:'+entry.deploymentId+':'+entry.launchId,'deployment.host-closed',state=>{
          const deployment=state.deployments.find(d=>d.id===entry.deploymentId);
          if(deployment&&['running','stopping'].includes(deployment.status)){deployment.status='stopped';deployment.stoppedAt=stopped.stoppedAt;deployment.connections=[];}
          if(state.activeDeploymentId===entry.deploymentId)state.activeDeploymentId=null;
          return {deploymentId:entry.deploymentId,launchId:entry.launchId,...stopped};
        });
        this.closingEntries.delete(entry.projectId);
      }catch(error){first??=error;}
    }
    if(first)throw first;
  }
}
