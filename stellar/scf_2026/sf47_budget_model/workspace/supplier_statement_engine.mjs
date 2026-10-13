import { compileSupplierStatementReconciliationHistorical, verifySupplierStatementReconciliationHistorical, parseStrictJson } from './supplier_statement_engine/engine.mjs';
const MAX=16*1024*1024;let size=0;const chunks=[];
try{
  for await(const chunk of process.stdin){size+=chunk.length;if(size>MAX)throw Error('The complete reconciliation input exceeds 16 MiB.');chunks.push(chunk);}
  const value=parseStrictJson(Buffer.concat(chunks).toString('utf8'));
  if(!value||Object.keys(value).some(k=>!['input','asOf','receipt'].includes(k)))throw Error('Select the complete original reconciliation input.');
  const receipt=compileSupplierStatementReconciliationHistorical(value.input,{asOf:value.asOf});
  verifySupplierStatementReconciliationHistorical(value.receipt??receipt,value.input);
  process.stdout.write(JSON.stringify({ok:true,receipt})+'\n');
}catch(error){process.stdout.write(JSON.stringify({ok:false,error:{code:error.code??'SUPPLIER_ENGINE_INPUT',message:error.message}})+'\n');process.exitCode=1;}
