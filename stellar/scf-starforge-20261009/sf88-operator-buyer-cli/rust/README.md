# Stellar Forge customer workflows in Rust

Use the installed original SF88 buyer from a Rust application or the
`starforge-buyer-rust` executable. The library covers single purchases, merchant
handoffs, durable Inbox work, resumable whole/chunked objects, paginated datasets,
verified response files, NDJSON/SSE/CSV consumption, and original accounting.

The runtime remains in the selected Stellar Forge merchant installation. This
crate invokes its existing `go/bridge.mjs` protocol and `node/index.mjs` engine.
Existing Node, Python, Go and Rust consumers can reopen the same original state.

## Install and select the runtime

A Unix host, Rust 1.74 or newer, Cargo, and the installed merchant package's
supported Node release are required. Install the original merchant package using
its distribution guide, then select the actual SF88 directory inside that
installation.

~~~sh
cargo install --locked --path /absolute/merchant/source/stellar/scf-starforge-20261009/sf88-operator-buyer-cli/rust \
  --root /absolute/customer-tools --jobs 1

/absolute/customer-tools/bin/starforge-buyer-rust \
  --runtime /absolute/merchant/source/stellar/scf-starforge-20261009/sf88-operator-buyer-cli \
  --state /absolute/private/customer ready
~~~

The default bridge is `SF88/go/bridge.mjs`. `--bridge ABS_FILE` selects that
original shipped bridge explicitly when adopting an older installed source
closure. The runtime must include the original Node buyer and all of its
dependencies. `ready` checks the selected original runtime before use.

Consume the Cargo library directly:

~~~toml
[dependencies]
starforge-buyer = { path = "/absolute/merchant/source/stellar/scf-starforge-20261009/sf88-operator-buyer-cli/rust" }
~~~

`Cargo.lock` fixes the executable's dependencies. `cargo install --locked`
reproduces that selection.

## Review, execute and recover a purchase

Use a merchant's original SF88 configuration or its SF96 operation handoff.
Configuration amounts remain decimal strings in atomic units. Preserve the
merchant's explicit intent ID, network, asset, recipient, route, method and
response limits.

~~~sh
starforge-buyer-rust --runtime /absolute/sf88 --state /absolute/customer \
  create /absolute/buyer.json

starforge-buyer-rust --runtime /absolute/sf88 --state /absolute/customer \
  review order-20261011 --out /absolute/reviews/order-20261011.json

starforge-buyer-rust --runtime /absolute/sf88 --state /absolute/customer \
  --profile /absolute/private/operator.json --approval-stdin \
  execute order-20261011 /absolute/reviews/order-20261011.json

starforge-buyer-rust --runtime /absolute/sf88 --state /absolute/customer \
  inspect order-20261011

starforge-buyer-rust --runtime /absolute/sf88 --state /absolute/customer \
  recover order-20261011
~~~

Review the saved native object before executing it. `--approval-stdin` passes the
real terminal descriptor to the original approval flow. The SDK supplies no
approval answers. The default leaves stdin closed, which suits offline review,
recovery and verified delivery.

`recover` opens the retained outcome and completed native command output.
A `null` result means a complete outcome is unavailable. It does not allocate a
new intent or restart a purchase. Use the existing operation's `inspect` report
and original recovery instructions after an uncertain response.

For a merchant handoff, inspect its original choices and select an explicit
accept index:

~~~sh
starforge-buyer-rust --runtime /absolute/sf88 --state /absolute/customer \
  inspect-handoff /absolute/merchant-operation.json
starforge-buyer-rust --runtime /absolute/sf88 --state /absolute/customer \
  import /absolute/merchant-operation.json --accept 0
~~~

The imported operation follows the same review/execution/recovery commands.
`discover CATALOG.json` and `prepare SELECTION.json` call the original catalog
inspection and explicitly selected quote preparation. The selection document
uses the original Node buyer's fields.

### Rust application

~~~rust
use starforge_buyer::{Client, Config, Context, CreateOptions, Options};
use std::{path::PathBuf, time::Duration};

# fn example() -> Result<(), Box<dyn std::error::Error>> {
let mut options = Options::new("/absolute/sf88", "/absolute/customer");
options.operator_profile = Some(PathBuf::from("/absolute/private/operator.json"));
options.approval_stdin = true;
let buyer = Client::new(options)?;
let call = Context::with_timeout(Duration::from_secs(180));

