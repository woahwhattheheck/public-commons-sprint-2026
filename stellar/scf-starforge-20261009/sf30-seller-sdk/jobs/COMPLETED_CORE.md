# Continue from the completed original paid-jobs core

The cloud runner can adopt a completed original merchant journey and continue its customer and checkout work. It retains the actual native result, completed jobs, original application source and absolute paths. The earlier core phase becomes an adopted completed phase in the same CloudJobs operation.

This mode uses the original merchant state and the original cloud worker. The capsule helper handles the private transfer; the existing native operator still owns worker selection, admission, command custody, stop and artifact return.

## Capture the completed merchant

The capture command acquires the merchant's existing lease after the receiving process closes. It reads the completed core result at its exact supplied SHA256, verifies both original job states and output bytes, and captures the unchanged source/config binding.

For the completed CKQrif continuation, the current original native result is 1,242 bytes with SHA256 645b5a134345e8f6675c352ac76fbf4bc6ffa03ed3cd314ba1d85cf8d432f4e3. It reports the original report:2026.10 and recovery:2026.10 jobs and two native verifies/settlements. The report is COMPLETED at revision6, with a279-byte result whose SHA256 is9f1b3366668ce42810926ce0537a773b7696941762f9016b43a9f6532714ab0e.

Use the exact current paths from the original receiving owner:

~~~sh
python3 /absolute/source/stellar/scf-starforge-20261009/sf30-seller-sdk/jobs/native_capsule.py \
  --retained /workspace/scratch/2769ce96ce7e/scout-native-state/sf30-paid-jobs-CKQrif \
  --core-result /workspace/scratch/2769ce96ce7e/scout-native-state/native-result.json \
  --core-result-sha256 645b5a134345e8f6675c352ac76fbf4bc6ffa03ed3cd314ba1d85cf8d432f4e3 \
  --native-record /workspace/scratch/2769ce96ce7e/scout-native-records/3907ac881890b4360b15a4a808dfc0eb03b2f4e25e2fdd968e8003e024543485 \
  --out /absolute/private/completed-core.tar.gz
~~~

The output directory is an existing private directory outside the retained merchant tree. The command creates the named file once, prints its actual byte count and SHA256, and includes the full captured manifest. Its original merchant lease covers the capture and the source readback.

The completed-core capsule has schema stellar-forge.paid-job-native-completed-core.v1. It contains:

- The complete original retained file tree and each file's size/hash.
- The exact earlier native-result.json bytes and original native record directory.
- The original merchant configuration, retained source identity and completed result files.
- The actual application file at its canonical source path.
- The original application link, when the merchant reaches that source through a link inside its retained tree.

The helper reads the application path from the actual original merchant configuration and source descriptor. It preserves that real path in the transfer. A receiving merchant that moved its working directory while retaining an external original application can therefore reopen with the same source identity.

The captured source and state are read again before publication. Changed state produces a concrete capture error and keeps the original workspace available. A matching existing output file is reused; a different archive is saved under a new chosen output name.

## Transfer to the existing worker

Use the established private file route to put the completed capsule on the existing accepted worker. Its archive SHA256 becomes the explicit --sha256 argument. Keep the worker's actual ID, original job record and project directory.

The cloud payload remains a single script carrier. It fetches the complete pinned original repository first and loads native_capsule.py from that same checkout. The helper is included in source identity reporting. No separate helper install or additional controller is needed on the worker.

Select a complete source commit containing the intake product, browser approval integration, extended native continuation, native_capsule.py and the updated cloud-native.py. The maintained runtime profile supplies native payment, schema and operator dependencies from that exact source.

Invoke the accepted foreground job as:

~~~sh
python3 /absolute/worker/cloud-native.py \
  --workspace /root/commons-scf-0b8d-20261012/scf-paid-jobs \
  --out /root/commons-scf-0b8d-20261012/scf-paid-jobs/results \
  --source-commit COMPLETE_ORIGINAL_SOURCE_COMMIT \
  --capsule /absolute/private/completed-core.tar.gz \
  --sha256 ACTUAL_COMPLETED_CAPSULE_SHA256 \
  --input-mode completed-core \
  --approval browser \
  --node /absolute/node24/bin/node \
  --npm /absolute/node24/bin/npm
~~~

The existing native foreground operator wraps that complete command with its admitted capacity and artifact paths. Select these relative to the project:

- results/run-result.json
- results/run-artifacts.json
- results/native-return.tar.gz

The runner restores the captured merchant tree to its actual retainedDirectory, and restores the application to its captured real path. It creates missing private paths and verifies matching existing files. Original state that has already advanced on the same worker remains the recovery source.

## Continue customer and browser intake

The runner copies the exact earlier native result to results/baseline.json and records baseline as ADOPTED_COMPLETED. Its bytes and hash are retained, with the original source result path and native record directory. The baseline driver is skipped for this completed core.

The original customer continuation then uses the existing two accepted buyers and completed merchant results. It follows the same status and result endpoints, verifies and previews the output, adds notes, exports a collection, receives it and reopens the original customer state.

With --approval browser, the final checkout phase exercises the full self-service path:

1. Load the actual merchant intake catalog through the original HTTPS transport.
2. Save the customer input, reference and claim in the Request controller.
3. Prepare the original merchant job and retain its returned private ticket.
4. Import that ticket into the existing original checkout.
5. Read the original SF62 browser review and apply the exact disposable fixture decision.
6. Continue the original Node SDK purchase, native settlement and durable worker.
7. Retrieve the result into the original library, receive its collection and reopen the same request/checkout/customer records.

This phase uses browser-checkout:2026.10 and the existing browser fixture operation. The terminal fixture retains checkout:2026.10 and its original operation identity. The browser summary records the request, function/catalog/response hashes, exact checkout link, source modules and successful reopening.

The native fixture still uses a local facilitator, disposable signer, contract-shaped demonstration asset and verified TLS through the original explicit CONNECT transport. Its original approval, reservation, request, native SDK and application code execute through their existing interfaces.

## Resume and receive

Inspect the original native worker record after reconnecting. Continue the same accepted operation if it remains active. Completed phase outputs are reused from their original files.

The runner binds its input mode, approval mode, output directory and capsule identity on the first invocation. A later source correction can be selected while preserving that original operation and its completed phases. An attempted checkout recovers its existing native operation; the input request keeps the same original claim and ticket.

The return archive includes the exact earlier core result, customer/browser phase outputs, logs, original runtime profile/lock and a fresh capsule of the advanced retained state. run-result.json distinguishes the adopted earlier baseline from phases executed on the current worker.

Read the actual returned JSON and logs together with their recorded source and artifact hashes. The private state carrier holds the original claims and disposable keys required to continue the same operation. The smaller phase summaries carry the completed product behavior for the merchant, customer, Applications and grant integration owners.

The [general cloud runner guide](CLOUD_NATIVE.md) describes the original prepared-capsule mode, source/profile installation, foreground stop and artifact delivery in more detail.
