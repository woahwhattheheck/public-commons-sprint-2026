# Managed Ruby environments and received Rails applications

This component runs the complete original Ruby customer and Rails application with a selected host Ruby interpreter and a private Bundler installation. It retains the exact project source, resolved Gemfile.lock, Bundler version, dependency cache, original customer client, application rows and import history. Its two Applications entries open the environment desk and the registered Rails application through the existing managed command lifecycle.

The main command is `starforge ruby-runtime`. The direct source entry is `node stellar/scf-starforge-20261009/distribution/ruby-runtime/cli.mjs`. The browser guide is [workspace/README.md](workspace/README.md); the native receiving example is [examples/customer-runtime.mjs](examples/customer-runtime.mjs).

## Install the actual selected environment

The host supplies Linux, Node.js, `flock`, a real absolute Ruby executable at version 3.1 or newer, and the native development tools needed by its selected gems. Probe uses the selected executable and reports its actual Ruby, RubyGems and installed Bundler versions.

```sh
starforge ruby-runtime probe --ruby /usr/bin/ruby
starforge ruby-runtime init --directory /private/customer-ruby
starforge ruby-runtime create --directory /private/customer-ruby \
  --id customer --title "Customer Rails application" \
  --ruby /usr/bin/ruby --bundler-version 2.6.9 \
  --request-id 9050d878-a73e-4516-8b75-17ab5a02339d
starforge ruby-runtime install --directory /private/customer-ruby \
  --id customer --operation-id 9c359b20-3d5f-425a-8d68-f5d30b1f9639 --wait
```

Choose the exact Bundler version appropriate for the selected Ruby. If that version is absent, the installation downloads it into this environment's private bootstrap directory and retains its complete original gem. The default Gemfile resolves Rails, Active Record/Active Job, SQLite, Rack/Rackup, Puma, Nokogiri and BigDecimal. The actual Ruby dependency loader and an in-memory SQLite operation complete before the environment becomes READY.

An existing project can supply `--project-directory /absolute/project --gemfile Gemfile`. The complete selected project is copied; `.git`, `.bundle` and `vendor/bundle` are excluded. Its original lock is retained when present. Without a lock, Bundler resolves it once and the runtime saves those exact bytes **before installing dependencies**. Relative Path gems must stay within the selected copied project. Source files and the lock remain available in the desk.

The runtime sets its own GEM_HOME/GEM_PATH and Bundler configuration, path, cache, frozen lock and version. It retains ordinary host environment values required by the selected project; existing BUNDLE_* settings and Ruby load overrides are replaced by the private installation configuration. A project that reads environment variables keeps that behavior. The retained project itself should contain environment references for secret values.

## Continue the original customer operation

After install, `run` invokes one of the two source-owned customer programs through this exact bundle:

| Entry | Original program |
| --- | --- |
| `native-dataset-lifecycle` | `developer/ruby-client/examples/native_dataset_lifecycle.rb` |
| `baserow-customer-lifecycle` | `baserow/customer/lifecycle.rb` |

Arguments after `--` are passed as literal arguments, with no shell. The original program retains its own dataset identity, query, receipt, source binding and business operation. The runtime saves a separate execution UUID and complete stdout for installation and process recovery.

For an existing native receiving room:

```sh
starforge ruby-runtime run --directory /private/customer-ruby \
  --id customer --entry native-dataset-lifecycle \
  --operation-id 741aacbc-9892-40d7-a69f-b373d594ba97 --wait -- \
  run --out /private/original-customer-application \
  --room /private/original-native-room \
  --native-manifest-sha256 ORIGINAL_MANIFEST_SHA256 \
  --source-key ORIGINAL_SOURCE_KEY --dataset-id ORIGINAL_DATASET_ID \
  --checkout /absolute/original-source --python /usr/bin/python3 --node /absolute/node \
  --key ORIGINAL_RECORD_ID_FIELD
```

