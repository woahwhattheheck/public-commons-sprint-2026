# Use the installed buyer in LangGraph and LangChain

The maintained merchant package exposes the original Node buyer as typed
application modules and as `starforge buyer-agent`. Each graph or tool is bound
to one existing buyer operation. Its operator configuration, native approval,
attempt, response and spending journal remain the same through application
restarts.

## Install the optional framework runtime

Use Node.js 22.16 or newer. The original operator also needs its Linux host,
Python and existing configured buyer runtime. Install the maintained merchant
archive into the customer application using that release's installation guide.

The optional `node-agents` group reads the exact dependencies from
`sf88-operator-buyer-cli/node/examples/agents/runtime-package.json` in that
selected archive. Its reference lock travels beside the manifest. The operated
selection is:

| Package | Exact version |
| --- | --- |
| `@langchain/langgraph` | `1.4.21` |
| `@langchain/core` | `1.2.17` |
| `@langchain/langgraph-checkpoint-sqlite` | `1.0.4` |
| `better-sqlite3` | `12.10.0` |
| `zod` | `4.6.6` |

For an existing npm application, install these optional packages in the same
application directory as `@tokenjunkielabs/starforge-merchant`:

```sh
npm install --save-exact @langchain/langgraph@1.4.21 @langchain/core@1.2.17 \
  @langchain/langgraph-checkpoint-sqlite@1.0.4 better-sqlite3@12.10.0 zod@4.6.6
npx --no-install starforge doctor --feature node-agents
npx --no-install starforge buyer-agent --help
```

Keep the resulting application lockfile with the installed source. SQLite uses
the real `better-sqlite3` native binding for the selected Node version and
platform. Its normal npm installation prepares that binding. An installation
that suppresses lifecycle scripts needs explicit native preparation before
opening a SQLite workflow; resolving the JavaScript module alone does not open
a database. The maintained runtime profile/installer also selects this original
group with `--feature node-agents --operator`. Use its native preparation and
readiness workflow when operating a managed dependency directory.

The existing core `/buyer/node` and bound `/buyer/node/agents` modules do not
load these framework packages. Import the LangGraph, LangChain or SQLite entry
when the application uses that framework.

## Public application imports

All four entries include their original TypeScript declarations.

| Installed import suffix | Public API |
| --- | --- |
| `/buyer/node/agents` | `BuyerAgent`, result/outcome summaries and response types |
| `/buyer/node/agents/langgraph` | `createBuyerGraph` with an application-supplied checkpointer |
| `/buyer/node/agents/langchain` | `createBuyerTools` |
| `/buyer/node/agents/sqlite` | `createSqliteBuyerGraph` |

The prefix for every entry is `@tokenjunkielabs/starforge-merchant`. Applications
can use the original standalone SDK's examples by replacing its package imports
with these installed aliases; the APIs and declared types are the same.

```js
import { Buyer } from '@tokenjunkielabs/starforge-merchant/buyer/node';
import { createSqliteBuyerGraph } from
  '@tokenjunkielabs/starforge-merchant/buyer/node/agents/sqlite';

const buyer = new Buyer({
  runtimeDirectory: '/absolute/original/buyer-runtime',
  stateDirectory: '/absolute/private/buyer-state',
});
const operation = buyer.operation('original-approved-intent');
const session = await createSqliteBuyerGraph({
  operation,
  databasePath: '/absolute/private/agent-state/workflow.sqlite',
  read: { format: 'json' },
});
const config = {
  configurable: { thread_id: 'original-customer-workflow' },
  durability: 'sync',
};
try {
  const result = await session.graph.invoke({ action: 'recover' }, config);
  if (result.artifact) {
    console.log(result.artifact.data);
  }
} finally {
  session.close();
}
```

Use the existing acquisition or inbox workflow to receive, review and prepare a
new customer request before attaching its operation here. The runtime directory
in this example is the original SF88 operator runtime; the state directory is
the customer's original buyer state. The framework checkpoint file belongs to
the customer application and remains private.

## Pause and continue in a fresh process

The installed command forwards directly to the maintained executable example.
Supply the same original runtime, state, intent, checkpoint file and thread
throughout this workflow:

```sh
npx --no-install starforge buyer-agent graph \
  --runtime /absolute/original/buyer-runtime \
  --state /absolute/private/buyer-state --intent original-approved-intent \
  --checkpoints /absolute/private/agent-state/workflow.sqlite \
  --thread original-customer-workflow --action recover \
  --read-format json --pause-after inspect

npx --no-install starforge buyer-agent status \
  --runtime /absolute/original/buyer-runtime \
  --state /absolute/private/buyer-state --intent original-approved-intent \
  --checkpoints /absolute/private/agent-state/workflow.sqlite \
  --thread original-customer-workflow

npx --no-install starforge buyer-agent resume \
  --runtime /absolute/original/buyer-runtime \
  --state /absolute/private/buyer-state --intent original-approved-intent \
  --checkpoints /absolute/private/agent-state/workflow.sqlite \
  --thread original-customer-workflow
```

The resumed graph retains its saved JSON selection. Programmatic applications
resume with `graph.invoke(null, config)`. SQLite persists the request binding,
action, original review, response options and workflow position. The binding
is checked against the original operation before continuation. An existing
attempt uses its original recovery path; the original private inbox continues
to own a delegated operation.

`graph` defaults to `recover`. Select `--action review` for native review, or
`--action execute` to request the original approved execution workflow. The
saved native approval and the operator's payment controls determine execution.

## Use tools and the full response

```js
import { createBuyerTools } from
  '@tokenjunkielabs/starforge-merchant/buyer/node/agents/langchain';

const tools = createBuyerTools({ operation });
const read = tools.find(tool => tool.name === 'stellar_buyer_read');
const message = await read.invoke({
  type: 'tool_call',
  id: 'customer-result-1',
  name: read.name,
  args: { format: 'json' },
});
console.log(message.artifact.data);
```

The four tools review, execute, recover and read that same bound operation.
Each ordinary LangChain ToolCall returns a ToolMessage with its original call
ID. The content is a concise model-facing view; the structured artifact retains
the complete selected response. Read formats include verified file metadata,
JSON, text, base64, CSV, SSE and NDJSON. Paged stream reads verify the original
complete capture before selecting records. Explicit partial-stream handling
retains the original partial delivery scope.

The installed CLI exposes the same interface:

```sh
npx --no-install starforge buyer-agent tool \
  --runtime /absolute/original/buyer-runtime \
  --state /absolute/private/buyer-state --intent original-approved-intent \
  --tool read --read-format json --tool-call-id customer-result-1

npx --no-install starforge buyer-agent export \
  --runtime /absolute/original/buyer-runtime \
  --state /absolute/private/buyer-state --intent original-approved-intent \
  --out /absolute/customer/new-response.json
```

Export uses the original verified response's create-only destination operation.
Keep the buyer state and checkpoints together with the customer's existing
acquisition backup and operator configuration. The complete source guide,
read limits, cancellation semantics, application types and native operating
record are in [FRAMEWORKS.md](../sf88-operator-buyer-cli/node/FRAMEWORKS.md)
and its linked runnable examples.
