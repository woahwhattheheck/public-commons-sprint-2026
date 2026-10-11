// SF97 local-only review surface. Browser stores nothing remotely.
(() => {
  'use strict';
  const source=JSON.parse(document.getElementById('case-data').textContent);
  const byId=id=>document.getElementById(id);
  const msg=message=>{byId('message').textContent=message};
  const rows=source.milestones.map(m=>({id:m.id,select:document.querySelector(`select[data-id="${CSS.escape(m.id)}"]`),input:document.querySelector(`input[data-evidence="${CSS.escape(m.id)}"]`)}));
  function validate(d) {
    if(d?.schema!=='stellar-forge.pilot-conversion-review.v1'||d.pilotId!==source.pilotId||d.caseSha256!==source.caseSha||
      !Array.isArray(d.decisions)||d.decisions.length!==rows.length||typeof d.reviewer!=='string')throw Error('Review/case identity mismatch');
    rows.forEach((row,i)=>{const x=d.decisions[i];if(x.id!==row.id||!['OPEN','NEEDS_CHANGES','ACCEPTED'].includes(x.status)||typeof x.evidence!=='string')throw Error('Review milestone mismatch')});
  }
  byId('export').addEventListener('click',()=>{
    const review={schema:'stellar-forge.pilot-conversion-review.v1',pilotId:source.pilotId,caseSha256:source.caseSha,reviewer:byId('reviewer').value.trim(),decisions:rows.map(r=>({id:r.id,status:r.select.value,evidence:r.input.value.trim()}))};
    if(!review.reviewer){msg('Enter a reviewer name before exporting.');byId('reviewer').focus();return}
    try {validate(review);const b=new Blob([JSON.stringify(review,null,2)+'\n'],{type:'application/json'}),a=document.createElement('a'),u=URL.createObjectURL(b);a.href=u;a.download=`${source.pilotId}-review.json`;a.click();setTimeout(()=>URL.revokeObjectURL(u),3000);msg('Review saved locally. Run room.mjs finalize for a source-bound decision packet.')}catch(e){msg(e.message)}
  });
  byId('load').addEventListener('click',()=>byId('upload').click());
  byId('upload').addEventListener('change',async e=>{
    const f=e.target.files?.[0];if(!f)return;if(f.size>200000){msg('Review file exceeds 200 KB');return}
    try{const d=JSON.parse(await f.text());validate(d);byId('reviewer').value=d.reviewer;rows.forEach((r,i)=>{r.select.value=d.decisions[i].status;r.input.value=d.decisions[i].evidence});msg('Saved private review loaded into this page.')}catch(err){msg(err.message)}finally{e.target.value=''}
  });
})();
