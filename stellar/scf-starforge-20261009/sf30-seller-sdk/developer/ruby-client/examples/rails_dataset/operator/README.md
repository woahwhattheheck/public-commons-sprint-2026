# Dataset operator for the original Rails application

This package adds a complete, server-rendered dataset receiving and import interface to Rails. An operator selects a received delivery, reviews every row and the configured mapping, approves the exact preview, and imports an edition through the application's original Active Record models. Original attachments, every historical receipt and a complete review handoff remain available.

The interface uses neutral grayscale styles and ordinary HTML forms. It includes the source inbox, complete paginated change review and filters, typed before/after values, original source JSON, background preparation/import, retry of the same operation, refresh from the review's saved source, edition history, original file downloads, and full JSON/CSV/TAR exports.

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
  collection { get :stylesheet }
  member do
    post :prepare
    post :refresh
    post :commit
    get :changes
    get :history
    get :attachments
    get :download
    get :receipt
    get :attachment
    get :handoff
  end
end
~~~

Configure the shared resolver during application boot so web requests and workers reconstruct the same authorized context. The following uses the supplied example models; replace the target scope and catalogue with the application's actual model relation and received-delivery records:

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

Each catalogue candidate is a server-controlled object:

~~~ruby
{
  id: "customer-source-edition-3",
  title: "Customer catalogue / received edition 3",
  stream_id: original_dataset_stream.id,
  directory: "/private/complete-received-customer",
  format: "baserow", # "dataset" opens a standalone original DatasetDelivery
  manifest_sha256: original_complete_manifest_sha256,
  mapping: original_application_mapping
}
~~~

A candidate can supply `mapping_path` instead of a mapping object. The browser receives signed selections; it cannot choose arbitrary filesystem paths or a target model. Each tenant stream is checked against the resolver's original scoped relation.

## Daily operation

1. **Prepare complete review.** Select a candidate in the inbox. The job copies the full delivery and mapping into its own review, then writes the complete preview before deriving browser pages and exports.
2. **Inspect all changes.** Page through inserted, updated, unchanged or removed rows and the adoption, restoration and source-change flags. Every row retains its exact typed before/after values, business key and original JSON.
3. **Approve and import.** The signed form selects this exact preview. The original importer rechecks the source, mapping, scope, database schema and current records inside its transaction, applying normal validations and callbacks.
4. **Resume an interruption.** Preparation and import reuse the review ID and original operation key. A lost queue response can be retried on that same review. If the database committed before receipt export completed, retry finishes the original receipt.
5. **Refresh from saved source.** This creates a new review from the current review's copied delivery and mapping. It continues to work after the producer's directory moves or disappears. Current application records determine the new preview.
6. **Receive the result.** Download complete JSON/CSV reviews, selected mapping, all historical edition rows, original files or the complete review TAR. History is scoped to the original dataset stream.

A changed application preview produces a conflict and keeps the original review available. Use “Refresh from saved source” to review the new current state. Errors appear with the same original review; queue transport errors retain a resume action.

## Files, editions and attachment identity

A review saves its original selection, a complete source copy, complete preview bundle, JSON/CSV review, indexed JSONL rows, original mapping, approval and committed receipt. The preview bundle is retained before derived exports, so a partial write resumes the exact reviewed rows even if application records later change. Large outputs stream through temporary files and are fully hashed before exposure.

Attachment pages retain every selected row/field/index reference from the complete Baserow customer package. A download must match one of those original references. The same physical file can serve several original references without duplicating its source bytes. All values in the HTML are escaped, and attachments download as binary files.

Every edition remains in the application's original dataset history tables. Historical receipt downloads verify and stream every retained row in that edition. The complete review TAR contains a relative manifest and the original received source, mapping, full preview, approval and available receipt. Use the host application's existing source deployment and database backup to transfer its wider application.

## Portable application receiving

`Commission.reopen` uses the application's own copied customer, mapping and database. It checks the complete retained file set before opening the original models, verifies the original import operation and every receipt row, verifies all current target rows, opens the same rendered screens and downloads the full receipt. Its return equals the original completed result.

For a commissioned delivery, copy the whole private application directory with its file modes preserved. Open the copy using the same complete delivered client source. The saved review selections retain original provenance, while subsequent access resolves the copy's own received directories and SQLite database. The provider lifecycle performs this step and temporarily parks its own producer artifacts to exercise offline receiving.

The first successful commissioning result is immutable. Operating the copied application further naturally creates new reviews or editions; the original completion result then describes its original received edition. Preserve that completed delivery and use the host's normal application backup when transferring later work.

## Export compatibility

New native exports contain the original 16-file client plus these 14 operator files. New seller exports contain the original 26-file client plus the operator. Inspect and copy continue to accept the original 8-, 21-, 26- and 16-file completed editions using their exact original manifests.

If a native export stopped after creating an empty private directory but before saving its source selection, `native-resume` initializes that empty directory with the currently selected complete source. A nonempty interrupted package requires its original retained source selection. Existing files are never silently replaced.

## Framework references

- [Rails on Rack](https://guides.rubyonrails.org/rails_on_rack.html)
- [Rails 7.1 application configuration](https://guides.rubyonrails.org/v7.1/configuring.html)
- [Rails request forgery protection](https://api.rubyonrails.org/v7.1.6/classes/ActionController/RequestForgeryProtection.html)
