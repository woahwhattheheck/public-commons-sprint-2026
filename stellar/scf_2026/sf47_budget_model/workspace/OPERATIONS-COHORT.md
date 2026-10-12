# Cohort acceptance in the original SF47 case

Use **Delivery operations → Cohort acceptance** to review the original purchase population, accountable operators, useful merchant operations and deployed recovery outcomes against the acceptance proposal pinned to this case. The review becomes an immutable record in the existing Operations journal. **Tranche completion** can select that exact record and carry its complete evidence into the prepared form package.

The proposal comes from `deployment_acceptance_plan` in the case's saved SF47 scenario. Its seven-day and fourteen-day observation windows are the application's proposed delivery measurements. They do not replace the issuer's payment-based completion clock, establish an award, or record issuer acceptance. The source proposal's original wording and target counts are displayed and exported.

## Open the retained case

Start the original workspace as described in [README.md](README.md), choose **Delivery operations**, and select the existing case. Enter the recording operator. Original purchases can already be present through direct native observations, the maintained [SF88 receiving workflow](BUYER_OPERATIONS.md), or an existing complete case import.

Use the current case, source IDs, deployment IDs, purchase IDs and native history. The cohort pane does not create a new purchase population. **Export complete case** retains the original planner, operations, purchase history, sources, cohort reviews and prepared tranche forms together.

A case created from an older scenario without the acceptance proposal reports `COHORT_RULE_MISSING`. Adopt the intended saved planning revision through the existing planning/case workflow; the evaluator does not insert a second set of targets into that case.

## 1. Select the purchase window and actual scope

In **Window & scope**, choose tranche 2 or 3, give the review a useful name and enter the first and last UTC calendar dates. The window is inclusive: seven consecutive dates for the original tranche-2 proposal, fourteen for tranche 3. Enter **Observed through · original timezone** as the actual retained cutoff timestamp.

Purchase membership uses the original first-attempt time. Completion requires its actual settlement, complete output and applicable order completion within that purchase window. A cutoff after the window allows later observations to be described; it does not move a later output completion into the earlier window. A current operating case cannot freeze a future cutoff.

Select the existing buyer and merchant deployments in scope. Every original purchase remains visible. Rows outside the selected deployment/buyer scope are retained as excluded observations. Rows with no first-attempt clock remain explicitly unplaced. They are not silently removed from the coverage findings or assigned the time of a later read.

The evaluator distinguishes the latest original observation available at the cutoff from the current source record. A later void, output failure or first-attempt correction cannot change the earlier as-of observation. Later disagreements and current-state differences remain visible, and a new frozen review retains the full source history from which it was calculated.

### Coverage and award date

Use **Edit coverage** to retain the actual observation source and any gaps or truncation. The envelope of session timestamps is not continuous coverage. An unknown or partial history can be evaluated and frozen with its findings; it does not become complete acceptance evidence.

Use **Record actual award clock** only when the actual award-acceptance date and its source exist. The original planning calendar, prospective invitation or payment forecast does not fill this field. An unentered award date stays unestablished.

Two timing scopes are deliberately retained:

| Evidence | Evaluation interval |
| --- | --- |
| Purchase cohort and useful completion | Selected seven/fourteen UTC calendar days, with the original first attempt and actual completion in that window |
| Recovery, restore, support and required deployed work | Actual award acceptance through the observed cutoff and the pinned proposed tranche deadline; inclusion in the purchase window is reported separately |

The current pinned proposal uses award-relative finish days 90 and 150. The evaluator reads those values from the selected original proposal. Work completed earlier in the same tranche can therefore qualify without being incorrectly forced into its final purchase window.

## 2. Review accountable operators and the useful operation

In **Operators & operations**, review the original deployment classifications and operator identities. An external buyer or merchant must be an original buyer/merchant deployment in the required network environment, operating or handed over, with its retained source basis. Multiple hosts, wallets, sessions or agents under the same accountable operator count once.

The original purchase's captured team-operated classification stays separate from independent adoption. Selecting an external buyer later does not convert an original team-operated purchase into customer use or replace its captured buyer identity.

Add each useful merchant operation with:

- Its stable reviewed ID and label.
- The selected original merchant installation.
- The agreed resource, contract, scope and complete terms.
- The expected complete useful output.
- Its retained source IDs or an attributed original-source observation.

Use one reviewed operation ID only for the same useful operation. Similar URLs or unrelated provider catalogs do not establish equivalence.

Add actual facilitator services with their stable ID, name, accountable operator ID, service URL, participation class and source. Separate endpoints or self-hosted copies controlled by one operator count once. The source proposal may discuss candidate providers; a candidate is not a recorded deployed facilitator.

## 3. Associate the original purchases

**Original purchases** displays the native source rows, intent and transaction identities, settlement/output states, original clocks and current association. Choose **Associate original** or **Edit association** for an existing row.

