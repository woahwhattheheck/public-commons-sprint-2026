// MIT. Compare actual returned cells against the immutable released workbook.
import {cellAt,locateReturnedCell,valueText,requireValue} from './workbook.mjs';
import {clone,same,digest} from './contracts.mjs';
const visible=value=>({value:value.value,formula:value.formula});
const cellKey=(sheet,cell)=>JSON.stringify([sheet,cell]);
export function compareReturn(released,returned,bindings){
  const covered=new Set(),mapped=[];
  for(const binding of bindings){
    const before=cellAt(released,binding.sheet,binding.cell);
    let located=null,error=null;
    try{located=locateReturnedCell(returned,binding);}catch(failure){error=failure.code??'TEMPLATE_RETURN_CELL_UNAVAILABLE';}
    const after=located?.value??null,changed=error!==null||!same(visible(before),visible(after));
    covered.add(cellKey(binding.sheet,binding.cell));
    if(located)covered.add(cellKey(located.sheet,located.cell));
    mapped.push({bindingId:binding.id,resultId:binding.resultId,editionId:binding.editionId,
      resultSetId:binding.resultSetId,rowId:binding.rowId,fieldId:binding.fieldId,component:binding.component,source:clone(binding.source),
      released:{sheet:binding.sheet,cell:binding.cell,value:before},
      returned:located?{sheet:located.sheet,cell:located.cell,value:after}:null,
      identity:binding.rowIdentity?'original-result-id':'fixed-cell',
      moved:Boolean(located&&located.cell!==binding.cell),changed,error,
      correctionEligible:binding.source.kind==='answer'&&binding.component==='value'&&!error&&after?.formula===null&&
        !['error','date'].includes(after?.value?.type),
      csvLiteralPrefix:binding.csvLiteralPrefix===true});
  }
  const originalCells=new Map(released.sheets.flatMap(s=>s.cells.map(c=>[cellKey(s.name,c.address),{sheet:s.name,...c}])));
  const returnedCells=new Map(returned.sheets.flatMap(s=>s.cells.map(c=>[cellKey(s.name,c.address),{sheet:s.name,...c}])));
  const keys=new Set([...originalCells.keys(),...returnedCells.keys()]),unmappedCells=[];
  for(const key of keys){
    if(covered.has(key))continue;
    const before=originalCells.get(key)??null,after=returnedCells.get(key)??null;
    if(!same(before,after))unmappedCells.push({sheet:before?.sheet??after.sheet,cell:before?.address??after.address,before,after});
  }
  const beforeParts=new Map(released.originalParts.map(p=>[p.path,p])),afterParts=new Map(returned.originalParts.map(p=>[p.path,p]));
  const changedParts=[...new Set([...beforeParts.keys(),...afterParts.keys()])].filter(p=>!same(beforeParts.get(p)??null,afterParts.get(p)??null))
    .map(path=>({path,before:beforeParts.get(path)??null,after:afterParts.get(path)??null}));
  const result={schema:'sf88-template-return-comparison/v1',releasedSha256:released.sha256,returnedSha256:returned.sha256,
    mapped,unmappedCells,changedParts,sheets:{before:released.sheets.map(s=>({name:s.name,state:s.state,kind:s.kind,merged:s.merged,protected:s.protected})),
      after:returned.sheets.map(s=>({name:s.name,state:s.state,kind:s.kind,merged:s.merged,protected:s.protected}))},
    counts:{mapped:mapped.length,changedMapped:mapped.filter(m=>m.changed).length,
      unavailableMapped:mapped.filter(m=>m.error!==null).length,movedMapped:mapped.filter(m=>m.moved).length,
      unmappedCellChanges:unmappedCells.length,changedPackageParts:changedParts.length},
    calculation:'Formula expressions and cached values are displayed as supplied; formulas are not executed.',
    retention:'The complete original client file is retained, including all unmapped edits and package parts.'};
  return {...result,fingerprint:digest(result)};
}
export function reviewedDecisions(raw,comparison){
  requireValue(Array.isArray(raw),'TEMPLATE_DECISIONS_REQUIRED');
  const changed=comparison.mapped.filter(x=>x.changed),choices=new Map();
  for(const decision of raw){
    requireValue(decision&&typeof decision==='object'&&typeof decision.bindingId==='string'&&!choices.has(decision.bindingId),'TEMPLATE_DECISION_DUPLICATE');
    requireValue(['keep-release','propose-correction','client-only'].includes(decision.disposition),'TEMPLATE_DECISION_INVALID');
    requireValue(typeof decision.note==='string'&&decision.note.trim().length>0&&decision.note.length<=5000,'TEMPLATE_DECISION_NOTE_REQUIRED');
    choices.set(decision.bindingId,decision);
  }
  requireValue(choices.size===changed.length&&changed.every(x=>choices.has(x.bindingId)),'TEMPLATE_COMPLETE_RETURN_REVIEW_REQUIRED');
  return changed.map(change=>{
    const selected=choices.get(change.bindingId);
    if(selected.disposition==='propose-correction'){
      requireValue(change.correctionEligible,'TEMPLATE_RETURN_CORRECTION_UNAVAILABLE');
      requireValue(change.identity!=='fixed-cell'||selected.fixedCellConfirmed===true,'TEMPLATE_FIXED_CELL_REVIEW_REQUIRED');
    }
    return {bindingId:change.bindingId,disposition:selected.disposition,note:selected.note,
      fixedCellConfirmed:selected.fixedCellConfirmed===true,changeFingerprint:digest(change)};
  });
}
export function returnedTypedValue(change,original){
  const value=change.returned?.value?.value;
  requireValue(change.correctionEligible&&value,'TEMPLATE_RETURN_CORRECTION_UNAVAILABLE');
  if(value.type==='blank')return ['NoneType',null];
  let lexical=valueText(value);
  if(change.csvLiteralPrefix&&lexical.startsWith("'"))lexical=lexical.slice(1);
  if(original[0]==='number'){
    requireValue(/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/u.test(lexical),'TEMPLATE_RETURN_DECIMAL_REQUIRED');
    return ['number',lexical];
  }
  if(original[0]==='bool'){
    requireValue(value.type==='boolean'||['TRUE','FALSE'].includes(lexical),'TEMPLATE_RETURN_BOOLEAN_REQUIRED');
    return ['bool',value.type==='boolean'?value.value:lexical==='TRUE'];
  }
  // JSON/array/object edits require the original extraction form's explicit JSON
  // editor. Retain them as client-only rather than guessing a structure.
  requireValue(['str','NoneType'].includes(original[0]),'TEMPLATE_RETURN_USE_ORIGINAL_JSON_EDITOR');
  return ['str',lexical];
}
