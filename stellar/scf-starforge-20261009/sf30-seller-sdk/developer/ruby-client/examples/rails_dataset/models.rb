# frozen_string_literal: true
# MIT. Copy these models into the same database as the original target records.
require_relative "../../rails_dataset"

module Starforge
  module DatasetExample
    class Record < ActiveRecord::Base
      self.abstract_class = true
    end

    class DatasetStream < Record
      self.table_name = "starforge_dataset_streams"
      validates :tenant_key, :name, presence: true
    end

    class DatasetEdition < Record
      self.table_name = "starforge_dataset_editions"
      before_update do
        if receipt_sha256_in_database.present?
          raise ActiveRecord::ReadOnlyRecord, "A committed dataset edition is immutable"
        end
      end
      before_destroy { raise ActiveRecord::ReadOnlyRecord, "Retain dataset edition history" }
    end

    class DatasetRow < Record
      self.table_name = "starforge_dataset_rows"
      validates :status, inclusion: {in: %w[active removed]}
    end

    class DatasetEntry < Record
      self.table_name = "starforge_dataset_entries"
      before_update { raise ActiveRecord::ReadOnlyRecord, "A dataset entry is immutable" }
      before_destroy { raise ActiveRecord::ReadOnlyRecord, "Retain dataset source rows" }
    end

    class CatalogRecord < Record
      self.table_name = "starforge_dataset_catalog_records"
      validates :tenant_key, :external_id, presence: true
    end

    MODELS = {edition: DatasetEdition, row: DatasetRow, entry: DatasetEntry}.freeze

    def self.importer(stream:, tenant_key:, delivery_directory:, manifest_sha256:, mapping_path:)
      RailsDataset.need(stream.tenant_key == tenant_key, "DATASET_EXAMPLE_TENANT")
      delivery = DatasetDelivery.open(delivery_directory, expected_manifest_sha256: manifest_sha256)
      mapping = Files.parse(Files.read(mapping_path))
      RailsDataset.new(delivery: delivery, scope: CatalogRecord.where(tenant_key: tenant_key),
        stream: stream, models: MODELS, mapping: mapping)
    end

    # Stream a complete output into a new file. A retry accepts only the exact
    # original bytes; it never replaces another review or completed receipt.
    module Artifacts
      module_function
      def write_once(path)
        path = File.expand_path(path)
        directory = Files.directory(File.dirname(path))
        temp = Tempfile.new([".dataset-artifact-", ".pending"], directory)
        begin
          temp.binmode
          yield temp
          temp.flush
          temp.fsync
          count, digest = temp.size, Digest::SHA256.file(temp.path).hexdigest
          temp.close
          begin
            File.link(temp.path, path)
            Files.sync(directory)
          rescue Errno::EEXIST
            # Preview/history exports can be larger than one original data file.
            # Verify all bytes directly without imposing the native input ceiling.
            File.open(path, File::RDONLY | File::NOFOLLOW | File::NONBLOCK) do |file|
              before = file.stat
              Files.need(before.file? && before.size == count, "DATASET_ARTIFACT_CONFLICT")
              actual, received = Digest::SHA256.new, 0
              while (chunk = file.read(1_048_576))
                actual.update(chunk)
                received += chunk.bytesize
                Files.need(received <= count, "DATASET_ARTIFACT_CONFLICT")
              end
              after = file.stat
              Files.need(received == count && actual.hexdigest == digest &&
                [before.dev,before.ino,before.size,before.mtime,before.ctime] ==
                [after.dev,after.ino,after.size,after.mtime,after.ctime], "DATASET_ARTIFACT_CONFLICT")
            end
          end
          {"path"=>path, "bytes"=>count, "sha256"=>digest}
        ensure
          temp.close!
        end
      end
    end
  end
end
