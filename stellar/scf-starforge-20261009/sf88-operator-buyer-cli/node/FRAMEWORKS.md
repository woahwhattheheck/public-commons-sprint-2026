# Agent applications with the native Node buyer

Use an existing Stellar Forge `Buyer` operation from a LangGraph workflow or a
LangChain tool. The application selects the original intent, private state, native
runtime, accepted terms, and response destination. The integration then carries
that same operation through offline review, execution, recovery, and response
consumption.

The modules are optional. The ordinary `@stellar-forge/native-buyer` import keeps
its dependency-free behavior. Framework imports use their official packages:

| Import | Purpose | Optional dependencies |
| --- | --- | --- |
| `@stellar-forge/native-buyer/agents` | Bound operation, recovery, response artifacts | None |
| `@stellar-forge/native-buyer/agents/langgraph` | Standard compiled StateGraph | LangGraph |
| `@stellar-forge/native-buyer/agents/langchain` | Four standard structured tools | LangChain core, Zod |
| `@stellar-forge/native-buyer/agents/sqlite` | Private SQLite checkpoint session | LangGraph, official SQLite saver |

## Install and select the original operation

The operated dependency set is LangGraph `1.4.21`, LangChain core `1.2.17`, the
official SQLite saver `1.0.4`, and Zod `4.6.6`. The saver uses `better-sqlite3`;
the operated native dependency is `12.10.0`. Node 22 or newer is required by this
SDK. Install these in the application that imports the optional modules:

```sh
npm install @langchain/langgraph@1.4.21 @langchain/core@1.2.17 \
  @langchain/langgraph-checkpoint-sqlite@1.0.4 better-sqlite3@12.10.0 zod@4.6.6
```

An application may use its compatible existing dependency closure instead. Keep
its lockfile with the application. Installing from this source directory also
makes the dependencies available to the supplied executable example.

```js
import { Buyer } from '@stellar-forge/native-buyer';

const buyer = new Buyer({
  runtimeDirectory: '/srv/stellar/sf88-operator-buyer-cli',
  stateDirectory: '/srv/customer/buyer-state',
});
const operation = buyer.operation('customer-report-2026-10');
```

This attaches to an operation already prepared using the ordinary SDK. For a new
request, use the existing `fromConfig`, `fromRequest`, `prepare`, or request inbox
flow to select its terms and create its original stable intent. See the main
[buyer guide](README.md) and [request inbox guide](INBOX.md). Keep the returned
`Operation` as the application boundary. A tool argument does not select another
merchant, accepted price, body, payer, or intent.

## A persistent LangGraph customer workflow

```js
import { createSqliteBuyerGraph } from '@stellar-forge/native-buyer/agents/sqlite';

const session = await createSqliteBuyerGraph({
  operation,
  databasePath: '/srv/customer/agent-state/checkpoints.sqlite',
  read: { format: 'json' },
});
const config = {
  configurable: { thread_id: 'monthly-report-workflow' },
  durability: 'sync',
};
try {
  const state = await session.graph.invoke({ action: 'recover' }, config);
  if (state.artifact) {
    console.log(state.artifact.data);
    console.log(state.artifact.result.file.sha256);
  }
} finally {
  session.close();
}
```

`action: 'recover'` is the default. It reads the original result and, when one is
available, consumes the configured response format. It returns `prepared` for an
operation with no native attempt and `awaiting_result` for an existing attempt
whose result has not yet become recoverable.

When a native result exists but has no readable retained delivery, the graph
returns that intact outcome with `artifact: null`. A retained failed stream can
be consumed through its matching SSE/NDJSON format with `allowPartial: true`.

`action: 'review'` runs the existing native offline review and checkpoints its
original `Review`. `action: 'execute'` first checks the original operation. It
recovers an existing result, returns an existing pending attempt, or runs the
original offline review and `Operation.execute` for a prepared operation. The
original `attempt.json` publication remains the concurrency authority. A graph
retry cannot replace that marker or create another attempt.

The returned object is the official compiled LangGraph graph, so normal
`invoke`, `stream`, `getState`, checkpoint history, tracing, and application graph
composition remain available. `createBuyerGraph({ operation, checkpointer, ... })`
accepts another durable official checkpointer when the application already owns
one. That application retains responsibility for closing its own checkpointer.

### Restart a process at a real checkpoint

For a deliberate application pause, supply `interruptAfter: ['inspect']` when
creating the session. The first invocation stores the binding and recovered
native result before pausing ahead of response consumption. Close the process.
In a new process, open the same database, operation, and thread, then call:

```js
const state = await session.graph.invoke(null, config);
```

The pending node continues from SQLite. The original read options are included
in the checkpoint, so a process restart retains its selected format and record
page. Each resumed node checks the original intent, operation directory, config
digest, body digest, ticket digest, and original native workspace when present.
Reusing that graph thread for another
operation raises `AGENT_OPERATION_BINDING_MISMATCH`.

For recovery after an ordinary process crash, open the same application state
and checkpoint database. Resume the pending graph or invoke recovery on the
existing operation. When the native child finished before the framework saved
its next checkpoint, the adapter finds its retained output through the original
`Operation.recover`. Native status, process exit status, and file delivery status
remain separate in the returned outcome.

The SQLite directory is private (`0700`) and the database is created with mode
`0600`. The official saver owns its WAL and checkpoint schema. `session.close()`
closes the saver's native SQLite handle. Preserve the original buyer workspace
as well as the checkpoint database: the response bytes, attempt, and native
result live in that original workspace. See [workspace recovery](RECOVERY.md)
for its backup and restore operation.

## Standard LangChain tools

