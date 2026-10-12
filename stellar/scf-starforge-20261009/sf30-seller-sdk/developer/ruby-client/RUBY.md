# Ruby and Rails customer applications

A seller can deliver its current OpenAPI contract as a complete Ruby customer package. The application constructs the selected request with the generated seller implementation, prepares it through the installed Node Buyer, reviews its exact terms and body, executes through the existing operator, and receives a complete response that can be reopened offline.

The package also includes a durable receiving service for Rails jobs. A stable business key selects one native intent. The application can restart, recover the same operation, import its complete saved response, and resume database processing without requesting another purchase.

For complete paginated datasets, use [Dataset receiving and Rails editions](DATASETS.md). That workflow retains the original native acquisition, receives every SF100 data file, previews all mapped row changes and commits the selected edition with its application receipt. The complete migration, models, job and commissioning command are delivered in [examples/rails_dataset](examples/rails_dataset/README.md).

## Create and deliver the customer package

Use the current seller OpenAPI exported by the maintained merchant workspace:

~~~sh
starforge client ruby export --openapi /absolute/seller-openapi.json --out /absolute/customer-package
starforge client ruby status --dir /absolute/customer-package
~~~

The same command is available directly from this source:

~~~sh
node stellar/scf-starforge-20261009/sf30-seller-sdk/developer/ruby-client/export.mjs \
  export --openapi /absolute/seller-openapi.json --out /absolute/customer-package
~~~

An already completed JavaScript customer export can receive its Ruby companions with:

~~~sh
starforge client ruby resume --dir /absolute/existing-customer-export
~~~

The exporter preserves the original five JavaScript files and their existing client-export.json. The current edition adds 21 Ruby/application files and writes ruby-client.json after every companion is complete. Each file carries an exact byte count and SHA-256. The Ruby manifest also binds the original client-export.json and seller source hash.

| File | Purpose |
| --- | --- |
| seller_client.rb | Ruby request, Buyer, Operation and offline Delivery APIs |
| seller_client.rbs | Generated operation-ID types and public API signatures |
| seller-client-bridge.mjs | Finite request construction through the generated buildRequest |
| seller-buyer-bridge.mjs | Original Node Buyer preparation, review, execution, recovery and saved-file receiving |
| seller-contract.json | Complete selected source and operation descriptions |
| rails_receiving.rb | Stable business-job preparation, explicit execution and receiving |
| customer.rb | Runnable customer CLI and one repeatable operator journey |
| RUBY.md | This operating and Rails integration guide |
| seller-dataset-bridge.mjs | Original Dataset session, recovery and complete SF100 receiving |
| dataset_delivery.rb, dataset_receiving.rb | Exact offline dataset rows and durable acquisition/receiving service |
| dataset_customer.rb, examples/dataset_lifecycle.rb | Complete operator CLI and original-session customer continuation |
| rails_dataset.rb | Complete mapping/revision preview and transaction importer |
| DATASETS.md | Dataset operation, source contract and receiving guide |
| examples/rails_dataset/ | Migration, models, job, commission command, mapping and application guide |

Inspection and copy preserve existing complete eight-file Ruby editions. Export to a new destination for the current full Dataset/Rails edition; completed existing packages retain their original manifests. The current exporter includes and verifies every nested Rails example file.

Use exact-copy delivery when transferring an existing package:

~~~sh
starforge client ruby copy --dir /absolute/customer-package --out /absolute/recipient-package
starforge client ruby copy-resume --dir /absolute/customer-package --out /absolute/interrupted-recipient
~~~

Copy and copy-resume retain the selected bytes and original manifests. Additive resume completes an interrupted export from the matching source; a conflicting companion file requires its existing source version or a new destination. Keep the completed package with the customer application so a later seller deployment does not change an existing job's contract.

## Runtime and host selection

Use Linux, Ruby 3.1 or newer with JSON, BigDecimal, CSV and the other standard libraries used by seller_client.rb, and the installed Node 24 SF88 buyer runtime. Preparation and execution load that runtime's node/index.mjs and CLI from the host-selected directory. The customer package contains application adapters; the native operator, signing integration, policy, wallet, HTTP transport, reconciliation and ledger come from that existing installation.

Each application selects a private buyer state directory. The same state directory and intent reopen the same operation. Select either an existing operator profile or an initialized native buyer workspace. The workspace route preserves its own configuration and operator identity.

