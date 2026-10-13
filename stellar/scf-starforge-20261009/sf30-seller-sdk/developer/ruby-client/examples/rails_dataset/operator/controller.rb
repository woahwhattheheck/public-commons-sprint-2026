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
          :operator_data_time, :operator_data_column, :operator_data_type,
          :operator_mapping_row, :operator_mapping_label, :operator_mapping_configured?, :operator_source_types
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

      def create_source
        selected = operator_verify("create_source")
        id = selected.fetch("review_id")
        @workspace.select(id: id,candidate_id: selected.fetch("candidate_id"),
          selection_sha256: selected.fetch("selection_sha256"),actor: @operator_actor)
        operator_enqueue(SourcePrepareJob,id)
        redirect_to({action: :mapping,id: id},status: :see_other)
      end

      def prepare_source
        selected = operator_verify("source_prepare")
        id = params[:id].to_s
        Files.need(selected["review_id"] == id,"DATASET_OPERATOR_SELECTION_CHANGED")
        @workspace.selection(id)
        operator_enqueue(SourcePrepareJob,id)
        redirect_to({action: :mapping,id: id},status: :see_other)
      end

      def mapping
        operator_mapping_context
        render template: "starforge_dataset_operator/mapping",layout: "starforge_dataset_operator"
      end

      def save_mapping
        selected = operator_verify("mapping_save")
        id = params[:id].to_s
        Files.need(selected["original_review_id"] == id,"DATASET_OPERATOR_SELECTION_CHANGED")
        @mapping_form = operator_mapping_input
        review_id = selected.fetch("review_id")
        @workspace.remap_form(id,new_id: review_id,actor: @operator_actor,form: @mapping_form,
          expected_context_sha256: selected.fetch("context_sha256"))
        operator_enqueue(PrepareJob,review_id)
        redirect_to({action: :show,id: review_id},status: :see_other)
      rescue Starforge::Error, Starforge::RailsDataset::ImportError => error
        @mapping_problem = operator_mapping_problem(error)
        operator_mapping_context
        render template: "starforge_dataset_operator/mapping",
          layout: "starforge_dataset_operator",status: :unprocessable_entity
      end

      def source_rows
        id = params[:id].to_s
        @detail = @workspace.detail(id)
        unless @workspace.source_available?(id)
          redirect_to({action: :mapping,id: id},status: :see_other)
          return
        end
        @source_summary = @workspace.source_summary(id)
        @source_rows = @workspace.source_rows(id,page: operator_data_page)
        render template: "starforge_dataset_operator/source_rows",layout: "starforge_dataset_operator"
      end

      def source_export
        operator_download(@workspace.source_export(params[:id].to_s,format: params[:format].to_s))
      end

      def mapping_export
        operator_download(@workspace.mapping_export(params[:id].to_s))
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

      def operator_mapping_context
        id = params[:id].to_s
        @detail = @workspace.detail(id)
        @mapping_review_id = SecureRandom.uuid
        return unless @workspace.source_available?(id)
        @mapping_context = @workspace.mapping_context(id)
        return if @mapping_form
        definition = @mapping_context.fetch("mapping")
        keys = definition.fetch("key_columns",[])
        chosen = @mapping_context.dig("target","unique_keys").find { |index|
          index.fetch("columns").sort == keys.sort
        }
        @mapping_form = {"key_index"=>chosen && chosen["name"],
          "removal"=>definition.dig("removal","strategy") || "retain",
          "archive_column"=>definition.dig("removal","column"),
          "archive_active"=>definition.dig("removal","active") == false ? "false" : "true",
          "rows"=>@mapping_context.dig("target","columns").map do |column|
            spec = definition.fetch("columns",{}).fetch(column.fetch("name"),{})
            field = spec["field"]
            field = "" unless field.is_a?(String) && @mapping_context.dig("source","fields").include?(field)
            {"column"=>column.fetch("name"),"field"=>field,
              "null"=>%w[assign preserve].include?(spec["null"]) ? spec["null"] : "assign",
              "missing"=>%w[error preserve].include?(spec["missing"]) ? spec["missing"] : "error",
              "stringify"=>spec["stringify"] == true ? "1" : "0"}
          end}
      end

      def operator_mapping_input
        value = params.require(:mapping)
        raise ActionController::BadRequest,"Use the field mapping form." unless
          value.is_a?(ActionController::Parameters)
        value.permit(:key_index,:removal,:archive_column,:archive_active,
          rows: [:column,:field,:null,:missing,:stringify]).to_h
      end

      def operator_mapping_row(form, name)
        value = form.fetch("rows",[])
        value = value.values if value.is_a?(Hash)
        return {} unless value.is_a?(Array)
        value.find { |row| row.is_a?(Hash) && row["column"] == name } || {}
      end

      def operator_mapping_configured?(definition)
        definition.is_a?(Hash) && definition["columns"].is_a?(Hash) &&
          !definition["columns"].empty? && definition["key_columns"].is_a?(Array) &&
          !definition["key_columns"].empty?
      end

      def operator_mapping_label(value)
        text = value.to_s.tr("_"," ").strip
        text.empty? ? "Field" : text.sub(/\A./) { |first| first.upcase }
      end

      def operator_source_types(column)
        types = column.fetch("types",{})
        names = {"null"=>"Empty","string"=>"Text","integer"=>"Whole number",
          "decimal"=>"Decimal","boolean"=>"Yes / no"}
        selected = types.reject { |key,count| key == "null" || count.to_i.zero? }.map do |key,count|
          "#{names.fetch(key) { operator_mapping_label(key) }}: #{count}"
        end
        selected.empty? ? "No nonempty values" : selected.join(" · ")
      end

      def operator_mapping_problem(error)
        code = error.respond_to?(:code) ? error.code : nil
        problems = {
          "DATASET_OPERATOR_MAPPING_CONTEXT_CHANGED"=>"The source or application fields changed while this form was open. Review the current fields below, then create the mapping review.",
          "DATASET_OPERATOR_MAPPING_SELECTION_CHANGED"=>"This saved form belongs to another mapping selection. Review the current fields below and create a new review.",
          "DATASET_OPERATOR_KEY_INDEX"=>"Choose one of the application's unique record keys.",
          "DATASET_OPERATOR_KEY_SOURCE_REQUIRED"=>"Choose a source column for every field in the selected record key.",
          "DATASET_OPERATOR_KEY_SOURCE_CHANGED"=>"The current source no longer supplies this stream's original record key. Review the original source selection.",
          "DATASET_OPERATOR_MAPPING_COLUMN"=>"Choose each application field once from the fields shown below.",
          "DATASET_OPERATOR_MAPPING_FIELD"=>"Choose a source column from the complete retained dataset.",
          "DATASET_OPERATOR_MAPPING_FORM"=>"Complete the supported field mapping options below.",
          "DATASET_OPERATOR_MAPPING_TEXT"=>"Convert numbers or yes/no values to text only for a text field.",
          "DATASET_OPERATOR_REMOVAL_POLICY"=>"Choose whether absent source records are retained or archived.",
          "DATASET_OPERATOR_ARCHIVE_COLUMN"=>"Choose a Boolean archive field that is left unmapped in the field list.",
          "DATASET_MAPPING_KEYS"=>"Map at least one application field and choose its complete record key.",
          "DATASET_TARGET_COLUMN"=>"This field is controlled by the application. Choose an available application field.",
          "DATASET_COLUMN_TYPE"=>"Use the application's current field type.",
          "DATASET_FIELD_MAPPING"=>"Choose a source column and supported empty-value behavior for each mapped field.",
          "DATASET_KEY_REQUIRED"=>"Every record-key field needs an actual source value.",
          "DATASET_UNIQUE_TARGET_KEY"=>"The selected record key needs an existing unique index within this application's scope.",
          "DATASET_STREAM_BINDING"=>"This stream's established source, record key or application scope differs from the selection. Continue with its original source and key.",
          "DATASET_ARCHIVE_COLUMN"=>"Choose an available Boolean archive field that is left unmapped.",
          "DATASET_SOURCE_FIELD_MISSING"=>"The selected source column is missing from this complete dataset.",
          "DATASET_TEXT_REQUIRED"=>"A source value needs text. Select text conversion only when numbers or yes/no values should become text.",
          "DATASET_INTEGER_REQUIRED"=>"A source value does not fit a whole-number field.",
          "DATASET_DECIMAL_REQUIRED"=>"A source value does not fit a decimal field.",
          "DATASET_BOOLEAN_REQUIRED"=>"A yes/no field requires actual true or false source values.",
          "DATASET_COLUMN_NULL"=>"The application requires a value in this field.",
          "DATASET_COLUMN_PRECISION"=>"A source value exceeds the precision of its application field.",
          "DATASET_COLUMN_VALUE"=>"A source value does not fit its selected application field."
        }
        message = problems.fetch(code,"The mapping could not be selected. Review the source columns, record key and application fields below.")
        details = error.respond_to?(:details) ? error.details : nil
        column = details && (details[:column] || details["column"])
        column ? "#{operator_mapping_label(column)}: #{message}" : message
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
          "complete"=>"Ready","source_preparing"=>"Reading complete source",
          "source_ready"=>"Source ready for mapping","source_error"=>"Source needs attention",
          "preparing"=>"Preparing complete review","ready"=>"Ready for review",
          "approved"=>"Import approved","importing"=>"Importing edition",
          "import_error"=>"Import needs attention","prepare_error"=>"Review needs attention"}.fetch(value.to_s) { value.to_s.tr("_"," ").capitalize }
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