Select its actual buyer deployment, reviewed useful operation and actual facilitator where known. Confirm **Matching native transfer independently verified** and **Complete expected useful output reviewed** only from the relevant retained original evidence. These are attributed review decisions; they do not make a provider request or perform a transfer.

For an order-dependent product, enter the actual order-completion timestamp and retain the original source. The purchase's native order state must also be fulfilled. A webhook acknowledgment alone is not order fulfillment. Leave the time blank when the actual fulfillment time is unknown.

Useful completed use requires the original approved intent, positive settled atomic amount and transaction, accepted terms, complete saved output bytes/digest, original completion clocks and the explicit transfer/output/operator associations. Missing joins remain findings. Known attempts, partial outputs, unresolved settlement and cancellations remain in their original intent groups and reporting population.

### Replay, adjustments and transaction identity

Retries and saved-result reopening remain under the same original intent. Current complete output and earlier gross completion are separate results. A later cancellation, refund or unavailable-output observation does not erase a prior completed purchase or invent a refund amount.

Transactions deduplicate by network and canonical transaction hash. Their original amount, asset, time and source observations remain attached. Equivalent timestamp spellings compare as the same instant while retaining their original text. Conflicting amounts remain unresolved and are excluded from known quantity totals. Conflicting fee observations remain unknown; unknown fees are never shown as zero. Original `feesStroops` quantities are native-XLM stroops and remain explicitly labeled separately from the payment asset.

If one transaction proof is associated with multiple intent groups, the review exposes `TRANSACTION_ALLOCATION_REVIEW_REQUIRED` and does not credit multiple independent useful completions from that unresolved proof. Stellar transactions can contain several payment operations, so a transaction hash alone is insufficient to establish distinct transferred amounts for those intents. Preserve the actual source exception and reconcile the original transfer/intent evidence before treating it as fulfilled adoption.

## 4. Retain products, deployed incidents and actual refunds

In **Products & recovery**, add the actual parent product with its complete expected original purchase set. Page or part purchases have their own intent denominator. Whole-product completion requires every selected expected purchase to be complete, plus the parent product's explicit complete state, source and actual completion time. A completed page does not establish a completed dataset or whole order.

Use **Add original outcome** for an existing deployed event:

| Kind | Original evidence to retain |
| --- | --- |
| Interrupted settled purchase | Original case/reference, deployment, fault/start, deployed alert, acknowledgment, completion, result and actual financial outcome |
| Merchant-delivery failure | The corresponding original delivery failure and deployed alert/acknowledgment/recovery result |
| Restore/cutover | Original release/rollback, backup/state restoration, authorized receiving host and post-backup operation reconciliation reference |
| Independent support | Original case, independent resolving operator and participation class, actual work times and resolved result |

The outcome's deployment and evidence remain original case records. Reusing one original reference under another review-row ID does not create another independent recovery case. Actual active operator minutes are decimal text and remain separate from elapsed seconds. Recovery and support timestamps keep their original timezone and fractional precision.

The required deployed threat/remediation work is entered under its original tranche-2 source requirement. Link existing work observations and their original evidence. A completed declaration without the required source, date and current work binding remains a finding.

Select actual **REFUND** cash observations where relevant. Their original date, direction, quantity, currency, network, asset, valuation and void state remain visible. An order marked refunded does not manufacture a cash refund record; a recorded USD valuation does not convert an atomic transfer into USD spending.

## 5. Evaluate and freeze

Choose **Evaluate current draft**. The preview is bound to the current case version, complete reviewed inputs, relevant original sources, pinned plan and original purchase observation history.

Read the three scopes separately: all selected original intents, reviewed independent use, and team-operated use. The report includes:

- Approved and payment-attempted intent counts.
- Complete and gross-complete purchases, partial/missing output and unsettled attempts.
- Cancellation, refund, no-payment and applicable order outcomes.
- Completion/attempt and fulfillment/order numerators and denominators.
- Complete parent products and their started-product denominator.
- Unique transaction quantities and known/unknown fees by network and asset.
- Accountable buyer/merchant counts, same-operation facilitator observations and returning buyers.
- Coverage gaps, excluded original rows, missing anchors, current source differences and all proposed target comparisons.

A zero denominator is shown as unestablished. Returning use requires distinct original intent groups on different UTC completion days; retries or multiple observations of one intent do not make a returning buyer.

**Freeze reviewed cohort** saves the exact preview, including unmet targets. It uses the original `cohort.prepare` request in the existing case transaction and creates a `COHORT_EVALUATION` review in `ops_reviews`. Its case event, reviewer, input, snapshot, purchase history and digests are retained together. It does not record an award, grant payment, purchase, customer commitment or issuer decision.

If the source changed after preview, refresh the original case and review the retained draft against it. A refresh preserves edited inputs and unfinished dialogs. The UI keeps pending save identity and request metadata before dispatch; after an uncertain response, **Continue original freeze** reuses the identical original request. If the write returned but its readback was interrupted, **Read back accepted review** reads the same committed review. A stale-version rejection preserves the draft for an explicit new preview.