~~~ruby
require_relative "customer-package/rails_receiving"

client = Starforge::SellerClient.new("/absolute/customer-package")
buyer = Starforge::Buyer.new(
  client: client,
  runtime_directory: "/absolute/scf-starforge-20261009/sf88-operator-buyer-cli",
  state_directory: "/absolute/private/ruby-buyer",
  workspace_directory: "/absolute/private/original-buyer-workspace"
)
~~~

For a profile-based customer, replace workspace_directory with operator_profile pointing to the original private profile JSON. Host environment variables remain available to the original signing and approval integrations. The adapter removes Node runtime injection variables NODE_OPTIONS and NODE_PATH. It preserves the host's original stdin and existing approval-broker environment for the native operator; approval continues in that original terminal or browser session.

Call buyer.close during application or worker shutdown. It closes admission, cancels active child calls, and waits for their cleanup. Request generation uses a finite JSON input; payment and receiving calls use private files and the original Node child lifecycle. Each call has a timeout, a private process result, and a durable response. A process cancellation leaves the original buyer's recorded attempt available for recovery.

## Select a real operation and retain its request

Inspect the delivered contract before selecting an operation:

~~~sh
ruby /absolute/customer-package/customer.rb contract --package /absolute/customer-package
~~~

In Ruby, client.operations returns the exact operation descriptions and payment choices. Select the actual operation ID, path/query inputs, payment alternative and atomic ceiling from that contract.

~~~ruby
key = "monthly-source-refresh:account-42:2026-10"
bound = client.build_request(
  ENV.fetch("SELLER_OPERATION_ID"),
  {
    "path" => JSON.parse(File.read("/absolute/private/path-inputs.json")),
    "query" => JSON.parse(File.read("/absolute/private/query-inputs.json"))
  },
  intent_id: Starforge::Receiving.intent_id(key),
  max_atomic: ENV.fetch("SELECTED_MAX_ATOMIC"),
  accept_index: Integer(ENV.fetch("SELECTED_ACCEPT_INDEX"))
)
bound.save("/absolute/private/retained-request")
~~~

Require rails_receiving.rb before using Receiving.intent_id. A plain Ruby application can instead choose its own stable intent string and use seller_client.rb directly.

build_request delegates serialization and original offer matching to the delivered JavaScript buildRequest. Ruby inputs use string keys. Path and query values follow that operation's original schema, including repeated query values. Payment ceilings remain decimal strings, including values above JavaScript's exact integer range. Integer JSON request values outside that range are rejected; use an exact string when the actual seller schema specifies a string. Unsupported Ruby objects, cycles, duplicate JSON keys and nonfinite numbers are rejected before the request bridge runs.

Use inputs["body"] for a JSON request. For an optional body, inputs["omitBody"] follows the original generator. For multipart requests, supply the complete existing multipart body as a binary Ruby String and its exact Content-Type:

~~~ruby
inputs = {
  "multipart" => {
    "body" => File.binread("/absolute/private/request.multipart"),
    "contentType" => File.read("/absolute/private/request.content-type").strip
  }
}
~~~

The adapter does not rebuild multipart boundaries. It binds the resulting body length and digest to the original request. The bridge accepts bodies up to 16 MiB and envelopes up to 64 MiB. The original generated runtime also enforces its existing JSON-body and operation-specific limits.

BoundRequest.save retains request-input.json, the generated request.json, optional request.body and request-plan.json. client.load_request verifies those bytes and reconstructs the same request using the retained customer package. The manifest and source hashes travel into the original operation's ruby-seller-source.json.

## Prepare, review, execute and recover

The direct API exposes the existing original buyer operation:

~~~ruby
begin
  operation = client.prepare(buyer, bound)
  review = operation.review
  # Present and inspect this actual native review in the existing operator flow.
  result = operation.execute(review: review)
  puts result.fetch("status")
ensure
  buyer.close
end
~~~

execute requires the selected review. The native operator still performs its own approval and policy checks. Keep this call in the actual operator session, with its original terminal or scoped browser approval integration. Background receiving jobs use recover and receive.

Operation.status returns its native state, delivery status, retry guidance and bound seller source. Operation.recover reads the same saved result and original native output. It returns nil when that operation has no recoverable result. A recoverable transport result preserves the native status, exit information, runtime error, response descriptor and stream metadata.

