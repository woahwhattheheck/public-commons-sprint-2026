// Execute the maintained receiver classes with explicit filesystem and Applications adapters.
export async function runManagedOwnerClosureCourse(files,C){
  const products=['replication-workbench'];
  const checks=[],check=(yes,name)=>{if(!yes)throw Error(name);checks.push(name);},clone=v=>JSON.parse(JSON.stringify(v));
  const canonical=v=>v===null||typeof v!=='object'?JSON.stringify(v):Array.isArray(v)?'['+v.map(canonical).join(',')+']':'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}';
  const same=(a,b)=>canonical(a)===canonical(b),tick=async()=>{for(let n=0;n<160;n++)await Promise.resolve();};
  const deferred=()=>{let release;const promise=new Promise(r=>release=r);return{promise,release};};
  const need=(yes,code,message)=>{if(!yes)throw Object.assign(Error(message??code),{code});};
  const rows=[];
  for(const product of products){
    const s=files['products/'+product+'/receiving.mjs'];need(typeof s==='string','SOURCE_REQUIRED',product);
    const start=s.indexOf('class Course{'),end=s.indexOf('\nexport async function main',start);
    need(start>=0&&end>start,'COMPLETE_CLASS_REQUIRED',product);
    const events=[],disk=new Map(),pendingPrimary=deferred(),pendingManager=deferred(),pendingOther=deferred(),pendingFirstWrite=deferred();
    let failReceiptWrite=true,finalWriteFailures=0,managerFailure=true,serialMode=false,serialFailure=false,serialHold=false,saveActive=0,maxSaveActive=0,leaseReleased=false;
    const now=()=>new Date().toISOString(),err=e=>({code:e.code??'AUTHORED_ERROR',message:e.message});
    const identity=async path=>{need(disk.has(path),'ENOENT');const b=C.utf8Encode(JSON.stringify(disk.get(path),null,2)+'\n');return{bytes:b.length,sha256:C.sha256(b)};};
    const save=async(path,value,{immutable=false}={})=>{
      const snapshot=clone(value);
      if(immutable&&disk.has(path)){need(same(disk.get(path),snapshot),'RECORD_CHANGED');return identity(path);}
      if(path.endsWith('/operation.json')){
        saveActive++;maxSaveActive=Math.max(maxSaveActive,saveActive);
        try{
          if(finalWriteFailures>0&&snapshot.hosts?.receiving?.starts?.[0]?.closed){finalWriteFailures--;events.push('final-journal-failure');throw Error('authored final close journal outage');}
          if(serialMode){events.push('write-begin-'+snapshot.counter);if(serialHold){serialHold=false;await pendingFirstWrite.promise;}if(serialFailure){serialFailure=false;throw Error('authored operation write failure');}}
          if(failReceiptWrite&&Object.keys(snapshot.files??{}).some(p=>p.includes('receiving-')&&p.endsWith('-closed.json'))){failReceiptWrite=false;throw Error('authored lost receipt journal write');}
          disk.set(path,snapshot);if(serialMode)events.push('write-end-'+snapshot.counter);
        }finally{saveActive--;}
      }else disk.set(path,snapshot);
      return identity(path);
    };
    const join=(...parts)=>parts.join('/').replace(/\/{2,}/g,'/'),resolve=(...parts)=>{let result='';for(const part of parts)result=part.startsWith('/')?part:join(result,part);return result;},child=(root,path)=>{need(path.startsWith(root+'/'),'PATH');return path.slice(root.length+1);};
    const json=async path=>{need(disk.has(path),'ENOENT');return clone(disk.get(path));},exists=async path=>disk.has(path);
    let serial=0;const randomUUID=()=> '00000000-0000-4000-8000-'+String(++serial).padStart(12,'0');
    let h;const Course=new Function('save','exists','json','identity','join','resolve','child','same','need','now','err','delay','process','openRuntimeWorkspace','randomUUID',s.slice(start,end)+';return Course;')(
      save,exists,json,identity,join,resolve,child,same,need,now,err,async()=>{},
      {stderr:{write(){throw Error('authored diagnostic sink failure');}},stdout:{write(){}}},
      async()=>{events.push('observer-reopen');return h.apps;},randomUUID);
    const lease={assert(){need(!leaseReleased,'LEASE_RELEASED');}};
    h=product==='hive-routing-workbench'?new Course({directory:'/operation','merchant-workspace':'/runtime'}, {},{},lease):
      new Course('/operation',{merchant:{workspace:'/runtime'}},{},{operationId:'original'},lease);
    h.bound=true;h.path='/operation/operation.json';h.root='/operation';h.directory='/operation';
    const makeHost=name=>({applicationId:'app-'+name,starts:[{stage:'original',requestId:'request-'+name,reviewId:'review-'+name,applicationId:'app-'+name,dispatch:'entered',closed:false}]});
    h.state={id:'receiving-original',hosts:{primary:makeHost('primary'),receiving:makeHost('receiving')},files:{},errors:[]};
    const present=new Set(['request-primary','request-receiving']),stopped=new Set(),startCalls=[],stopCalls=[];
    h.apps={
      applicationsOutput:async({applicationId,operationId})=>{
        if(!present.has(operationId))throw Object.assign(Error('absent original run'),{code:'ENOENT'});
        return{operationId,active:!stopped.has(operationId),phase:stopped.has(operationId)?'SUCCEEDED':'RUNNING',commandResult:stopped.has(operationId)?{operation:'original-command',completedAt:now(),state:'STOPPED',launched:true,exitCode:0,signal:null}:null};
      },
      applicationsStart:async args=>{startCalls.push(clone(args));present.add(args.requestId);return{operationId:args.requestId};},
      applicationsStop:async({applicationId,operationId})=>{
        stopCalls.push({applicationId,operationId});events.push('stop-'+operationId);
        if(operationId==='request-primary')await pendingPrimary.promise;
        stopped.add(operationId);
        if(operationId!=='request-primary')return{schema:'stellar-forge.application-run-cancellation.v1',applicationId,operationId,state:'CANCELLED',launched:false,completedAt:now()};
        return{operationId,stopping:true};
      },
      close:async()=>events.push('observer-closed')
    };
    h.manager={close:async()=>{events.push('manager-close');if(managerFailure){managerFailure=false;throw Error('authored manager close failure');}await pendingManager.promise;events.push('manager-closed');}};
    h.call=async(name,args)=>{events.push('alias-'+name);return{workspaces:[]};};
    if(product==='collaborative-documents')h.owners.set('retained-editor',{close:async()=>{events.push('other-close');await pendingOther.promise;events.push('other-closed');}});
    if(product==='hive-routing-workbench')h.browserOwners.add({close:async()=>{events.push('other-close');await pendingOther.promise;events.push('other-closed');}});
    let finished=false;const first=h.close(),again=h.close();check(first===again,product+': concurrent close joins one retained drain');
    first.then(()=>{finished=true;});
    await tick();
    check(stopCalls.some(x=>x.operationId==='request-receiving')&&stopCalls.some(x=>x.operationId==='request-primary')&&events.includes('manager-close')&&!finished,product+': all independent shutdowns enter while the first owner is held');
    check(h.state.hosts.receiving.starts[0].closed&&stopCalls.filter(x=>x.operationId==='request-receiving').length===1,product+': a saved positive receipt survives its lost journal acknowledgement without repeating Stop');
    check(!events.some(x=>x.startsWith('alias-'))&&!leaseReleased,product+': whole close leaves aliases to the manager and retains the original lease');
    pendingPrimary.release();await tick();
    check(!finished&&events.includes('observer-closed'),product+': Applications closes independently while manager or other retained owners remain pending');
    pendingManager.release();pendingOther.release();await first;
    check(h.state.hosts.primary.starts[0].closed&&h.state.hosts.receiving.starts[0].closed&&maxSaveActive===1,product+': all exact proofs complete with serialized durable operation writes');
    h.state.hosts.receiving.starts[0].closed=false;
    h.apps={close:async()=>events.push('late-observer-closed')};
    finalWriteFailures=2;
    await h.close();
    check(finalWriteFailures===0&&disk.get(h.path).hosts.receiving.starts[0].closed&&events.filter(v=>v==='final-journal-failure').length===2,product+': final run-closed and diagnostic writes can fail before complete durable closure retries');
    const callsBefore=stopCalls.length;h.state.hosts.receiving.starts[0].closed=false;
    await h.stop('receiving');check(stopCalls.length===callsBefore&&h.state.hosts.receiving.starts[0].closed,product+': cold retained-proof replay marks the same original run closed without another native Stop');
    h.state.hosts.selected=makeHost('selected');h.state.hosts.selected.starts[0].dispatch='selected';
    h.apps={applicationsOutput:async()=>{throw Object.assign(Error('absent'),{code:'ENOENT'});},applicationsStart:async args=>startCalls.push(clone(args)),applicationsStop:async args=>stopCalls.push(clone(args))};
    const priorStarts=startCalls.length,priorStops=stopCalls.length;await h.stop('selected');
    check(startCalls.length===priorStarts&&stopCalls.length===priorStops&&h.state.hosts.selected.starts[0].cancelledBeforeDispatch,product+': positively unentered original selection closes without dispatch');
    h.state.hosts.uncertain=makeHost('uncertain');h.state.hosts.uncertain.starts[0].dispatch='dispatching';
    h.apps.applicationsStop=async args=>{stopCalls.push(clone(args));return{schema:'stellar-forge.application-run-cancellation.v1',...args,state:'CANCELLED',launched:false,completedAt:now()};};
    await h.stop('uncertain');check(startCalls.at(-1).requestId==='request-uncertain'&&startCalls.at(-1).reviewId==='review-uncertain'&&h.state.hosts.uncertain.starts[0].closed,product+': uncertain entry reconciles the exact saved Start before original cancellation');
    serialMode=true;serialHold=true;events.length=0;h.state.counter=1;const one=h.save();h.state.counter=2;const two=h.save();await tick();
    check(same(events,['write-begin-1']),product+': a later state snapshot cannot overtake a pending earlier durable write');pendingFirstWrite.release();await Promise.all([one,two]);
    serialFailure=true;h.state.counter=3;let failed=false;try{await h.save();}catch{failed=true;}h.state.counter=4;await h.save();
    check(failed&&disk.get(h.path).counter===4&&maxSaveActive===1,product+': rejected writes remain visible and a later exact retry can commit');
    leaseReleased=true;rows.push({product,positiveStopCalls:stopCalls.length,retainedProofs:[...disk.keys()].filter(p=>p.endsWith('-closed.json')).length,maxConcurrentStateWrites:maxSaveActive});
  }
  return{schema:'stellar-forge.managed-owner-closure-course.v1',passed:checks.length,checks,products:rows,execution:'Actual complete maintained Replication Course class with authored filesystem, Applications, process-output and deferred-owner adapters. No native process, rendered browser or customer operation executed.'};
}
