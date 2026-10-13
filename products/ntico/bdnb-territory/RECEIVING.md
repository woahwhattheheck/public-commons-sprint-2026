# Complete BDNB producer, customer and independent return receiving

This programme operates one actual supplied BDNB case through the original HTTP action/read/download APIs and original Analysis archive receiver. It retains the whole source manifest, exact requests, every selected row, native outputs, two archives, customer decisions, return receipts and original replay evidence.

The programme is parameterized by real original files and decisions. The public Nord departmental release pair is an acquisition selection until complete source archives, publisher dictionaries and extracted file identities have actually been received. Do not fill an unavailable source with generated data or mark a deferred operator decision as accepted.

## Prepare the input

Save one UTF-8 JSON object with schema stellar-forge.bdnb-receiving.v1/input and all fields below. JSON duplicate keys and non-finite numbers are rejected. Each identity ending in _id is a stable 32-character lowercase hexadecimal value.

| Field | Actual selected value |
| --- | --- |
| operation_id | This complete receiving journal's retained ID |
| analysis_operation_id | Existing Datasette/BDNB business operation ID |
| checkout | Canonical absolute root of the complete installed application source |
| node | Existing installed Node executable/command used by Analysis |
| source_files | Complete selected source roster: path relative to checkout, bytes, sha256 |
| producer_workspace | Existing or newly selected original producer Analysis directory |
| customer_workspace | Separate receiving destination for the producer archive |
| return_workspace | Separate independent receiving destination for the customer's archive |
| output | Private receiving journal/output directory, outside all three workspaces |
| producer_actions | Complete ordered original producer action requests |
| customer_actions | Complete ordered supplied customer continuation requests |
| producer_publication_id | Producer's selected complete publication |
| producer_pack_id | Producer's selected final pack |
| customer_publication_id | Customer's selected complete successor publication |
| customer_pack_id | Customer's selected final pack |
| customer_receive_id | Original archive receive operation into customer_workspace |
| return_receive_id | Original archive receive operation into return_workspace |

The three directories must be disjoint. Restoring an archive preserves its original workspace UUID; the programme binds each path, selected archive and actual UUID. It does not invent distinct UUIDs for restored copies.

Each action is exactly {request_id, action, body}. Supported actions are bdnb.import, bdnb.select, bdnb.compare, bdnb.review, bdnb.publish and bdnb.pack. Request IDs are unique across both action lists. Keep all source, mapping, edition-path, scope and review fields in their full original bodies. Do not add a resume field to the retained body.

The producer course includes the actual comparison. The customer course includes a real supplied review continuation. Both courses end in their own selected pack of their selected publication. Every pack request_id must equal body.pack_id.

The full input is bounded to 16 MiB and each action body to 1 MiB. Large source content is selected by original file path/length/hash, then retained by the source importer. JSON receiving artifacts are bounded to 96 MiB. Full data JSONL, report/workbook outputs and archives are streamed and are not restricted to the JSON-artifact size.

The source roster must include the complete selected domain, UI, original model/server/client, products/workflow/receiving code, installed runtime source and native Analysis dependencies. At minimum the receiving source validates its own identity, bdnb_adapter.py, bdnb_products.py, analysis_exports.py and workspace_archive_receive.py; include the entire actual source manifest rather than only those minimum required names. The managed launcher independently verifies its own full selected product/runtime source.

Review the actual comparison first so each customer review names the correct immutable item ID, evidence hash and current predecessor. The receiver does not create a review reason or author for the operator.

## Run the complete original operation

With the selected installed Python environment:

~~~sh
python products/ntico/bdnb-territory/receiving.py \
  --input /private/bdnb/receiving-input.json
~~~

The managed command uses the same installation selection as the product CLI:

~~~sh
node products/ntico/bdnb-territory/cli.mjs \
  --runtime-workspace /private/operator \
  --runtime-directory /private/runtime \
  --runtime-id ACTUAL_RUNTIME_ID \
  --installation-id ACTUAL_INSTALLATION_ID \
  -- bdnb-receive --input /private/bdnb/receiving-input.json
~~~

The receiving process owns a kernel flock for the complete operation and opens only one original Analysis operator at a time. Stop another operator for the same directory through its original owner before selecting it here. The programme retains its lease through native executor/server/workspace closure.

## The complete ten-stage course

1. **Input:** verify all selected source bytes and retain exact input/runtime identity.
2. **Producer:** freeze the original baseline, execute/adopt every original producer action and retain complete responses.
3. **Producer data:** page and retain every row of every produced source/selection/comparison/publication collection.
4. **Products:** download every publication and pack file, verify full lengths/hashes, inspect every archive member and independently derive the catalogue from its actual SQLite snapshot.
5. **Customer receive:** restore that exact archive to the original separate customer destination with its retained native receive ID.
6. **Customer continuation:** verify the received publication/catalogue, freeze the customer baseline, execute/adopt the supplied decisions and successor publication/pack.
7. **Earlier receive replay:** replay the original producer archive receipt and prove it preserves later customer entities.
8. **Return delivery:** retain the customer's complete native outputs and archive, using its actual snapshot catalogue.
9. **Independent return:** restore the customer's archive into the separate return destination, reopen the exact publication and retain all customer entity rows.
10. **Original request replay:** repeat each original producer/customer request and prove accepted immutable entities and later current work remain unchanged.

The final pack record is accepted after the snapshot. The catalogue expected inside an archive is the one actually read from the archive, rather than a pre-export observation or the later final pack entity.

## Continue after an interruption

Run the exact same input and output journal with --resume. Keep every original request, entity, receiving ID and source selection unchanged.

Each complete phase records its exact input binding and cumulative full artifact index. Resume verifies those files and adopts the original complete phase observation; it does not redefine a completed observation from a newer customer head. Incomplete phases continue their same requests. All observed request outcomes have content-addressed filenames; an earlier failed observation is preserved beside the later accepted result.

Customer baselines are frozen before the first customer mutation. On continuation, the programme checks those immutable original entities remain present while allowing accepted customer successors. Archive receive observations retain the native transient reused flag separately; the stable accepted receipt preserves the first complete outcome without conflicting on a later replay.

A complete-result replay reopens all ten phase files, verifies every original phase and artifact index, derives its selected publications from those phase values, verifies both whole archives and their actual catalogues, then opens each original workspace and checks its bound publication and actual workspace UUID. The complete result cannot substitute a shorter artifact list for that course.

If closure is uncertain the process emits CLOSING_HELD and keeps the original operation lease while retrying the held owners. It never reports COMPLETE before closure. Preserve the original process/session and journal when investigating a held result. Do not start a competing receiving operation on its directories.

## Read the result

complete.json identifies the exact source input, ordered phases, selected publications, original workspace identities, archive-catalogue hashes, all artifact identities and CLOSED lifetime. The phase files retain complete responses and values. Streamed JSONL files contain complete observed row bodies; comparison read-time review annotations remain in their own content-addressed observations.

The two downloaded native archives and their manifest files are the independently reusable customer handovers. Their native receive journals remain at the original destination's sibling control directory. Keep the complete output directory and both archives with the original project.

This local programme does not submit to JMS, invoke a remote Kestra broker or fabricate an external receipt. Use [WORKFLOW.md](WORKFLOW.md) for the original commissioned transport and its actual result/acknowledgment course. Record source review, local native completion, broker outcome and customer acceptance using their actual separate receipts.
