# SFTP dataset publication

This module composes a native SFTP source with the original retained source
publisher. Use the parent [SFTP guide](../README.md) for source configuration,
file capture, typed values, credentials, and the complete merchant workflow.

`openSftpPublisher(options)` accepts the same private workspace/source/target,
runtime environment, and buyer options as `openSourceDatasetPublisher`.
It installs `sftpPublisherDriver`; all plan/run/review/publication transitions
remain owned by the original publisher.

`cli.mjs` delegates the original publisher command surface and browser server.
Run `node sftp/publisher/cli.mjs --help` for its exact options. The maintained
product command is `sftp-publisher`. The complete parent authoring workspace is
`sftp-workspace`.

The saved plan retains both the exact original source declaration and its
accepted runtime declaration, their hashes, the selected file report and typed
inputs, public dataset schema, and an independent complete-extraction budget.
Each completed extraction includes a full capture receipt, source record count,
returned row count, explicit scalar/source-type observations, and ordering.

The original recurring publisher opens this same driver on each attempt.
Review, publish, schedule, dataset seller, and snapshot-bound buyer behavior
compose the existing implementations. A failed capture or projection leaves the
existing published dataset version available.

The generic publication console renders the SFTP path, format, record pointer,
optional expected digest, mapping, and fixed comparisons. Its public column
editor starts from the source's declared types and nullability.
