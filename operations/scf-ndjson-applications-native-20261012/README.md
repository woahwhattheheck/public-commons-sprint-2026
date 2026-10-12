# Receive the retained JSON Lines application

This operation opens the original NDJSON project produced by the complete dataset
lifecycle through the maintained Applications controller. It uses the actual saved
runtime, original source workspace and completed source-to-customer outcome.

## Select the original runtime and dataset operation

First complete the original operation documented in
[the dataset lifecycle guide](../scf-dataset-lifecycle-native-20261012/README.md).
Keep its `native-outcome.json` and `source-workspace` together on the working host.

Use the existing runtime installer to prepare or upgrade the selected source
containing both the NDJSON dataset lifecycle and Applications producer. The original
runtime inspection must report READY. Its source commit and manifest remain the
selected installed identities; Applications uses its normal managed adoption.

Write a private configuration file using the actual paths on that host:

~~~json
{
  "runtimeDirectory": "/srv/starforge/selected-runtime",
  "nativeOutcome": "/srv/starforge/ndjson-lifecycle/native-outcome.json",
  "pythonExecutable": "/usr/bin/python3",
  "receivingDirectory": "/srv/starforge/ndjson-applications-receiving"
}
~~~

The receiving directory must be new, or contain this same retained receiving.
Optional `expectedSourceCommit` pins the exact commit returned by the original
runtime inspection. `workspaceDirectory` selects another original retained copy
when its source, mapping, build, comparison and dataset are the ones in the outcome.
Optional `applicationWorkspace` and `homeId` use an existing Applications workspace
and managed home; omit them to create the normal receiving workspace. An existing
`environmentFile` retains the selected Applications environment.

Run the original source operation with the host's selected Node:

~~~bash
node operations/scf-ndjson-applications-native-20261012/receive.mjs \
  /private/ndjson-applications-receiving.json
~~~

## Complete receiving

The operation performs two full starts separated by Stop and reopening the original
Applications workspace. Review and Save bind the original Python, source, retained
project and runtime. The existing queue adopts and starts that selected release.

Each open reads the original live launch and source state, checks the retained
source, mapping and build, and queries the exact large integer customer row with
its original decimal text. It downloads the complete saved comparison and project
through the original authenticated console. The optional connection file points
the existing merchant MCP at that same process. Stop drains the original console
and removes its connection; the next start returns the same data with a new session.

`receiving.json` preserves the saved application and original request IDs. Continue
an interrupted operation with the same configuration; existing Applications recovery
handles those recorded requests. The completed record contains both source/query/
comparison observations, original download byte counts, source and binding identities,
and the closed operations. Private console URLs stay on the host.

The customer-facing product and manual controls are described in the
[NDJSON Applications guide](../../stellar/scf-starforge-20261009/sf30-seller-sdk/ndjson/MANAGED_APPLICATIONS.md).
