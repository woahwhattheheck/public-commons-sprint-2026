// MIT. A fresh process preserves the original SF88 exit and single-attempt state.
import {initializeQueue,openQueue} from '../../../sf88-operator-buyer-cli/queue.mjs';
import {errorView} from '../common.mjs';

const [mode,root,intentId,configuration,workspace]=process.argv.slice(2);
const controller=new AbortController();
const send=message=>{if(process.connected)process.send(message)};
process.on('message',message=>{if(message?.type==='cancel')controller.abort(new Error('OPERATOR_CANCELLED'))});
process.on('disconnect',()=>controller.abort(new Error('PARENT_WORKSPACE_DISCONNECTED')));
for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>controller.abort(new Error(signal)));
let queue,value=null,error=null;
try{
  await initializeQueue(root,{resume:true});queue=await openQueue(root);
  if(mode==='prepare'||mode==='execute'||mode==='cancel'){
    value=await queue.enqueue(configuration);send({type:'queue',value});
    if(mode!=='prepare'&&!value.attempt){
      if(mode==='cancel'||controller.signal.aborted)value=await queue.cancel(intentId);
      else value=await queue.run(intentId,{signal:controller.signal,...(workspace==='-'?{}:{workspace})});
    }
  }else if(mode==='recover')value=await queue.recover(intentId);
  else throw new Error('Unknown original native queue operation');
}catch(caught){
  error=errorView(caught);
  if(queue)try{value=await queue.show(intentId)}catch{}
  process.exitCode=process.exitCode||1;
}finally{
  send({type:'result',value,error});
  if(process.connected)process.disconnect();
}
