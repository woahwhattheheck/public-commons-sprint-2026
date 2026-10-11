# Go customer SDK

Use the original SF88 buyer from Go services, command-line tools and merchant integrations. This module provides durable request creation, native review and execution, recovery, verified response files, object acquisition, paged datasets and accounting. The selected Node buyer remains the implementation for the original payment, approval, delivery and recovery workflows.

## Install and select a runtime

Use Go 1.23 or newer and the Node version required by the selected [SF88 runtime](../node/README.md). The SDK uses the Go standard library and the original installed Node modules. Keep `bridge.mjs` beside the Go source in the selected runtime.

From this directory, build the customer command:

```sh
go build -o starforge-buyer ./cmd/starforge-buyer
```

For a separate Go application, add this module at a published repository revision, or use a local module replacement when consuming a source distribution:

```go
require github.com/woahwhattheheck/public-commons-sprint-2026/stellar/scf-starforge-20261009/sf88-operator-buyer-cli/go v0.0.0

replace github.com/woahwhattheheck/public-commons-sprint-2026/stellar/scf-starforge-20261009/sf88-operator-buyer-cli/go => /absolute/installed/source/stellar/scf-starforge-20261009/sf88-operator-buyer-cli/go
```

`RuntimeDirectory` selects the original SF88 directory containing `node/index.mjs`. `StateDirectory` selects the original Node application's private state directory. Both paths must be absolute. Existing Node operations, object entries and dataset entries can be reopened by selecting that same state directory. The Go bridge stores its temporary invocation files under `.go-calls` within it.

The command accepts `-runtime`, `-state`, `-bridge`, `-node`, `-profile` and `-timeout` before the command name. `-bridge` is useful while consuming a new Go adapter with an existing original runtime.

```sh
./starforge-buyer -runtime /absolute/sf88-runtime -state /absolute/customer-state ready
./starforge-buyer -runtime /absolute/sf88-runtime -state /absolute/customer-state list
```

## Create, review, execute and recover

The following application creates an intent from an original buyer configuration, displays its review, executes through the original approval terminal, then consumes the verified JSON response.

```go
package main

import (
    "context"
    "encoding/json"
    "fmt"
    "os"
    "os/signal"
    "syscall"

    buyer "github.com/woahwhattheheck/public-commons-sprint-2026/stellar/scf-starforge-20261009/sf88-operator-buyer-cli/go"
)

func run(ctx context.Context) error {
    client, err := buyer.New(buyer.Options{
        RuntimeDirectory: os.Getenv("STARFORGE_RUNTIME"),
        StateDirectory: os.Getenv("STARFORGE_STATE"),
        OperatorProfile: os.Getenv("STARFORGE_OPERATOR_PROFILE"),
        ApprovalInput: os.Stdin,
    })
    if err != nil { return err }
    operation, err := client.CreateFromFile(ctx, os.Getenv("STARFORGE_CONFIG"), buyer.CreateOptions{})
    if err != nil { return err }
    review, err := operation.Review(ctx)
    if err != nil { return err }
    fmt.Fprintln(os.Stderr, string(review))
    result, err := operation.Execute(ctx, review)
    if err != nil { return err }
    if result == nil || !result.OK {
        return fmt.Errorf("original operation status: %+v", result)
    }
    var response map[string]any
    if err := operation.File().JSON(ctx, &response, 8<<20); err != nil { return err }
    return json.NewEncoder(os.Stdout).Encode(response)
}

func main() {
    ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
    defer stop()
    if err := run(ctx); err != nil {
        fmt.Fprintln(os.Stderr, err)
        os.Exit(1)
    }
}
```

An intent ID is durable. After restarting the application, reopen it with `client.Operation(intentID)`. `Inspect` returns the original state and recovery availability. `Recover` returns the completed original result, or a nil result when a complete outcome is still unavailable. Use it after cancellation or a lost caller response to reconcile the existing attempt.

