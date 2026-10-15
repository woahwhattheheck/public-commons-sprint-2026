# Receive actual delivery outcomes

Retain the complete provider report and its original SENT message. A SENT receipt records dispatch; the report supplies its later transport outcome. The original message, exact customer edition and contact history remain unchanged.

Supply a JSON request with operation_id, recorded_at (UTC), mailbox, pack_id, reports (complete Gmail FULL objects), sent_messages (complete original Gmail FULL objects), and optional history_path. For a machine report missing from FULL, use the existing portable FULL/RAW binding and retain both original provider responses. The complete maintained parser handles RFC delivery status, original RFC identity, recipient and time association, delayed retries and native Gmail policy or capacity failures.

Run `node native/receive-delivery-feedback.mjs ORIGINAL_SOURCE_DIRECTORY FEEDBACK_INPUT_JSON NEW_OUTPUT_DIRECTORY`. The selected source directory must contain its complete-source.json plus every declared ordinary member. The command validates original bytes, receives through the unchanged maintained core, retains every original member and predecessor, and creates a complete new directory through the resumable publication writer. Reuse the same original input/output to recover an interrupted write. It performs no provider or outbound action.

Reopen with `node native/reopen-cohort.mjs NEW_OUTPUT_DIRECTORY` from the received source. Historical operation replay includes the complete feedback parser; receipt checks bind each actual send to the buyer route at its original operation. A later confirmed contact correction is a normal pack-save revision before recording a later actual send. Link actual successive attempts with delivery-followup-link. Preserve every older edition and provider receipt; never recreate an immutable customer edition to correct an address.

The feedback receiver checks complete retained customer HTML, CSV, JSON and Markdown remain exact. The existing producing-peer instruction still applies to every outgoing product/attachment: open/render/use the exact version at relevant widths, LOOK at actual outputs and repair concrete presentation problems in the original equipped receiving operation.

## Complete successor and continued receiving

The native receiver checks every declared original text/binary file against the selected bank. Additional ordinary files already present in that directory are retained byte for byte: well-formed UTF-8 stays text; other bytes stay binary. Links and special files reject. The exact original request text is retained under `internal/delivery-status-inputs/REQUEST_SHA256/request.json`.

`feedback-receiving-result.json` belongs to the complete source bank and member manifest. A later receiving operation archives its exact predecessor under `history/feedback-results/` before writing the new result. Its `input_source` identifies the original selected complete bank; the console result identifies the final output bank, avoiding a self-referential hash. A received directory can therefore serve directly as the next original source, including earlier feedback output and any original supplemental files.

The complete predecessor bank and replaced tool bodies remain in history. Source-publication recovery state is a sibling of the output, outside the delivered tree; leave it beside the original output for an interrupted retry. Repeating the same original input/output uses the same create-only plan. Receiving the same original feedback into a later complete source remains an event no-op while preserving the new source handover.

The successor carries the full current recorder, independent opener and their exact source-tool closure, including MIME/RAW helpers, archive tools, materializer and receiving guides. Replaced bodies remain under history. This applies equally to an older selected project that did not yet include these later entrypoints.

## Native runtime lookup

The native receiver declares the portable runtime directory before loading the original source's core. This keeps feedback receiving on the selected customer's retained engine while the current receiver supplies the complete source-preserving handover. Both paths remain ordinary files under the selected source directory; no provider action occurs.
