# Invoice & Settlement customer commissioning

Select **invoice-settlement** in the existing Installation Source Desk or native workorder preparer to commission the customer's original invoice reconciliation programme. The profile connects the maintained invoice application, Horizon deposit review, authenticated customer interface and independent receiving to the original Grant Operations case.

The actual Workshare supplies the customer, commercial scope, phase owners, effort, fees, review allowance and acceptance criteria. The profile supplies a complete operating sequence. It preserves the seed's workorder, assignments, checks, Workshare, workflow periods, coordination and unselected payment fields.

## The useful customer result

A finance or operations reviewer starts with the customer's existing invoice programme and actual original observations. The application retains the complete source and payment instructions, explains candidate attributions and discrepancies, saves individually reasoned decisions, creates reconciliation/report editions and delivers the full continuing workspace to an independent recipient.

The recipient receives the selected application and original source history as well as a report. They can inspect programme versions, original source bodies, capture coverage, decisions and unresolved findings in the same native browser. Reopening an exported case does not require the exporting host's credentials.

| Surface | Existing entry |
| --- | --- |
| Local invoice workspace and browser | `stellar-invoice-settlement serve` |
| Guided original deposit attribution | Native `horizon.review` / `horizon.apply` and **Horizon deposits** |
| Authenticated customer access | `invoice-settlement-customer` |
| Typed client, retained requests, full download/receive | `./merchant/invoice-settlement/client`, `operations`, `download` |
| Original Installation profile/seed preparation | `starforge grant-installation-workorder` |
| Whole original Workshare/Installation receiving | `starforge grant-installation-receive` |

The full native contracts are [Horizon invoices](../../../scf-starforge-20261009/sf30-seller-sdk/invoice-settlement/HORIZON_INVOICES.md) and [Applications](../../../scf-starforge-20261009/sf30-seller-sdk/invoice-settlement/APPLICATIONS.md). The complete remote customer commands are in [Invoice & Settlement customer operations](../../../../stellar-forge/mcp-merchant-operator/INVOICE_SETTLEMENT_CUSTOMER.md).

## 1. Select the actual commissioned work

Use the existing owner's saved Operations case and complete original Workshare. Reopen an existing Installation as its next draft when that work is already represented; the generic preparer accepts a fresh planned seed for a new Installation.

Receive these selections before preparing the work:

| Selection | Required original record |
| --- | --- |
| Customer and authority | Actual invoice owner, financial reviewer, host operator and recipient |
| Commercial scope | Full Workshare/packet, explicit source population and period, review allowance, fee and milestone criteria |
| Invoice terms | Native programme UUID/version/digest, original invoice IDs, asset/network definitions, exact amount strings and collection/settlement roles |
| Deposit instructions | Complete original account/memo register with the source of each instruction |
| Observation population | Complete original files or selected capture IDs, root/network response, account/window/cursor and observed coverage |
| Continuing state | Existing workspace UUID, source revision, prior decisions, original request and capture/delivery records |
| Installed access | Actual complete archive/commit, declared alias, endpoint, configured host inputs and credential reference |
| Receiving | Independent directory, selected Linux/Node runtime, named engineer and agreed backup/support |
| Funding and commerce | Original funded assignments, Workshare phases and separately approved merchant payment terms, if any |

Use actual retained records throughout. A generated demonstration programme cannot supply customer identity, authorisation, a payment observation, a completed Workshare or an Installation acceptance. Do not replace an unavailable original case with an invented one.

The native invoice amount is a source fact. It is separate from the professional commissioning fee and from an optional merchant service's atomic price. Keep a task budget unselected when the original case has no approved paid service. The preparation report lists unselected payment/deployment fields; it does not manufacture values to clear them.

### Receive the original Workshare source

Use **Source preparation** in the original Installation Source Desk to retain complete files, choose the original Workshare, map each phase's actual effort source and select profile `invoice-settlement`. Save the complete selection, prepare its full native package, attach that cohort to the same case and open its native Installation preparation.

The maintained terminal source helper is:

~~~sh
starforge grant-installation-workorder sources \
  --selection "$ORIGINAL_SOURCE_SELECTION" \
  --source-root "$ORIGINAL_COMPLETE_FILES" \
  --out "$PRIVATE_SOURCE_PREPARATION" \
  --python "$ACTUAL_PYTHON"
~~~

