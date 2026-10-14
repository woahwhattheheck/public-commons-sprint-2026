/** Reconciliation controls on the existing Lead fulfillment screen. */
export function renderLeadReconciliationPanel(){
  return '<section id="reconciliation-panel" hidden aria-labelledby="reconciliation-title">'+
    '<div class="section-heading"><h2 id="reconciliation-title">Reconcile team records</h2></div>'+
    '<p>Review another team copy beside the current customer records. Choose useful incoming fields and match alternate company IDs. The complete incoming source, current baseline and reviewed result stay with this customer.</p>'+
    '<div id="reconciliation-list"></div>'+
    '<form id="reconciliation-form" hidden>'+
    '<div id="reconciliation-source-heading"></div>'+
    '<div class="actions"><a id="reconciliation-download" download>Download both sources and review</a></div>'+
    '<div id="reconciliation-brief"></div><div id="reconciliation-leads"></div><div id="reconciliation-assets"></div>'+
    '<label>Reason for these choices<textarea name="reason" rows="3" maxlength="4000" required></textarea></label>'+
    '<div id="reconciliation-preview" aria-live="polite"></div>'+
    '<div class="actions"><button id="preview-reconciliation" type="button">Review selected changes</button>'+
    '<button id="apply-reconciliation" type="submit" disabled>Save reconciled customer records</button></div>'+
    '</form></section>';
}
