# Supplied production-plan review workspace

An offline, source-preserving review desk for plant planning inputs and supplied baseline/candidate schedules. Original source, explicit mappings, source-row corrections, frozen plans, complete comparisons and named PLANNING/OPERATIONS decisions remain together.

Start with docs/OPERATOR.md. Build with `node native/build-desk.mjs NEW_OUTPUT.html`; open the blank desk and retain original files. The authored example and whole receiving course are separate. `node native/planning-cli.mjs course --out NEW_DIRECTORY` runs the source course using Node built-ins only. The complete source manifest covers every included technical file. Keep research and correspondence outside this application.

No optimizer, dispatch, machine control or ERP mutation is implemented. The owning product retains those responsibilities.

## Durable browser storage and closing

This edition uses IndexedDB instead of a single localStorage item. Complete immutable domain objects are stored once by their exact root; small draft/version records point to those originals. Each proposed save is retained. An expected-head comparison publishes one current copy atomically, while a competing tab's complete proposal remains separately recoverable.

Open and restore offers **Browse retained browser versions**, **Open retained version**, **Export retained version**, and **Save current as an independent browser copy**. These controls preserve prior heads and conflicting proposals. An editable HTML handover has its own browser identity, so reopening the same handover resumes its later saved drafts without replacing an unrelated active copy. Earlier localStorage originals remain unchanged and can be imported or downloaded explicitly.

The status line states whether the current complete copy committed. If storage is unavailable or full, the current fields remain open and the tab requests confirmation before closing. Download the current complete working JSON, editable HTML, or whole ZIP to retain that exact session; a later edit restores the close guard. A report-only or domain-only export does not clear the working-draft guard. Browsers ultimately control prompts and downloads, so check the saved file before closing valuable work.

Complete working JSON remains backward compatible with the preceding edition. Editable HTML uses a validated shared-node session graph; every original byte, retained prior snapshot, unfinished source correction and named decision reconstructs into the same full working session. The native builder accepts both complete formats. Browser storage is private to the browser/origin; it does not upload data.

## Complete source and receiving

This directory is the reusable application. Run commands from this directory with Node.js and, when opening a downloaded source carrier, Python 3. The runtime uses standard libraries and the complete included codec; no package installation or hosted Actions run is required.

```sh
node native/build-desk.mjs NEW_BLANK.html
node native/build-desk.mjs NEW_EDITABLE.html COMPLETE_WORKING.json
node native/planning-cli.mjs course --out NEW_SOURCE_COURSE
node native/receive-operator.mjs NEW_OPERATOR_COURSE
```

The blank desk starts without plant records. Choose the clearly labelled authored example to examine the complete source, baseline, recovery, disruption, source-row correction and named review workflow. `docs/CONTRACT.md` defines all nine tables and source semantics. `docs/OPERATOR.md` explains normal operation; `docs/NATIVE_RECEIVING.md` contains source, capacity and transport commands; `docs/BROWSER_RECEIVING.md` provides the actual browser receiving sequence.

Before presenting an application or generated attachment to a person, open the actual current output in a browser, inspect its rendered layout and ordinary/narrow states, operate the critical controls, and open exported files. The included V8 source/DOM/IndexedDB receiving results document their explicit adapters and remain distinct from that browser inspection. Keep the original source manifest and clean outputs together when transferring the application.

A downloaded complete source carrier can be materialized with the included standalone `native/materialize-source.py`, supplied alongside the carrier: `python3 materialize-source.py SOURCE.json NEW_SOURCE_DIRECTORY`. Existing source bodies and complete immutable history stay in every full handover. See `commissioning/RECEIVING_RESULTS.md` for measured whole-workflow and retained-capacity results.
