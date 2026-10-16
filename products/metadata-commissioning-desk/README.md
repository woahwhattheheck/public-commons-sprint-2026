# Metadata Commissioning Desk

A complete local DataHub commissioning workspace: retain original source and target observations, review current aspects and relationships, prepare source-bound changes, receive actual native results, and hand over editable work.

## Open and operate

Use Node 20 or later. From this directory run `node serve.cjs`, then open http://127.0.0.1:8486. The server exposes only the six browser assets. It contains no service token and makes no DataHub calls. The native Python helper performs the selected SDK and GMS operations using the authorized operator's environment.

Read OPERATING.md for complete source, review, native change, recovery, revert and handover instructions. Read NATIVE_RECEIVING.md for the exact-version reference receiving course. `native/requirements.txt` selects acryl-datahub 1.7.0.14. Python 3.10+ on POSIX is required; native run directories use an OS lock and synchronized journals.

## Working files

The complete workspace includes every original observation, target HTTP body, named review, proposed before/after aspect, imported native run, named edition, handover note, incoming workspace and unfinished editing draft. Browser copies use IndexedDB with a version comparison; a competing page's save is reported and does not overwrite the other edition. Download the complete JSON before moving computers or closing after a failed save.

Choose saved browser projects explicitly. Restore a named edition through Handover; the pre-restore complete project is retained. An edited/imported complete file keeps the prior original. The portable HTML built by the CLI starts with its embedded selected edition.

## Exact data and actual operations

The comparison parser preserves JSON number text, including large integers, decimal precision and exponent notation. Object-key order is ignored; array order and numeric representations are compared exactly. String, number, null and omitted values remain distinct. Duplicate object keys are rejected. Current-aspect comparison and separately retained time-series records are explicitly different populations.

The native operator validates the selected aspect with the pinned SDK, preserves the original JSON body, reads the current target before dispatch and records the request before sending. Resuming an already attempted change only reads and classifies the existing state. A proposed revert starts from a fresh target readback and produces a new reviewed plan.

## Files

- `model.js`: exact JSON, workspace, comparison, decisions, plans, editions and relationships.
- `app.js`, `index.html`, `style.css`: plain industrial browser workspace.
- `sha256.js`: retained js-sha256 1.0.0 implementation and strict UTF-8 wrapper; original MIT notice included.
- `native/datahub_handover.py`: SDK source normalization, GMS collection, reviewed aspect apply and recovery.
- `cli.cjs`, `render.cjs`: complete file-only exports and portable editable HTML.
- `reference/upstream/`: unchanged DataHub bootstrap and original Apache 2.0 license.

The selected source-review fixture comes from DataHub commit b385ec5261cac18752da413f0e891def401f65df. The native reference runtime is separately pinned to DataHub Core v1.7.0.1 and SDK 1.7.0.14. Native receiving records the actual installed versions and outcomes.

## Product inspection

Before presenting the outgoing application or any attachment, run/open its exact version, look at real wide and narrow screens, operate important controls, downloads and independent reopen, and fix observed defects. Open the actual reports, CSVs and archive members in their recipient-facing viewers. Source checks do not substitute for operating the product. Use the same source and receiving operation throughout; do not introduce broad CI or paid Actions.