Review and execution use the original configuration, exact request body, ticket and state checks. Present the returned review and pass those same bytes to `Execute`. The original terminal consumes its own approval through `ApprovalInput`; a nil input closes the terminal's input. Give concurrently executing interactive operations separate terminals, or serialize their approval interaction.

`CreateOptions.Body` distinguishes an absent request body (`nil`) from an explicitly empty one (`[]byte{}`). `CreateRequest` takes the native URL, method, headers, expectations and order reference. `ImportOperation` consumes the original portable operation handoff. `Discover` and `Prepare` preserve the original catalog and selected payment option.

Equivalent customer commands:

```sh
./starforge-buyer -runtime /absolute/runtime -state /absolute/state create -config /absolute/buyer.json -body /absolute/request-body.bin
./starforge-buyer -runtime /absolute/runtime -state /absolute/state review -id order-42 -out /absolute/review.json
./starforge-buyer -runtime /absolute/runtime -state /absolute/state execute -id order-42 -review /absolute/review.json
./starforge-buyer -runtime /absolute/runtime -state /absolute/state inspect -id order-42
./starforge-buyer -runtime /absolute/runtime -state /absolute/state recover -id order-42
```

Omit `-body` to preserve an absent body. Output paths for saved reviews and copied deliveries must be new paths. The command writes structured results to stdout and diagnostics to stderr.

## Consume original response bytes and records

`operation.File()` addresses the original saved response. Its methods delegate to the selected runtime's verified file reader:

| Method | Application use |
| --- | --- |
| `Verify(ctx)` | Read the saved file's checked size and SHA-256. |
| `SaveAs(ctx, destination)` | Publish a verified copy using the original non-overwriting, synchronized file operation. |
| `WriteTo(ctx, writer)` | Stream a large response with backpressure and bounded buffering. |
| `Bytes(ctx, limit)` | Read a complete verified response within an explicit byte limit. |
| `JSON(ctx, &value, limit)` | Decode the original bytes directly in Go; interface-valued numbers use `json.Number`. |
| `Records(ctx, format, options, consume)` | Consume original NDJSON, SSE, CSV or dataset records. |

Wait for a successful return from `WriteTo` or `Records` before committing downstream effects. A consumer callback can stop a stream by returning an error. `Bytes` supports limits up to 256 MiB; use `WriteTo` for larger files.

```go
file := client.Operation("market-events").File()
transfer, err := file.Records(ctx, buyer.SSE, buyer.RecordOptions{
    AllowPartial: true,
}, func(event json.RawMessage) error {
    return json.NewEncoder(os.Stdout).Encode(event)
})
if err != nil { return err }
fmt.Fprintln(os.Stderr, transfer.Records)
```

`AllowPartial` selects the original decoder's complete-record prefix of a partially captured response. SSE and NDJSON decoding require the original response stream metadata. The selected runtime checks the original saved bytes and stream framing; CSV and dataset consumption use their original codecs.

```sh
./starforge-buyer -runtime /absolute/runtime -state /absolute/state copy -id order-42 -out /absolute/order.json
./starforge-buyer -runtime /absolute/runtime -state /absolute/state read -id order-42
./starforge-buyer -runtime /absolute/runtime -state /absolute/state records -id market-events -format sse -partial
```

## Acquire and reopen objects

`CreateObject` accepts an original configuration or `ConfigFile`, stable `ID`, `ObjectID`, exact total atomic budget, expected byte count, chunk size, snapshot, digest and content type. Atomic amounts are strings. Pointer byte fields retain the difference between an omitted value and zero bytes. Use `AttachObject` to register an existing original native session in the selected application.

```go
object, err := client.AttachObject(ctx, "annual-report", "/absolute/native/object-session", false)
if err != nil { return err }
delivery, err := object.Delivery(ctx, "/absolute/existing/report.pdf", buyer.PageOptions{ChunkLimit: 50})
if err != nil { return err }
info, err := object.File(delivery.Path).Verify(ctx)
if err != nil { return err }
fmt.Println(info.Bytes, info.SHA256)
```

