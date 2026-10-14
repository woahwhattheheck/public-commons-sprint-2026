'use strict';
function checkRouteRecovery({originalRecorder,currentRecorder,originalFiles,currentFiles,recoveryInput,recoveryBody,deps}){
 const need=(ok,message)=>{if(!ok)throw Error(message);};
 let predecessorRejected=false;
 try{originalRecorder.verifyReceipts(currentFiles,deps);}
 catch(error){predecessorRejected=/Actual recipient differs/.test(error.message);}
 need(predecessorRejected,'Reproduce the current-route/historical-receipt defect');
 const prior=currentRecorder.verifyReceipts(originalFiles,deps);
 const current=currentRecorder.verifyReceipts(currentFiles,deps);
 need(current.receipts===prior.receipts+1,'Retain the original receipt and the recovered send');
 const wrongCurrent={...originalFiles};
 for(const item of recoveryInput.attachments)if(currentFiles[item.source_path]!==undefined)wrongCurrent[item.source_path]=currentFiles[item.source_path];
 let wrongTargetRejected=false;
 try{currentRecorder.recordDelivery(wrongCurrent,recoveryInput,recoveryBody,deps);}
 catch(error){wrongTargetRejected=/Actual recipient differs/.test(error.message);}
 need(wrongTargetRejected,'A new send must still match the current buyer route');
 const replay=currentRecorder.replay(currentFiles,deps.core,recoveryInput.history_path,deps.coreOptions);
 const result=currentRecorder.recordDelivery(currentFiles,recoveryInput,recoveryBody,deps);
 need(JSON.stringify(result.files)===JSON.stringify(currentFiles),'Repeating actual recovered send must preserve every source file');
 const outputs=currentRecorder.exportedFiles(currentFiles,replay.record,deps);
 return {original_receipts:prior.receipts,current_receipts:current.receipts,new_target_guard:true,repeat_unchanged:true,operations:replay.operations.length,customer_files:outputs};
}
module.exports={checkRouteRecovery};
