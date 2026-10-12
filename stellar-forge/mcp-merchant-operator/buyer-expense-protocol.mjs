import { buyerExpenseTools, SPECS, PREFIX, workspace, enums, range, text, record, mutation, alias, actor, center, labels, period, coding, object, sha, reason, request, number, date } from './catalog/buyer-expenses.mjs';
export { PREFIX, buyerExpenseTools } from './catalog/buyer-expenses.mjs';
// MIT. Shared customer tool contract; original SF36 methods retain all financial semantics.
import { MAX_RETAINED_CHUNK_BYTES } from './retained-file-reads.mjs';





















export const BUYER_EXPENSE_ACTIONS = Object.freeze(Object.fromEntries(SPECS.map(([name, description, properties, required, readOnly]) =>
  [name, { description, inputSchema: object(properties, required), readOnly }])));

export function validateBuyerExpenseArguments(action,args) {
  const definition=BUYER_EXPENSE_ACTIONS[action];
  const invalid=message=>{throw Object.assign(new Error(message),{code:'BUYER_EXPENSE_ARGUMENTS'});};
  if(!definition)invalid('Choose an original buyer expense action.');
  function visit(value,spec,path) {
    if(spec.enum&&!spec.enum.includes(value))invalid(path+' must use a declared choice.');
    if(spec.type==='object'){
      if(value===null||typeof value!=='object'||Array.isArray(value))invalid(path+' must be an object.');
      if(Object.keys(value).some(k=>!Object.hasOwn(spec.properties,k))||(spec.required??[]).some(k=>!Object.hasOwn(value,k)))invalid(path+' needs exactly its declared fields.');
      for(const [k,v] of Object.entries(value))visit(v,spec.properties[k],path+'.'+k);
    }else if(spec.type==='array'){
      if(!Array.isArray(value)||(spec.minItems!==undefined&&value.length<spec.minItems)||(spec.maxItems!==undefined&&value.length>spec.maxItems))invalid(path+' must be an array within its declared count.');
      value.forEach((v,i)=>visit(v,spec.items,path+'['+i+']'));
    }else if(spec.type==='integer'){
      if(!Number.isSafeInteger(value)||(spec.minimum!==undefined&&value<spec.minimum)||(spec.maximum!==undefined&&value>spec.maximum))invalid(path+' must be an exact whole number within its declared range.');
    }else if(spec.type==='string'){
      if(typeof value!=='string'||(spec.minLength!==undefined&&value.length<spec.minLength)||(spec.maxLength!==undefined&&value.length>spec.maxLength)||(spec.pattern&&!new RegExp(spec.pattern).test(value)))invalid(path+' must preserve its declared original string format.');
    }else if(spec.type==='boolean'&&typeof value!=='boolean')invalid(path+' must be a boolean.');
  }
  visit(args,definition.inputSchema,action);
  if(action==='source_rebind'&&(Object.hasOwn(args,'ledger')===Object.hasOwn(args,'quoteSource')))invalid('source_rebind requires exactly one original ledger or quoteSource alias.');
  return definition;
}
