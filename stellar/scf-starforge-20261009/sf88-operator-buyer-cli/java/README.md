# Java customer SDK

Use the maintained Stellar Forge buyer from Java 17 or newer. The SDK provides
durable request creation, native review and execution, original-attempt recovery,
inbox operation, whole-object and paged-dataset acquisition, verified file
delivery and streaming record consumption.

The selected Node buyer remains the payment, approval, accounting and recovery
implementation. Java calls its existing bridge and reopens the same private
application state as the Node and Go customers.

## Build and select the installed runtime

Use a Java 17+ JDK and the Node/Python runtime required by the selected
[original buyer](../README.md). This SDK uses only the Java standard library.

From this directory, create the customer JAR in a new output directory:

~~~sh
java Build.java /absolute/new-java-build
java -jar /absolute/new-java-build/starforge-buyer.jar help
~~~

The builder compiles with Java release 17 and creates the command-line JAR.
It downloads no dependencies. Keep the JAR with the source revision you selected.
An application can add that JAR to its classpath:

~~~sh
java --class-path /absolute/new-java-build/starforge-buyer.jar \
  examples/ApprovedRequest.java \
  /absolute/sf88-runtime /absolute/private/java-customer \
  /absolute/private/operator-profile.json \
  /absolute/private/buyer-request.json
~~~

For Gradle, the same local dependency is:

~~~kotlin
dependencies {
    implementation(files("/absolute/new-java-build/starforge-buyer.jar"))
}
~~~

`runtimeDirectory` is the original SF88 directory containing `node/index.mjs`,
`go/bridge.mjs` and the native commands. An installed source edition includes it
under:

~~~
/absolute/application/node_modules/@tokenjunkielabs/starforge-merchant/source/stellar/scf-starforge-20261009/sf88-operator-buyer-cli
~~~

`stateDirectory` is the customer's private original Node application directory.
Choose absolute paths. Reuse that directory when reopening an existing
application. A distinct `.java-calls` directory holds Java invocation records;
the original intent and acquisition directories retain their existing format.

The private state and invocation directories use POSIX permissions. Run on the
same Linux/macOS/POSIX operator host as the native buyer, including an existing
WSL operator environment when appropriate. Select the actual installed Node
executable if it is outside the host's normal PATH.

~~~java
import io.starforge.buyer.Buyer;
import java.nio.file.Path;
import java.time.Duration;

Buyer buyer = Buyer.builder(
        Path.of("/absolute/sf88-runtime"),
        Path.of("/absolute/private/java-customer"))
    .node("/absolute/node")
    .operatorProfile(Path.of("/absolute/private/operator-profile.json"))
    .approvalInput(true)
    .nativeTimeout(Duration.ofMinutes(6))
    .cleanupGrace(Duration.ofSeconds(15))
    .build();

System.out.println(buyer.ready());
~~~

`build()` selects and inspects the original runtime files. `ready()` opens the
private application state through the maintained Node implementation.

The environment is inherited by default. Calling `environment(Map<String,
String>)` selects a complete replacement environment for the child, including
any PATH and existing provider references it needs. Credential values stay in
that process environment.

## Create, review, execute and reopen

`Buyer.create` accepts the original saved buyer configuration or a Java JSON
object. `Buyer.request` accepts the native request fields. `importOperation`
accepts the merchant's original portable handoff and an explicit payment-option
index. `prepare` retains the selected catalog row, request and payment option.

~~~java
import io.starforge.buyer.Json;
import io.starforge.buyer.Operation;
import java.nio.file.Path;
import java.util.Map;

Operation operation = buyer.create(
    Path.of("/absolute/private/buyer-request.json"),
    new Buyer.CreateOptions());

Map<String, Object> review = operation.review();
System.out.println(Json.stringify(review));
Operation.Result result = operation.execute(review);

System.out.println(result.status());
if (result.ok()) {
    Object response = operation.file().json(8 * 1024 * 1024);
    System.out.println(Json.stringify(response));
}
~~~

Configure the original operator profile before creating the request. Creation
retains the request, profile, exact body, response settings and any operation
ticket. The review passed to `execute` belongs to that same retained operation.
The original native terminal and spending policy then operate on the current
merchant challenge.

An intent ID is durable. After reopening the application:

~~~java
Operation original = buyer.operation("report-2026-10");
Operation.State state = original.inspect();
var completed = original.recover();
if (completed.isPresent()) {
    System.out.println(completed.get().status());
}
~~~

