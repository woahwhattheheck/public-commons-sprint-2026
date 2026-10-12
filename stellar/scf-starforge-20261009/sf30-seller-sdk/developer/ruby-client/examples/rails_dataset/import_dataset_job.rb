# frozen_string_literal: true
# MIT. A database job consumes one already received, complete dataset packet.
require "active_job"
require_relative "models"

module Starforge
  module DatasetExample
    class ImportDatasetJob < ActiveJob::Base
      queue_as :default

      # Resolve these paths and tenant identity on the application's server.
      # The business operation key and selected preview survive job retries.
      def perform(stream_id:, tenant_key:, delivery_directory:, manifest_sha256:,
                  mapping_path:, operation_key:, preview_sha256:, receipt_path: nil)
        stream = DatasetStream.where(tenant_key: tenant_key).find(stream_id)
        importer = DatasetExample.importer(stream: stream, tenant_key: tenant_key,
          delivery_directory: delivery_directory, manifest_sha256: manifest_sha256, mapping_path: mapping_path)
        result = importer.import!(operation_key: operation_key, expected_preview_sha256: preview_sha256)
        if receipt_path
          Artifacts.write_once(receipt_path) { |io| importer.write_receipt(io, operation_key: operation_key) }
        end
        result
      end
    end
  end
end
