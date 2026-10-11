// MIT. Owner-entered terms for the original SF77 builder. Browser memory only; no network/storage.
const deliveryFields={deliveryScope:'scope',deliverables:'deliverables',acceptanceCriteria:'acceptanceCriteria'};

// Shared conversion for the original form and host-configured merchant operator.
// This keeps unfinished form values in SF74; SF77 still validates a proposal.
export function termsDocumentFromDraft(values) {
  if(!values||typeof values!=='object'||Array.isArray(values))throw new Error('Unknown owner terms draft shape.');
  const keys=['workOrderRef','sellerDisplayName','relationshipOwner','proposedWindow','consentStatus','consentReceipt',
    'priceApproval','feeUsd','costUsd','approvalReceipt',...Object.keys(deliveryFields)];
  if(Object.keys(values).some(key=>!keys.includes(key)))throw new Error('Unknown owner terms draft field.');
  const draft={...Object.fromEntries(Object.keys(deliveryFields).map(key=>[key,''])),...values};
  for(const key of keys)if(typeof draft[key]!=='string'||draft[key].length>8192)throw new Error('Invalid '+key+' draft.');
  if(!['NOT_RECORDED','CONFIRMED'].includes(draft.consentStatus)||
      !['NOT_APPROVED','OWNER_APPROVED_PROPOSAL'].includes(draft.priceApproval))throw new Error('Unknown owner terms draft status.');
  const approved=draft.priceApproval==='OWNER_APPROVED_PROPOSAL',confirmed=draft.consentStatus==='CONFIRMED';
  if(approved)for(const key of ['feeUsd','costUsd'])if(!/^-?(?:\d+|\d*\.\d+)(?:[eE][+-]?\d+)?$/.test(draft[key])||!Number.isFinite(Number(draft[key])))
    throw new Error('Provide the recorded '+key+' value before preparing the proposal.');
  const delivery=Object.fromEntries(Object.entries(deliveryFields).map(([name,key])=>[key,draft[name].trim()]));
  return {workOrderRef:draft.workOrderRef.trim(),sellerDisplayName:draft.sellerDisplayName.trim(),
    relationshipOwner:draft.relationshipOwner.trim(),proposedWindow:draft.proposedWindow.trim()||'UNSCHEDULED',
    ...(Object.values(delivery).some(Boolean)?{delivery}:{}),
    merchantConsent:{status:draft.consentStatus,receiptUrl:confirmed?draft.consentReceipt.trim():null},
    commercial:{priceApproval:draft.priceApproval,feeUsd:approved?Number(draft.feeUsd):null,
      costUsd:approved?Number(draft.costUsd):null,approvalReceiptUrl:approved?draft.approvalReceipt.trim():null}};
}

export function termsDraftFromDocument(doc) {
  const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
  if(!object(doc)||!object(doc.merchantConsent)||!object(doc.commercial))
    throw new Error('Choose a terms file with merchantConsent and commercial fields.');
  if(doc.delivery!==undefined&&(!object(doc.delivery)||Object.keys(doc.delivery).some(key=>!Object.values(deliveryFields).includes(key))))
    throw new Error('Invalid owner delivery terms.');
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
    approvalReceipt:string(doc.commercial.approvalReceiptUrl,'owner approval record URL'),
    ...Object.fromEntries(Object.entries(deliveryFields).map(([name,key])=>[name,string(doc.delivery?.[key],key,8192)]))};
}

export function mountTermsEditor(container, {onChange=()=>{}}={}) {
  container.innerHTML=`
    <div class="form-grid">
      <label>Work order reference <small>Your reference for this proposed scope</small><input name="workOrderRef" data-label="Work order reference" required maxlength="120" autocomplete="off" placeholder="Your internal reference"></label>
      <label>Seller name <small>The actual merchant this work is for</small><input name="sellerDisplayName" data-label="Seller name" required maxlength="200" autocomplete="off" placeholder="Merchant or organization"></label>
      <label>Relationship owner <small>Person responsible for this merchant and the offer</small><input name="relationshipOwner" data-label="Relationship owner" required maxlength="200" autocomplete="off" placeholder="Owner name"></label>
      <label>Proposed delivery window <small>Optional; leave blank if no window has been agreed</small><input name="proposedWindow" data-label="Proposed delivery window" autocomplete="off" placeholder="Unscheduled"></label>
    </div>
    <h3>Work to deliver</h3>
    <p>Record the scope and criteria supplied by the owner. These entries describe the proposed work; they do not mark it complete.</p>
    <div class="form-grid">
      <label class="full">Scope and exclusions<small>The exact operation, source period and service boundary</small><textarea name="deliveryScope" data-label="Delivery scope" maxlength="8192" rows="3" placeholder="Work included and any agreed exclusions"></textarea></label>
      <label class="full">Deliverables<small>What the merchant should receive</small><textarea name="deliverables" data-label="Deliverables" maxlength="8192" rows="3" placeholder="Concrete outputs and handoff items"></textarea></label>
      <label class="full">Acceptance criteria<small>How the merchant and operator will review the result</small><textarea name="acceptanceCriteria" data-label="Acceptance criteria" maxlength="8192" rows="3" placeholder="Observable completion criteria and agreed review"></textarea></label>
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
      : 'The packet will withhold price. You can still prepare the workorder from its original sources.';
  }
  function read() {
    sync();
    for(const field of Object.values(fields)) {
      if(field.required&&!field.disabled&&!field.value.trim())throw new Error('Provide '+field.dataset.label.toLowerCase()+'.');
      if(!field.checkValidity()) {field.reportValidity();throw new Error('Check '+field.dataset.label.toLowerCase()+'.');}
    }
    return termsDocumentFromDraft(Object.fromEntries(Object.entries(fields).map(([name,field])=>[name,field.value])));
  }

  function load(terms) {
    // Validate the complete shape before replacing fields; a failed import leaves current terms intact.
    const values=termsDraftFromDocument(terms);
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
        Object.keys(values).some(name=>!Object.hasOwn(fields,name)))
      throw new Error('Unknown owner terms draft shape.');
    // Earlier original cases have no delivery fields; their existing raw entries stay intact.
    const normalized={...values};
    for(const name of Object.keys(deliveryFields))if(!Object.hasOwn(normalized,name))normalized[name]='';
    for(const [name,field] of Object.entries(fields)) {
      const value=normalized[name];
      if(typeof value!=='string'||value.length>8192||
          (field.maxLength>0&&value.length>field.maxLength))
        throw new Error('Invalid '+field.dataset.label+' draft.');
      // Preserve browser-native values exactly, including select and number semantics.
      const probe=field.cloneNode(true);probe.value=value;
      if(probe.value!==value)throw new Error('Unrepresentable '+field.dataset.label+' draft.');
    }
    return normalized;
  }
  function loadDraft(values) {
    const normalized=validateDraft(values);
    for(const [name,value] of Object.entries(normalized))fields[name].value=value;
    sync();onChange();
  }
  container.addEventListener('input',()=>{sync();onChange();});
  container.addEventListener('change',()=>{sync();onChange();});
  sync();
  return {read,load,readDraft,validateDraft,loadDraft};
}