An empty recovery result means the original attempt has no complete recoverable
result yet. The same `inspect`, native logs and original recovery workflow show
its current state. An existing attempt continues under its same identity.

`CreateOptions.body(null)` leaves the body absent. `body(new byte[0])` preserves
an explicitly empty body. Provided bytes travel as base64 in the private call
file. An original configuration's `operation.bodyFile` continues through the
native request-file reader.

`responseFile` accepts the original response limits, expected type/digest and
stream options; the Node application owns its destination. `requestTimeout`
sets the native merchant HTTP deadline, from 1 to 300000 milliseconds.

~~~java
Buyer.CreateOptions options = new Buyer.CreateOptions()
    .body(requestBytes)
    .requestTimeout(Duration.ofSeconds(120))
    .responseFile(Json.map("maxBytes", 64 * 1024 * 1024, "timeoutMs", 120000));

Operation operation = buyer.request(Json.map(
    "intentId", "report-2026-10",
    "url", originalMerchantUrl,
    "method", "POST",
    "expect", originalExpectedTerms,
    "headers", originalRequestHeaders
), options);
~~~

The corresponding command-line workflow uses the same Java SDK:

~~~sh
java -jar /absolute/new-java-build/starforge-buyer.jar \
  --runtime /absolute/sf88-runtime --state /absolute/private/java-customer \
  --profile /absolute/private/operator-profile.json \
  create --config /absolute/private/buyer-request.json

java -jar /absolute/new-java-build/starforge-buyer.jar \
  --runtime /absolute/sf88-runtime --state /absolute/private/java-customer \
  review --id report-2026-10 --save-result /absolute/private/original-review.json

java -jar /absolute/new-java-build/starforge-buyer.jar \
  --runtime /absolute/sf88-runtime --state /absolute/private/java-customer \
  --approval-input execute --id report-2026-10 \
  --review /absolute/private/original-review.json

java -jar /absolute/new-java-build/starforge-buyer.jar \
  --runtime /absolute/sf88-runtime --state /absolute/private/java-customer \
  recover --id report-2026-10
~~~

`--approval-input` inherits the caller's real stdin. The Java SDK never supplies
an approval answer. Interactive customers should serialize use of one terminal.
The native approval implementation retains its own terminal requirements.

## Consume verified bytes and records

`operation.file()` addresses its original saved response. `NativeFile` also
addresses an inbox response, an assembled object, a dataset export or a retained
native `BuyerResult`.

| Method | Customer use |
| --- | --- |
| `verify()` | Read the original checked byte count and digest. |
| `saveAs(Path)` | Create a verified copy through the original synchronized file publisher. |
| `writeTo(OutputStream)` | Stream a complete response with bounded Java buffering. |
| `bytes(int)` | Read a complete response within an explicit memory limit. |
| `json(int)` | Decode verified UTF-8 JSON using exact decimal Java numbers. |
| `records(Format, Map, RecordConsumer)` | Consume the original NDJSON, SSE, CSV or typed dataset decoder. |

`bytes` accepts zero to 256 MiB. Use `writeTo` for larger resources. A zero limit
can receive a zero-byte file. The returned transfer records the original byte
count and digest.

~~~java
var info = buyer.operation("report-2026-10").file()
    .saveAs(Path.of("/absolute/private/report.json"));
System.out.println(info.bytes());
System.out.println(info.sha256());
~~~

A streaming callback receives data before the original decoder completes its
final checks. Commit downstream effects after the method returns successfully.
A callback can throw `IOException` to stop the original transfer.

~~~java
import io.starforge.buyer.NativeFile;

NativeFile.Transfer transfer = buyer.operation("market-events").file().records(
    NativeFile.Format.SSE,
    Json.map("allowPartial", true),
    event -> System.out.println(Json.stringify(event)));

System.out.println(transfer.records());
~~~

`allowPartial` selects the original decoder's complete-record prefix of a partial
native capture. Original stream metadata and framing rules remain attached.
CSV options include the existing `headers`, `maxFieldCharacters` and
`maxRowCharacters` fields. Dataset records use the original typed row decoder.

The Java bridge-record limit defaults to 16 MiB per encoded record. Its explicit
overload supports up to 256 MiB, independently of the native decoder limits.