Use the existing room, output, source key and dataset ID from the customer operation. The native program performs complete receiving, exact mapping, the transactional import, original receipt and a fully moved recipient application. The Baserow entry accepts its maintained `run --native-run ...` or `resume --directory ...` command and uses the original published selection and every applicable attachment.

Both programs remain complete source packages inside `environments/ENV/client`. Their own completed reopen operates on the original retained delivery. The runtime's `customer-stdout.txt` is downloadable through `file`.

## Register and operate the application

Select the **complete delivered application** produced by the original customer program. Native receiving uses `received-application` or `recipient` with `application-delivery.json`. The Baserow customer uses `delivered-application` with its original `application.json` and `operator-result.json`.

```sh
starforge ruby-runtime register --directory /private/customer-ruby \
  --id customer-app --title "Customer data" --environment-id customer \
  --application-directory /private/original-customer-application/received-application \
  --request-id 615497ba-2e31-4ad5-ae7e-9d6b145cdf61 --wait
starforge ruby-runtime launch --directory /private/customer-ruby \
  --id customer-app --operation-id ca0b680f-c9ee-427a-a2ca-e2f8698f4d26 --port 9292
starforge ruby-runtime application --directory /private/customer-ruby --id customer-app
```

Registration copies the full original application into its own managed working directory. It runs the original Rails controller, real signed forms and CSRF handling, saved preview, import job, receipts, history and attachment receiving on those actual customer records. The native original immutable database is retained separately from its managed operating database.

The URL appears after the actual Puma listener returns an authenticated HTTP 200. Open the current private URL from the desk or Applications. Its fragment is exchanged for a private HttpOnly cookie. The original Rails authentication and CSRF checks still control application actions. The workspace shows the active operation, startup identity and complete process output.

The received Rails interface includes source selection, full paginated changes, exact target preview, retained approval, committed history, original CSV/JSON/receipt files and original attachment links. Application input and tenant scope continue through the maintained Rails importer and operator.

Stop and verify the complete current state:

```sh
starforge ruby-runtime stop --directory /private/customer-ruby --id customer-app
starforge ruby-runtime verify --directory /private/customer-ruby \
  --id customer --application-id customer-app \
  --operation-id d2b37df6-d0b8-4e87-b07b-19659fc7e7d8 --wait
```

The stopped application verification opens the real database, checks the original exact target rows and source mapping, verifies every retained edition receipt, and reads the rendered Rails pages and original receipt downloads. Its complete `application-verification.json` is retained in that operation.

## Whole runtime export and receiving

Export is admitted with the same application lock and original database lock used by launch. Stop the app first. The archive contains the original project and client, exact lock, cached Bundler gem, complete gem source cache, installation/source metadata and every file in the selected managed application.

```sh
starforge ruby-runtime export --directory /private/customer-ruby \
  --id customer --application-id customer-app \
  --operation-id a9156e8c-23aa-4ad7-960c-54b11c8491d0 --wait
starforge ruby-runtime file --directory /private/customer-ruby \
  --operation-id a9156e8c-23aa-4ad7-960c-54b11c8491d0 \
  --name ruby-runtime.tar --out /private/ruby-runtime.tar

starforge ruby-runtime init --directory /private/received-ruby
starforge ruby-runtime receive --directory /private/received-ruby \
  --id received --title "Received customer" --ruby /usr/bin/ruby \
  --archive /private/ruby-runtime.tar --expected-sha256 ORIGINAL_ARCHIVE_SHA256 \
  --operation-id 1f99940c-3fae-462a-bc29-b8e1f028a506 --wait
```

Receiving verifies the exact archive SHA, manifest and every full regular member before restoring source or application state. It installs from the original retained cache with `bundle install --local`. The selected Ruby engine, Ruby ABI, architecture and platform must match the archive. Native extension compilation may still require the host's development tools. A different host path for the compatible Ruby executable is supported.

The received application gets its own local application ID, environment selection and working directory, while retaining its original source, mapping, dataset, receipts and complete files. The receive result returns this ID. Launch or verify it through the same command/API.