Each application call has a UUID separate from the purchase intent. Pass call_id when the application already retains a transport request ID. Repeating that UUID returns its saved response or reports the original unavailable reply. It does not blindly repeat a dispatched child. The original buyer's create-only attempt record independently preserves the same purchase across Ruby and Node restarts.

A new call ID is appropriate for a fresh read of evolving status or recovery. Repeating a preparation with the same exact bound request adopts an existing matching prepared operation. Repeating an execution still reaches the original single-attempt protection. Preserve an incomplete native preparation and its original state if the native runtime reports that it needs recovery.

## Receive complete data and reopen offline

After the original result contains a SAVED response, receive it into a private directory:

~~~ruby
operation = client.reopen(buyer, bound.intent_id)
delivery = operation.receive("/absolute/private/customer-receipt")
expected_manifest = delivery.manifest_sha256
~~~

Receiving copies the saved response through the existing Node result.verify and result.saveAs implementation. It retains the selected source, request, body when present, review, native result and complete response.bin. A saved receiving plan binds those files before copying, so interrupted recovery uses the same selected result. customer-delivery.json completes the handoff.

The response's native status remains in result.json. A saved response may be an application error response; inspect its original status and runtime information before applying business changes.

A later process can reopen without Node or network:

~~~ruby
require_relative "customer-package/seller_client"

delivery = Starforge::Delivery.open(
  "/absolute/private/customer-receipt",
  expected_manifest_sha256: expected_manifest
)
data = delivery.json
~~~

Delivery.open verifies every complete file, the selected manifest and source/request/review/result bindings. Each data reader uses a complete private snapshot whose SHA-256 is checked before application code receives bytes. This keeps database callbacks from acting on a response that fails its final digest.

Use delivery.bytes for a bounded binary response, each_chunk for streaming, json for JSON, and each_csv for CSV. JSON response integers retain Ruby precision and decimal values use BigDecimal. CSV with headers returns CSV::Row, retaining duplicate column names and their original order. Select fields according to the actual delivered schema.

~~~ruby
delivery.each_csv do |row|
  original_fields = row.fields
  original_headers = row.headers
  # Apply the project's explicit field mapping here.
end
~~~

Receiving artifacts are private application data. Preserve the expected manifest hash in the application's job/database record when transferring a handoff to another machine.

## One complete customer command

Create a private settings JSON using the actual installed runtime and existing host workspace:

~~~json
{
  "schema": "stellar-forge.ruby-customer-settings.v1",
  "runtimeDirectory": "/absolute/scf-starforge-20261009/sf88-operator-buyer-cli",
  "buyerDirectory": "/absolute/private/ruby-buyer",
  "jobsDirectory": "/absolute/private/customer-jobs",
  "workspaceDirectory": "/absolute/private/original-buyer-workspace",
  "node": "/absolute/bin/node",
  "timeout": 420,
  "responseFile": {
    "maxBytes": 67108864,
    "timeoutMs": 30000
  }
}
~~~

The request JSON contains operationId, inputs, maxAtomic, and optional acceptIndex/paymentFlow. Use actual values from seller-contract.json. For this CLI's multipart input, supply inputs.multipart.bodyBase64 and contentType; the CLI decodes the complete original bytes before calling the Ruby API.

~~~sh
ruby /absolute/customer-package/customer.rb run \
  --package /absolute/customer-package \
  --settings /absolute/private/customer-settings.json \
  --request /absolute/private/selected-request.json \
  --key monthly-source-refresh-account-42-2026-10
~~~

This prepares the original operation, retains its review and recovers any existing result. Add --execute in the original operator session to continue the explicit native execution. Once a response is saved, the same command receives and verifies the complete handoff.

Subsequent calls can omit --request to load the retained request plan. prepare, review, execute, recover, receive and status are also individual commands with the same settings and key. The first settings bytes are retained beside the job and must match on later calls.

A completed repeat reopens the original receiving result offline. The explicit offline command needs only the jobs root, stable key and optional expected manifest:

~~~sh
ruby /absolute/customer-package/customer.rb reopen \
  --jobs-directory /absolute/private/customer-jobs \
  --key monthly-source-refresh-account-42-2026-10 \
  --manifest-sha256 ORIGINAL_CUSTOMER_DELIVERY_SHA256
~~~