~~~sh
java -jar /absolute/new-java-build/starforge-buyer.jar \
  --runtime /absolute/sf88-runtime --state /absolute/private/java-customer \
  file-copy --id report-2026-10 --out /absolute/private/report-copy.json

java -jar /absolute/new-java-build/starforge-buyer.jar \
  --runtime /absolute/sf88-runtime --state /absolute/private/java-customer \
  file-records --id market-events --format sse --partial
~~~

`file-read` writes exact streamed bytes to stdout. `file-records` writes one JSON
value per line. Their original transfer metadata goes to stderr. `file-json`
produces a structured JSON value and accepts `--limit`.

## Whole-object acquisition

Create an acquisition with the original native options, or attach a retained
original session:

~~~java
var object = buyer.attachObject(
    "annual-report", Path.of("/absolute/private/native-object-session"), false);
object.inspect();
var delivery = object.delivery(
    Path.of("/absolute/private/already-assembled-report.pdf"), Map.of());
var verified = object.file(delivery.path()).verify();
System.out.println(verified.sha256());
~~~

`createObject` passes the maintained option names directly:

~~~java
var object = buyer.createObject(Json.map(
    "id", "annual-report",
    "config", "/absolute/private/original-object-config.json",
    "objectId", originalObjectId,
    "maxTotalAtomic", "90000",
    "expectedSnapshot", originalSnapshot,
    "expectedSha256", originalDigest));
~~~

Choose the actual original object ID, snapshot and digest for the merchant.
`config` accepts the original file path or configuration object. Atomic budgets
are strings. Byte and chunk sizes remain optional; zero and an omitted size
retain their different native meanings.

`initialize`, `inspect`, `run` and `recover` operate the saved session.
`download(destination, options)` acquires missing chunks and assembles the
result. `assemble` uses acquired chunks. `delivery` reopens the original assembled
file. The selected file is an absolute assembled **file path**.

The options map carries native page controls such as `chunkOffset` and
`chunkLimit`. `accounting`, `finalizeAccounting` and `recoverAccounting` pass their
original workspace, reservation and finality options.

~~~sh
java -jar /absolute/new-java-build/starforge-buyer.jar \
  --runtime /absolute/sf88-runtime --state /absolute/private/java-customer \
  object-attach --id annual-report --session /absolute/private/native-object-session

java -jar /absolute/new-java-build/starforge-buyer.jar \
  --runtime /absolute/sf88-runtime --state /absolute/private/java-customer \
  object-delivery --id annual-report --out /absolute/private/already-assembled-report.pdf

java -jar /absolute/new-java-build/starforge-buyer.jar \
  --runtime /absolute/sf88-runtime --state /absolute/private/java-customer \
  file-copy --kind object --id annual-report \
  --delivery /absolute/private/already-assembled-report.pdf \
  --out /absolute/private/report-copy.pdf
~~~

## Paged datasets and typed rows

The adapter retains the original page limits, total atomic budget, schema,
acquisition state, export directory and accounting.

~~~java
var dataset = buyer.createDataset(Json.map(
    "id", "inventory",
    "config", "/absolute/private/original-dataset-config.json",
    "maxPages", 20,
    "maxTotalAtomic", "200000",
    "expectedSnapshot", originalSnapshot));

dataset.initialize();
dataset.run();
var delivered = dataset.deliver(Path.of("/absolute/private/inventory-export"));
NativeFile.Transfer rows = dataset
    .file(Path.of("/absolute/private/inventory-export"), "dataset.jsonl")
    .records(NativeFile.Format.DATASET, Map.of(),
        row -> System.out.println(Json.stringify(row)));
~~~

A retained session is reopened with `attachDataset(id, directory, accountingOnly)`.
`dataset(id)` addresses an acquisition registered in this same application.
`recover()` reconciles its original state. Standard exports include
`dataset.jsonl`, `dataset.csv`, `review.html` and `manifest.json`.

`exportManifest` uses the original command. Accounting methods retain the
original escrow, refund, claim and finality records. Options use the native
camel-case names; the CLI reads them from `--options`.

~~~sh
java -jar /absolute/new-java-build/starforge-buyer.jar \
  --runtime /absolute/sf88-runtime --state /absolute/private/java-customer \
  dataset-attach --id inventory --session /absolute/private/native-dataset-session

java -jar /absolute/new-java-build/starforge-buyer.jar \
  --runtime /absolute/sf88-runtime --state /absolute/private/java-customer \
  dataset-deliver --id inventory --out /absolute/private/inventory-export