```js
import { createBuyerTools } from '@stellar-forge/native-buyer/agents/langchain';

const tools = createBuyerTools({
  operation,
  namePrefix: 'stellar_buyer',
  maxContentCharacters: 16000,
  readDefaults: { format: 'json' },
});
```

| Tool | Behavior |
| --- | --- |
| `stellar_buyer_review` | Runs the original offline review and retains its original `Review`. |
| `stellar_buyer_execute` | Uses that saved review for the selected operation; recovers existing native output or an existing pending attempt. |
| `stellar_buyer_recover` | Reads original operation status and recoverable native output. |
| `stellar_buyer_read` | Verifies and reads the original retained file, JSON, text, CSV, SSE, or NDJSON response. |

The returned array can be supplied to normal LangChain agents or a LangGraph
`ToolNode`. An application can select the tools it wants to expose. Execution
uses the same original review requirement as the SDK. If an operation has no
saved matching review, call its review tool before its execute tool.

All four tools use official `responseFormat: 'content_and_artifact'`. The model
receives a useful JSON content summary and selected data. A large response has
an explicit truncated preview; the artifact retains the complete requested
selection and exact source binding. Invoke with a real ToolCall to obtain the
standard ToolMessage and its artifact:

```js
const read = tools.find(item => item.name === 'stellar_buyer_read');
const message = await read.invoke({
  type: 'tool_call',
  id: 'report-read-1',
  name: read.name,
  args: { format: 'json' },
});
console.log(message.content);
console.log(message.artifact.result.file.sha256);
```

A plain argument invocation returns the content according to LangChain's normal
tool contract. A ToolCall ID links the ToolMessage to the model's invocation;
the original buyer intent identifies the native operation. Repeated ToolCall
IDs or new model invocations share that same native operation.

## Response formats and complete-source verification

`BuyerAgent.read` and the read tool return a `ResponseArtifact` with the original
operation binding, native result summary, format, selected data, and source file
digest. It retains the native HTTP status, runtime error, and delivery status.

| Format | Data returned |
| --- | --- |
| `file` | Verified path, byte length, SHA-256, and native delivery metadata. |
| `json` | The original SDK's decoded JSON value. |
| `text` | Strict UTF-8 text after complete file verification. |
| `base64` | The verified response bytes as base64. |
| `csv` | A selected page of rows from the original CSV reader. |
| `sse` | A selected page of original framed event records. |
| `ndjson` | A selected page of the original decoded JSON records. |

For CSV/SSE/NDJSON, `offset` and `limitRecords` control the selected page. The
iterator still consumes and verifies the complete retained source before
returning that page. `records` contains the total count, selected offset,
returned count, and next offset. The default selection is the first 100 records.
`limitBytes` defaults to 8 MiB and controls buffered scalar data or selected
records. Choose appropriate limits for the application's real response size.
The native captured-response limit remains part of the original operation.

SSE and NDJSON use the parser in the selected original SF31 runtime. To read a
retained incomplete stream, choose the matching stream format and explicitly
set `allowPartial: true`. The original reader verifies the full retained partial
file and exposes only its fully framed prefix. The artifact keeps
`partial: true`, the original delivery status, and original stream summary.

To publish a whole verified file into the application's own destination, use
`new BuyerAgent(operation).saveAs('/absolute/new-output-file')`. This delegates
to the existing create-only `BuyerResult.saveAs`. The graph's `read: false`
option returns the native outcome without materializing response data.

## Executable operator workflow

The supplied [agent-workflow.mjs](examples/agent-workflow.mjs) operates an
existing intent. All paths below identify the application's actual private state.

```sh
node examples/agent-workflow.mjs graph \
  --runtime /srv/stellar/sf88-operator-buyer-cli \
  --state /srv/customer/buyer-state --intent customer-report-2026-10 \
  --checkpoints /srv/customer/agent-state/checkpoints.sqlite \
  --thread monthly-report-workflow --action recover \
  --read-format json --pause-after inspect

node examples/agent-workflow.mjs resume \
  --runtime /srv/stellar/sf88-operator-buyer-cli \
  --state /srv/customer/buyer-state --intent customer-report-2026-10 \
  --checkpoints /srv/customer/agent-state/checkpoints.sqlite \
  --thread monthly-report-workflow

node examples/agent-workflow.mjs tool \
  --runtime /srv/stellar/sf88-operator-buyer-cli \
  --state /srv/customer/buyer-state --intent customer-report-2026-10 \
  --tool read --read-format json
```

`status` reads the checkpoint's next nodes and original binding. `export --out`
saves the verified file. `graph --action execute` is the explicit native execute
path. Successful commands print JSON. Errors retain their original SDK code and
exit with status 1; use the same intent and checkpoint for recovery.

[agent-customer.mts](examples/agent-customer.mts) is the typed application
equivalent. The optional modules have their own `.d.mts` declarations and use
the original SDK's `Operation`, `Review`, `BuyerResult`, and stream types.

## Upstream contracts

- [LangGraph JavaScript persistence](https://docs.langchain.com/oss/javascript/langgraph/persistence)
- [LangGraph interrupt and resume behavior](https://docs.langchain.com/oss/javascript/langgraph/interrupts)
- [Official SQLite checkpoint package](https://reference.langchain.com/javascript/langchain-langgraph-checkpoint-sqlite)
- [Official LangChain core tool implementation](https://github.com/langchain-ai/langchainjs/tree/main/langchain-core/src/tools)
- [Pinned LangGraph package metadata](https://registry.npmjs.org/@langchain/langgraph/1.4.21)
- [Pinned SQLite saver package metadata](https://registry.npmjs.org/@langchain/langgraph-checkpoint-sqlite/1.0.4)

The operated source, restart result, exact response identity, and dependency lock
are described in [the native customer run](examples/agents/OPERATED.md).
