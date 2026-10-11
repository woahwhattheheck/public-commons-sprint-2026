// MIT. Owner-entered terms for the original SF77 builder. Browser memory only; no network/storage.
export function mountTermsEditor(container, {onChange=()=>{}}={}) {
  container.innerHTML=`
    <div class="form-grid">
      <label>Work order reference <small>Your reference for this proposed scope</small><input name="workOrderRef" data-label="Work order reference" required maxlength="120" autocomplete="off" placeholder="Your internal reference"></label>
      <label>Seller name <small>The actual merchant this work is for</small><input name="sellerDisplayName" data-label="Seller name" required maxlength="200" autocomplete="off" placeholder="Merchant or organization"></label>
      <label>Relationship owner <small>Person responsible for this merchant and the offer</small><input name="relationshipOwner" data-label="Relationship owner" required maxlength="200" autocomplete="off" placeholder="Owner name"></label>
      <label>Proposed delivery window <small>Optional; leave blank if no window has been agreed</small><input name="proposedWindow" data-label="Proposed delivery window" autocomplete="off" placeholder="Unscheduled"></label>
    </div>
    <h3>Existing seller permission</h3>
    <p>Select what is already recorded for this merchant. Preparing a work order does not obtain permission or send an offer.</p>
    <div class="form-grid">
      <label>Permission status <select name="consentStatus" data-label="Permission status"><option value="NOT_RECORDED">Not recorded</option><option value="CONFIRMED">Confirmed in an existing record</option></select></label>
      <label data-consent-receipt hidden>Permission record URL <small>Existing HTTPS record supplied by the relationship owner</small><input name="consentReceipt" data-label="Permission record URL" type="url" pattern="https://.+" autocomplete="off" placeholder="https://…" disabled></label>
    </div>
    <h3>Owner-approved proposal</h3>
    <p>A proposed price is separate from the seller accepting the work. Leave approval unrecorded until the commercial owner supplies the economics and approval record.</p>
    <div class="form-grid">
      <label class="full">Price approval <select name="priceApproval" data-label="Price approval"><option value="NOT_APPROVED">Not approved — withhold price from the packet</option><option value="OWNER_APPROVED_PROPOSAL">Proposal already approved by the owner</option></select></label>
      <label data-approved-price hidden>Approved fee · USD <small>Price proposed to the seller</small><input name="feeUsd" data-label="Approved fee" type="number" min="0.01" step="0.01" inputmode="decimal" autocomplete="off" placeholder="0.00" disabled></label>
      <label data-approved-price hidden>Approved delivery cost · USD <small>Owner-supplied cost to deliver the agreed scope</small><input name="costUsd" data-label="Approved delivery cost" type="number" min="0" step="0.01" inputmode="decimal" autocomplete="off" placeholder="0.00" disabled></label>
      <label data-approved-price class="full" hidden>Owner approval record URL <small>Existing HTTPS record approving this proposal and its economics</small><input name="approvalReceipt" data-label="Owner approval record URL" type="url" pattern="https://.+" autocomplete="off" placeholder="https://…" disabled></label>
    </div>
    <p data-terms-summary class="hint" aria-live="polite"></p>
    `;
  const fields=Object.fromEntries([...container.querySelectorAll('[name]')].map(el=>[el.name,el]));
  function showFields(selector,visible) {
    for(const label of container.querySelectorAll(selector)) {
      label.hidden=!visible;
      const input=label.querySelector('input');input.disabled=!visible;input.required=visible;
    }
  }
  function sync() {
    const consent=fields.consentStatus.value==='CONFIRMED';
    const approved=fields.priceApproval.value==='OWNER_APPROVED_PROPOSAL';
    showFields('[data-consent-receipt]',consent);showFields('[data-approved-price]',approved);
    container.querySelector('[data-terms-summary]').textContent=approved
      ? 'The packet will include the owner-approved proposal. Seller acceptance stays open.'
      : 'The packet will withhold price. You can still prepare an internal work order with the diagnosis.';
  }
  function read() {
    sync();
    for(const field of Object.values(fields)) {
      if(field.required&&!field.disabled&&!field.value.trim())throw new Error('Provide '+field.dataset.label.toLowerCase()+'.');
      if(!field.checkValidity()) {field.reportValidity();throw new Error('Check '+field.dataset.label.toLowerCase()+'.');}
    }
    const approved=fields.priceApproval.value==='OWNER_APPROVED_PROPOSAL';
    const confirmed=fields.consentStatus.value==='CONFIRMED';
    return {workOrderRef:fields.workOrderRef.value.trim(),sellerDisplayName:fields.sellerDisplayName.value.trim(),
      relationshipOwner:fields.relationshipOwner.value.trim(),proposedWindow:fields.proposedWindow.value.trim()||'UNSCHEDULED',
      merchantConsent:{status:fields.consentStatus.value,receiptUrl:confirmed?fields.consentReceipt.value.trim():null},
      commercial:{priceApproval:fields.priceApproval.value,feeUsd:approved?Number(fields.feeUsd.value):null,
        costUsd:approved?Number(fields.costUsd.value):null,approvalReceiptUrl:approved?fields.approvalReceipt.value.trim():null}};
  }
  function decodeTerms(doc) {
    const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
    if(!object(doc)||!object(doc.merchantConsent)||!object(doc.commercial))
      throw new Error('Choose a terms file with merchantConsent and commercial fields.');
    if(!['NOT_RECORDED','CONFIRMED'].includes(doc.merchantConsent.status)||
        !['NOT_APPROVED','OWNER_APPROVED_PROPOSAL'].includes(doc.commercial.priceApproval))
      throw new Error('The terms file has an unknown permission or price approval status.');
    const string=(value,label,max=Infinity)=>{
      if(value===null||value===undefined)return '';
      if(typeof value!=='string'||value.length>max)throw new Error('Invalid '+label+' in the terms file.');
      return value;
    };
    const number=(value,label)=>{
      if(value===null||value===undefined)return '';
      if(typeof value!=='number'||!Number.isFinite(value))throw new Error('Invalid '+label+' in the terms file.');
      return String(value);
    };
    return {workOrderRef:string(doc.workOrderRef,'work order reference',120),sellerDisplayName:string(doc.sellerDisplayName,'seller name',200),
      relationshipOwner:string(doc.relationshipOwner,'relationship owner',200),proposedWindow:string(doc.proposedWindow,'delivery window'),
      consentStatus:doc.merchantConsent.status,consentReceipt:string(doc.merchantConsent.receiptUrl,'permission record URL'),
      priceApproval:doc.commercial.priceApproval,feeUsd:number(doc.commercial.feeUsd,'fee'),costUsd:number(doc.commercial.costUsd,'cost'),
      approvalReceipt:string(doc.commercial.approvalReceiptUrl,'owner approval record URL')};
  }
  function load(terms) {
    // Validate the complete shape before replacing fields; a failed import leaves current terms intact.
    const values=decodeTerms(terms);
    for(const [name,value] of Object.entries(values))fields[name].value=value;
    sync();onChange();
  }
  // Case files must also preserve incomplete and currently hidden form entries.
  // These are raw drafts, not a validated SF77 proposal or an approval decision.
  function readDraft() {
    return validateDraft(Object.fromEntries(Object.entries(fields).map(([name,field])=>[name,field.value])));
  }
  function validateDraft(values) {
    if(!values||typeof values!=='object'||Array.isArray(values)||
        Object.keys(values).length!==Object.keys(fields).length||
        Object.keys(values).some(name=>!Object.hasOwn(fields,name)))
      throw new Error('Unknown owner terms draft shape.');
    for(const [name,field] of Object.entries(fields)) {
      const value=values[name];
      if(typeof value!=='string'||value.length>8192||
          (field.maxLength>0&&value.length>field.maxLength))
        throw new Error('Invalid '+field.dataset.label+' draft.');
      // Preserve browser-native values exactly, including select and number semantics.
      const probe=field.cloneNode(true);probe.value=value;
      if(probe.value!==value)throw new Error('Unrepresentable '+field.dataset.label+' draft.');
    }
    return values;
  }
  function loadDraft(values) {
    validateDraft(values);
    for(const [name,value] of Object.entries(values))fields[name].value=value;
    sync();onChange();
  }
  container.addEventListener('input',()=>{sync();onChange();});
  container.addEventListener('change',()=>{sync();onChange();});
  sync();
  return {read,load,readDraft,validateDraft,loadDraft};
}