java -jar /absolute/new-java-build/starforge-buyer.jar \
  --runtime /absolute/sf88-runtime --state /absolute/private/java-customer \
  file-records --kind dataset --id inventory \
  --delivery /absolute/private/inventory-export --file dataset.jsonl --format dataset
~~~

The complete [ReceiveDataset example](examples/ReceiveDataset.java) shows an
original session's receiving, typed row handling and reopened verified export.

## Operate the original inbox

An inbox has its original native directory and can receive an operation from
this same Java buyer or an original configuration file.

~~~java
var inbox = buyer.inbox(Path.of("/absolute/private/native-inbox"));
inbox.enqueue(buyer.operation("report-2026-10"));
var review = inbox.review("report-2026-10");
inbox.execute("report-2026-10", review, Path.of("/absolute/private/native-operator"));
var response = inbox.response("report-2026-10");
if (response.isPresent()) {
    Object report = inbox.file("report-2026-10").json(8 * 1024 * 1024);
    System.out.println(Json.stringify(report));
}
~~~

Use `createInbox` for a new inbox. `list`, `show`, `cancel`, `recover`,
`finalizeAccounting` and `exportReport` delegate to the original commands.
Enqueuing a Java operation requires the same `Buyer`. The original delegation
and permanent-attempt records own subsequent execution.

~~~sh
java -jar /absolute/new-java-build/starforge-buyer.jar \
  --runtime /absolute/sf88-runtime --state /absolute/private/java-customer \
  inbox-show --inbox /absolute/private/native-inbox --id report-2026-10

java -jar /absolute/new-java-build/starforge-buyer.jar \
  --runtime /absolute/sf88-runtime --state /absolute/private/java-customer \
  inbox-review --inbox /absolute/private/native-inbox --id report-2026-10 \
  --save-result /absolute/private/inbox-review.json

java -jar /absolute/new-java-build/starforge-buyer.jar \
  --runtime /absolute/sf88-runtime --state /absolute/private/java-customer \
  --approval-input inbox-execute --inbox /absolute/private/native-inbox \
  --id report-2026-10 --review /absolute/private/inbox-review.json \
  --workspace /absolute/private/native-operator
~~~

## Retained native results

For an application's original `BuyerResult` and response configuration:

~~~java
NativeFile file = buyer.response(originalRecord, originalResponseConfiguration);
var info = file.verify();
file.records(NativeFile.Format.NDJSON, Map.of(),
    record -> System.out.println(Json.stringify(record)));
~~~

The CLI uses `--kind response --record ABS --response-config ABS`. The selected
runtime's `BuyerResult` and `VerifiedFile` check the original record, size, digest
and stream metadata.

## Cancellation, errors and private records

Interrupting the Java caller thread requests termination through the original
bridge's abort signal. JVM shutdown also waits for its owned process's cleanup.
The native command deadline defaults to six minutes and cleanup grace to fifteen
seconds. Optional `callTimeout` bounds the whole Java invocation separately; its
zero default leaves the original per-command native deadline in effect.

| BuyerException field | Meaning |
| --- | --- |
| `code()` | Original native error code or Java adapter error. |
| `action()` and `operationId()` | Exact requested action and original identity. |
| `invocationDirectory()` | Private request, response and bridge diagnostics. |
| `nativeError()` | Complete original structured error and progress. |
| `result()` | Any original result accompanying a local failure. |
| `getCause()` | Java transport, consumer, timeout or interruption cause. |

Successful calls remove their own invocation files. Failed calls retain them.
Original intent, acquisition, response, spending and evidence files stay in the
application state. Continue with that same operation's inspection or recovery.

JSON results use `Map<String,Object>`, `List<Object>`, strings, booleans, null and
`BigDecimal` numbers. Typed wrappers retain all fields in `original()`. Supply
atomic amounts as the native decimal strings. The codec rejects duplicate keys,
trailing values, invalid UTF-8 and unpaired Unicode surrogates.

The invocation ceiling is 32 MiB. CLI `--body` accepts up to 20 MiB for base64 and
envelope headroom; larger files can use the original configuration's body-file
path within its own native limit. Result metadata defaults to 64 MiB; streamed
files do not enter that metadata buffer.

The complete command inventory is available with `help`. Commands reject unused
options before starting the native action. Structured results use stdout,
errors use stderr, and command errors exit with status 2.
