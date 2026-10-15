# Supplied production-plan review workspace

An offline, source-preserving review desk for plant planning inputs and supplied baseline/candidate schedules. Original source, explicit mappings, source-row corrections, frozen plans, complete comparisons and named PLANNING/OPERATIONS decisions remain together.

Start with docs/OPERATOR.md. Build with `node native/build-desk.mjs NEW_OUTPUT.html`; open the blank desk and retain original files. The authored example and whole receiving course are separate. `node native/planning-cli.mjs course --out NEW_DIRECTORY` runs the source course using Node built-ins only. The complete source manifest covers every included technical file. Keep research and correspondence outside this application.

No optimizer, dispatch, machine control or ERP mutation is implemented. The owning product retains those responsibilities.
