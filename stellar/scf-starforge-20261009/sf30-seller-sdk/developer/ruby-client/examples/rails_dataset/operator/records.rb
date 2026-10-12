# frozen_string_literal: true
# MIT. Complete staff views over the original committed dataset and target scope.
require "csv"
require "tmpdir"

module Starforge
  module DatasetOperator
    module Records
      SCHEMA = "stellar-forge.dataset-operator-capture.v1"
      REQUEST = "stellar-forge.dataset-operator-capture-request.v1"
      QUERY = "stellar-forge.dataset-operator-data-query.v1"
      ROW = "stellar-forge.dataset-operator-record.v1"
      PAGE = 100
      RUN_ROWS = 1000
      RUN_BYTES = 8 * 1024 * 1024
      FAN_IN = 24
      STATES = %w[active removed].freeze
      TARGET_STATES = %w[unchanged changed missing].freeze
      OPS = %w[eq ne contains starts_with gt gte lt lte is_null not_null].freeze
      module_function

      def need(value, code, **details)
        RailsDataset.need(value, code, **details)
      end
      def json(value)
        RailsDataset.json(value)
      end
      def sha(value)
        RailsDataset.sha(value)
      end
      def seal(value)
        value.merge("sha256"=>RailsDataset.fingerprint(value))
      end
      def check_seal(value, schema)
        need(value.is_a?(Hash) && value["schema"] == schema &&
          HASH.match?(value["sha256"].to_s) &&
          RailsDataset.fingerprint(value.reject { |key,_| key == "sha256" }) == value["sha256"],
          "DATASET_DATA_MANIFEST_CHANGED")
        value
      end
      def directory(path)
        value = Files.directory(path, create: true)
        # A retry also completes an interrupted mkdir-before-parent-fsync.
        Files.sync(File.dirname(value))
        value
      end
      def write(root, name)
        need(/\A(?:[a-z0-9-]+\/)*[a-z0-9.-]+\z/.match?(name) &&
          !name.split("/").any? { |part| part == "." || part == ".." },
          "DATASET_DATA_FILE_NAME")
        path = root
        name.split("/")[0...-1].each { |part| path = directory(File.join(path, part)) }
        descriptor = Store.write(File.join(root,name)) { |io| yield io }
        descriptor.merge("name"=>name)
      end
      def original_file(root, file, &block)
        need(file.is_a?(Hash) && /\A(?:[a-z0-9-]+\/)*[a-z0-9.-]+\z/.match?(file["name"].to_s) &&
          !file["name"].split("/").any? { |part| part == "." || part == ".." },
          "DATASET_DATA_FILE_NAME")
        parent = root
        file["name"].split("/")[0...-1].each { |part| parent = Files.directory(File.join(parent,part)) }
        Store.snapshot(File.join(root,file["name"]),file,&block)
      end
      def each_json(root, file)
        return enum_for(__method__,root,file) unless block_given?
        original_file(root,file) do |io|
          io.each_line do |line|
            need(line.end_with?("\n"),"DATASET_DATA_COMPLETE_LINE")
            value = Files.parse(line)
            need(value.is_a?(Hash),"DATASET_DATA_RECORD")
            yield value
          end
        end
      end
      def text(value)
        case value
        when NilClass then ""
        when BigDecimal then value.to_s("F")
        when Time, DateTime, ActiveSupport::TimeWithZone then value.to_time.utc.iso8601(9)
        when Date then value.iso8601
        when String then value
        when Integer, TrueClass, FalseClass then value.to_s
        else RailsDataset.exact_json(value)
        end
      end
      def tagged(value)
        RailsDataset.pack(value)
      end
      def values(value)
        RailsDataset.unpack(value)
      end
      def scalar(value, type)
        case type
        when "string"
          need(value.is_a?(String) && value.valid_encoding? && value.bytesize <= 65_536,
            "DATASET_DATA_FILTER_VALUE")
          value
        when "integer"
          need(value.is_a?(String) && /\A-?(?:0|[1-9][0-9]*)\z/.match?(value) &&
            value.bytesize <= 4096, "DATASET_DATA_FILTER_VALUE")
          Integer(value,10)
        when "decimal"
          need(value.is_a?(String) && /\A-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?\z/.match?(value) &&
            value.bytesize <= 4096, "DATASET_DATA_FILTER_VALUE")
          result = BigDecimal(value)
          need(result.finite?,"DATASET_DATA_FILTER_VALUE")
          result
        when "boolean"
          need(value == true || value == false,"DATASET_DATA_FILTER_VALUE")
          value
        when "date"
          need(value.is_a?(String) && /\A[0-9]{4}-[0-9]{2}-[0-9]{2}\z/.match?(value),
            "DATASET_DATA_FILTER_VALUE")
          Date.iso8601(value)
        when "datetime"
          need(value.is_a?(String) &&
            /\A[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]{1,9})?(?:Z|[+-][0-9]{2}:[0-9]{2})\z/.match?(value),
            "DATASET_DATA_FILTER_VALUE")
          Time.iso8601(value).utc
        else
          raise RailsDataset::ImportError.new("DATASET_DATA_COLUMN_TYPE", type: type)
        end
      rescue ArgumentError
        raise RailsDataset::ImportError.new("DATASET_DATA_FILTER_VALUE")
      end

      def normalize_query(input, columns)
        need(input.is_a?(Hash) && (input.keys - %w[search statuses target_states filters sort]).empty?,
          "DATASET_DATA_QUERY")
        allowed = columns.to_h { |column| [column.fetch("key"),column] }
        search = input.fetch("search","")
        need(search.is_a?(String) && search.valid_encoding? && search.bytesize <= 4096,
          "DATASET_DATA_SEARCH")
        selected_states = input.fetch("statuses",STATES)
        target_states = input.fetch("target_states",TARGET_STATES)
        [[selected_states,STATES],[target_states,TARGET_STATES]].each do |selected,legal|
          need(selected.is_a?(Array) && selected.length.between?(1,legal.length) &&
            selected.uniq == selected && (selected-legal).empty?,"DATASET_DATA_STATUS")
        end
        filters = input.fetch("filters",[])
        sort = input.fetch("sort",[])
        need(filters.is_a?(Array) && filters.length <= 32 && sort.is_a?(Array) &&
          sort.length <= 8,"DATASET_DATA_QUERY_LIMIT")
        filters = filters.map do |filter|
          need(filter.is_a?(Hash) && (filter.keys-%w[column operator value]).empty? &&
            allowed.key?(filter["column"]) && OPS.include?(filter["operator"]),
            "DATASET_DATA_FILTER")
          type,operator = allowed.fetch(filter["column"]).fetch("type"),filter["operator"]
          need(!%w[contains starts_with].include?(operator) || type == "string",
            "DATASET_DATA_FILTER_TYPE")
          need(!%w[gt gte lt lte].include?(operator) || type != "boolean",
            "DATASET_DATA_FILTER_TYPE")
          if %w[is_null not_null].include?(operator)
            need(!filter.key?("value"),"DATASET_DATA_FILTER_VALUE")
            filter.slice("column","operator")
          else
            need(filter.key?("value"),"DATASET_DATA_FILTER_VALUE")
            scalar(filter["value"],type)
            filter.slice("column","operator","value")
          end
        end
        sort = sort.map do |selected|
          need(selected.is_a?(Hash) && (selected.keys-%w[column direction nulls]).empty? &&
            allowed.key?(selected["column"]) && %w[asc desc].include?(selected.fetch("direction","asc")) &&
            %w[first last].include?(selected.fetch("nulls","last")),"DATASET_DATA_SORT")
          {"column"=>selected["column"],"direction"=>selected.fetch("direction","asc"),
            "nulls"=>selected.fetch("nulls","last")}
        end
        need(sort.map { |item| item["column"] }.uniq.length == sort.length,"DATASET_DATA_SORT")
        {"search"=>search,"statuses"=>STATES.select { |item| selected_states.include?(item) },
          "target_states"=>TARGET_STATES.select { |item| target_states.include?(item) },
          "filters"=>filters,"sort"=>sort}
      end

      def matches?(record, query, columns)
        return false unless query["statuses"].include?(record["status"]) &&
          query["target_states"].include?(record["target_state"])
        term = query["search"].downcase
        unless term.empty?
          source = values(record.fetch("source").fetch("values"))
          target = values(record.fetch("target").fetch("values"))
          haystack = [record["key_text"],record["status"],record["target_state"]] +
            source.values.map { |value| text(value) } + target.values.map { |value| text(value) }
          return false unless haystack.any? { |value| value.downcase.include?(term) }
        end
        query["filters"].all? do |filter|
          actual = values(record.fetch("cells").fetch(filter["column"]))
          operator = filter["operator"]
          next actual.nil? if operator == "is_null"
          next !actual.nil? if operator == "not_null"
          next false if actual.nil?
          wanted = scalar(filter.fetch("value"),columns.fetch(filter["column"]).fetch("type"))
          case operator
          when "eq" then actual == wanted
          when "ne" then actual != wanted
          when "contains" then actual.downcase.include?(wanted.downcase)
          when "starts_with" then actual.downcase.start_with?(wanted.downcase)
          when "gt" then (actual <=> wanted) == 1
          when "gte" then (actual <=> wanted) >= 0
          when "lt" then (actual <=> wanted) == -1
          when "lte" then (actual <=> wanted) <= 0
          end
        end
      end

      def compare(left,right,sort)
        sort.each_with_index do |spec,index|
          a,b = values(left.fetch("sort").fetch(index)),values(right.fetch("sort").fetch(index))
          if a.nil? || b.nil?
            next if a.nil? && b.nil?
            return a.nil? ? (spec["nulls"] == "first" ? -1 : 1) : (spec["nulls"] == "first" ? 1 : -1)
          end
          result = if a == true || a == false
            (a ? 1 : 0) <=> (b ? 1 : 0)
          else
            a <=> b
          end
          need(!result.nil?,"DATASET_DATA_SORT_VALUES")
          next if result.zero?
          return spec["direction"] == "desc" ? -result : result
        end
        left.fetch("key_sha256") <=> right.fetch("key_sha256")
      end

      # Sort all selected rows with bounded batches and bounded open descriptors.
      # Runs carry only exact sort values and original chunk/row references.
      class Sorter
        def initialize(root,sort)
          @root,@sort,@pending,@bytes,@runs,@serial = root,sort,[],0,[],0
        end
        def append(value)
          @pending << value
          @bytes += Records.json(value).bytesize
          flush if @pending.length >= RUN_ROWS || @bytes >= RUN_BYTES
        end
        def flush
          return if @pending.empty?
          @pending.sort! { |a,b| Records.compare(a,b,@sort) }
          @runs << write_run { |io| @pending.each { |value| io.write(Records.json(value) + "\n") } }
          @pending,@bytes = [],0
        end
        def write_run
          @serial += 1
          Records.write(@root,format("runs/run-%08d.jsonl",@serial)) { |io| yield io }
        end
        def with_inputs(runs,index = 0,inputs = [],&block)
          return yield(inputs) if index == runs.length
          Records.original_file(@root,runs[index]) do |io|
            with_inputs(runs,index+1,inputs+[io],&block)
          end
        end
        def merge(runs)
          with_inputs(runs) do |inputs|
            current = inputs.map { |io| (line=io.gets) && Files.parse(line) }
            loop do
              selected = current.each_index.select { |index| current[index] }.min do |a,b|
                Records.compare(current[a],current[b],@sort)
              end
              break if selected.nil?
              yield current[selected]
              line = inputs[selected].gets
              current[selected] = line && Files.parse(line)
            end
          end
        end
        def each
          return enum_for(__method__) unless block_given?
          flush
          while @runs.length > FAN_IN
            prior = @runs
            @runs = prior.each_slice(FAN_IN).map do |group|
              write_run { |io| merge(group) { |value| io.write(Records.json(value) + "\n") } }
            end
          end
          merge(@runs) { |value| yield value }
        end
      end
    end

    class Workspace
      def data_scope(review_id)
        chosen = selection(review_id)
        current = stream(chosen.fetch("candidate").fetch("stream_id"))
        scope = @target_scope.call(current)
        Records.need(scope.is_a?(ActiveRecord::Relation),"DATASET_DATA_TARGET_SCOPE")
        scope = scope.reorder(nil)
        Records.need(scope.limit_value.nil? && scope.offset_value.nil? && scope.group_values.empty? &&
          scope.klass.primary_key.is_a?(String),"DATASET_DATA_TARGET_SCOPE")
        Records.need(([@models.fetch(:edition),@models.fetch(:entry),@models.fetch(:row),scope.klass]).all? {
          |model| model.connection_pool.equal?(current.class.connection_pool)
        },"DATASET_ONE_DATABASE")
        signature = RailsDataset.fingerprint({"model"=>scope.klass.name,"sql"=>scope.to_sql,
          "creation_values"=>scope.scope_for_create.stringify_keys})
        Records.need(current.target_model == scope.klass.name && current.scope_sha256 == signature,
          "DATASET_DATA_SCOPE_CHANGED")
        {selection: chosen,stream: current,scope: scope,scope_sha256: signature,pk: scope.klass.primary_key}
      end

      def data_receipt(edition, current)
        raw = edition.receipt_json
        Records.need(raw.is_a?(String) && RailsDataset.sha(raw) == edition.receipt_sha256,
          "DATASET_RECEIPT_CHANGED")
        result = Files.parse(raw)
        expected = {"schema"=>RailsDataset::SCHEMA,"stream_id"=>current.id.to_s,
          "edition_id"=>edition.id.to_s,"revision"=>edition.revision,
          "operation_sha256"=>edition.operation_sha256,"manifest_sha256"=>edition.manifest_sha256,
          "source_sha256"=>edition.source_sha256,"mapping_sha256"=>edition.mapping_sha256,
          "binding"=>Files.parse(edition.binding_json),"preview_sha256"=>edition.preview_sha256}
        Records.need(expected.all? { |key,value| result[key] == value },"DATASET_RECEIPT_BINDING")
        result
      end

      def data_current(review_id,context = nil)
        context ||= data_scope(review_id)
        current,chosen = context.fetch(:stream).reload,context.fetch(:selection)
        edition = @models.fetch(:edition).find_by!(dataset_stream_id: current.id,id: current.latest_edition_id)
        receipt = data_receipt(edition,current)
        Records.need(edition.revision == current.revision,"DATASET_PRIOR_REVISION_CHANGED")
        saved = Store.present?(File.join(path(review_id),"review.json")) ? review(review_id) : nil
        same = saved && saved.dig("summary","binding","source") == receipt.dig("binding","source") &&
          saved.dig("summary","binding","mapping_sha256") == receipt["mapping_sha256"]
        original_review = nil
        unless same
          Dir.children(@directory).sort.each do |id|
            next unless UUID.match?(id) && Store.present?(File.join(path(id),"selection.json"))
            candidate = selection(id)
            next unless candidate.dig("candidate","stream_id").to_s == current.id.to_s &&
              RailsDataset.sha(candidate.fetch("operation_key")) == edition.operation_sha256
            Records.need(original_review.nil?,"DATASET_DATA_CURRENT_REVIEW_AMBIGUOUS")
            original_review = id
          end
        end
        {"stream_id"=>current.id.to_s,"revision"=>current.revision,"edition_id"=>edition.id.to_s,
          "receipt_sha256"=>edition.receipt_sha256,"can_capture"=>!!same,
          "current_review_id"=>same ? review_id : original_review,
          "reason"=>same ? nil : "Open the review for the current received edition before capturing working records."}
      end

      def data_directory(review_id, capture_id, create: false)
        Records.need(UUID.match?(capture_id.to_s),"DATASET_DATA_CAPTURE_ID")
        base = File.join(path(review_id),"data")
        create ? Records.directory(base) : Files.directory(base)
        result = File.join(base,capture_id)
        create ? Records.directory(result) : Files.directory(result)
      end

      def select_data_capture(review_id, id:, actor:, expected_revision:, expected_receipt_sha256:)
        Records.need(UUID.match?(id.to_s) && actor.is_a?(String) && actor.valid_encoding? &&
          !actor.strip.empty? && actor.bytesize <= 512 &&
          expected_revision.is_a?(Integer) && expected_revision >= 1 &&
          HASH.match?(expected_receipt_sha256.to_s),"DATASET_DATA_CAPTURE_SELECTION")
        context = data_scope(review_id)
        root = data_directory(review_id,id,create: true)
        request = {"schema"=>Records::REQUEST,"id"=>id,"review_id"=>review_id,"actor"=>actor,
          "tenant_key"=>@tenant_key,"stream_id"=>context.fetch(:stream).id.to_s,
          "selection_sha256"=>context.fetch(:selection).dig("candidate","selection_sha256"),
          "scope_sha256"=>context.fetch(:scope_sha256),"expected_revision"=>expected_revision,
          "expected_receipt_sha256"=>expected_receipt_sha256}
        Files.lock(root) do
          selected_path = File.join(root,"request.json")
          if Store.present?(selected_path)
            saved = Records.check_seal(Store.read(selected_path),Records::REQUEST)
            Records.need(saved.reject { |key,_| %w[created_at sha256].include?(key) } == request,
              "DATASET_DATA_CAPTURE_SELECTION_CHANGED")
          else
            actual = data_current(review_id,context)
            Records.need(actual["can_capture"] && actual["revision"] == expected_revision &&
              actual["receipt_sha256"] == expected_receipt_sha256,"DATASET_DATA_EDITION_CHANGED")
            saved = Records.seal(request.merge("created_at"=>Time.now.utc.iso8601(6)))
            Files.once(selected_path,Files.json(saved))
          end
        end
        data_capture_state(review_id,id)
      end

      def data_request(review_id,capture_id)
        context = data_scope(review_id)
        saved = Records.check_seal(Store.read(File.join(data_directory(review_id,capture_id),"request.json")),
          Records::REQUEST)
        Records.need(saved["id"] == capture_id && saved["review_id"] == review_id &&
          saved["tenant_key"] == @tenant_key && saved["stream_id"] == context.fetch(:stream).id.to_s &&
          saved["scope_sha256"] == context.fetch(:scope_sha256) &&
          saved["selection_sha256"] == context.fetch(:selection).dig("candidate","selection_sha256"),
          "DATASET_DATA_CAPTURE_SELECTION_CHANGED")
        [saved,context]
      end

      def data_capture(review_id,capture_id)
        request,context = data_request(review_id,capture_id)
        root = data_directory(review_id,capture_id)
        result = Records.check_seal(Store.read(File.join(root,"content","manifest.json")),Records::SCHEMA)
        Records.need(result["id"] == capture_id && result["review_id"] == review_id &&
          result["request_sha256"] == request["sha256"] &&
          result["stream_id"] == context.fetch(:stream).id.to_s &&
          result["scope_sha256"] == context.fetch(:scope_sha256) &&
          result["revision"] == request["expected_revision"] &&
          result["receipt_sha256"] == request["expected_receipt_sha256"],
          "DATASET_DATA_CAPTURE_CHANGED")
        result
      end

      def data_capture_state(review_id,capture_id)
        request,_context = data_request(review_id,capture_id)
        root = data_directory(review_id,capture_id)
        if Store.present?(File.join(root,"content","manifest.json"))
          capture = data_capture(review_id,capture_id)
          {"id"=>capture_id,"review_id"=>review_id,"state"=>"complete","request"=>request,"capture"=>capture}
        else
          value = Store.present?(File.join(root,"state.json")) ? Store.read(File.join(root,"state.json")) : {}
          {"id"=>capture_id,"review_id"=>review_id,"state"=>value.fetch("state","selected"),
            "request"=>request,"error"=>value["error"]}
        end
      end

      def data_captures(review_id, before: nil, limit: 30)
        Records.need(limit.is_a?(Integer) && limit.between?(1,100) &&
          (before.nil? || before.is_a?(String)),"DATASET_DATA_PAGE")
        context = data_scope(review_id)
        base = File.join(path(review_id),"data")
        items,pending = [],[]
        if File.directory?(base)
          Files.directory(base)
          Dir.children(base).sort.each do |id|
            next unless UUID.match?(id) && Store.present?(File.join(data_directory(review_id,id),"request.json"))
            state = data_capture_state(review_id,id)
            if state["state"] == "complete"
              value = state.fetch("capture")
              cursor = value.fetch("created_at") + "/" + id
              items << value.merge("cursor"=>cursor) unless before && cursor >= before
            else
              pending << state
            end
          end
        end
        items.sort_by! { |item| item["cursor"] }.reverse!
        selected = items.first(limit)
        {"current"=>data_current(review_id,context),"items"=>selected,"pending"=>pending,
          "next_before"=>items.length > limit ? selected.last["cursor"] : nil}
      end

      def capture_data(review_id, **input)
        selected = select_data_capture(review_id,**input)
        complete_data_capture(review_id,selected.fetch("id"))
      end

      def data_columns(mapping)
        columns = [
          {"key"=>"@key","label"=>"Record key","type"=>"string","origin"=>"metadata"},
          {"key"=>"@status","label"=>"Source membership","type"=>"string","origin"=>"metadata"},
          {"key"=>"@target_state","label"=>"Working record","type"=>"string","origin"=>"metadata"}
        ]
        mapping.columns.each do |name,spec|
          columns << {"key"=>"target."+name,"label"=>name,"type"=>spec.fetch("type"),
            "origin"=>"target","source_field"=>spec.fetch("field")}
        end
        if mapping.removal["strategy"] == "archive"
          name = mapping.removal.fetch("column")
          columns << {"key"=>"target."+name,"label"=>name,"type"=>"boolean","origin"=>"target"}
        end
        columns
      end

      def data_entry(entry,edition_id,key)
        Records.need(entry && entry.dataset_edition_id.to_s == edition_id.to_s &&
          entry.key_sha256 == key && RailsDataset.sha(entry.record_json) == entry.record_sha256,
          "DATASET_DATA_ENTRY_CHANGED")
        value = Files.parse(entry.record_json)
        Records.need(value["key_sha256"] == key && value["edition_id"] == edition_id.to_s &&
          value["action"] == entry.action && value["target_id"] == entry.target_id &&
          value["source_ordinal"] == entry.source_ordinal,"DATASET_DATA_ENTRY_BINDING")
        value
      end

      def data_review_packages(review_id,current)
        ids = [review_id] + Dir.children(@directory).sort.select { |id| UUID.match?(id) && id != review_id }
        choices = Hash.new { |hash,key| hash[key] = [] }
        ids.each do |id|
          next unless Store.present?(File.join(path(id),"selection.json")) &&
            Store.present?(File.join(path(id),"review.json")) &&
            Store.present?(File.join(path(id),"received.json"))
          chosen = selection(id)
          next unless chosen.dig("candidate","stream_id").to_s == current.id.to_s
          ready = review(id)
          original_manifest = ready.dig("summary","binding","source","manifest_sha256")
          choices[original_manifest] << id if HASH.match?(original_manifest.to_s)
        end
        choices
      end

      def data_attachments_for(manifest,source_values,choices,packages)
        unless packages.key?(manifest)
          packages[manifest] = nil
          Array(choices[manifest]).each do |review_id|
            package = selected_delivery(review_id)
            native = package.respond_to?(:dataset) ? package.dataset : package
            Records.need(native.manifest_sha256 == manifest,"DATASET_DATA_RECEIVED_SOURCE_CHANGED")
            next unless package.respond_to?(:attachment_page) && package.respond_to?(:source)
            source = package.source
            next unless source.is_a?(Hash) && source["schema"] == "stellar-forge.baserow-customer-source.v1"
            id_column = source.fetch("recordIdColumn")
            refs,offset = Hash.new { |hash,key| hash[key] = [] },0
            loop do
              page = package.attachment_page(offset: offset,limit: 1000)
              page.fetch("files").each do |file|
                file.fetch("references").each do |ref|
                  record_id = ref.fetch("record_id")
                  refs[record_id] << {"file"=>file.fetch("file"),"bytes"=>file.fetch("bytes"),
                    "sha256"=>file.fetch("sha256"),"filename"=>ref.fetch("name"),
                    "mime_type"=>file.fetch("mime_type"),"record_id"=>record_id,
                    "column"=>ref.fetch("column"),"index"=>ref.fetch("index"),"review_id"=>review_id}
                end
              end
              next_offset = page["next_offset"]
              break if next_offset.nil?
              Records.need(next_offset.is_a?(Integer) && next_offset > offset,"DATASET_DATA_ATTACHMENT_PAGE")
              offset = next_offset
            end
            packages[manifest] = {id_column: id_column,refs: refs}
            break
          end
        end
        selected = packages[manifest]
        return [] unless selected
        record_id = source_values[selected.fetch(:id_column)]
        Records.need(record_id.is_a?(String),"DATASET_DATA_ATTACHMENT_ID")
        selected.fetch(:refs).fetch(record_id,[])
      end

      def data_authorize_records(context,records)
        ids = records.map { |record| record.dig("target","id") }.compact.uniq
        return if ids.empty?
        scope,pk = context.fetch(:scope),context.fetch(:pk)
        present = scope.where(pk=>ids).pluck(pk).map(&:to_s)
        missing = ids-present
        Records.need(missing.empty? || !scope.klass.unscoped.where(pk=>missing).exists?,
          "DATASET_MANAGED_TARGET_OUTSIDE_SCOPE")
      end

      def data_snapshot_transaction(context,&block)
        connection = context.fetch(:stream).class.connection
        Records.need(!connection.transaction_open?,"DATASET_DATA_CAPTURE_TRANSACTION",
          reason: "Start a capture outside an existing application transaction.")
        adapter = connection.adapter_name.downcase
        options = case adapter
        when /postgres|mysql|trilogy/ then {isolation: :repeatable_read}
        when /sqlite/ then {}
        else
          raise RailsDataset::ImportError.new("DATASET_DATA_SNAPSHOT_ADAPTER",adapter: adapter)
        end
        connection.transaction(**options) do
          context.fetch(:stream).lock!
          yield
        end
      end

      def data_cleanup_staging(root,prefix)
        Dir.children(root).select { |name| name.start_with?(prefix) }.each do |name|
          selected = Files.directory(File.join(root,name))
          FileUtils.remove_entry_secure(selected)
        end
        Files.sync(root)
      end

      # Creation and export verification observe the identical native state.
      # Keep one row builder for original entries, exact values and file links.
      def data_native_records(review_id,context,value)
        current,scope,pk = context.values_at(:stream,:scope,:pk)
        column_names = value.mapping.target_columns
        choices,packages = data_review_packages(review_id,current),{}
        editions = {}
        edition_for = lambda do |id|
          editions[id.to_s] ||= begin
            row = @models.fetch(:edition).find_by!(dataset_stream_id: current.id,id: id)
            [row,value.verified_receipt(row)]
          end
        end
        states_relation = @models.fetch(:row).where(dataset_stream_id: current.id)
        states_relation.find_in_batches(batch_size: Records::PAGE) do |states|
          ids = states.map(&:target_id).compact
          targets = ids.empty? ? {} : scope.where(pk=>ids).to_a.index_by { |target| target.public_send(pk).to_s }
          missing_ids = ids.map(&:to_s)-targets.keys
          Records.need(missing_ids.empty? || !scope.klass.unscoped.where(pk=>missing_ids).exists?,
            "DATASET_MANAGED_TARGET_OUTSIDE_SCOPE")
          entries = @models.fetch(:entry).where(dataset_edition_id: states.map(&:last_edition_id).uniq,
            key_sha256: states.map(&:key_sha256)).to_a.index_by { |entry| [entry.dataset_edition_id.to_s,entry.key_sha256] }
          records = states.map do |state|
            Records.need(HASH.match?(state.key_sha256.to_s) &&
              RailsDataset.sha(state.key_json) == state.key_sha256 &&
              state.target_model == scope.klass.name && Records::STATES.include?(state.status),
              "DATASET_DATA_KEY_STATE")
            last_edition,last_receipt = edition_for.call(state.last_edition_id)
            entry_row = entries[[state.last_edition_id.to_s,state.key_sha256]]
            last_entry = data_entry(entry_row,last_edition.id,state.key_sha256)
            Records.need(last_entry["key_json"] == state.key_json &&
              last_entry["target_id"] == state.target_id &&
              (state.status == "removed") == (last_entry["action"] == "removed"),
              "DATASET_DATA_KEY_STATE_CHANGED")
            source_row,source_edition = entry_row,last_edition
            if state.status == "removed"
              entry_table,edition_table = @models.fetch(:entry).arel_table,@models.fetch(:edition).arel_table
              joined = entry_table.join(edition_table).on(
                entry_table[:dataset_edition_id].eq(edition_table[:id])).join_sources
              source_row = @models.fetch(:entry).joins(joined).
                where(edition_table[:dataset_stream_id].eq(current.id)).
                where(edition_table[:revision].lteq(last_edition.revision)).
                where(key_sha256: state.key_sha256).where.not(action: "removed").
                order(edition_table[:revision].desc,entry_table[:id].desc).first
              Records.need(source_row,"DATASET_DATA_ORIGINAL_ROW_MISSING")
              source_edition,_source_receipt = edition_for.call(source_row.dataset_edition_id)
            end
            original = data_entry(source_row,source_edition.id,state.key_sha256)
            Records.need(original["source_raw_json"].is_a?(String) &&
              RailsDataset.sha(original["source_raw_json"]) == original["source_row_sha256"] &&
              original["source_row_sha256"] == state.source_row_sha256 &&
              original["after_json"] == state.values_json,"DATASET_DATA_ORIGINAL_ROW_CHANGED")
            raw_values = Files.parse(original.fetch("source_raw_json"),decimals: true)
            Records.need(raw_values.is_a?(Hash),"DATASET_DATA_ORIGINAL_ROW")
            assigned = RailsDataset.unpack(Files.parse(state.values_json))
            expected = assigned.merge(RailsDataset.unpack(Files.parse(last_entry.fetch("after_json"))))
            target = targets[state.target_id.to_s]
            current_values = target ? column_names.to_h { |name| [name,target.public_send(name)] } : {}
            changed = expected.keys.select { |name|
              !target || !current_values.key?(name) ||
                RailsDataset.pack(current_values[name]) != RailsDataset.pack(expected[name])
            }
            target_state = target.nil? ? "missing" : (changed.empty? ? "unchanged" : "changed")
            key = RailsDataset.unpack(Files.parse(state.key_json))
            Records.need(key.is_a?(Hash),"DATASET_DATA_KEY")
            key_text = key.map { |name,cell| name + "=" + Records.text(cell) }.join(", ")
            cells = {"@key"=>Records.tagged(key_text),"@status"=>Records.tagged(state.status),
              "@target_state"=>Records.tagged(target_state)}
            column_names.each { |name| cells["target."+name] = Records.tagged(current_values[name]) }
            record = {"schema"=>Records::ROW,"key_sha256"=>state.key_sha256,
              "key"=>Records.tagged(key),"key_text"=>key_text,"status"=>state.status,
              "target_state"=>target_state,"source"=>{"edition_id"=>source_edition.id.to_s,
                "revision"=>source_edition.revision,"manifest_sha256"=>source_edition.manifest_sha256,
                "row_sha256"=>original["source_row_sha256"],"ordinal"=>original["source_ordinal"],
                "entry_sha256"=>source_row.record_sha256,"values"=>Records.tagged(raw_values),
                "raw_json"=>original.fetch("source_raw_json")},
              "committed"=>{"edition_id"=>last_edition.id.to_s,"revision"=>last_edition.revision,
                "entry_sha256"=>entry_row.record_sha256,"values"=>Records.tagged(expected)},
              "target"=>{"id"=>state.target_id,"model"=>scope.klass.name,
                "values"=>Records.tagged(current_values),"changed_columns"=>changed.sort},
              "cells"=>cells,
              "attachments"=>data_attachments_for(source_edition.manifest_sha256,raw_values,choices,packages)}
            record
          end
          yield records
        end
      end

      def complete_data_capture(review_id,capture_id)
        request,context = data_request(review_id,capture_id)
        root = data_directory(review_id,capture_id)
        Files.lock(root) do
          return data_capture(review_id,capture_id) if Store.present?(File.join(root,"content","manifest.json"))
          Records.need(!Store.present?(File.join(root,"content")),"DATASET_DATA_CAPTURE_INCOMPLETE")
          Store.replace(File.join(root,"state.json"),{"state"=>"running","started_at"=>Time.now.utc.iso8601(6)})
          data_cleanup_staging(root,".data-capture-")
          temporary = Dir.mktmpdir(".data-capture-",root)
          File.chmod(0700,temporary)
          begin
            result = nil
            data_snapshot_transaction(context) do
              actual = data_current(review_id,context)
              Records.need(actual["can_capture"] && actual["revision"] == request["expected_revision"] &&
                actual["receipt_sha256"] == request["expected_receipt_sha256"],"DATASET_DATA_EDITION_CHANGED")
              value = importer(review_id)
              current,scope,pk = context.values_at(:stream,:scope,:pk)
              binding = value.binding
              Records.need(binding["scope_sha256"] == request["scope_sha256"],"DATASET_DATA_SCOPE_CHANGED")
              latest = @models.fetch(:edition).find_by!(dataset_stream_id: current.id,id: current.latest_edition_id)
              latest_receipt = value.verified_receipt(latest)
              Records.need(latest_receipt.dig("binding","source") == value.source_binding &&
                latest.mapping_sha256 == value.mapping.sha256,"DATASET_DATA_RECEIVED_SOURCE_CHANGED")
              columns = data_columns(value.mapping)
              column_names = value.mapping.target_columns
              counts = {"total"=>0,"active"=>0,"removed"=>0,"unchanged"=>0,"changed"=>0,"missing"=>0}
              chunks,buckets,bucket_files = [],{},{}
              aggregate = Digest::SHA256.new
              data_native_records(review_id,context,value) do |records|
                records.each do |record|
                  counts["total"] += 1
                  counts[record.fetch("status")] += 1
                  counts[record.fetch("target_state")] += 1
                end
                chunk_number = chunks.length
                file = Records.write(temporary,format("rows/chunk-%08d.jsonl",chunk_number)) do |io|
                  records.each_with_index do |record,index|
                    raw = Records.json(record) + "\n"
                    io.write(raw)
                    aggregate.update(raw)
                    prefix = record.fetch("key_sha256")[0,2]
                    unless buckets[prefix]
                      folder = Records.directory(File.join(temporary,"keys"))
                      buckets[prefix] = File.open(File.join(folder,prefix+".jsonl"),
                        File::WRONLY | File::CREAT | File::EXCL | File::NOFOLLOW,0600)
                    end
                    buckets[prefix].write(Records.json({"key_sha256"=>record.fetch("key_sha256"),
                      "chunk"=>chunk_number,"index"=>index}) + "\n")
                  end
                end
                chunks << file.merge("count"=>records.length)
              end
              buckets.each do |prefix,io|
                io.flush
                io.fsync
                io.close
                name = "keys/"+prefix+".jsonl"
                path = File.join(temporary,name)
                bucket_files[prefix] = {"name"=>name,"bytes"=>File.size(path),
                  "sha256"=>Digest::SHA256.file(path).hexdigest}
              end
              Files.sync(File.join(temporary,"keys")) unless buckets.empty?
              current.reload
              Records.need(current.revision == request["expected_revision"] &&
                current.latest_edition_id == latest.id,"DATASET_DATA_EDITION_CHANGED")
              result = Records.seal({"schema"=>Records::SCHEMA,"id"=>capture_id,"review_id"=>review_id,
                "created_at"=>request.fetch("created_at"),"captured_at"=>Time.now.utc.iso8601(6),
                "actor"=>request.fetch("actor"),"request_sha256"=>request.fetch("sha256"),
                "stream_id"=>current.id.to_s,"scope_sha256"=>context.fetch(:scope_sha256),
                "target_model"=>scope.klass.name,"revision"=>current.revision,"edition_id"=>latest.id.to_s,
                "receipt_sha256"=>latest.receipt_sha256,"receipt"=>latest_receipt,
                "source"=>value.source_binding,"mapping"=>value.mapping.definition,
                "columns"=>columns,"counts"=>counts,"rows_sha256"=>aggregate.hexdigest,
                "chunks"=>chunks,"keys"=>bucket_files,"files"=>chunks+bucket_files.values})
            ensure
              buckets&.each_value { |io| io.close unless io.closed? }
            end
            Records.write(temporary,"manifest.json") { |io| io.write(Files.json(result)) }
            Files.sync(temporary)
            File.rename(temporary,File.join(root,"content"))
            Files.sync(root)
            temporary = nil
            Store.replace(File.join(root,"state.json"),{"state"=>"complete","capture_sha256"=>result["sha256"]})
            data_capture(review_id,capture_id)
          rescue Exception => error
            Store.replace(File.join(root,"state.json"),{"state"=>"error",
              "error"=>{"code"=>error.respond_to?(:code) ? error.code : error.class.name,
                "message"=>error.message.to_s[0,4000]}})
            raise
          ensure
            FileUtils.remove_entry_secure(temporary) if temporary && File.directory?(temporary)
          end
        end
      end

      def data_each_record(review_id,capture)
        return enum_for(__method__,review_id,capture) unless block_given?
        context = data_scope(review_id)
        Records.need(capture["scope_sha256"] == context.fetch(:scope_sha256),
          "DATASET_DATA_SCOPE_CHANGED")
        root = File.join(data_directory(review_id,capture.fetch("id")),"content")
        count,digest = 0,Digest::SHA256.new
        capture.fetch("chunks").each_with_index do |file,chunk_index|
          batch = []
          Records.each_json(root,file) do |record|
            Records.need(record["schema"] == Records::ROW,"DATASET_DATA_RECORD")
            batch << record
            digest.update(Records.json(record) + "\n")
          end
          Records.need(batch.length == file.fetch("count"),"DATASET_DATA_CHUNK_CHANGED")
          data_authorize_records(context,batch)
          batch.each_with_index do |record,index|
            yield record,{"key_sha256"=>record.fetch("key_sha256"),"chunk"=>chunk_index,"index"=>index}
            count += 1
          end
        end
        Records.need(count == capture.dig("counts","total") && digest.hexdigest == capture["rows_sha256"],
          "DATASET_DATA_COMPLETE_CAPTURE_CHANGED")
      end

      def data_query_directory(review_id,capture_id,query_id,create: false)
        Records.need(HASH.match?(query_id.to_s),"DATASET_DATA_QUERY_ID")
        root = File.join(data_directory(review_id,capture_id),"queries")
        create ? Records.directory(root) : Files.directory(root)
        result = File.join(root,query_id)
        create ? Records.directory(result) : Files.directory(result)
      end

      def data_query(review_id,capture_id,query_id)
        capture = data_capture(review_id,capture_id)
        root = data_query_directory(review_id,capture_id,query_id)
        value = Records.check_seal(Store.read(File.join(root,"content","query.json")),Records::QUERY)
        normalized = Records.normalize_query(value.fetch("query"),capture.fetch("columns"))
        Records.need(value["id"] == query_id && value["capture_sha256"] == capture["sha256"] &&
          normalized == value["query"] &&
          RailsDataset.fingerprint({"capture_sha256"=>capture["sha256"],"query"=>normalized}) == query_id,
          "DATASET_DATA_QUERY_CHANGED")
        value.merge("capture"=>capture,"columns"=>capture.fetch("columns"))
      end

      def query_data(review_id,capture_id,query:)
        capture = data_capture(review_id,capture_id)
        normalized = Records.normalize_query(query,capture.fetch("columns"))
        selected = {"capture_sha256"=>capture.fetch("sha256"),"query"=>normalized}
        query_id = RailsDataset.fingerprint(selected)
        root = data_query_directory(review_id,capture_id,query_id,create: true)
        Files.lock(root) do
          if Store.present?(File.join(root,"content","query.json"))
            return data_query(review_id,capture_id,query_id)
          end
          Files.once(File.join(root,"request.json"),Files.json(selected))
          Records.need(!Store.present?(File.join(root,"content")),"DATASET_DATA_QUERY_INCOMPLETE")
          data_cleanup_staging(root,".data-query-")
          temporary = Dir.mktmpdir(".data-query-",root)
          File.chmod(0700,temporary)
          begin
            sorter = Records::Sorter.new(temporary,normalized.fetch("sort"))
            columns = capture.fetch("columns").to_h { |column| [column.fetch("key"),column] }
            total = 0
            data_each_record(review_id,capture) do |record,reference|
              next unless Records.matches?(record,normalized,columns)
              sorter.append(reference.merge("sort"=>normalized.fetch("sort").map {
                |spec| record.fetch("cells").fetch(spec.fetch("column"))
              }))
              total += 1
            end
            files,pending = [],[]
            write_page = lambda do
              number = files.length
              selected_page = pending
              files << Records.write(temporary,format("pages/page-%08d.jsonl",number)) do |io|
                selected_page.each { |reference| io.write(Records.json(reference.reject { |key,_| key == "sort" }) + "\n") }
              end.merge("count"=>selected_page.length)
              pending = []
            end
            sorter.each do |reference|
              pending << reference
              write_page.call if pending.length == Records::PAGE
            end
            write_page.call unless pending.empty?
            run_root = File.join(temporary,"runs")
            FileUtils.remove_entry_secure(run_root) if File.directory?(run_root)
            value = Records.seal({"schema"=>Records::QUERY,"id"=>query_id,
              "capture_sha256"=>capture.fetch("sha256"),"query"=>normalized,
              "total"=>total,"pages"=>[1,files.length].max,"page_size"=>Records::PAGE,
              "files"=>files})
            Records.write(temporary,"query.json") { |io| io.write(Files.json(value)) }
            Files.sync(temporary)
            File.rename(temporary,File.join(root,"content"))
            Files.sync(root)
            temporary = nil
            data_query(review_id,capture_id,query_id)
          ensure
            FileUtils.remove_entry_secure(temporary) if temporary && File.directory?(temporary)
          end
        end
      end

      def data_resolve_references(review_id,capture,references)
        Records.need(references.is_a?(Array) && references.length <= Records::PAGE,
          "DATASET_DATA_PAGE")
        root = File.join(data_directory(review_id,capture.fetch("id")),"content")
        loaded = {}
        references.each do |reference|
          index = reference.fetch("chunk")
          Records.need(index.is_a?(Integer) && index >= 0 && index < capture.fetch("chunks").length,
            "DATASET_DATA_REFERENCE")
          next if loaded.key?(index)
          file = capture.fetch("chunks").fetch(index)
          loaded[index] = Records.each_json(root,file).to_a
          Records.need(loaded[index].length == file.fetch("count"),"DATASET_DATA_CHUNK_CHANGED")
        end
        records = references.map do |reference|
          index = reference.fetch("index")
          Records.need(index.is_a?(Integer) && index >= 0,"DATASET_DATA_REFERENCE")
          row = loaded.fetch(reference.fetch("chunk"))[index]
          Records.need(row && row["schema"] == Records::ROW &&
            row["key_sha256"] == reference["key_sha256"],"DATASET_DATA_REFERENCE_CHANGED")
          row
        end
        data_authorize_records(data_scope(review_id),records)
        records
      end

      def data_rows(review_id,capture_id,query_id,page: 0)
        selected = data_query(review_id,capture_id,query_id)
        Records.need(page.is_a?(Integer) && page >= 0 && page < selected.fetch("pages"),
          "DATASET_DATA_PAGE")
        root = File.join(data_query_directory(review_id,capture_id,query_id),"content")
        file = selected.fetch("files")[page]
        references = file ? Records.each_json(root,file).to_a : []
        Records.need(references.length == (file ? file.fetch("count") : 0),"DATASET_DATA_QUERY_PAGE_CHANGED")
        records = data_resolve_references(review_id,selected.fetch("capture"),references)
        {"capture"=>selected.fetch("capture"),"query"=>selected.slice("id","query","total","pages","page_size"),
          "columns"=>selected.fetch("columns"),"rows"=>records,"page"=>page,
          "pages"=>selected.fetch("pages"),"total"=>selected.fetch("total")}
      end

      def data_record(review_id,capture_id,key_sha256:)
        Records.need(HASH.match?(key_sha256.to_s),"DATASET_DATA_RECORD_KEY")
        capture = data_capture(review_id,capture_id)
        file = capture.fetch("keys")[key_sha256[0,2]]
        Records.need(file,"DATASET_DATA_RECORD_NOT_FOUND")
        root = File.join(data_directory(review_id,capture_id),"content")
        found = nil
        Records.each_json(root,file) do |reference|
          next unless reference["key_sha256"] == key_sha256
          Records.need(found.nil?,"DATASET_DATA_RECORD_DUPLICATED")
          found = reference
        end
        Records.need(found,"DATASET_DATA_RECORD_NOT_FOUND")
        {"capture"=>capture,"record"=>data_resolve_references(review_id,capture,[found]).first}
      end

      def data_export(review_id,capture_id,query_id,format:)
        Records.need(%w[csv json].include?(format),"DATASET_DATA_EXPORT_FORMAT")
        selected = data_query(review_id,capture_id,query_id)
        capture = selected.fetch("capture")
        columns = capture.fetch("columns")
        Download.new(filename: "dataset-records-"+capture_id+"."+format,
          content_type: format == "csv" ? "text/csv; charset=utf-8" : "application/json") do |io|
          if format == "json"
            header = {"schema"=>"stellar-forge.dataset-operator-selected-records.v1",
              "capture"=>capture,"query"=>selected.reject { |key,_| %w[capture columns].include?(key) }}
            io.write(Records.json(header)[0...-1] + ',"records":[')
          else
            header = columns.map { |column| column.fetch("key") } +
              %w[key_sha256 source_edition_id source_revision source_manifest_sha256 source_row_sha256
                 source_ordinal target_id committed_edition_id committed_revision changed_columns
                 source_raw_json committed_tagged_json target_tagged_json attachments_json]
            io.write(CSV.generate_line(header,row_sep: "\r\n"))
          end
          count = 0
          selected.fetch("pages").times do |page|
            rows = data_rows(review_id,capture_id,query_id,page: page).fetch("rows")
            rows.each do |record|
              if format == "json"
                io.write(",") unless count.zero?
                io.write(Records.json(record))
              else
                row = columns.map { |column| Records.text(Records.values(record.fetch("cells").fetch(column.fetch("key")))) } +
                  [record["key_sha256"],record.dig("source","edition_id"),record.dig("source","revision"),
                   record.dig("source","manifest_sha256"),record.dig("source","row_sha256"),
                   record.dig("source","ordinal"),record.dig("target","id"),
                   record.dig("committed","edition_id"),record.dig("committed","revision"),
                   Records.json(record.dig("target","changed_columns")),record.dig("source","raw_json"),
                   Records.json(record.dig("committed","values")),Records.json(record.dig("target","values")),
                   Records.json(record["attachments"])]
                io.write(CSV.generate_line(row,row_sep: "\r\n"))
              end
              count += 1
            end
          end
          Records.need(count == selected.fetch("total"),"DATASET_DATA_COMPLETE_EXPORT_CHANGED")
          io.write("]}\n") if format == "json"
        end
      end

      # Exact attachment routing uses the captured source edition's retained
      # review. The request cannot substitute another record's original link.
      def data_attachment(review_id,capture_id,key_sha256:,file:,record_id:,column:,index:)
        result = data_record(review_id,capture_id,key_sha256: key_sha256)
        selected = result.fetch("record").fetch("attachments").find do |reference|
          reference["file"] == file && reference["record_id"] == record_id &&
            reference["column"] == column && reference["index"] == index
        end
        Records.need(selected,"DATASET_DATA_ATTACHMENT_NOT_FOUND")
        received = attachment(selected.fetch("review_id"),file: file,record_id: record_id,column: column)
        Records.need(received.sha256 == selected.fetch("sha256") && received.bytes == selected.fetch("bytes"),
          "DATASET_DATA_ATTACHMENT_CHANGED")
        received
      rescue Exception
        received&.close
        raise
      end

      # Explicit portability profile for a saved, complete working-state capture.
      # Native edition receipts stay immutable while legitimate target changes
      # and missing rows are verified against the selected capture.
      def verify_data_capture(review_id,capture_id,expected_capture_sha256:)
        Records.need(HASH.match?(expected_capture_sha256.to_s),"DATASET_DATA_CAPTURE_HASH")
        capture = data_capture(review_id,capture_id)
        Records.need(capture["sha256"] == expected_capture_sha256,"DATASET_DATA_CAPTURE_CHANGED")
        context = data_scope(review_id)
        data_snapshot_transaction(context) do
          current = data_current(review_id,context)
          Records.need(current["can_capture"] && current["revision"] == capture["revision"] &&
            current["edition_id"] == capture["edition_id"] &&
            current["receipt_sha256"] == capture["receipt_sha256"],
            "DATASET_DATA_EDITION_CHANGED")
          value = importer(review_id)
          Records.need(value.source_binding == capture["source"] &&
            value.mapping.definition == capture["mapping"] &&
            data_columns(value.mapping) == capture["columns"],"DATASET_DATA_RECEIVED_SOURCE_CHANGED")
          # Read every selected capture file before using it as the comparison.
          data_each_record(review_id,capture) { |_record,_reference| }
          root = File.join(data_directory(review_id,capture_id),"content")
          capture.fetch("keys").each_value { |file| Records.original_file(root,file) { |_io| } }
          digest,counts = Digest::SHA256.new,{"total"=>0,"active"=>0,"removed"=>0,
            "unchanged"=>0,"changed"=>0,"missing"=>0}
          data_native_records(review_id,context,value) do |records|
            records.each do |record|
              digest.update(Records.json(record) + "\n")
              counts["total"] += 1
              counts[record.fetch("status")] += 1
              counts[record.fetch("target_state")] += 1
            end
          end
          Records.need(counts == capture["counts"] && digest.hexdigest == capture["rows_sha256"],
            "DATASET_DATA_WORKING_STATE_CHANGED")
          history,editions = Digest::SHA256.new,0
          native = context.fetch(:stream).reload
          @models.fetch(:edition).where(dataset_stream_id: native.id).find_each do |edition|
            receipt = value.verified_receipt(edition)
            if edition.id.to_s == capture["edition_id"]
              Records.need(receipt == capture["receipt"],"DATASET_RECEIPT_CHANGED")
            end
            history.update(RailsDataset.json(receipt))
            history.update("\n")
            editions += 1
          end
          Records.need(native.revision == capture["revision"] &&
            native.latest_edition_id.to_s == capture["edition_id"],"DATASET_DATA_EDITION_CHANGED")
          {"schema"=>"stellar-forge.dataset-operator-captured-working-state.v1",
            "profile"=>"captured-working-state",
            "workingCapture"=>{"reviewId"=>review_id,"captureId"=>capture_id,
              "expectedCaptureSha256"=>capture.fetch("sha256")},
            "stream_id"=>native.id.to_s,"scope_sha256"=>capture.fetch("scope_sha256"),
            "revision"=>capture.fetch("revision"),"edition_id"=>capture.fetch("edition_id"),
            "receipt_sha256"=>capture.fetch("receipt_sha256"),"source"=>capture.fetch("source"),
            "counts"=>counts,"rows_sha256"=>digest.hexdigest,"editions"=>editions,
            "history_sha256"=>history.hexdigest}
        end
      end

      private :data_scope, :data_receipt, :data_current, :data_directory, :data_request, :data_cleanup_staging,
        :data_columns, :data_entry, :data_review_packages, :data_attachments_for,
        :data_authorize_records, :data_snapshot_transaction, :data_each_record, :data_native_records,
        :data_query_directory, :data_query, :data_resolve_references
    end
  end
end
