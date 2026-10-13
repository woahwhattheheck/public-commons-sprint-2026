# Three-edition migration receiving

Run the installed complete application against its bundled, explicitly invented source editions. This programme processes ten full source/target table pairs and two original crosswalks per edition. It is functional product receiving; the small authored populations are not customer records or a throughput result for a two-million-row engagement.

## Open the complete source

Keep all product files and examples together under one source directory. Use an existing Python 3.11+ environment with SQLite. No runtime installation or provider access is part of this programme. The original eleven discovery files stay byte-for-byte unchanged.

The examples are documented in examples/README.md. Each edition contains all twenty-two CSV files, an exact-hash original manifest, and the full interpretation. Edition A retains missing/invalid reads, an absent parent, duplicate meter and ambiguous mapping records, and a negative-credit sign error. B corrects the missing/invalid source values and credit signs while preserving unresolved identities. C resolves the remaining identity issues. Every CSV row participates.

The interpreted dimensions are deliberately complete: account, period, unit, meter, tariff and linked payment/bill identity are selected wherever they determine numeric comparability. Full exact grouped totals retain these dimensions; a balanced sum does not clear ambiguous underlying records.

## One native receiving invocation

Choose a new private output directory outside the installed source tree:

    python /absolute/source/receiving_migration.py \
      --directory /absolute/private/migration-receiving \
      --keep-server

The course records the complete selected source inventory and every real subprocess command/stdout/stderr. It executes the actual calculator and packer for A, B and C, receives the final archive into a distinct directory, then invokes the received workbench's calculator with its original receiving manifest and exact interpretation. It compares full row and grouped-total streams, original input hashes and exact rational amounts. Earlier archives are hashed again after later editions and receiving.

The programme also opens the actual localhost server on an independently received case and on the final original case. It reads all result pages, complete individual records, the original quoted multiline CSV record, filtered full exports, original source metadata and complete file/ZIP downloads. HTTP receiving uses the returned private tokenized origin; it does not construct an assumed port or bypass the original server.

Each actual comparison row is checked against its native SQLite payload and original table/record references. The course verifies that every original selected source and target row remains represented. It checks the retained duplicate/crosswalk issues, missing-parent/source findings, the original wrong-sign amount, later corrections, exact GBP/quantity totals and preserved genuine credit balance.

Outputs include:

| Output | Contents |
| --- | --- |
| source-selection.json | Complete measured application and example source selected for this invocation. |
| edition-a/, edition-b/, edition-c/ | Three complete original native cases, including unchanged snapshots and full row/total outputs. |
| Migration_Edition_A.zip, B.zip, C.zip | Independently packed whole editions; none replaces an earlier archive. |
| source-comparison-a-b.json, b-c.json | Actual maintained engine comparisons of the original source reports. |
| received-final/ | Complete final archive received through the original receiver. |
| cold-rerun/ | Actual received workbench rerun against its complete original CSV snapshots. |
| Migration_Cold_Original_Source.zip | Complete rerun archive, with its actual source/run identity. |
| http-*.jsonl / *.json / *.zip | Actual server downloads checked against their selected full native files. |
| server-received.json, server-current.json | Actual private server receipts, with tokenized origins and original case/archive identity. |
| logs/ | Every complete original subprocess/server stdout and stderr. |
| receiving-progress.json | Atomically replaced current operation record. |
| receiving.json | Complete successful native receiving record, with every case/archive identity and actual server state. |
| receiving-error.json / receiving-error.txt | Original failure state and traceback if the programme returns before completion. |

The output directory must be new. Preserve a returned attempt and its logs; after correcting the concrete cause, run a distinct receiving directory with its selected source. No successful prior archive or calculated case is rewritten. Atomic receipts prevent partial JSON from replacing complete state.

## Continue the actual browser course

With --keep-server, only the final current server remains running after the native course. The complete receiving.json records its actual PID, receipt, origin, case and archive under servers[].kept_for_browser=true. The tokenized server receipt contains private access information and stays in the authorized operation.

Use the maintained helper against that exact live receipt and a new browser output directory:

    node /absolute/source/receiving_migration_browser.mjs \
      --server-receipt /absolute/private/migration-receiving/server-current.json \
      --directory /absolute/private/migration-browser-current \
      --playwright /absolute/installed/playwright/index.mjs \
      --chromium /absolute/installed/chromium

Both runtime paths are required. Select the original existing installed Playwright module and Chromium binary. The helper does not infer them, install software or start a calculator/server. After browser use, the original launching operator may stop its own retained server PID. Do not terminate unrelated processes.

Without --keep-server the native course stops both of its own server children after HTTP receiving, and no live-server availability is claimed. The same original application can reopen any preserved edition for actual browser review:

    python /absolute/source/migration_server.py \
      --case /absolute/private/migration-receiving/edition-a \
      --archive /absolute/private/migration-receiving/Migration_Edition_A.zip \
      --receipt /absolute/private/edition-a-browser-server.json \
      --port 0

Keep that command alive, then run the same browser helper against its actual new receipt in a distinct browser directory. Repeat for the corrected/final or cold-received case when examining the corresponding actual issue/correction and export views. For received-final, use its own workbench/migration_server.py, the received-final case, and the original Migration_Edition_C.zip.

## Read the outcome correctly

The cold receiving manifest changes original source paths to retained snapshots, so its run identity can legitimately differ. The course preserves both identities and verifies complete source hashes, original interpretation bytes and exact semantic rows/totals. It does not relabel another run as the first edition.

COMPLETE means the actual native programme returned successfully on the recorded host. The separate browser and visual review must still be performed and the actual outputs viewed. No source bank, parsed code, screenshot file or other worker's approval is a substitute.

Follow the entire standing owner instruction in MIGRATION_RECONCILIATION.md. Open the outgoing application, operate important controls and downloads, inspect actual desktop and narrow screenshots, open every applicable outgoing report/PDF page, and inspect usable contents of the complete archives and source files. Fix an actual observed defect in the owned implementation and continue the same coherent delivery. Preserve all original private-data, attribution, signature and recipient controls.
