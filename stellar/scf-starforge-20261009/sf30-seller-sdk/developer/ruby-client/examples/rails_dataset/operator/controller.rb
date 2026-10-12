# frozen_string_literal: true
# MIT. Include in an authenticated controller of the existing Rails application.
require "active_support/concern"
require_relative "jobs"

module Starforge
  module DatasetOperator
    module Controller
      extend ActiveSupport::Concern
      included do
        before_action :starforge_dataset_authorize!
        before_action :operator_context
        protect_from_forgery with: :exception
        append_view_path File.join(__dir__,"views")
        after_action do
          response.headers["Cache-Control"] = "no-store"
          response.headers["X-Content-Type-Options"] = "nosniff"
        end
        helper_method :operator_token, :operator_values, :operator_text
        rescue_from Starforge::Error, Starforge::RailsDataset::ImportError, with: :operator_error
        rescue_from ActiveRecord::RecordNotFound do
          head :not_found
        end
      end

      def index
        @candidates = @workspace.candidates
        @reviews = @workspace.list(before: params[:before])
        render template: "starforge_dataset_operator/index", layout: "starforge_dataset_operator"
      end

      def create
        selected = operator_verify("create")
        id = selected.fetch("review_id")
        @workspace.select(id: id, candidate_id: selected.fetch("candidate_id"),
          selection_sha256: selected.fetch("selection_sha256"), actor: @operator_actor)
        operator_enqueue(PrepareJob,id)
        redirect_to({action: :show,id: id},status: :see_other)
      end

      def show
        @detail = @workspace.detail(params[:id])
        render template: "starforge_dataset_operator/show", layout: "starforge_dataset_operator"
      end

      def prepare
        id = params[:id].to_s
        @workspace.selection(id)
        operator_enqueue(PrepareJob,id)
        redirect_to({action: :show,id: id},status: :see_other)
      end

      def refresh
        chosen = operator_verify("refresh")
        id = params[:id].to_s
        Files.need(chosen["original_review_id"] == id, "DATASET_OPERATOR_SELECTION_CHANGED")
        new_id = chosen.fetch("review_id")
        @workspace.refresh(id,new_id: new_id,actor: @operator_actor)
        operator_enqueue(PrepareJob,new_id)
        redirect_to({action: :show,id: new_id},status: :see_other)
      end

      def commit
        chosen = operator_verify("commit")
        id = params[:id].to_s
        Files.need(chosen["review_id"] == id, "DATASET_OPERATOR_SELECTION_CHANGED")
        @workspace.approve(id,preview_sha256: chosen.fetch("preview_sha256"),actor: @operator_actor)
        operator_enqueue(ImportJob,id)
        redirect_to({action: :show,id: id},status: :see_other)
      end

      def changes
        @detail = @workspace.detail(params[:id])
        @changes = @workspace.changes(params[:id],group: params.fetch(:group,"all"),
          page: operator_integer(:page,0))
        render template: "starforge_dataset_operator/changes", layout: "starforge_dataset_operator"
      end

      def history
        @detail = @workspace.detail(params[:id])
        @history = @workspace.history(params[:id],before: params[:before])
        render template: "starforge_dataset_operator/history", layout: "starforge_dataset_operator"
      end

      def attachments
        @detail = @workspace.detail(params[:id])
        @attachments = @workspace.attachments(params[:id],offset: operator_integer(:offset,0))
        render template: "starforge_dataset_operator/attachments", layout: "starforge_dataset_operator"
      end

      def download
        operator_download(@workspace.export(params[:id],params[:name].to_s))
      end

      def receipt
        operator_download(@workspace.historical_receipt(params[:id],params[:edition_id].to_s))
      end

      def attachment
        operator_download(@workspace.attachment(params[:id],file: params[:file].to_s,
          record_id: params[:record_id].to_s,column: params[:column].to_s))
      end

      def handoff
        operator_download(@workspace.handoff(params[:id]))
      end

      def stylesheet
        render plain: File.binread(File.join(__dir__,"operator.css")), content_type: "text/css"
      end

      private

      # Implement all three methods in the including application controller.
      # Its normal session/authentication helpers and role policy remain in force.
      def starforge_dataset_authorize!
        raise NotImplementedError, "Authorize dataset operator access in the application controller"
      end
      def starforge_dataset_tenant_key
        raise NotImplementedError, "Resolve the authenticated application's tenant"
      end
      def starforge_dataset_actor
        raise NotImplementedError, "Resolve the authenticated application's operator identity"
      end

      def operator_context
        @operator_tenant = starforge_dataset_tenant_key.to_s
        @operator_actor = starforge_dataset_actor.to_s
        Files.need(!@operator_actor.empty?, "DATASET_OPERATOR_ACTOR_REQUIRED")
        @workspace = DatasetOperator.workspace(@operator_tenant)
      end

      def operator_token(payload,purpose)
        Rails.application.message_verifier("starforge-dataset-operator").generate(
          {"tenant"=>@operator_tenant,"actor"=>@operator_actor,"payload"=>payload},
          purpose: purpose, expires_in: 24.hours)
      end

      def operator_verify(purpose)
        value = Rails.application.message_verifier("starforge-dataset-operator").verified(
          params[:selection].to_s,purpose: purpose)
        Files.need(value.is_a?(Hash) && value["tenant"] == @operator_tenant &&
          value["actor"] == @operator_actor && value["payload"].is_a?(Hash),
          "DATASET_OPERATOR_SELECTION_EXPIRED")
        value.fetch("payload")
      end

      def operator_integer(name,default)
        value = params[name]
        value.nil? ? default : Integer(value.to_s,10)
      rescue ArgumentError
        raise ActionController::BadRequest, "Choose a whole-number page"
      end

      def operator_enqueue(job,id)
        result = job.perform_later(@operator_tenant,id)
        if result
          flash[:notice] = "The selected review is queued. Refresh this page for its result."
        else
          flash[:alert] = "The queue did not accept this review. Resume the same review below."
        end
      rescue StandardError
        # Queue transport may have accepted the job before its response was lost.
        # The retained review and importer make a repeat use the same operation.
        flash[:alert] = "The queue response was interrupted. Refresh this review; Resume keeps its original operation."
      end

      def operator_download(file)
        response.headers["Content-Type"] = file.content_type
        response.headers["Content-Length"] = file.bytes.to_s
        response.headers["Content-Disposition"] = ActionDispatch::Http::ContentDisposition.format(
          disposition: "attachment",filename: file.filename)
        response.headers["X-Content-SHA256"] = file.sha256
        self.response_body = file
      rescue Exception
        file&.close
        raise
      end

      def operator_error(error)
        @operator_problem = error.message
        render template: "starforge_dataset_operator/error",layout: "starforge_dataset_operator",status: :conflict
      end

      def operator_values(raw)
        value = RailsDataset.unpack(Files.parse(raw))
        value.is_a?(Hash) ? value : {"value"=>value}
      end

      def operator_text(value)
        case value
        when BigDecimal then value.to_s("F")
        when Time, DateTime then value.iso8601(9)
        when Date then value.iso8601
        when NilClass then "(null)"
        when String then value
        when Hash, Array then RailsDataset.exact_json(value)
        else value.to_s
        end
      end
    end
  end
end