Keep the original source selection, case/plan digest, phase mapping and packet. Its selected row uses profile `invoice-settlement`; no other field is inferred from this guide. The existing helper returns the complete commissioning/packet files and `SUPPLIER_RECEIVING.json`. That historical output name serves all its supported customer programmes.

## 2. Prepare the native Installation

List installed profiles and retain the selected profile's complete source identity:

~~~sh
starforge grant-installation-workorder profiles
~~~

From the original `sf47_budget_model` application, receive the fresh native seed for the selected commercial work:

~~~sh
python3 workspace/cli.py operations --workspace "$SCF_WORKSPACE" \
  installation-workshare-seed \
  --case "$SCF_CASE" --expected-version "$SCF_VERSION" \
  --source "$COMMISSIONING_SOURCE" --expected-source-sha256 "$COMMISSIONING_SHA256" \
  --packet-source "$PACKET_SOURCE" --expected-packet-sha256 "$PACKET_SHA256" \
  --workshare-case "$COMMERCIAL_CASE" --expected-revision 0 \
  --output "$PRIVATE_OUTPUT/original-seed.json"

starforge grant-installation-workorder template \
  --profile invoice-settlement \
  --seed "$PRIVATE_OUTPUT/original-seed.json" \
  --out "$PRIVATE_OUTPUT/invoice-bindings"
~~~

Each variable selects an actual original record or path. The binding template retains the case version, plan revision, plan content/source digests and original Workshare selection.

Fill only actual customer choices:

- `source.reference` names the original programme/version, register, observation population and retained source/capture identities.
- `source.authority` records the customer's actual source-use authority and permitted review.
- `source.sourceIds` and `receiving.sourceIds` add real case attachment IDs; the engine preserves the source closure already in the seed.
- `merchantDeploymentId` and `buyerDeploymentIds` identify deployments already recorded in the original case.
- `receiving.host` and `receiving.operator` name the real receiving environment and responsible person.
- Payment values retain the approved original selections. Atomic amounts are integer strings, task count is an integer, and an unselected amount stays null.

The native input permits customer-specific task/receiving details within the existing field bounds. Do not insert credentials, private tokens or a session URL. Use the existing authorised configuration reference.

~~~sh
starforge grant-installation-workorder prepare \
  --profile invoice-settlement \
  --seed "$PRIVATE_OUTPUT/original-seed.json" \
  --bindings "$PRIVATE_OUTPUT/invoice-bindings/bindings.json" \
  --out "$PRIVATE_OUTPUT/invoice-installation"
~~~

The complete output is `installation-input.json`, its original preview envelope, `WORKORDER.md` and `preparation.json`. Publication is private and create-only. The same exact input reopens the same output. An intentional changed source selection receives a new preparation edition; an existing operated Installation stays in its original draft/history.

## 3. Preview, save and reopen in the same case

In **Customer installations**, load the complete input, preview it and save it. Review every missing actual selection reported by the native preview. Saving appends the original Installation edition through the existing request journal.

The corresponding native commands are:

~~~sh
python3 workspace/cli.py operations --workspace "$SCF_WORKSPACE" \
  installation-preview --case "$SCF_CASE" --expected-version "$SCF_VERSION" \
  --expected-revision 0 \
  --document "$PRIVATE_OUTPUT/invoice-installation/installation-input.json" \
  --output "$PRIVATE_OUTPUT/invoice-installation/native-preview.json"

python3 workspace/cli.py operations --workspace "$SCF_WORKSPACE" \
  installation-save --case "$SCF_CASE" --expected-version "$SCF_VERSION" \
  --expected-revision 0 \
  --document "$PRIVATE_OUTPUT/invoice-installation/installation-input.json" \
  --expected-preview-sha256 "$NATIVE_PREVIEW_SHA256" \
  --actor "$RECORDING_OPERATOR" --request-id "$ORIGINAL_SAVE_REQUEST" \
  --note "$INSTALLATION_REASON"
~~~

Use the actual returned preview digest and current original case version. After an uncertain save, inspect the original request; do not issue a replacement UUID. Retain the resulting Installation ID, edition and case version and reopen that same edition.

These steps create a planned operating record. Source preparation and a saved plan do not mark its unchanged native acceptance checks complete.

## 4. Open the customer's actual invoice programme

The host owner selects the existing private workspace and complete installed product. The local command is:

~~~sh
stellar-invoice-settlement serve \
  --workspace "$ORIGINAL_INVOICE_WORKSPACE" \
  --connections-file "$PRIVATE_ORIGINAL_CONNECTIONS"