`Initialize`, `Inspect`, `Run` and `Recover` use the original native session and command results. `Download` performs its resumable acquisition and assembly. `Assemble` constructs a delivery from the acquired bytes. `Delivery` reopens the original assembled result. Whole objects, zero-byte objects and chunked objects follow the selected runtime's original acquisition path.

Select an object by its original assembled **file path**. `ObjectDelivery.Path` returns that path for a subsequent `object.File(delivery.Path)` call. Omit the path to reopen the latest original assembly.

```sh
./starforge-buyer -runtime /absolute/runtime -state /absolute/state object-attach -id annual-report -session /absolute/native/object-session
./starforge-buyer -runtime /absolute/runtime -state /absolute/state object-delivery -id annual-report -delivery /absolute/existing/report.pdf
./starforge-buyer -runtime /absolute/runtime -state /absolute/state object-copy -id annual-report -delivery /absolute/existing/report.pdf -out /absolute/report-copy.pdf
./starforge-buyer -runtime /absolute/runtime -state /absolute/state object-report -id annual-report -format html -out /absolute/object-review.html
```

`PageOptions` chooses the original chunk report offset and limit. Use `Accounting`, `Finalize` and `RecoverAccounting` for the original escrow, refund, claim and finality workflow. Their options and returned records preserve the native schema.

## Acquire paged datasets and use typed rows

`CreateDataset` takes the original configuration, maximum page count, total atomic budget, optional row and page-byte limits, and expected snapshot. `AttachDataset` reopens an existing native session. `Run`, `Recover` and `Deliver` preserve the original page, schema, accounting and delivery behavior.

```go
dataset, err := client.AttachDataset(ctx, "inventory", "/absolute/native/dataset-session", false)
if err != nil { return err }
deliveryDirectory := "/absolute/existing/dataset-delivery"
_, err = dataset.Deliver(ctx, deliveryDirectory)
if err != nil { return err }
transfer, err := dataset.File(deliveryDirectory, "dataset.jsonl").Records(
    ctx, buyer.DatasetRows, buyer.RecordOptions{},
    func(row json.RawMessage) error { return json.NewEncoder(os.Stdout).Encode(row) },
)
if err != nil { return err }
fmt.Fprintln(os.Stderr, transfer.Records)
```

Declared exports are `dataset.jsonl`, `dataset.csv`, `review.html` and `manifest.json`. Use `DatasetRows` for the original typed row decoder. `ExportManifest` exports the native manifest, and the dataset accounting methods reopen or finish the original payment accounting.

```sh
./starforge-buyer -runtime /absolute/runtime -state /absolute/state dataset-attach -id inventory -session /absolute/native/dataset-session
./starforge-buyer -runtime /absolute/runtime -state /absolute/state dataset-deliver -id inventory -out /absolute/existing/dataset-delivery
./starforge-buyer -runtime /absolute/runtime -state /absolute/state dataset-rows -id inventory -delivery /absolute/existing/dataset-delivery
./starforge-buyer -runtime /absolute/runtime -state /absolute/state dataset-copy -id inventory -delivery /absolute/existing/dataset-delivery -file dataset.csv -out /absolute/inventory.csv
```

The `object-create` and `dataset-create` commands read `-options /absolute/options.json`. Options use the Go field names or their case-insensitive JSON spellings, such as `id`, `configFile`, `objectId`, `maxPages` and `maxTotalAtomic`. Choose either `config` or `configFile` for an acquisition.

## Run the merchant inbox from Go

`client.Inbox(directory)` opens the original durable native inbox. `CreateInbox` initializes one through the original implementation. `Enqueue` delegates an operation belonging to the same buyer, retaining its exact body and ticket; `EnqueueConfig` accepts an original configuration file. `Review`, `Execute`, `Cancel`, `Recover` and `Finalize` operate on the original intent. `Show`, `List`, `Response` and `ExportReport` expose the resulting native state.