Archives are manifest-first, uncompressed regular-file ustar `.tar` files, up to 4 GiB and 100,000 members. Full names must fit ustar's 255-byte UTF-8 path limit. The receiver rejects changed, duplicate, partial or nonregular members. Browser upload retains the same operation UUID, expected length and SHA before forwarding the archive to this original receiver.

## Restart, cancellation and logs

Each environment is an immutable selected source. Each operation retains its exact arguments before dispatch. Repeating the same operation UUID with different arguments returns `RUBY_OPERATION_CHANGED`; the original result and files remain available. The browser closes its own requests and server cleanly while an admitted detached installation or customer operation continues.

```sh
starforge ruby-runtime operation --directory /private/customer-ruby --operation-id ORIGINAL_UUID
starforge ruby-runtime log --directory /private/customer-ruby --operation-id ORIGINAL_UUID --offset 0
starforge ruby-runtime cancel --directory /private/customer-ruby --operation-id ORIGINAL_UUID
starforge ruby-runtime resume --directory /private/customer-ruby --operation-id ORIGINAL_UUID --wait
```

Cancellation and worker admission share the same retained generation. It reaches the actual Ruby child and descendant process group. The original kernel lease stays alive until those processes drain. Explicit resume keeps the original request, source and lock and advances the attempt into a separate build directory. A completed native result is adopted if its outer response was lost. Downloads return an independent, unlinked, full hash-verified snapshot; browser closure cannot mutate the retained original output.

## Actual customer commissioning

`examples/customer-runtime.mjs` consumes a private source selection JSON. It can first continue the existing customer program or start with an already completed application:

```json
{
  "schema": "stellar-forge.ruby-runtime-customer-selection.v1",
  "ruby": "/usr/bin/ruby",
  "bundlerVersion": "2.6.9",
  "title": "Original customer application",
  "environmentId": "customer",
  "applicationId": "customer-app",
  "applicationDirectory": "/private/original-customer-application/received-application",
  "sourcePort": 9292,
  "recipientPort": 9293
}
```

An optional `customer` object contains `entry` and the complete original literal `argv` array. Use its original operation's existing source and output paths.

```sh
node stellar/scf-starforge-20261009/distribution/ruby-runtime/examples/customer-runtime.mjs \
  --directory /private/customer-runtime-journey --selection /private/original-customer-selection.json
```

The example retains every operation UUID before execution. It installs, continues the original customer when selected, registers and operates the real Rails application over authenticated HTTP, stops it, exports the complete runtime, temporarily parks its own producer runtime, receives the archive offline, opens the new application and verifies the original current rows/history. It then reopens the actual recipient before restoring the producer. `runtime-customer-result.json` contains the full selected operation/source, exact archive, native results, HTTP observations and recipient identity. Repeating the same command resumes the saved phases.

## Program interface and source

`openRubyRuntime({directory, create:false})` returns the model used by the CLI, browser and Applications provider. Its full methods are `inspect`, `probe`, `create`, `start`, `run`, `resume`, `cancel`, `operation`, `log`, `application`, `registerApplication`, `launchApplication`, `stopApplication`, `receive`, `openFile` and `close`. `runApplication` is the foreground managed Applications route. All original IDs, selection hashes, phases, outputs and startup records remain in that one model.

Dependency behavior follows the primary [Bundler configuration](https://guides.rubygems.org/command-reference/bundle-config/), [lock](https://guides.rubygems.org/command-reference/bundle-lock/) and [cache](https://guides.rubygems.org/command-reference/bundle-cache/) interfaces. The live application uses the original [Puma server](https://github.com/puma/puma/blob/master/lib/puma/server.rb). Customer receiving and Rails mapping stay in the maintained [Ruby client](../../sf30-seller-sdk/developer/ruby-client/NATIVE_DATASETS.md), [Rails importer](../../sf30-seller-sdk/developer/ruby-client/examples/rails_dataset/README.md), and [Baserow customer](../../sf30-seller-sdk/baserow/customer/README.md).
