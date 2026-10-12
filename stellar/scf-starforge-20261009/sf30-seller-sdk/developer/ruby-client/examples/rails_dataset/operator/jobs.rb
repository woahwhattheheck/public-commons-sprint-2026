# frozen_string_literal: true
# MIT. Jobs share the original selected review, delivery and database operation.
require "active_job"
require_relative "workspace"

module Starforge
  module DatasetOperator
    class PrepareJob < ActiveJob::Base
      queue_as :default
      def perform(tenant_key, review_id)
        DatasetOperator.workspace(tenant_key).prepare(review_id)
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