let operation = buyer.create(
    &call, Config::File(PathBuf::from("/absolute/buyer.json")),
    CreateOptions::default(),
)?;
let review = operation.review(&call)?;
// Present and retain review.value() in your application before this step.
let received = operation.execute(&call, &review)?;
let reopened = buyer.operation(operation.intent_id.clone()).recover(&call)?;
println!("{} {}", received.status, reopened.is_some());
# Ok(()) }
~~~

`CreateOptions.body: None` means no body. `Some(Vec::new())` means a present
zero-byte body. The CLI mirrors this: omitting `--body` is absent, while an empty
selected file is present and empty. Binary body bytes use the original strict
base64 call field. Request-call JSON is limited to 32 MiB; stream large delivered
files through the file APIs.

## Durable Inbox and accounting

~~~sh
starforge-buyer-rust --runtime /absolute/sf88 --state /absolute/customer \
  inbox /absolute/native-inbox create
starforge-buyer-rust --runtime /absolute/sf88 --state /absolute/customer \
  inbox /absolute/native-inbox enqueue order-20261011
starforge-buyer-rust --runtime /absolute/sf88 --state /absolute/customer \
  inbox /absolute/native-inbox review order-20261011 \
  --out /absolute/reviews/inbox-order-20261011.json
starforge-buyer-rust --runtime /absolute/sf88 --state /absolute/customer \
  --approval-stdin inbox /absolute/native-inbox execute order-20261011 \
  /absolute/reviews/inbox-order-20261011.json --workspace /absolute/native-commerce
starforge-buyer-rust --runtime /absolute/sf88 --state /absolute/customer \
  inbox /absolute/native-inbox recover order-20261011
starforge-buyer-rust --runtime /absolute/sf88 --state /absolute/customer \
  inbox /absolute/native-inbox response order-20261011
~~~

Inbox `show`, `list`, `cancel`, `finalize` and `report` use their original native
state and accounting semantics. The `finalize` command takes original arguments:

~~~json
{
  "options": {
    "workspaceDirectory": "/absolute/native-commerce",
    "outboxDirectory": "/absolute/native-outbox",
    "merchantRoute": "/paid-report"
  }
}
~~~

Pass that document with `--args /absolute/finalization.json`. Rust's typed
`Inbox::finalize` accepts the inner options object. Report arguments contain
`destination` and optional `options.workspaceDirectory`.

## Whole objects and paginated datasets

Create from the original validated object or dataset configuration with
`object create --args ORIGINAL_OPTIONS.json` or `dataset create --args
ORIGINAL_OPTIONS.json`. Rust exposes corresponding `ObjectOptions` and
`DatasetOptions` types. Optional numeric limits retain the difference between
zero and omission; spend limits use strings.

Existing native sessions can be adopted through `attach_object` or
`attach_dataset`. Their CLI attachment document is:

~~~json
{"id":"inventory","directory":"/absolute/original-native-session","accountingOnly":false}
~~~

~~~sh
starforge-buyer-rust --runtime /absolute/sf88 --state /absolute/customer \
  dataset attach --args /absolute/attachment.json
starforge-buyer-rust --runtime /absolute/sf88 --state /absolute/customer \
  dataset inventory initialize
starforge-buyer-rust --runtime /absolute/sf88 --state /absolute/customer \
  dataset inventory recover
starforge-buyer-rust --runtime /absolute/sf88 --state /absolute/customer \
  dataset inventory deliver --args /absolute/delivery-arguments.json
~~~

Delivery arguments are `{"destination":"/absolute/delivery-directory"}`.
Object delivery uses a file destination. Original acquisition `run` and object
`download` perform the paid acquisition; `recover`, `delivered`/`delivery`, and
dataset `deliver` reopen retained work according to the original engine.

Objects expose `initialize`, `inspect`, `recover`, `run`, `download`, `assemble`,
`delivered`, `file`, `export_report`, `accounting`, `finalize`, and
`recover_accounting`. Datasets expose `initialize`, `inspect`, `recover`, `run`,
`deliver`, `file`, `export_manifest`, and the same three accounting methods.

The CLI's `--args` document is the original bridge argument object. For paged
object status, use `{"options":{"chunkOffset":0,"chunkLimit":20}}`; for an object
report, add `destination` and `format`. Accounting commands pass
`{"options":{...original accounting fields...}}`. The selected native engine
validates those complete original options.