## 6. Reopen and deliver the exact evidence

**Frozen reviews** shows the immutable saved reviews, their source-currentness and their original target outcome. **Use as new draft** starts a new review from an older review's inputs while preserving the old review.

**Download complete cohort** produces a deterministic private ZIP containing:

- `cohort.json`: full original review, exact input, original case snapshot, observation history, measurements and findings.
- `cohort.html`: readable result, original operator classifications, denominator populations and target comparison.
- CSV files for metrics, deployments, useful operations, facilitators, comparisons, returning buyers, intents, transactions, exact quantities, products, deployed outcomes, actual refund observations, targets and findings.
- Every referenced original source byte sequence, verified against its retained SHA-256 and byte count.
- `MANIFEST.json`: every included file's exact path, size and digest.

The measurement digest includes the original purchase/deployment population and history, selected source identities, reviewed refund/work records, input and pinned plan. An unrelated cash entry or completion assignment does not rewrite that digest. Changes to the measurement source are reported separately from the preserved frozen review. A complete case import verifies the original review and its preparation event and can compare the same measurement after receiving into a different workspace/case identity.

The ZIP is a private operating artifact because its original workorder/source files may contain private data. Use the existing authorized receiving destination for those bytes. Publish only the source or material already selected for the intended audience.

## 7. Join the original tranche preparation

Open **Tranche completion** in this same case. Its existing previous-payment record, 90-calendar-day completion clock, deliverable assignments, issuer-confirmed extensions, actual form receipt and issuer outcome remain the governing lifecycle.

Choose the exact **Frozen cohort evidence (optional)** records. The native completion preview checks each selected review's tranche, cutoff, proposed-target result and current measurement source. Unmet or stale evidence is displayed as a preparation finding. Selecting a review does not submit the form or assert issuer approval.

A successful original preparation embeds the selected immutable reviews and their complete original history. **Download prepared files** includes each cohort under `cohorts/<original-review-id>/`, linked from `completion.html`. The complete case archive also retains the same original review identities. Record an actual form submission only from its original receipt using the existing Completion controls.

Omitting cohort selection preserves the earlier completion preparation contract and hashes. The cohort measurement proposal does not create an additional universal submission rule.

## Native CLI and API

The same workflow is available through the installed merchant command or source `cli.py`. Close the browser's workspace owner before a headless command opens that same workspace.

```sh
starforge grant-workspace operations --workspace /absolute/private/scf-planning cohort-seed --case operation-EXACT_ID --expected-version CURRENT_VERSION --tranche 2 --output /absolute/private/cohort-seed.json
starforge grant-workspace operations --workspace /absolute/private/scf-planning cohort-preview --case operation-EXACT_ID --expected-version CURRENT_VERSION --inputs /absolute/private/cohort-inputs.json --output /absolute/private/cohort-preview.json
starforge grant-workspace operations --workspace /absolute/private/scf-planning cohort-prepare --case operation-EXACT_ID --expected-version CURRENT_VERSION --inputs /absolute/private/cohort-inputs.json --expected-preview-sha256 EXACT_PREVIEW_SHA --actor "Recording operator" --request-id ORIGINAL_REQUEST_ID
starforge grant-workspace operations --workspace /absolute/private/scf-planning cohort-export --case operation-EXACT_ID --review review-EXACT_ID --output /absolute/private/cohort-evidence.zip
```

Replace the explicit IDs, version, paths and digest with the retained original values. The seed response contains an `inputs` object; edit that object into the input file, or export the reviewed input from the browser. The `--inputs` file is the complete input object, not the surrounding seed/preview response.

Use the same `--request-id` and exact preparation inputs after an uncertain result. Existing output files are preserved; inspect/reopen the original exported path, or choose a new filename for a genuinely new export.

| Route | Request / result |
| --- | --- |
| `POST /api/operations/{case}/cohort-seed` | `{expectedVersion,tranche}`; original rule, input seed and source inventory |
| `POST /api/operations/{case}/cohort-preview` | `{expectedVersion,inputs}`; complete evaluation and `previewSha256` |
| `POST /api/operations/{case}/command` | Original `{expectedVersion,actor,requestId,note,action:"cohort.prepare",data:{inputs,expectedPreviewSha256}}` |
| `GET /api/operations/{case}/reviews/{review}` | Original immutable review |
| `GET /api/operations/{case}/cohort-reviews/{review}/export.zip` | Complete private evidence ZIP |
| Existing completion preview / prepare | Optional `cohortReviewIds:[...]`, embedded original evidence and native findings |

HTTP writes use the original authenticated local request path. Python callers use `Operations.seed_cohort`, `preview_cohort`, the original `command` method and `export_cohort`. The [API contract](OPERATIONS-API.md), [CLI guide](CLI.md) and [agent integration guide](AGENT.md) retain the complete original workspace lifecycle.
