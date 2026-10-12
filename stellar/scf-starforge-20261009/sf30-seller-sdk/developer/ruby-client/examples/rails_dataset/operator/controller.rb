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
        helper_method :operator_token, :operator_values, :operator_text,
          :operator_data_unpack, :operator_data_value, :operator_data_label,
          :operator_data_time, :operator_data_column, :operator_data_type
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

      def records
        id = params[:id].to_s
        @detail = @workspace.detail(id)
        @data_catalog = @workspace.data_captures(id,before: params[:capture_before])
        capture_id = params[:capture_id].presence || @data_catalog.fetch("items").first&.fetch("id")
        if capture_id
          selected = @workspace.data_capture_state(id,capture_id)
          if selected.fetch("state") == "complete"
            @data_capture = selected.fetch("capture")
            if params[:query_id].present? && !params.key?(:query)
              @data = @workspace.data_rows(id,capture_id,params[:query_id].to_s,
                page: operator_data_page)
            else
              query = operator_data_query(@data_capture.fetch("columns"))
              result = @workspace.query_data(id,capture_id,query: query)
              @data = @workspace.data_rows(id,capture_id,result.fetch("id"),
                page: operator_data_page)
            end
            @data_query = @data.fetch("query").fetch("query")
            @data_query_id = @data.fetch("query").fetch("id")
          else
            @data_pending_selection = selected
          end
        end
        render template: "starforge_dataset_operator/records",layout: "starforge_dataset_operator"
      end

      def capture_data
        selected = operator_verify("data_capture")
        id = params[:id].to_s
        Files.need(selected.fetch("review_id") == id,"DATASET_OPERATOR_SELECTION_CHANGED")
        capture_id = selected.fetch("capture_id")
        state = @workspace.select_data_capture(id,id: capture_id,
          actor: selected.fetch("capture_actor",@operator_actor),
          expected_revision: selected.fetch("expected_revision"),
          expected_receipt_sha256: selected.fetch("expected_receipt_sha256"))
        if state.fetch("state") == "complete"
          flash[:notice] = "The saved working dataset is ready."
        else
          operator_enqueue_capture(id,capture_id)
        end
        redirect_to({action: :records,id: id,capture_id: capture_id},status: :see_other)
      end

      def record
        id,capture_id = params[:id].to_s,params[:capture_id].to_s
        @detail = @workspace.detail(id)
        @record_detail = @workspace.data_record(id,capture_id,key_sha256: params[:key_sha256].to_s)
        @data_capture = @record_detail.fetch("capture")
        # A returning query is re-opened in the same review/capture before it is linked.
        if params[:query_id].present?
          @return_data = @workspace.data_rows(id,capture_id,params[:query_id].to_s,
            page: operator_data_page)
        end
        render template: "starforge_dataset_operator/record",layout: "starforge_dataset_operator"
      end

      def data_export
        operator_download(@workspace.data_export(params[:id].to_s,params[:capture_id].to_s,
          params[:query_id].to_s,format: params[:format].to_s))
      end

      def data_attachment
        operator_download(@workspace.data_attachment(params[:id].to_s,params[:capture_id].to_s,
          key_sha256: params[:key_sha256].to_s,file: params[:file].to_s,
          record_id: params[:record_id].to_s,column: params[:column].to_s,
          index: operator_integer(:index,0)))
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

      def operator_data_page
        page = operator_integer(:page,1)
        raise ActionController::BadRequest, "Choose a page starting at 1." unless page >= 1
        page - 1
      end

      def operator_data_query(columns)
        raw = params[:query]
        return {"search"=>"","statuses"=>["active"],
          "target_states"=>%w[unchanged changed missing],"filters"=>[],"sort"=>[]} if raw.nil?
        raise ActionController::BadRequest, "Use the record search form." unless
          raw.is_a?(ActionController::Parameters) || raw.is_a?(Hash)
        allowed = columns.to_h { |column| [column.fetch("key"),column] }
        result = {"search"=>raw.fetch("search","").to_s,
          "statuses"=>operator_data_choices(raw["statuses"],%w[active removed]),
          "target_states"=>operator_data_choices(raw["target_states"],%w[unchanged changed missing]),
          "filters"=>[],"sort"=>[]}
        operator_data_inputs(raw["filters"],32).each do |filter|
          column,operator = filter["column"].to_s,filter.fetch("operator","eq").to_s
          next if column.empty?
          definition = allowed[column]
          raise ActionController::BadRequest, "Choose a column from this saved dataset." unless definition
          selected = {"column"=>column,"operator"=>operator}
          unless %w[is_null not_null].include?(operator)
            value = filter.fetch("value","")
            raise ActionController::BadRequest, "Enter one filter value." unless value.is_a?(String)
            if definition.fetch("type") == "boolean"
              raise ActionController::BadRequest, "Use true or false for a yes/no filter." unless
                %w[true false].include?(value)
              value = value == "true"
            end
            selected["value"] = value
          end
          result["filters"] << selected
        end
        operator_data_inputs(raw["sort"],8).each do |sort|
          column = sort["column"].to_s
          next if column.empty?
          result["sort"] << {"column"=>column,"direction"=>sort.fetch("direction","asc").to_s,
            "nulls"=>sort.fetch("nulls","last").to_s}
        end
        result
      end

      def operator_data_choices(value,allowed)
        raise ActionController::BadRequest, "Choose at least one record state." unless value.is_a?(Array)
        chosen = value.reject { |item| item == "" }
        raise ActionController::BadRequest, "Choose at least one record state." unless
          chosen.all? { |item| item.is_a?(String) && allowed.include?(item) } &&
          !chosen.empty? && chosen.uniq == chosen
        chosen
      end

      def operator_data_inputs(value,maximum)
        return [] if value.nil?
        if value.is_a?(ActionController::Parameters) || value.is_a?(Hash)
          keys = value.keys
          raise ActionController::BadRequest, "Use the ordered record filters." unless
            keys.all? { |key| /\A(?:0|[1-9][0-9]*)\z/.match?(key.to_s) }
          selected = keys.sort_by { |key| Integer(key.to_s,10) }.map { |key| value[key] }
        elsif value.is_a?(Array)
          selected = value
        else
          raise ActionController::BadRequest, "Use the ordered record filters."
        end
        raise ActionController::BadRequest, "Too many selected filters or sort columns." unless
          selected.length <= maximum && selected.all? {
            |item| item.is_a?(ActionController::Parameters) || item.is_a?(Hash)
          }
        selected
      end

      def operator_enqueue_capture(review_id,capture_id)
        result = DataCaptureJob.perform_later(@operator_tenant,review_id,capture_id)
        if result
          flash[:notice] = "The working dataset is being saved. Refresh this page for its result."
        else
          flash[:alert] = "The queue did not accept this dataset. Resume the saved capture below."
        end
      rescue StandardError
        flash[:alert] = "The queue response was interrupted. Refresh this page; Resume continues the saved capture."
      end

      def operator_data_unpack(value)
        RailsDataset.unpack(value)
      end

      def operator_data_value(value)
        return "Empty value" if value.nil?
        return "Empty text" if value.is_a?(String) && value.empty?
        return "Yes" if value == true
        return "No" if value == false
        operator_text(value)
      end

      def operator_data_label(value)
        {"active"=>"Present in source","removed"=>"Removed from source",
          "unchanged"=>"Matches imported values","changed"=>"Edited after import",
          "missing"=>"No current record","selected"=>"Waiting to start",
          "running"=>"Saving records","error"=>"Needs attention",
          "complete"=>"Ready"}.fetch(value.to_s) { value.to_s.tr("_"," ").capitalize }
      end

      def operator_data_time(value)
        return "Not recorded" if value.nil? || value.to_s.empty?
        Time.iso8601(value.to_s).utc.strftime("%b %-d, %Y at %H:%M UTC")
      rescue ArgumentError
        value.to_s
      end

      def operator_data_column(column)
        label = column.fetch("label").to_s.tr("_"," ").strip
        label.empty? ? "Column" : label.sub(/\A./) { |first| first.upcase }
      end

      def operator_data_type(value)
        {"string"=>"Text","integer"=>"Whole number","decimal"=>"Decimal",
          "boolean"=>"Yes / no","date"=>"Date","datetime"=>"Date and time"}.fetch(value.to_s,value.to_s)
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
