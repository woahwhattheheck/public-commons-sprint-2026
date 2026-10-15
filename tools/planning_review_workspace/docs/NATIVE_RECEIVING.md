# Native receiving

Requires Node18+ and Python3 for initial materialization. No package install, hosted Actions, paid service or customer credentials.

```sh
python3 materialize-source.py COMPLETE_SOURCE.json new-source
cd new-source
node native/build-desk.mjs ../Blank.html
node native/planning-cli.mjs demo --out ../demo
node native/planning-cli.mjs course --out ../domain-course
node native/receive-operator.mjs ../operator-course
node native/planning-cli.mjs capacity --jobs 250 --out ../capacity-domain
node native/receive-capacity-transport.mjs ../capacity-domain/Planning_Run_Workspace.json ../capacity-transport
```

`--jobs` selects authored jobs, each containing two operations. The commissioned example uses250 jobs/500 operations. All outputs are explicitly fictitious. The native command accepts original source (`source`), inspection, analysis, frozen editions, comparison, proposals, named review, handoff and receive. Run `native/planning-cli.mjs` without a command for the supported command list; required flags are named in each error. Complete source and originals accompany every native working output.

The browser carrier is distinct from the domain workspace. The native builder's optional second positional argument accepts the complete operator carrier; domain CLI `receive --workspace` accepts the complete domain workspace. Both validate exact originals and replay foreign histories.

Actual browser receiving uses docs/BROWSER_RECEIVING.md. Source execution with explicit adapters is recorded separately from native filesystem/browser execution.

## Existing capacity workspace through durable storage

Use the already retained complete domain from the capacity command; this receiving path does not regenerate its scenario:

~~~sh
node native/receive-storage-capacity.mjs ../capacity-domain/Planning_Run_Workspace.json ../capacity-storage
~~~

It runs the actual production storage/session/archive source with the explicit transactional IndexedDB adapter, retains two complete draft versions and a prior-session backup while storing the immutable domain once, then independently reopens both versions byte-for-byte. Actual browser persistence remains in docs/BROWSER_RECEIVING.md.