~~~

Omit the optional connections flag for offline inspection of retained work. Open the printed private loopback URL. The original **Applications → Invoice settlement** lifecycle also selects and owns this same native application. Keep session tokens private.

For authenticated customer access, the host's existing Merchant configuration points `invoiceWorkspaceConnection` at a private declaration. That declaration maps an alias to the existing directory, optional expected workspace UUID, private connection references and approved input aliases. Relative paths remain relative to the file that declares them.

The customer operates:

~~~sh
invoice-settlement-customer connection-template --out connection.json
invoice-settlement-customer bind --connection connection.json --out bound.json
invoice-settlement-customer read --connection bound.json --tool status --out opened.json
invoice-settlement-customer read --connection bound.json --tool methods --out native-methods.json
invoice-settlement-customer history --connection bound.json --out original-history.json
~~~

Before binding, fill the actual endpoint, alias and token environment-variable name. The file contains no credential value. Binding reads the original workspace UUID. Keep that bound identity for every later command.

An alias selects a workspace; it does not create customer-specific authorisation. The current Merchant authentication determines access. The partner retains a shared host token and delivers an independent offline received copy, or uses an independently authorised service.

Native changes use `plan`, `run` and `show` in one retained private operation directory. The exact tool arguments come from the original method catalog. Save the original request UUID and revision before dispatch. A completed local operation reopens offline. An unknown capture or listener outcome is reconciled from its native state before explicit `--continue-original`; that option reuses the original request, not a new customer operation.

## 5. Retain complete observations and review attribution

Use the actual complete invoice programme and payment-instruction source. The native register binds programme UUID, version and digest; each mapping names its original invoice, collection or settlement role, exact destination, explicit memo type/value and source note. An optional sender adds an exact condition.

For a configured host input, first read its `inputs` descriptor. Plan an `import` with its returned SHA-256 and original native source metadata. The provider rereads the complete approved file before calling `source.import`; the customer supplies an alias rather than a host filesystem path.

When the original work requires live capture, use its configured native connection, original account/network and exact period/cursor. Retain the root/network response, transaction joins, failed observations and every complete response page. Continue the same capture after interruption. A partial response set is not complete source coverage.

Read `horizon.review` with the actual programme/version, register source UUID and complete selected source UUIDs. Keep its full result and `reviewSha256`. The existing browser shows the same result in **Horizon deposits**.

The reviewer checks:

| Source condition | Operating response |
| --- | --- |
| Exact account, memo, asset and amount | Inspect the candidate and its actual original invoice instruction |
| Multiple eligible invoice mappings | Select one mapping with an individual reason, or leave it unresolved |
| Partial or overpayment | Retain native exact difference and the reviewer's explicit treatment |
| Failed/unknown success, missing root/join or incomplete capture | Keep the blocked reason and repair the original source selection |
| Earlier link/unlink/exclusion | Use the original corrective-decision workflow and its history |
| Unmatched movement | Preserve original values and explanation; do not infer a payer from amount alone |

Choose each accepted movement/mapping and write its actual reason. `horizon.apply` receives the unchanged selection, review digest, actor, current expected revision and one original request UUID. The native transaction recomputes the whole review and commits no subset when a choice fails. A lost response resolves through `request.status` for that UUID or exact permitted native replay.

This records local attribution. It neither transfers funds nor updates the external company ledger. Any accounting posting, payment, refund, signing or external mutation remains with its separately authorised original owner and process.

## 6. Produce and receive the complete result

Create the original reconciliation edition using the selected source and decisions. Reopen it, compare any later edition and create the complete original report. Inspect remaining issues and balances before the named reviewer decides how to use it.

Plan a full workspace `export` with its original request UUID and current revision. Its publication retains the selected native manifest and exact application/workspace/source/runtime files. Reconcile an uncertain export through that original publication rather than selecting newer state.

~~~sh
invoice-settlement-customer inspect-publication \
  --connection bound.json --publication-id "$ORIGINAL_PUBLICATION"

invoice-settlement-customer download \
  --connection bound.json --publication-id "$ORIGINAL_PUBLICATION" \
  --directory "$PRIVATE_DOWNLOAD"

invoice-settlement-customer verify \
  --directory "$PRIVATE_DOWNLOAD" --publication-id "$ORIGINAL_PUBLICATION"

