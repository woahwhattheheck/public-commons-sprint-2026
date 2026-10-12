# Python customer integration for channel work

Use Python to run actual recurring work through the existing native MPP product and receive its complete files. The retained Node bridge calls the same `MppChannelClient` used by the installed application. Its connection stays attached across Python calls; the native product keeps its workspace lease, task authority, SDK state and background jobs.

## Receive the complete client source

Keep this directory with the complete installed channel application:

| File | Purpose |
|---|---|
| `channel_client.py` | Python connection, native operations, work lists, recovery and file receiving |
| `channel_client.pyi` | Typed actions, work-list inputs and received-file metadata |
| `bridge.mjs` | Retained attachment to the original Node client and private atomic file writer |
| `run_work.py` | Run the supplied actual work list and receive every completed paid response |
| `receive_channel.py` | Carry a selected operating channel into the actual receiving product |
| `README.md` | Complete operation and continuation instructions |

Use Python 3.10 or later and the actual Node 22+ executable. The original MPP product must already be running. It retains its selected `@stellar/mpp 0.7.1`, `mppx 0.6.29` and `@stellar/stellar-sdk 15.1.0` runtime. Python adds no payment SDK or package installation.

The installed distribution includes this directory with `mpp-channel`. A complete native channel handover also carries all six source files. Generated Python bytecode is omitted from that source closure. Use `python3 -B` for the supplied commands to keep interpreter caches out of the source directory.

## Run useful recurring work

Select and authorize the actual task in **Channel work** first. Use the selected merchant's real endpoint and input for every original purchase. Save the complete work list with schema `stellar-forge.mpp-channel-work.v1`; its `purchases` array contains each `taskId`, stable `purchaseId` and complete `request`.

Run the retained input:

```sh
python3 -B "$MPP_CHANNEL_PYTHON/run_work.py" \
  --product "$MPP_PRODUCT" \
  --work "$ACTUAL_CHANNEL_WORK_LIST" \
  --out "$PYTHON_RESULT_DIRECTORY"
```

The command creates a private receiving directory if needed. It retains the complete original work result and receives every completed response as an immutable file with its native source, task, channel, amount, receipt and content-type metadata. The printed result gives the exact paths and digests.

The first work result stays at `channel-work.json`. A changed outcome after continuation receives a separate immutable edition beside it. The returned `file.path` selects that current edition. Every edition is bound to the same work-list digest and original workspace creation identity.

Exit status 0 means the returned work list is COMPLETE. Status 2 returns the actual pending job or unfinished original operation with the completed files. Read that original job or continue the same work list. Status 1 includes the original native error and any retained operation IDs.

`--wait-ms` controls the original client’s per-job wait. `--timeout` controls this whole Python call. A large work list can set a suitable total timeout. The work list itself is read directly by the retained Node client, keeping large source inputs out of the bridge message stream.

## Use the typed client

When this directory is on the application's module search path:

```python
from channel_client import ChannelClient

with ChannelClient(actual_product_directory) as channel:
    current = channel.state()
    saved = channel.run_purchases(
        actual_work_list,
        result_path=actual_result_file,
    )
    if saved["state"] == "COMPLETE":
        original = channel.purchase(original_purchase_id)
        received = channel.receive_response(
            original_purchase_id,
            actual_response_path,
            expected_sha256=original["response"]["sha256"],
        )
```

The example uses the actual existing task, request and response selections supplied by the application. The full work-list runner handles the same preparation/recovery joins for every supplied item.

An operator can also invoke the existing actions directly:

```python
with ChannelClient(actual_product_directory) as channel:
    saved = channel.invoke(
        "task-save",
        {"config": complete_selected_task, "expectedRevision": current_revision},
    )
    if saved["state"] == "COMPLETE":
        task = channel.task(original_task_id)
        authorized = channel.invoke(
            "task-authorize",
            {"taskId": original_task_id, "expectedRevision": task["revision"]},
            wait_ms=0,
        )
        # Read authorized["id"] with channel.job while the original terminal presents its cap.
    else:
        observed = channel.job(saved["id"])
```

Use the current revision from the actual native task record. A task correction retains its prior configurations and committed spending. The original terminal selects the new budget authority. The Python transport carries no signing keys and cannot answer that terminal.

### Available interfaces

| Python method | Original application operation |
|---|---|
| `identity()`, `state()` | Current native product identity and channel state |
| `task(id)`, `purchase(id)`, `contract(id)` | Complete selected original record |
| `record(kind, id)` | Original funder profile, funding operation, settlement or coherent observation |
| `job(id)` | Original native background job |
| `invoke(action, arguments)` | Existing task, merchant, purchase, delivery, funding, collection, refund, close or receiving action |
| `prepare_purchase`, `execute_purchase`, `resume_purchase` | Original purchase identity and retained request |
| `run_purchases(document)` | Complete supplied work-list object |
| `run_file(file, result_path=…)` | Complete supplied work-list file with immutable result editions |
| `receive_response(id, path)` | Original response bytes and complete receiving metadata |
| `receive_handover(bundle_sha256, path)` | Complete original channel file and source metadata |
| `receive_channel(file, dependency_root)` | Original whole-channel native receiver |