```go
inbox, err := client.Inbox("/absolute/native/inbox")
if err != nil { return err }
response, err := inbox.Response(ctx, "order-42")
if err != nil { return err }
if response == nil { return fmt.Errorf("order response is still pending") }
var order map[string]any
if err := inbox.File("order-42").JSON(ctx, &order, 8<<20); err != nil { return err }
fmt.Println(response.Status, order)
```

`Inbox.File(intentID)` supports the same verified file, JSON, CSV and response-stream methods. `InboxResponse.Job` contains the native job and its original outcome; `InboxProgress.Process` describes the command just performed. The CLI supports the full inbox workflow:

```sh
./starforge-buyer -runtime /absolute/runtime -state /absolute/state inbox-show -inbox /absolute/native/inbox -id order-42
./starforge-buyer -runtime /absolute/runtime -state /absolute/state inbox-review -inbox /absolute/native/inbox -id order-42 -out /absolute/inbox-review.json
./starforge-buyer -runtime /absolute/runtime -state /absolute/state inbox-execute -inbox /absolute/native/inbox -id order-42 -review /absolute/inbox-review.json
./starforge-buyer -runtime /absolute/runtime -state /absolute/state inbox-response -inbox /absolute/native/inbox -id order-42
./starforge-buyer -runtime /absolute/runtime -state /absolute/state inbox-copy -inbox /absolute/native/inbox -id order-42 -out /absolute/merchant-order.json
```

`inbox-enqueue` takes the original buyer intent ID. `inbox-enqueue-config` takes `-config`. `inbox-finalize` reads an original options file with `-options`, including the native `workspaceDirectory`. `inbox-report` writes a new `-out` path and accepts the original `-workspace`. `InspectOperationHandoff` inspects the complete merchant packet before selecting a native payment option.

## Consume a retained native response

`client.Response(record, responseConfiguration)` exposes the selected runtime's public `BuyerResult` reader. Pass the original native record and original response-file configuration as `json.RawMessage`. This is useful for an SF31 stream capture retained by an existing application. The file reader uses the original response metadata, digest and framing.

```go
file := client.Response(originalRecord, originalResponseConfiguration)
transfer, err := file.Records(ctx, buyer.NDJSON, buyer.RecordOptions{},
    func(value json.RawMessage) error { return json.NewEncoder(os.Stdout).Encode(value) },
)
if err != nil { return err }
fmt.Fprintln(os.Stderr, transfer.Records)
```

The `response-verify`, `response-read`, `response-copy` and `response-records` commands take `-record /absolute/original-record.json` and `-response-config /absolute/original-response-config.json`. Select `-format sse -partial` to consume the original complete-event prefix of a partial SSE capture, or `-format ndjson` for a complete NDJSON response.

## Cancellation and operational recovery

Each method accepts a context. Cancellation reaches the bridge's abort signal and the original runtime's child-process cleanup. `NativeTimeout` controls the native command deadline; `CleanupGrace` controls its termination grace. The default native timeout is six minutes and the default cleanup grace is fifteen seconds.

`CallError` includes the action, intent or acquisition ID, native error code and retained invocation directory. Its wrapped cause supports `errors.Is(err, context.Canceled)` and `errors.Is(err, context.DeadlineExceeded)` when cancellation caused the failure. Inspect the private bridge stderr and the original native command logs for the exact operation, then call the original recovery method for that intent or acquisition.

Successful calls remove their own temporary invocation files. Failed calls retain them for diagnosis. Keep application state and operator profile paths private. Configuration, body and review data travel through private files; the child-process arguments contain only the bridge and request file paths.

Native result and accounting records use `json.RawMessage` where the source schema evolves. Go callers can bind those records to their application structs while retaining the selected runtime's complete fields.

