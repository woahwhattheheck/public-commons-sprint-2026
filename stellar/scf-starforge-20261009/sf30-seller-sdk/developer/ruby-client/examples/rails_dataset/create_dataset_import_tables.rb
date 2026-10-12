# frozen_string_literal: true
# MIT. Install once in the application's existing database.
class CreateDatasetImportTables < ActiveRecord::Migration[7.1]
  def change
    create_table :starforge_dataset_streams do |t|
      t.string :tenant_key, null: false, limit: 128
      t.string :name, null: false, limit: 180
      t.integer :revision, null: false, default: 0
      t.bigint :latest_edition_id
      t.string :target_model
      t.string :scope_sha256, limit: 64
      t.string :key_mapping_sha256, limit: 64
      t.string :membership_sha256, limit: 64
      t.integer :lock_version, null: false, default: 0
      t.timestamps
    end
    add_index :starforge_dataset_streams, [:tenant_key, :name], unique: true, name: "sf_ds_stream_name"

    create_table :starforge_dataset_editions do |t|
      t.bigint :dataset_stream_id, null: false
      t.integer :revision, null: false
      t.string :operation_sha256, null: false, limit: 64
      t.string :manifest_sha256, null: false, limit: 64
      t.string :source_sha256, null: false, limit: 64
      t.string :mapping_sha256, null: false, limit: 64
      t.string :preview_sha256, null: false, limit: 64
      t.text :binding_json, null: false, limit: 64 * 1024 * 1024
      t.text :receipt_json, limit: 64 * 1024 * 1024
      t.string :receipt_sha256, limit: 64
      t.timestamps
    end
    add_index :starforge_dataset_editions, [:dataset_stream_id, :operation_sha256],
      unique: true, name: "sf_ds_edition_operation"
    add_index :starforge_dataset_editions, [:dataset_stream_id, :revision],
      unique: true, name: "sf_ds_edition_revision"
    add_foreign_key :starforge_dataset_editions, :starforge_dataset_streams, column: :dataset_stream_id
    add_foreign_key :starforge_dataset_streams, :starforge_dataset_editions, column: :latest_edition_id

    create_table :starforge_dataset_rows do |t|
      t.bigint :dataset_stream_id, null: false
      t.string :key_sha256, null: false, limit: 64
      t.text :key_json, null: false, limit: 64 * 1024 * 1024
      t.string :target_model, null: false
      t.string :target_id
      t.string :status, null: false, limit: 16
      t.bigint :last_edition_id, null: false
      t.string :source_row_sha256, limit: 64
      t.text :values_json, limit: 64 * 1024 * 1024
      t.timestamps
    end
    add_index :starforge_dataset_rows, [:dataset_stream_id, :key_sha256],
      unique: true, name: "sf_ds_row_key"
    add_index :starforge_dataset_rows, [:target_model, :target_id],
      unique: true, name: "sf_ds_row_target"
    add_index :starforge_dataset_rows, [:dataset_stream_id, :status, :id],
      name: "sf_ds_row_status"
    add_foreign_key :starforge_dataset_rows, :starforge_dataset_streams, column: :dataset_stream_id
    add_foreign_key :starforge_dataset_rows, :starforge_dataset_editions, column: :last_edition_id

    create_table :starforge_dataset_entries do |t|
      t.bigint :dataset_edition_id, null: false
      t.string :key_sha256, null: false, limit: 64
      t.bigint :source_ordinal
      t.string :action, null: false, limit: 16
      t.string :target_id
      t.text :record_json, null: false, limit: 64 * 1024 * 1024
      t.string :record_sha256, null: false, limit: 64
      t.timestamps
    end
    add_index :starforge_dataset_entries, [:dataset_edition_id, :key_sha256],
      unique: true, name: "sf_ds_entry_key"
    add_index :starforge_dataset_entries, [:dataset_edition_id, :id], name: "sf_ds_entry_order"
    add_foreign_key :starforge_dataset_entries, :starforge_dataset_editions, column: :dataset_edition_id

    # Replace this example target with the application's original business model.
    # Its actual tenant/key unique index is required by RailsDataset.
    create_table :starforge_dataset_catalog_records do |t|
      t.string :tenant_key, null: false, limit: 128
      t.string :external_id, null: false, limit: 180
      t.string :name
      t.decimal :amount, precision: 30, scale: 8
      t.bigint :quantity
      t.boolean :active
      t.date :observed_on
      t.datetime :recorded_at, precision: 6
      t.boolean :source_active, null: false, default: true
      t.integer :lock_version, null: false, default: 0
      t.timestamps
    end
    add_index :starforge_dataset_catalog_records, [:tenant_key, :external_id],
      unique: true, name: "sf_ds_catalog_key"
  end
end
