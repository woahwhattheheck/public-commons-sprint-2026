# Dataset operator for the original Rails application

This package adds a complete, server-rendered dataset receiving and import interface to Rails. An operator selects a received delivery, reads every original row, configures application fields, reviews the complete resulting changes, and imports the selected edition through the application's original Active Record models. Original attachments, every historical receipt and a complete review handoff remain available.

The interface uses neutral grayscale styles and ordinary HTML forms. It includes the source inbox, full source profiles and row browser, field mapping forms, complete paginated change review and filters, typed before/after values, original source JSON, background preparation/import, retry of the same operation, refresh from the review's saved source, edition history, original file downloads, and full JSON/CSV/TAR exports.

## Use the complete Baserow customer package

The installed command is:

~~~sh
starforge baserow-source customer --help
~~~

The provider's customer lifecycle prepares the original published Baserow candidate, receives its complete SF100 dataset and selected files, copies the complete client and customer package, and invokes this operator in its existing application directory. See the Baserow customer's README for the selected run/candidate, query and original operation arguments.

The stable Ruby entry is:

~~~ruby
require "/absolute/customer-client/baserow/customer/baserow_customer_receiving"
require "/absolute/customer-client/developer/ruby-client/examples/rails_dataset/operator/commission"

result = Starforge::DatasetOperator::Commission.run(
  customer_directory: "/private/complete-baserow-delivery",
  manifest_sha256: original_baserow_delivery_manifest_sha256,
  directory: "/private/customer-application",
  source_key: original_source_key,
  record_id_column: original_record_id_output_alias
)

reopened = Starforge::DatasetOperator::Commission.reopen(
  directory: "/private/customer-application"
)
raise "Changed application" unless reopened == result
~~~

Use the original customer package's source key and projected record-ID alias. The mapping is derived from the actual native column metadata. Integer and Boolean columns retain their types; number values use exact decimal text; original record IDs form the unique tenant business key. All received rows are imported into the commissioner's actual SQLite database.

The commissioner uses a real Rails application and its middleware. It follows rendered forms through HTTP Basic authentication, session CSRF and signed selections, executes the actual import jobs, reads every change page, downloads complete exports and edition receipts, follows all original attachment references, and refreshes from saved source after the import. It then disconnects and reopens the application, verifies the full original receipt and current database records, and repeats the rendered receiving flow. A failure raises; completion returns schema `stellar-forge.baserow-rails-operator-application.v1` with state `COMPLETE`, the exact observed result and every retained application's relative file descriptor.

Rails 7.1 or later supplies Action Pack, Active Job, Nokogiri and Rack. The original native receiving lifecycle supplies Active Record and SQLite. Run with the same compatible bundle as the receiving application. The optional interactive server also uses the ordinary `rackup` and `puma` gems.

## Open the commissioned application in a browser

Load the copied provider class and start the included local server:

~~~sh
ruby -r /absolute/customer-client/baserow/customer/baserow_customer_receiving \
  /absolute/customer-client/developer/ruby-client/examples/rails_dataset/operator/install.rb \
  --directory /private/customer-application --port 9292
~~~

Open `http://127.0.0.1:9292/dataset_imports`. The HTTP Basic user is `operator`; the password is the application's private `access-key` file. The server binds to loopback. The complete application directory contains the original received customer, SQLite database, mappings, both reviews, original source copies, complete downloads, rendered receiving pages and completion result. Keep that directory private.

The commissioner uses inline jobs so its one process can complete the real journey. An existing application uses its own configured queue and authentication, as described below.

## Install in an existing Rails application

The host keeps its original database, target models, authentication, tenant policy and job queue. Copy or vendor the complete native client source. Apply the original dataset-history migration in the same database as the target records. See the parent Rails example for model and mapping definitions.

Include the concern in a controller that inherits from the host's authenticated application controller:

~~~ruby
require Rails.root.join("vendor/starforge/examples/rails_dataset/operator/controller")