## Verified files and typed records

A selection document addresses a retained original response:

| Source | Selection |
|---|---|
| Single operation | `{"kind":"operation","id":"order-20261011"}` |
| Inbox | `{"kind":"inbox","directory":"/absolute/inbox","id":"order-20261011"}` |
| Whole or chunked object | `{"kind":"object","id":"archive","destination":"/absolute/archive.zip"}` |
| Dataset CSV | `{"kind":"dataset","id":"inventory","destination":"/absolute/delivery","name":"dataset.csv"}` |
| Retained public stream | `{"kind":"response","record":ORIGINAL_RECORD,"responseFile":ORIGINAL_RESPONSE_OPTIONS}` |

~~~sh
starforge-buyer-rust --runtime /absolute/sf88 --state /absolute/customer \
  file /absolute/selection.json verify
starforge-buyer-rust --runtime /absolute/sf88 --state /absolute/customer \
  file /absolute/selection.json copy /absolute/exports/report.pdf
starforge-buyer-rust --runtime /absolute/sf88 --state /absolute/customer \
  file /absolute/dataset-selection.json records dataset
starforge-buyer-rust --runtime /absolute/sf88 --state /absolute/customer \
  file /absolute/stream-selection.json records sse --partial
~~~

`save_as`/`copy` uses the original verified, fsynced, non-overwriting publication.
`bytes(limit)` accepts a real zero-byte file with `limit=0`. `json::<T>(limit)`
deserializes one complete UTF-8 JSON value after original byte verification.

`write_to` streams with pipe backpressure. `records::<T>` uses the original Node
CSV, dataset, NDJSON or SSE decoder, then deserializes each record into Rust.
Rust's JSON `Value` preserves arbitrary-precision number lexemes. No floating
point conversion is introduced for atomic money.

The original runtime retains incomplete stream status. `allow_partial=true`
permits its validated complete-record prefix. Final success includes original
stream checks and the actual record count. Callbacks may receive bytes before
final verification. Commit downstream changes after `Ok(transfer)`; for a
file destination, prefer `save_as`.

The executable writes streamed payload to stdout and the final transfer receipt
to stderr. Check its exit status before promoting a redirected output. Structured
`--out` writes are private, create-only and atomic; an identical retry is accepted.

The runnable [received-dataset](examples/received-dataset.rs) example consumes
the original typed inventory rows, totals available units and exports exact CSV:

~~~sh
cargo run --locked --example received-dataset -- \
  /absolute/sf88 /absolute/customer inventory \
  /absolute/original-delivery /absolute/exports/inventory.csv
~~~

## Cancellation, ownership and reopening

Every call gets a private `STATE/.rust-calls/call-…` directory containing its
request, bridge stderr and final response. Successful calls remove their own
transient directory. Failed calls retain it, while durable native state remains
at its original paths. Errors expose the action, intent ID, invocation directory,
original safe error code and any original progress/result.

The child runs in an owned Unix process group. Context cancellation or a CLI
signal reaches the original bridge's AbortSignal. The call closes its output
reader and waits for original cleanup before returning. The configurable cleanup
grace includes a final five-second handoff allowance; an unresponsive owned
process group is terminated after that interval. Reopen the original intent
after uncertain execution instead of issuing a new identity.

A context clone can be cancelled from another thread. The library installs no
global signal handlers; the executable owns SIGINT/SIGTERM. A custom writer or
record callback must return control for cancellation to finish—an application
callback that blocks forever cannot be interrupted safely by the SDK.

`Options.environment=None` inherits the caller's environment.
`Some(BTreeMap::new())` selects an empty environment; supply its complete required
values explicitly, including PATH if `node` is a PATH name. Credentials remain in
the original operator profile or runtime environment.

## Native adoption and source composition

The Rust source composes the original Go bridge from PR1259, merged at
`3af9ff842de232dfcc964ab68bdabd19bf9e77b7`. The accepted customer fixtures supplied
by that owner include the settled core response, zero-byte and 35-byte whole
objects, a 1,843,229-byte assembled archive, five typed dataset rows and exact CSV,
a settled Inbox order, and retained NDJSON/SSE captures. The single Rust native
adoption run reopens those originals through the installed runtime.

Release source must include this crate, its Cargo lockfile, the existing Go
bridge and the original Node runtime closure. The distribution owner retains
custody of the cumulative merchant package.