invoice-settlement-customer receive \
  --directory "$PRIVATE_DOWNLOAD" --publication-id "$ORIGINAL_PUBLICATION" \
  --destination "$RECEIVED_INVOICE" --request-id "$ORIGINAL_RECEIVING_REQUEST"
~~~

Download verifies every member, its original length/hash and complete manifest. An interrupted prefix continues under the same publication. Retained readers are released. Downloaded payloads stay private; the native receiver makes a separate hash-bound source copy with the declared original modes, including selected runtime executables. Preserve that staging directory until receiving and offline reopening finish.

Receiving and verification require no endpoint or token. The unchanged receiver checks application/source/runtime coverage and full history. Active captures and listener work retain their original state and are paused according to the native receiving contract. The received product does not start new provider work merely by reopening.

Open the actual received application:

~~~sh
node "$RECEIVED_INVOICE/application/source/stellar/scf-starforge-20261009/sf30-seller-sdk/invoice-settlement/cli.mjs" \
  serve --workspace "$RECEIVED_INVOICE/workspace"
~~~

Use its printed loopback URL. Inspect the original programme, all selected source bodies, review and decisions, reconciliation/report editions and paused operation history. Select current credentials and received runtime generations only when the authorised host owner later continues those original operations.

## 7. Return actual acceptance to the Installation

Retain the recipient's actual opened workspace UUID, selected report/publication, receiving result and named observation against the original Workshare phase. Keep the complete files with the case, then use the existing Installation workflow to record its actual check observations. An import/download receipt is not a purchase, grant completion or customer acceptance.

Reopen the saved Installation edition. Export its complete operating-case handover, receive it through the original Operations importer and reopen the same selected Installation. For complete original commissioning files, the maintained whole driver is:

~~~sh
starforge grant-installation-receive \
  --operations-cli "$SCF_MODEL_ROOT/workspace/cli.py" \
  --workspace "$SCF_WORKSPACE" --case "$SCF_CASE" --plan "$SCF_PLAN" \
  --inputs "$PRIVATE_SOURCE_PREPARATION/SUPPLIER_RECEIVING.json" \
  --source-root "$PRIVATE_SOURCE_PREPARATION" --out "$INSTALLATION_RECEIVING_OUTPUT" \
  --receiving-workspace "$SCF_RECEIVING_WORKSPACE" \
  --actor "$SCF_ACTOR" --receiving-actor "$SCF_RECEIVING_ACTOR"
~~~

Its input must be the original source helper's complete retained selection, with this profile selected for the actual row. The driver uses the existing preview/save/import operations and preserves newer saved Installation work. Keep the same selected invocation and output after interruption.

## Commercial adoption and evidence

Commission one real customer's scoped reconciliation programme first: explicit invoice/source population, period, review responsibility, complete report and independent receiving. Price its actual professional phases in the original Workshare. If recurring reporting or paid service is commissioned, record the agreed cadence/unit separately and retain actual subsequent orders in the existing operations.

Measure actual operated outcomes: complete source coverage; reviewed candidates and unresolved issues; original request recovery; reports delivered; independent recipients who reopened the whole workspace; and deliberately selected later editions. Keep invoice principal and source transaction values separate from earned service revenue. Record funded engineering once against its actual assignment; this profile does not add grant hours or alter the current funded packages.

The original Horizon feature has a retained seventeen-phase native result and three reviewed application views. The separate installed authenticated customer eighteen-phase result is pending its original receiving continuation. This profile and guide prepare the actual customer/Grant case; no such case save, payment, customer acceptance or installed eighteen-phase completion is claimed by their publication.

## Maintained implementation

This profile uses the unchanged `profiles.mjs`, `prepare-core.mjs`, `prepare.mjs` and `receive.mjs` in this directory. The installed Grant Operations selection carries the complete directory, so the new profile and this guide enter its existing source closure and discovery.

The guarded whole receiving continuation is PR1410, merge `1b19665fde7c5fc7fbbe6ebc37557364e3670ba6`, and preserves the same original installed operation, 154 complete selected source files, permanent operation lock, child results and same-process saves. Its eighteen-phase result remains pending. The reviewed product source edition is merchant-workspace commit `c1cd32e1d0e8d28ed2c2e40332276c06c7f4ae67` (PR1325). Its original native Horizon feature is PR1262, merge `e0ade1d51e695dc55fe40281b0d55bf2994e3472`. The profile's sourceFiles records pin the three complete operating guides. Select later source editions deliberately and preserve their original receiving history.