class DatasetImportsController < ApplicationController
  include Starforge::DatasetOperator::Controller

  private

  def starforge_dataset_authorize!
    # Call the host's actual import permission policy here.
    # This example assumes the application supplies authorize!.
    authorize!(:manage_dataset_imports, current_account)
  end

  def starforge_dataset_tenant_key
    current_account.id.to_s
  end

  def starforge_dataset_actor
    current_user.id.to_s
  end
end
~~~

All three methods are required. The concern's default methods raise until the application supplies its actual context. Read and write actions pass through that same policy. The host's CSRF/session middleware stays enabled. Signed selections bind the source, review, tenant and operator for 24 hours.

Add routes:

~~~ruby
resources :dataset_imports, only: [:index, :show, :create] do
  collection do
    get :stylesheet
    post :create_source
  end
  member do
    get :mapping
    post :save_mapping
    post :prepare_source
    get :source_rows
    get :source_export
    get :mapping_export
    post :prepare
    post :refresh
    post :commit
    get :changes
    get :history
    get :attachments
    get :records
    get :record
    post :capture_data
    get :data_export
    get :data_attachment
    get :download
    get :receipt
    get :attachment
    get :handoff
  end
end
~~~

Configure the shared resolver during application boot so web requests and workers reconstruct the same authorized context. The following uses the supplied example models; replace the target scope and catalog with the application's actual model relation and received-delivery records:

~~~ruby
Starforge::DatasetOperator.workspace_resolver = lambda do |tenant_key|
  Starforge::DatasetOperator::Workspace.new(
    directory: Rails.root.join("storage/dataset-operator").to_s,
    tenant_key: tenant_key,
    streams: Starforge::DatasetExample::DatasetStream.where(tenant_key: tenant_key),
    target_scope: ->(_stream) {
      Starforge::DatasetExample::CatalogRecord.where(tenant_key: tenant_key)
    },
    models: Starforge::DatasetExample::MODELS,
    catalog: -> {
      # Server-side records selected from the actual received-delivery inbox.
      received_dataset_candidates_for(tenant_key)
    },
    formats: {
      "baserow" => ->(directory, sha) {
        Starforge::BaserowCustomerDelivery.open(
          directory: directory, expected_manifest_sha256: sha
        )
      }
    }
  )
end
~~~

Create the `storage` parent directory privately before use. The operator creates its own private root and per-tenant review directories. Web and background workers need access to the same private filesystem and database. Configure a durable Active Job adapter in the host; preserve the original review directory while an operation is queued or running.

Each catalog candidate is a server-controlled object:

~~~ruby
{
  id: "customer-source-edition-3",
  title: "Customer catalog / received edition 3",
  stream_id: original_dataset_stream.id,
  directory: "/private/complete-received-customer",
  format: "baserow", # "dataset" opens a standalone original DatasetDelivery
  manifest_sha256: original_complete_manifest_sha256,
  mapping: original_application_mapping
}
~~~

A candidate can supply `mapping_path` instead of a mapping object, or omit both to select the complete source before configuring fields. An omitted mapping is retained as an empty definition. The browser receives signed selections; filesystem paths, target models and the authorized relation come from the application. Each tenant stream is checked against the resolver's original scoped relation.

## Configure fields from the complete original source

Choose **Read source and configure fields** in the received-delivery inbox. The application retains the original candidate and review ID, then its `SourcePrepareJob` copies the complete delivery and profiles every row. The source page shows all projected columns, observed value types, separate empty and missing counts, and actual text lengths. **Browse every source row** opens the entire dataset in pages of 100 rows. Each row keeps its original JSON, field names, exact numbers and source order; full CSV and JSONL downloads contain the original dataset bytes.

Source preparation does not require a usable target mapping. A delivery with missing or incomplete mapping can therefore be inspected and handed off before the field choices are ready. **Read or resume complete source** continues the same review after an interrupted queue call. A complete source-only handoff contains its original selection, delivery, source rows, profile and index.