All `invoke` actions come from the existing channel client. Read the action list and full input shapes in the [channel guide](../README.md) and installed `channel help`. Its return is the original native job/result envelope.

The connection validates the original private product session on each operation. Calls on one Python client are serial. Closing the Python context drains and stops its own bridge attachment; the native product and its accepted jobs remain available.

## Funding, merchant collection and refunds

Python uses the same maintained financial operations as the browser and installed command. Select the actual stream from `state()`, save the complete original funder profile, and keep one stable ID for each funding operation.

```python
with ChannelClient(actual_product_directory) as channel:
    prepared = channel.invoke(
        "funding-prepare",
        {
            "stream": selected_stream_key,
            "fundingId": original_funding_id,
            "action": "top_up",
            "amountAtomic": selected_token_amount_atomic,
        },
    )
    if prepared["state"] == "COMPLETE":
        authorization = channel.invoke(
            "funding-execute",
            {"fundingId": original_funding_id},
            wait_ms=0,
        )
        # The original funder terminal reviews the amount and maximum fee.
        # Read the returned native job, then reopen the same funding record.
    else:
        pending_preparation = channel.job(prepared["id"])
```

Use `record("funding", original_funding_id)` to reopen its durable native state. `funding-resume` continues a saved transaction. `funding-reconcile` accepts the same funding ID and an optional selected archival `rpcUrl`. A signed action keeps its original envelope across Python disconnection and native product restart.

Prepare ongoing merchant collection with `collection-prepare` and `{stream, settlementId}`, then invoke `collection-execute` for that same ID. **COLLECTED** keeps the channel available for later work. A final `close-prepare` / `close-execute` uses its own ID and ends the channel. Read either through `record("settlements", original_settlement_id)`.

For the funder's remaining-balance return, `funding-prepare` accepts `action:"close_start"` and later `action:"refund"`, each with its own stable funding ID and no amount field. The application observes the actual refund ledger before preparing a refund. Its original terminal selects each action and fee.

`channel-observe` takes `{stream}` and returns one coherent selected-network observation. `record("observations", selected_stream_key)` reads the saved observation. Funding profiles, every original financial operation and their complete transaction recovery move through the existing `receive_channel.py` handover.

## Continue an interrupted operation

`ChannelError` retains `code`, `job_id`, `operation_ids`, `request_id`, `native`, `uncertain` and any `original_result`. `as_dict()` produces the complete receiving object for the caller's operation log.

A transport timeout closes that Python attachment. Open a new `ChannelClient` on the same product, inspect the saved purchase or native job, and continue that exact operation. The library performs no automatic replay. A work-list continuation reuses every supplied purchase ID; completed work returns its retained result.

If the native work finished but its result file could not be saved, the error includes the available native result summary. Receive or resume those existing records using their original IDs and a usable private output path.

Work results are source-bound before dispatch. A previously selected result path belonging to another work list or workspace stays intact. Paid response and handover files use the original private atomic writer, retain identical existing bytes and preserve conflicting files. Their sidecars record the actual native workspace and original output identities.

For a response, `expected_sha256` is its original full-byte digest. For a channel handover, `bundle_sha256` selects the bundle and `expected_file_sha256` is the optional full-byte transfer digest. Both identities are retained in the receiving metadata.

## Carry the complete operating channel

The complete receiving helper uses the actual source and receiving products. It connects to both and compares their original workspace identities before exporting:

```sh
python3 -B "$MPP_CHANNEL_PYTHON/receive_channel.py" \
  --source-product "$SOURCE_MPP_PRODUCT" \
  --receiving-product "$RECEIVING_MPP_PRODUCT" \
  --channel-file "$ORIGINAL_CHANNEL_IDENTITY_JSON" \
  --handover-id "$ORIGINAL_HANDOVER_ID" \
  --out "$COMPLETE_CHANNEL_TRANSFER_DIRECTORY" \
  --dependency-root "$RECEIVING_NATIVE_RUNTIME"
```

The channel file contains the actual complete channel identity selected in the original application. The helper exports that original operation, receives its immutable complete file, imports it into the selected receiving product and reads the receiving workspace identity and channel state.

If a native job is still running, the helper returns that exact job and status 2. Rerun with the same source, receiving product, channel identity, handover ID and output directory. The original export returns its retained file, and native receiving resumes the same bundle. Existing READY receiving returns its original completion.

For transfer across hosts, use `receive_handover` on the source host, carry that exact complete file through the existing artifact route, then call `receive_channel` on the receiving host. The complete source and native SDK selection remain those in the original bundle and receiving product.

The receiver preserves all task editions, budgets, signed commitments, merchant deliveries, responses, closes, SDK state, executable source and required inputs. Its tasks reopen as RECEIVED for the receiving operator's future authority. Existing reserved or signed purchases continue under their retained original recovery path.
