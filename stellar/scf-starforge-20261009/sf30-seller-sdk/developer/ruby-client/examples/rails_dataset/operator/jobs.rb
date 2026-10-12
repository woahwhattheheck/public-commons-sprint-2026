# frozen_string_literal: true
# MIT. Jobs share the original selected review, delivery and database operation.
require "active_job"
require_relative "workspace"

module Starforge
  module DatasetOperator
    class SourcePrepareJob < ActiveJob::Base
      queue_as :default
      def perform(tenant_key,review_id)
        DatasetOperator.workspace(tenant_key).prepare_source(review_id)
      end
    end

    class PrepareJob < ActiveJob::Base
      queue_as :default
      def perform(tenant_key, review_id)
        DatasetOperator.workspace(tenant_key).prepare(review_id)
      end
    end

    class DataCaptureJob < ActiveJob::Base
      queue_as :default
      def perform(tenant_key,review_id,capture_id)
        DatasetOperator.workspace(tenant_key).complete_data_capture(review_id,capture_id)
      end
    end

    class ImportJob < ActiveJob::Base
      queue_as :default
      def perform(tenant_key, review_id)
        DatasetOperator.workspace(tenant_key).commit(review_id)
      end
    end
  end
end