The original customer-result.json records source/package/manifest identity, native status and exact delivered files. Its state RECEIVED describes completed receiving. Keep its native status when presenting the result to users.

## Rails service and Active Job integration

rails_receiving.rb is framework independent. It can be called from a Rails service, job or console without adding a second queue. The business key should come from a persisted model identity and edition, such as a source-import row's UUID. Keep that key unchanged across framework retries.

~~~ruby
require Rails.root.join("vendor", "seller-package", "rails_receiving").to_s

class SellerImport
  def self.open(import)
    client = Starforge::SellerClient.new(import.package_directory)
    buyer = Starforge::Buyer.new(
      client: client,
      runtime_directory: import.runtime_directory,
      state_directory: import.buyer_directory,
      workspace_directory: import.original_workspace_directory
    )
    bound = client.load_request(import.request_directory)
    service = Starforge::Receiving.new(
      client: client,
      buyer: buyer,
      directory: import.jobs_directory,
      key: import.business_key,
      bound: bound,
      response_file: import.response_options
    )
    yield service
  ensure
    buyer&.close
  end
end
~~~

The fields in this service belong to your existing model. Store the actual selected host, package and request paths at import creation. Build and save that request with Receiving.intent_id(import.business_key), so the service can bind it to the same job.

An operator prepares and reviews the source import, then executes through the existing native operator session. The service retains one execution UUID before dispatch and verifies the saved review on repeat. A lost response is recovered from the original buyer.

~~~ruby
SellerImport.open(import) do |service|
  review = service.review
  # Existing operator UI/terminal presents this review.
  service.execute(review: review)
end
ReceiveSellerImportJob.perform_later(import.id)
~~~

The job receives and applies the resulting data. The example below illustrates one transaction and a retained manifest check; use your project's actual schema and uniqueness key.

~~~ruby
class ReceiveSellerImportJob < ApplicationJob
  queue_as :source_imports

  def perform(import_id)
    import = SourceImport.find(import_id)
    delivery = nil
    SellerImport.open(import) { |service| delivery = service.receive }
    payload = delivery.json

    import.with_lock do
      if import.received_manifest_sha256.present?
        raise "Different source receipt" unless
          import.received_manifest_sha256 == delivery.manifest_sha256
        return
      end
      SourceImport.transaction do
        # The existing domain service validates the real payload and uses its
        # actual unique source identifiers for inserts/updates.
        SourceImportApplier.call(import, payload)
        import.update!(
          received_manifest_sha256: delivery.manifest_sha256,
          received_directory: delivery.directory,
          received_at: Time.current
        )
      end
    end
  end
end
~~~

The domain apply and receipt update occur in the same database transaction. A retry after commit finds the original manifest and returns. A retry before commit reuses the same saved response. File receiving is complete before that transaction starts, keeping network/process lifetime outside the database lock.

Classify service errors in the existing application queue. An unfinished original response can be reviewed or recovered; changed source/request/receipt identities require resolving that original selection. Ordinary framework retry configuration applies to receiving and domain writes. Rails documents retry_on, discard_on and transaction behavior in its [Active Job guide](https://guides.rubyonrails.org/active_job_basics.html).

## Source and operations reference

The generated seller implementation and installed original Node Buyer remain the authority for supported operation inputs, payment options, approval, execution and recovery:

- [Seller developer interface](https://github.com/woahwhattheheck/public-commons-sprint-2026/blob/main/stellar/scf-starforge-20261009/sf30-seller-sdk/DEVELOPER.md)
- [Original Node buyer](https://github.com/woahwhattheheck/public-commons-sprint-2026/blob/main/stellar/scf-starforge-20261009/sf88-operator-buyer-cli/node/README.md)
- [Ruby process and pipe interfaces](https://docs.ruby-lang.org/en/3.3/Open3.html)
- [Ruby JSON implementation](https://github.com/ruby/json/blob/master/lib/json/common.rb)
- [Rails Active Job](https://guides.rubyonrails.org/active_job_basics.html)

Package inspection and copy read complete source bytes. The customer program supplies the practical operator journey over the actual selected merchant request and host. Preserve its result and native workspace with the delivered edition when handing operation to the next maintainer.

The customer command retains `customer-request.json` before native preparation or execution. Supplying `--request` again with a completed job checks the original operation, input values and atomic limit in Ruby; omitting it reopens the retained selection. Offline receiving also binds the delivery manifest to the original business intent and seller source.
