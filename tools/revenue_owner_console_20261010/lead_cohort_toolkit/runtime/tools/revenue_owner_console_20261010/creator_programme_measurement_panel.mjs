/** Existing creator programme measurement form; host supplies its original save/API callbacks. */
export function renderCreatorMeasurementPanel(){
 return '<section id="creator-measurement-panel" class="panel" hidden><h2>Activation and return-use measurement</h2>'+
 '<p>Use the current programme’s original attribution, source editions and financial operations. Choose an explicit observation window and evidence coverage.</p>'+
 '<p id="cm-source"></p><p id="cm-status" role="status"></p>'+
 '<form id="creator-measurement-form"><div class="grid">'+
 '<label>Observation cutoff in UTC (blank uses preview time)<input name="asOf" placeholder="2026-10-13T12:00:00Z"></label>'+
 '<label>Activation window in hours<input name="activationWithinHours" type="number" min="1" max="87600" step="1" required></label>'+
 '<label>Currency minor-unit exponent<input name="currencyMinorUnitExponent" type="number" min="0" max="6" step="1" required></label>'+
 '<label>Cohort starts at (blank uses programme start)<input name="cohortStartAt" placeholder="UTC ISO timestamp"></label>'+
 '<label>Cohort ends before (blank uses programme end)<input name="cohortEndAt" placeholder="UTC ISO timestamp"></label>'+
 '<label>Account population coverage<select name="accountPopulation"><option value="unknown">Unknown</option><option value="partial">Partial</option><option value="complete">Complete</option></select></label>'+
 '<label>Actual cost ledger coverage<select name="costLedger"><option value="unknown">Unknown</option><option value="partial">Partial</option><option value="complete">Complete</option></select></label>'+
 '<label>Uncertainty model<select name="uncertainty"><option value="descriptive">Descriptive rates</option><option value="wilson-binomial-95">Conditional Wilson 95% interval</option></select></label></div>'+
 '<label><input name="binomialAssumptionAccepted" type="checkbox"> I selected the independent Bernoulli / common-probability assumption for the conditional interval.</label>'+
 '<label>Coverage evidence or reason<textarea name="coverageEvidence" rows="3" required></textarea></label>'+
 '<label>Return windows (complete JSON array, measured after first qualifying activation)<textarea name="returnWindows" rows="5" required spellcheck="false"></textarea></label>'+
 '<label>Return event kinds (JSON array)<textarea name="returnEventKinds" rows="2" required spellcheck="false"></textarea></label>'+
 '<label>Exact source coverage (JSON array)<textarea name="coverage" rows="6" required spellcheck="false"></textarea></label>'+
 '<details><summary>Decision thresholds and exact source coverage fields</summary><p>Leave thresholds as null until a rule is selected. A coverage row names coverageId, sourceId, sourceRevision, sourceSha256, accountIds (&quot;*&quot; or exact IDs), eventKinds, fromAt, throughAt, status and evidence. Completeness belongs to that exact included source edition.</p>'+
 '<label>Selected decision thresholds (JSON object or null)<textarea name="thresholds" rows="6" spellcheck="false"></textarea></label>'+
 '<pre id="cm-native-sources"></pre></details>'+
 '<div class="actions"><button type="submit" data-cm="preview">Prepare measurement</button><button type="button" data-cm="save">Save definition in this programme</button>'+
 '<button type="button" data-cm="refresh">Use current source, keep definition</button><button type="button" data-cm="reset">Reopen saved definition</button></div></form>'+
 '<section><h3>Open a complete saved measurement</h3><label>Public measurement JSON or private working record<input id="cm-reopen-file" type="file" accept=".json,application/json"></label>'+
 '<button type="button" data-cm="reopen">Reopen selected record</button></section>'+
 '<section id="cm-output" hidden><h3>Prepared source-bound result</h3><p id="cm-result-identity"></p><div id="cm-downloads" class="actions"></div>'+
 '<button type="button" data-cm="retain">Save complete working measurement in this customer</button><p>The complete native source and report are retained as an internal working file. Customer packages use their own explicit file selections.</p>'+
 '<details><summary>Measurement report</summary><div id="cm-summary"></div></details></section></section>';
}