The mapping form is built from the original application's actual target relation and database schema. It lists supported, nonprotected fields and their text lengths or numeric precision. Record-key choices come from existing nonpartial unique indexes within that relation. Composite keys retain every component. The tenant's fixed scope values stay under the application's control.

For an existing stream, the original key columns and every original key-conversion option remain attached to its records. For a new stream, choose an available unique record key and supply a source column for every key field. The complete preview checks the actual values and any duplicate keys.

For each other field, choose its source column and how to handle an explicit empty value or a missing value. Leaving a field unselected keeps it outside the dataset's managed columns. Text fields can explicitly convert numbers and Boolean values to their exact text. Dates and date-times use the original importer's conversion rules. The complete preview reports a value that does not fit the application's type, null constraint or precision.

The absent-record section supports retaining existing values or setting a separate Boolean field. Choose the direction that matches the application: present records can use true and removed records false, or the reverse. Leave that Boolean field unmapped in the field list. A returning source key restores the configured present-record value.

**Save mapping and prepare complete review** creates a new review of the same original source. The first admission saves the complete submitted form or mapping, the validated source/application context, and the selected review together. If saving stops after that admission, the same review ID and original input finish the same selection, even if the live application has since advanced. The ordinary preview and import still apply their current-record and schema checks before an edition is written.

The source review stays available. The resulting import review links back to it and exposes its exact selected mapping, complete changes, original files and full handoff. To revise the fields again, open **Source and field mapping** and save another review. Approval and import continue through the original application transaction and operation key.

### Use the same source and mapping API

The browser and CLI use the same `Workspace` methods:

| Method | Complete result or operation |
| --- | --- |
| `prepare_source(id)` | Receive, profile and index the entire retained source |
| `source_summary(id)` | Original source identity, all field profiles and complete row/page counts |
| `source_rows(id, page: 0)` | One complete source page; API pages start at zero |
| `source_export(id, format: "csv")` | Original CSV or JSONL through the existing download owner |
| `mapping_target(id)` | Actual supported target fields, available unique indexes and established key binding |
| `mapping_context(id)` | Complete source/target selection and its context checksum |
| `remap_form(id, new_id:, actor:, form:, expected_context_sha256:)` | Retain a new review from the exact field form |
| `remap(id, new_id:, actor:, mapping:, expected_context_sha256:)` | Retain a new review from a complete mapping definition |
| `mapping_export(id)` | Download the exact mapping selected for that review |

A form contains `rows` as an array or numerically indexed object. Each row identifies an allowed application `column`, selected source `field`, `null` (`assign` or `preserve`), `missing` (`error` or `preserve`) and `stringify` (`"0"` or `"1"`). An empty source field leaves that application column unmanaged. A new stream supplies the selected actual `key_index` name. The removal fields are `removal` (`retain` or `archive`), `archive_column`, and `archive_active` (`"true"` or `"false"`). Target types, models and tenant scope are supplied by the server.

Use the context checksum returned by `mapping_context`, the original review ID, one retained new review UUID and the actual authenticated actor. Keep those values and the submitted form together for a retry. The programmatic mapping path uses the same admission and original importer.

### Source CLI in the installed application

`source_cli.rb` exposes the complete source, mapping and import workflow. In an existing Rails application, use its configured tenant resolver:

~~~sh
bin/rails runner /absolute/operator/source_cli.rb candidates --tenant ACTUAL_ACCOUNT
bin/rails runner /absolute/operator/source_cli.rb prepare-source \
  --tenant ACTUAL_ACCOUNT --review ORIGINAL_SOURCE_REVIEW
bin/rails runner /absolute/operator/source_cli.rb context \
  --tenant ACTUAL_ACCOUNT --review ORIGINAL_SOURCE_REVIEW --out /private/mapping-context.json
~~~

For a managed received application, select the original application directory, the current paired runtime source, and an environment containing this complete client edition:

~~~sh
bundle exec ruby CURRENT_CLIENT/examples/rails_dataset/operator/source_cli.rb candidates \
  --application ORIGINAL_APPLICATION --runtime-source CURRENT_RUNTIME \
  --environment CURRENT_ENVIRONMENT
~~~

The maintained runtime dispatcher also accepts the fixed `dataset-source` entry and passes its literal arguments to the same source CLI. Use the existing runtime environment and original operation UUID.

The complete command sequence is `candidates` → `select` → `prepare-source` → `summary` / `rows` / `source-export` → `context` → `remap` or `remap-form` → `prepare-import` → `preview` / `changes` / `export` → `approve` → `commit` → `receipt` / `history` / `handoff`. Mapping commands take the original source `--review`, a retained new `--id`, the actual `--actor`, `--context-sha256`, and complete `--input` JSON. Subsequent review/import commands select that new review. Approval takes its exact `--preview-sha256`.

Each output file is written once and verified on retry. Keep its original path. CLI row and change pages start at zero; browser source pages start at one. Read `--help` for the exact selection arguments and complete export names.

### Complete installed mapping and receiving example

The `mapping_example.rb` entry continues the original installed application using its actual current received candidate. It loads the complete current client explicitly so an older environment's retained Ruby classes cannot substitute for the selected source-mapping edition.

~~~sh
bundle exec ruby CURRENT_CLIENT/examples/rails_dataset/operator/mapping_example.rb run \
  --application ORIGINAL_APPLICATION --runtime-source CURRENT_RUNTIME \
  --out ORIGINAL_MAPPING_RUN
~~~

The maintained dispatcher exposes the same complete entry:

~~~sh
starforge ruby-runtime run --directory ORIGINAL_RUNTIME --id CURRENT_ENV \
  --operation-id ORIGINAL_UUID --entry dataset-mapping-lifecycle --wait -- \
  run --application ORIGINAL_APPLICATION --runtime-source CURRENT_RUNTIME \
  --out ORIGINAL_MAPPING_RUN
~~~

The journey retains the rendered source-selection and mapping forms before their effects, runs the actual source CLI through the installed resolver, reads every original source row and file, follows the complete preview and import, saves working records and downloads the complete edition history. It keeps both complete HTTP and CLI handoffs and compares their manifests and all members.

It then closes and copies the whole application, temporarily parks the original application path, and opens the recipient in a fresh Ruby process. The received application's source, original receipt, working targets and full exports are compared with the saved selection. Stop other users and workers of this application for that closed-database copying step. Use a stable private output directory for the entire operation and its retries.

Reopen the completed result and recipient using the same current source:

~~~sh
bundle exec ruby CURRENT_CLIENT/examples/rails_dataset/operator/mapping_example.rb reopen \
  --runtime-source CURRENT_RUNTIME --out ORIGINAL_MAPPING_RUN
~~~

The completed result uses schema `stellar-forge.dataset-operator-mapping-journey.v1`. This installed example selects the current source and mapping to exercise the whole unchanged-record continuation; operators use the ordinary mapping forms for substantive new field choices or later source editions.

## Daily operation

1. **Select the source and fields.** Open the complete source and mapping form, or use **Prepare complete review** when the inbox already has a configured mapping. Source preparation and mapping review keep their original selections. The preview job copies the full selected source and mapping and writes the entire preview before deriving browser pages and exports.
2. **Inspect all changes.** Page through inserted, updated, unchanged or removed rows and the adoption, restoration and source-change flags. Every row retains its exact typed before/after values, business key and original JSON.
3. **Approve and import.** The signed form selects this exact preview. The original importer rechecks the source, mapping, scope, database schema and current records inside its transaction, applying normal validations and callbacks.
4. **Resume an interruption.** Preparation and import reuse the review ID and original operation key. A lost queue response can be retried on that same review. If the database committed before receipt export completed, retry finishes the original receipt.
5. **Refresh from saved source.** This creates a new review from the current review's copied delivery and mapping. It continues to work after the producer's directory moves or disappears. Current application records determine the new preview.
6. **Receive the result.** Download complete JSON/CSV reviews, selected mapping, all historical edition rows, original files or the complete review TAR. History is scoped to the original dataset stream.

