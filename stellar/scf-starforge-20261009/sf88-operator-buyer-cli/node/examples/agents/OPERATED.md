# Native framework customer operation

The complete customer workflow ran on 2026-10-11 with Node 24.19.0 on Linux.
Eight separate Node processes completed successfully between 20:35:29 and
20:35:33 UTC. The optional modules used the original SF88 Node buyer operation
`native-single-consumer-c79f` and its retained native result. The final composition
used the current Node SDK at `fe240abd05057ef2793db0ae32916dca73b9057a`,
including its native workspace adoption and original request-inbox behavior.

## Customer behavior

| Operation | Observed result |
| --- | --- |
| Recover and pause after inspection | SQLite retained the binding, JSON read options and pending `read` node. |
| Open status in a fresh process | The same checkpoint and pending node were present. |
| Resume in another process | The graph read the complete original JSON without repeating the format option. |
| Invoke the LangChain read ToolCall | A standard ToolMessage retained the matching call ID, content and full response artifact. |
| Invoke execute through the tool | The existing native operation was recovered. |
| Invoke execute through the graph | The existing result was recovered and read. |
| Export through the original file API | The new output matched the retained response byte for byte. |
| Compile the TypeScript customer | Strict NodeNext compilation completed successfully with TypeScript 5.9.3. |

The SQLite database held ten checkpoints and retained mode `0600`. The original
operation, config, review, attempt, native stdout, result and response files had
identical hashes before and after the workflow. The native result was HTTP 200,
`NO_PAYMENT_REQUIRED`, with a 1,633-byte JSON response containing `schema`,
`dataset`, `fields`, `filters`, `ranges`, `order`, `rows` and `page`.

- Config SHA-256: `64213d3957cd1acc5d25f9b9f2c43a86cb1c95cf332adc612498e1145a054b81`
- Response and exported-file SHA-256: `198e40e90d941e82ea3f05ad8cb2d6c9b2deb3416b8c9fe231bd44cbb87071da`

## Reproduce the dependency closure

The SDK requires Node 22 or newer. The actual installation used LangGraph
1.4.21, LangChain core 1.2.17, the official SQLite saver 1.0.4,
better-sqlite3 12.10.0 and Zod 4.6.6. The native SQLite binding loaded under
Node 24.19.0, ABI 137.

`runtime-package.json` and `runtime-package-lock.json` retain the exact manifest
and npm lock used for that installation. The lock contains 60 dependency
packages; its SHA-256 is
`497056a9adb8148cf3b98a87fd9218f15c37f77328d23afb1cd6ddd1d55e4d95`.

To install that closure in a new application, copy those two files as its
`package.json` and `package-lock.json`, then run `npm ci` in that application.
Package this SDK with `npm pack` from the SDK source directory and install the
resulting tarball in the application with `npm install /absolute/package.tgz`.
The installed SDK then resolves the application's framework dependencies.

Use the runnable [workflow](../agent-workflow.mjs), typed
[customer example](../agent-customer.mts), and [framework guide](../../FRAMEWORKS.md)
with the application's original buyer runtime, private state, intent and
checkpoint file. The framework modules preserve the original SDK's native
request, review, attempt, response and recovery behavior.