A changed application preview produces a conflict and keeps the original review available. Use “Refresh from saved source” to review the new current state. Errors appear with the same original review; queue transport errors retain a resume action.

## Browse and deliver the committed working records

Open **Working records** on a committed review. Save one complete capture of the current dataset, then browse every retained business key, working value, source row and original attachment through the same tenant and target-model scope. The capture records active and removed keys separately and identifies working targets as unchanged, changed or missing. The original edition receipts and source rows remain attached to each record.

The records view provides full-text search, typed filters, multi-column sorting and complete pagination. CSV and JSON downloads contain the entire selected result, including the raw original source row and exact typed working values. Record details preserve original attachment references and stream the selected complete files. Pending captures use the same signed operation on resume.

For a managed application, the saved-record view also supplies the exact working-data selection for verification and full portable export. That explicit selection carries the capture, current working database, original source, immutable editions and receipts together. Receiving rechecks the complete current records against the retained capture. After later edits or a new imported edition, save a new capture for that new working state.

See [the complete saved-data operator guide](records.md) for column types, query fields, CLI commands, capture replay, full downloads and the original application receiving example. The new `DataCaptureJob` runs through the host's existing Active Job queue; the included local commissioner uses its actual inline queue.

## Files, editions and attachment identity

A review saves its original selection, a complete source copy, complete preview bundle, JSON/CSV review, indexed JSONL rows, original mapping, approval and committed receipt. The preview bundle is retained before derived exports, so a partial write resumes the exact reviewed rows even if application records later change. Large outputs stream through temporary files and are fully hashed before exposure.

Attachment pages retain every selected row/field/index reference from the complete Baserow customer package. A download must match one of those original references. The same physical file can serve several original references without duplicating its source bytes. All values in the HTML are escaped, and attachments download as binary files.

Every edition remains in the application's original dataset history tables. Historical receipt downloads verify and stream every retained row in that edition. The complete review TAR contains a relative manifest and the original received source, mapping, full preview, approval and available receipt. Use the host application's existing source deployment and database backup to transfer its wider application.

## Portable application receiving

`Commission.reopen` uses the application's own copied customer, mapping and database. It checks the complete retained file set before opening the original models, verifies the original import operation and every receipt row, verifies all current target rows, opens the same rendered screens and downloads the full receipt. Its return equals the original completed result.

For a commissioned delivery, copy the whole private application directory with its file modes preserved. Open the copy using the same complete delivered client source. The saved review selections retain original provenance, while subsequent access resolves the copy's own received directories and SQLite database. The provider lifecycle performs this step and temporarily parks its own producer artifacts to exercise offline receiving.

The first successful commissioning result is immutable. Operating the copied application further naturally creates new reviews or editions; the original completion result then describes its original received edition. Preserve that completed delivery and use the host's normal application backup when transferring later work.

## Export compatibility

Current complete exports contain 52 seller-client files or 42 native-client files, including the full operator, working-record browser and source-mapping workflow. Inspect and copy continue to accept the original 8-, 21-, 26-, 40- and 46-file seller editions and the original 16-, 30- and 36-file native editions using their exact original manifests.

If a native export stopped after creating an empty private directory but before saving its source selection, `native-resume` initializes that empty directory with the currently selected complete source. A nonempty interrupted package requires its original retained source selection. Existing files are never silently replaced.

## Framework references

- [Rails on Rack](https://guides.rubyonrails.org/rails_on_rack.html)
- [Rails 7.1 application configuration](https://guides.rubyonrails.org/v7.1/configuring.html)
- [Rails request forgery protection](https://api.rubyonrails.org/v7.1.6/classes/ActionController/RequestForgeryProtection.html)
