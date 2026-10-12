# frozen_string_literal: true
# MIT. Complete dataset revision import into the customer's original Rails database.
require "active_record"
require "active_support/time"
require "set"
require "date"
require "time"
require "csv"
require_relative "dataset_delivery"

module Starforge
  class RailsDataset
    SCHEMA = "stellar-forge.rails-dataset-import.v1"
    TYPES = %w[string integer decimal boolean date datetime].freeze

    class ImportError < StandardError
      attr_reader :code, :details
      def initialize(code, **details)
        @code, @details = code, details
        super([code, details.map { |key,value| "#{key}=#{value.inspect}" }.join(" ")].reject(&:empty?).join(": "))
      end
    end

    def self.need(condition, code, **details)
      raise ImportError.new(code, **details) unless condition
    end

    # Tagged values preserve native integers, decimal precision and dates in
    # complete previews/receipts without JSON's binary-number conversions.
    def self.pack(value)
      case value
      when NilClass then ["null"]
      when TrueClass, FalseClass then ["boolean", value]
      when String then ["string", value]
      when Integer then ["integer", value.to_s]
      when BigDecimal
        need(value.finite?, "DATASET_FINITE_DECIMAL")
        ["decimal", value.to_s("F")]
      when ActiveSupport::TimeWithZone, Time, DateTime then ["datetime", value.to_time.utc.iso8601(9)]
      when Date then ["date", value.iso8601]
      when Array then ["array", value.map { |item| pack(item) }]
      when Hash
        need(value.keys.all? { |key| key.is_a?(String) }, "DATASET_STRING_KEYS")
        ["object", value.keys.sort.map { |key| [key, pack(value.fetch(key))] }]
      else
        raise ImportError.new("DATASET_EXACT_VALUE", type: value.class.name)
      end
    end

    def self.unpack(value)
      type, data = value
      case type
      when "null" then nil
      when "boolean", "string" then data
      when "integer" then Integer(data, 10)
      when "decimal" then BigDecimal(data)
      when "date" then Date.iso8601(data)
      when "datetime" then Time.iso8601(data)
      when "array" then data.map { |item| unpack(item) }
      when "object" then data.to_h { |key,item| [key, unpack(item)] }
      else raise ImportError.new("DATASET_TAGGED_VALUE")
      end
    end

    def self.json(value)
      JSON.generate(value, allow_nan: false, max_nesting: 100)
    end

    def self.exact_json(value)
      json(pack(value))
    end

    def self.sha(value)
      Digest::SHA256.hexdigest(value.b)
    end

    def self.fingerprint(value)
      sha(exact_json(value))
    end

    def self.copy_json(value)
      JSON.parse(json(value), create_additions: false, allow_nan: false)
    end

    # The complete original source is streamed into a private preview, then
    # streamed again when reviewed or committed. Only key identities stay in RAM.
    class Preview
      attr_reader :binding, :counts, :sha256, :entries_sha256, :row_count
      def initialize(binding)
        @binding = RailsDataset.copy_json(binding)
        @counts = {"inserted"=>0, "updated"=>0, "unchanged"=>0, "removed"=>0,
                   "adopted"=>0, "restored"=>0, "source_changed"=>0}
        @file = Tempfile.new(["starforge-dataset-preview-", ".jsonl"])
        @file.binmode
        @file.unlink
        @digest, @row_count, @sealed, @closed = Digest::SHA256.new, 0, false, false
      end

      def append(entry)
        RailsDataset.need(!@sealed && !@closed, "DATASET_PREVIEW_SEALED")
        raw = RailsDataset.json(entry) + "\n"
        @file.write(raw)
        @digest.update(raw)
        @row_count += 1
        @counts.fetch(entry.fetch("action"))
        @counts[entry.fetch("action")] += 1
        %w[adopted restored source_changed].each { |key| @counts[key] += 1 if entry[key] }
      end

      def seal
        RailsDataset.need(!@closed, "DATASET_PREVIEW_CLOSED")
        unless @sealed
          @file.flush
          @entries_sha256 = @digest.hexdigest
          @sha256 = RailsDataset.fingerprint({"schema"=>SCHEMA, "binding"=>@binding,
            "counts"=>@counts, "row_count"=>@row_count, "entries_sha256"=>@entries_sha256})
          DatasetDelivery.freeze_value(@binding)
          DatasetDelivery.freeze_value(@counts)
          @sha256.freeze
          @entries_sha256.freeze
          @sealed = true
        end
        self
      end

      def each_entry
        return enum_for(__method__) unless block_given?
        RailsDataset.need(@sealed && !@closed, "DATASET_PREVIEW_CLOSED")
        @file.rewind
        seen = Digest::SHA256.new
        @file.each_line do |line|
          seen.update(line)
          yield JSON.parse(line, create_additions: false, allow_nan: false)
        end
        RailsDataset.need(seen.hexdigest == @entries_sha256, "DATASET_PREVIEW_CHANGED")
        self
      end

      def summary
        RailsDataset.need(@sealed && !@closed, "DATASET_PREVIEW_CLOSED")
        {"schema"=>SCHEMA, "binding"=>RailsDataset.copy_json(@binding),
         "preview_sha256"=>@sha256, "entries_sha256"=>@entries_sha256,
         "row_count"=>@row_count, "counts"=>@counts.dup}
      end

      def write_json(io)
        header = RailsDataset.json(summary)
        io.write(header.delete_suffix("}") + ',"rows":[')
        first = true
        each_entry do |row|
          io.write(",") unless first
          io.write(RailsDataset.json(row))
          first = false
        end
        io.write("]}\n")
        self
      end

      def write_csv(io)
        csv = CSV.new(io, force_quotes: true, row_sep: "\n")
        csv << %w[action source_ordinal key target_id adopted restored source_changed before after original_source_json source_row_sha256]
        each_entry do |row|
          csv << [row["action"], row["source_ordinal"], row["key_json"], row["target_id"],
            row["adopted"], row["restored"], row["source_changed"],
            row["before_json"], row["after_json"], row["source_raw_json"], row["source_row_sha256"]]
        end
        csv.flush
        self
      end

      def close
        return if @closed
        @closed = true
        @file.close
      end
    end

    # Explicit field mapping; a missing field can be preserved, while a supplied
    # null can independently be assigned or preserved. Keys always need values.
    class Mapping
      attr_reader :definition, :columns, :key_columns, :sha256, :key_sha256, :removal
      def initialize(definition, model, fields, protected_columns)
        RailsDataset.need(definition.is_a?(Hash), "DATASET_MAPPING")
        @definition = RailsDataset.copy_json(definition)
        RailsDataset.need(@definition["schema"] == "stellar-forge.rails-dataset-mapping.v1",
          "DATASET_MAPPING_SCHEMA")
        @columns, @key_columns = @definition["columns"], @definition["key_columns"]
        RailsDataset.need(@columns.is_a?(Hash) && !@columns.empty? &&
          @key_columns.is_a?(Array) && !@key_columns.empty? &&
          @key_columns.uniq == @key_columns && @key_columns.all? { |key| key.is_a?(String) && @columns.key?(key) },
          "DATASET_MAPPING_KEYS")
        @model = model
        @columns.each do |name,spec|
          RailsDataset.need(name.is_a?(String) && model.columns_hash.key?(name) &&
            !protected_columns.include?(name), "DATASET_TARGET_COLUMN", column: name)
          RailsDataset.need(spec.is_a?(Hash) && fields.include?(spec["field"]) &&
            TYPES.include?(spec["type"]) && %w[assign preserve].include?(spec.fetch("null", "assign")) &&
            %w[error preserve].include?(spec.fetch("missing", "error")) &&
            [true,false].include?(spec.fetch("stringify", false)), "DATASET_FIELD_MAPPING", column: name)
          RailsDataset.need((spec.keys - %w[field type null missing stringify]).empty?,
            "DATASET_MAPPING_OPTION", column: name)
          RailsDataset.need(!@key_columns.include?(name) ||
            (spec.fetch("null", "assign") == "assign" && spec.fetch("missing", "error") == "error"),
            "DATASET_KEY_REQUIRED", column: name)
          verify_type(name, spec["type"])
        end
        @removal = @definition.fetch("removal", {"strategy"=>"retain"})
        RailsDataset.need(@removal.is_a?(Hash) && %w[retain archive].include?(@removal["strategy"]),
          "DATASET_REMOVAL_POLICY")
        allowed_removal = @removal["strategy"] == "archive" ? %w[strategy column active inactive] : %w[strategy]
        RailsDataset.need((@removal.keys - allowed_removal).empty?, "DATASET_REMOVAL_OPTION")
        if @removal["strategy"] == "archive"
          name = @removal["column"]
          RailsDataset.need(name.is_a?(String) && model.columns_hash.key?(name) &&
            model.type_for_attribute(name).type == :boolean &&
            !protected_columns.include?(name) && !@columns.key?(name),
            "DATASET_ARCHIVE_COLUMN")
          RailsDataset.need(@removal.fetch("active", true) == true && @removal.fetch("inactive", false) == false,
            "DATASET_ARCHIVE_BOOLEAN")
        end
        RailsDataset.need((@definition.keys - %w[schema columns key_columns removal]).empty?,
          "DATASET_MAPPING_OPTION")
        DatasetDelivery.freeze_value(@definition)
        DatasetDelivery.freeze_value(@removal)
        @sha256 = RailsDataset.fingerprint(@definition).freeze
        @key_sha256 = RailsDataset.fingerprint({"key_columns"=>@key_columns,
          "columns"=>@columns.slice(*@key_columns)}).freeze
      end

      def verify_type(name, type)
        actual = @model.type_for_attribute(name).type
        accepted = {"string"=>[:string,:text], "integer"=>[:integer],
          "decimal"=>[:decimal], "boolean"=>[:boolean], "date"=>[:date],
          "datetime"=>[:datetime,:timestamp]}
        RailsDataset.need(accepted.fetch(type).include?(actual), "DATASET_COLUMN_TYPE",
          column: name, declared: type, actual: actual)
      end

      def converted(name, spec, value)
        if value.nil?
          RailsDataset.need(@model.columns_hash.fetch(name).null, "DATASET_COLUMN_NULL", column: name)
          return nil
        end
        selected = case spec["type"]
        when "string"
          if value.is_a?(String)
            value
          elsif spec["stringify"] && (value.is_a?(Integer) || value.is_a?(BigDecimal) || value == true || value == false)
            value.is_a?(BigDecimal) ? value.to_s("F") : value.to_s
          else
            raise ImportError.new("DATASET_TEXT_REQUIRED", column: name)
          end
        when "integer"
          if value.is_a?(Integer)
            value
          elsif value.is_a?(BigDecimal) && value.finite? && value.frac.zero?
            value.to_i
          elsif value.is_a?(String) && /\A[+-]?[0-9]+\z/.match?(value)
            Integer(value, 10)
          else
            raise ImportError.new("DATASET_INTEGER_REQUIRED", column: name)
          end
        when "decimal"
          RailsDataset.need(value.is_a?(Integer) || value.is_a?(BigDecimal) ||
            value.is_a?(String) && /\A[+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?\z/.match?(value),
            "DATASET_DECIMAL_REQUIRED", column: name)
          parsed = value.is_a?(BigDecimal) ? value : BigDecimal(value.to_s)
          RailsDataset.need(parsed.finite?, "DATASET_FINITE_DECIMAL", column: name)
          parsed
        when "boolean"
          RailsDataset.need(value == true || value == false, "DATASET_BOOLEAN_REQUIRED", column: name)
          value
        when "date"
          RailsDataset.need(value.is_a?(String) && /\A[0-9]{4}-[0-9]{2}-[0-9]{2}\z/.match?(value),
            "DATASET_DATE_REQUIRED", column: name)
          Date.iso8601(value)
        when "datetime"
          RailsDataset.need(value.is_a?(String) &&
            /\A[0-9]{4}-[0-9]{2}-[0-9]{2}T.+(?:Z|[+-][0-9]{2}:[0-9]{2})\z/.match?(value),
            "DATASET_TIMESTAMP_OFFSET", column: name)
          Time.iso8601(value).utc
        end
        if selected.is_a?(String)
          RailsDataset.need(selected.valid_encoding? && !selected.include?("\0"), "DATASET_TEXT_ENCODING", column: name)
          limit = @model.columns_hash.fetch(name).limit
          RailsDataset.need(limit.nil? || selected.length <= limit, "DATASET_TEXT_LENGTH", column: name)
        end
        if selected.is_a?(BigDecimal)
          column = @model.columns_hash.fetch(name)
          if column.precision && column.scale
            integral_digits = selected.zero? ? 0 : [selected.abs.exponent, 0].max
            RailsDataset.need(integral_digits <= column.precision - column.scale,
              "DATASET_DECIMAL_RANGE", column: name, precision: column.precision, scale: column.scale)
          end
        end
        type = @model.type_for_attribute(name)
        returned = type.deserialize(type.serialize(selected))
        RailsDataset.need(returned == selected, "DATASET_COLUMN_PRECISION", column: name,
          selected: selected.to_s, stored: returned.to_s)
        selected
      rescue ArgumentError, RangeError => error
        raise ImportError.new("DATASET_COLUMN_VALUE", column: name, reason: error.message)
      end

      def values(row)
        RailsDataset.need(row.is_a?(Hash), "DATASET_SOURCE_ROW")
        result = {}
        @columns.each do |name,spec|
          field = spec.fetch("field")
          unless row.key?(field)
            RailsDataset.need(spec.fetch("missing", "error") == "preserve",
              "DATASET_SOURCE_FIELD_MISSING", field: field)
            next
          end
          next if row[field].nil? && spec.fetch("null", "assign") == "preserve"
          result[name] = converted(name, spec, row[field])
        end
        @key_columns.each do |name|
          value = result[name]
          RailsDataset.need(!value.nil? && !(value.is_a?(String) && value.empty?),
            "DATASET_KEY_REQUIRED", column: name)
        end
        result[@removal["column"]] = true if @removal["strategy"] == "archive"
        result
      end

      def key(values)
        selected = @key_columns.to_h { |name| [name, values.fetch(name)] }
        raw = RailsDataset.exact_json(selected)
        [RailsDataset.sha(raw), raw]
      end

      def removed_values
        @removal["strategy"] == "archive" ? {@removal.fetch("column")=>false} : {}
      end

      def target_columns
        (@columns.keys + (@removal["strategy"] == "archive" ? [@removal["column"]] : [])).uniq
      end
    end

    attr_reader :mapping

    # models contains the application's edition, row and entry ActiveRecord
    # classes. stream is its persisted stream record; scope is its authorized
    # tenant relation. Every model must use the very same database connection.
    def initialize(delivery:, scope:, stream:, models:, mapping:)
      self.class.need(delivery.is_a?(DatasetDelivery), "DATASET_ORIGINAL_DELIVERY")
      self.class.need(scope.is_a?(ActiveRecord::Relation) && stream.is_a?(ActiveRecord::Base) &&
        stream.persisted?, "DATASET_NATIVE_SCOPE")
      self.class.need(models.is_a?(Hash) && %i[edition row entry].all? { |key|
        models[key].is_a?(Class) && models[key] < ActiveRecord::Base }, "DATASET_NATIVE_MODELS")
      @delivery, @scope, @stream = delivery, scope.reorder(nil), stream
      @model, @models = @scope.klass, models.slice(:edition, :row, :entry).freeze
      self.class.need(@scope.limit_value.nil? && @scope.offset_value.nil? &&
        @scope.group_values.empty?, "DATASET_COMPLETE_TARGET_SCOPE")
      pool = @stream.class.connection_pool
      self.class.need(([@model] + @models.values).all? { |model| model.connection_pool.equal?(pool) },
        "DATASET_ONE_DATABASE")
      self.class.need(@model.primary_key.is_a?(String), "DATASET_TARGET_PRIMARY_KEY")
      @pk = @model.primary_key
      @scope_values = @scope.scope_for_create.stringify_keys
      protected_columns = ([@pk, @model.inheritance_column, "created_at", "updated_at", "lock_version"] +
        @scope_values.keys).compact.uniq
      @mapping = Mapping.new(mapping, @model, @delivery.fields, protected_columns)
      @scope_sha = self.class.fingerprint({"model"=>@model.name, "sql"=>@scope.to_sql,
        "creation_values"=>@scope_values})
      @membership = self.class.copy_json(@delivery.membership)
      self.class.need(@membership.is_a?(Hash) &&
        @membership["query_sha256"].is_a?(String) &&
        /\A[a-f0-9]{64}\z/.match?(@membership["query_sha256"]) &&
        @membership["projected_fields"] == @delivery.fields, "DATASET_QUERY_MEMBERSHIP")
      DatasetDelivery.freeze_value(@membership)
      @membership_sha = self.class.fingerprint(@membership)
      @schema_sha = self.class.fingerprint(@mapping.target_columns.sort.map do |name|
        column = @model.columns_hash.fetch(name)
        {"name"=>name, "type"=>column.type.to_s, "sql_type"=>column.sql_type,
         "limit"=>column.limit, "precision"=>column.precision, "scale"=>column.scale, "null"=>column.null}
      end)
      verify_unique_key!
    end

    def verify_unique_key!
      allowed = (@mapping.key_columns + @scope_values.keys).uniq
      indexes = @model.connection.indexes(@model.table_name)
      eligible = indexes.any? do |index|
        columns = index.columns
        index.unique && columns.is_a?(Array) &&
          (@mapping.key_columns - columns).empty? && (columns - allowed).empty? &&
          (!index.respond_to?(:where) || index.where.nil? || index.where.empty?)
      end
      self.class.need(eligible, "DATASET_UNIQUE_TARGET_KEY",
        columns: @mapping.key_columns, scope_columns: @scope_values.keys)
    end

    def validate_stream!
      {"target_model"=>@model.name, "scope_sha256"=>@scope_sha,
       "key_mapping_sha256"=>@mapping.key_sha256, "membership_sha256"=>@membership_sha}.each do |key,expected|
        actual = @stream.public_send(key)
        self.class.need(actual.nil? || actual == expected, "DATASET_STREAM_BINDING", field: key)
      end
      self.class.need(@stream.revision.is_a?(Integer) && @stream.revision >= 0, "DATASET_STREAM_REVISION")
    end

    def source_binding
      {"manifest_sha256"=>@delivery.manifest_sha256, "source_sha256"=>@delivery.source_sha256,
       "snapshot"=>self.class.pack(@delivery.snapshot), "row_count"=>@delivery.row_count,
       "fields"=>@delivery.fields, "membership"=>@membership}
    end

    def prior_receipt
      return nil if @stream.latest_edition_id.nil?
      edition = @models[:edition].find_by(id: @stream.latest_edition_id, dataset_stream_id: @stream.id)
      self.class.need(edition, "DATASET_PRIOR_EDITION_MISSING")
      verified_receipt(edition)
      self.class.need(edition.revision == @stream.revision, "DATASET_PRIOR_REVISION_CHANGED")
      edition.receipt_sha256
    end

    def binding
      validate_stream!
      {"stream_id"=>@stream.id.to_s, "target_model"=>@model.name, "scope_sha256"=>@scope_sha,
       "source"=>source_binding, "mapping"=>@mapping.definition, "mapping_sha256"=>@mapping.sha256,
       "schema_sha256"=>@schema_sha, "prior_revision"=>@stream.revision,
       "prior_edition_id"=>@stream.latest_edition_id&.to_s, "prior_receipt_sha256"=>prior_receipt}
    end

    def preview
      result = nil
      @stream.with_lock { result = build_preview }
      result
    end

    def key_tuple(record)
      @mapping.key_columns.to_h { |name| [name, record.public_send(name)] }
    end

    def target_values(record, columns)
      return {} unless record
      columns.to_h { |name| [name, record.public_send(name)] }
    end

    def target_fingerprint(record, columns)
      values = {"present"=>!record.nil?, "id"=>record&.public_send(@pk)&.to_s,
        "values"=>target_values(record, columns)}
      values["lock_version"] = record.lock_version if record && record.has_attribute?("lock_version")
      self.class.fingerprint(values)
    end

    def matching_targets(batch)
      table = @model.arel_table
      predicates = batch.map do |row|
        @mapping.key_columns.map { |name| table[name].eq(row.fetch("values").fetch(name)) }.reduce(&:and)
      end
      return {} if predicates.empty?
      @scope.where(predicates.reduce(&:or)).lock.to_a.group_by do |record|
        @mapping.key(key_tuple(record)).first
      end
    end

    def append_incoming(plan, batch, seen_targets)
      states = @models[:row].where(dataset_stream_id: @stream.id,
        key_sha256: batch.map { |row| row["key_sha256"] }).to_a.index_by(&:key_sha256)
      ids = states.values.map(&:target_id).compact
      tracked = ids.empty? ? {} : @scope.where(@pk=>ids).lock.to_a.index_by { |record| record.public_send(@pk).to_s }
      missing_ids = ids.map(&:to_s) - tracked.keys
      if !missing_ids.empty? && @model.unscoped.where(@pk=>missing_ids).exists?
        raise ImportError.new("DATASET_MANAGED_TARGET_OUTSIDE_SCOPE")
      end
      candidates = matching_targets(batch)
      selected = batch.map do |row|
        state = states[row["key_sha256"]]
        original = state && tracked[state.target_id.to_s]
        found = candidates.fetch(row["key_sha256"], [])
        found = ([original] + found).compact.uniq { |record| record.public_send(@pk).to_s }
        self.class.need(found.length <= 1, "DATASET_TARGET_AMBIGUOUS", key: row["key_json"])
        [row, state, found.first]
      end
      target_ids = selected.map { |_,_,record| record&.public_send(@pk)&.to_s }.compact
      owners = @models[:row].where(target_model: @model.name, target_id: target_ids).to_a
        .index_by { |row| row.target_id.to_s }
      selected.each do |row,state,record|
        target_id = record&.public_send(@pk)&.to_s
        if target_id
          self.class.need(seen_targets.add?(target_id), "DATASET_TARGET_REUSED", target_id: target_id)
          owner = owners[target_id]
          self.class.need(owner.nil? || (owner.dataset_stream_id.to_s == @stream.id.to_s &&
            owner.key_sha256 == row["key_sha256"]), "DATASET_TARGET_ALREADY_MANAGED", target_id: target_id)
        end
        columns = row.fetch("values").keys
        before = target_values(record, columns)
        changed = !record || before != row["values"]
        action = !record ? "inserted" : changed ? "updated" : "unchanged"
        plan.append(row.except("values").merge(
          "action"=>action, "target_id"=>target_id, "state_id"=>state&.id&.to_s,
          "adopted"=>state.nil? && !record.nil?, "restored"=>state && state.status == "removed",
          "source_changed"=>state && state.source_row_sha256 != row["source_row_sha256"],
          "before_json"=>self.class.exact_json(before), "after_json"=>self.class.exact_json(row["values"]),
          "target_fingerprint"=>target_fingerprint(record, columns)))
      end
    end

    def append_removed(plan, seen_keys)
      @models[:row].where(dataset_stream_id: @stream.id, status: "active").in_batches(of: 200) do |relation|
        states = relation.to_a.reject { |row| seen_keys.include?(row.key_sha256) }
        ids = states.map(&:target_id).compact
        targets = ids.empty? ? {} : @scope.where(@pk=>ids).lock.to_a.index_by { |record| record.public_send(@pk).to_s }
        states.sort_by(&:key_sha256).each do |state|
          record = targets[state.target_id.to_s]
          if record.nil? && state.target_id && @model.unscoped.where(@pk=>state.target_id).exists?
            raise ImportError.new("DATASET_MANAGED_TARGET_OUTSIDE_SCOPE")
          end
          values = @mapping.removed_values
          plan.append({"action"=>"removed", "key_sha256"=>state.key_sha256, "key_json"=>state.key_json,
            "target_id"=>record&.public_send(@pk)&.to_s, "previous_target_id"=>state.target_id,
            "state_id"=>state.id.to_s, "source_ordinal"=>nil, "source_raw_json"=>nil,
            "source_row_sha256"=>nil, "adopted"=>false, "restored"=>false, "source_changed"=>false,
            "before_json"=>self.class.exact_json(target_values(record, values.keys)),
            "after_json"=>self.class.exact_json(values),
            "target_fingerprint"=>target_fingerprint(record, values.keys)})
        end
      end
    end

    def build_preview
      plan = Preview.new(binding)
      seen_keys, seen_targets, ordinal = Set.new, Set.new, 0
      # Keep SQL parameter counts practical without limiting the complete dataset.
      batch_size = [200, [800 / @mapping.key_columns.length, 1].max].min
      @delivery.each_record.each_slice(batch_size) do |records|
        selected = records.map do |record|
          self.class.need(record["ordinal"] == ordinal && record["raw_json"].is_a?(String) &&
            self.class.sha(record["raw_json"]) == record["sha256"], "DATASET_ORIGINAL_ROW", ordinal: ordinal)
          values = @mapping.values(record.fetch("values"))
          key_sha, key_json = @mapping.key(values)
          self.class.need(seen_keys.add?(key_sha), "DATASET_DUPLICATE_SOURCE_KEY", ordinal: ordinal, key: key_json)
          row = {"key_sha256"=>key_sha, "key_json"=>key_json, "values"=>values,
            "source_ordinal"=>ordinal, "source_raw_json"=>record["raw_json"], "source_row_sha256"=>record["sha256"]}
          ordinal += 1
          row
        end
        append_incoming(plan, selected, seen_targets)
      end
      self.class.need(ordinal == @delivery.row_count, "DATASET_COMPLETE_ROWS",
        actual: ordinal, declared: @delivery.row_count)
      append_removed(plan, seen_keys)
      plan.seal
    rescue Exception
      plan&.close
      raise
    end

    def verified_receipt(edition)
      raw = edition.receipt_json
      self.class.need(raw.is_a?(String) && self.class.sha(raw) == edition.receipt_sha256,
        "DATASET_RECEIPT_CHANGED")
      receipt = JSON.parse(raw, create_additions: false, allow_nan: false)
      self.class.need(receipt["schema"] == SCHEMA &&
        receipt["stream_id"] == @stream.id.to_s && receipt["edition_id"] == edition.id.to_s &&
        receipt["revision"] == edition.revision && receipt["operation_sha256"] == edition.operation_sha256 &&
        receipt["manifest_sha256"] == edition.manifest_sha256 &&
        receipt["source_sha256"] == edition.source_sha256 && receipt["mapping_sha256"] == edition.mapping_sha256 &&
        receipt["binding"] == JSON.parse(edition.binding_json) &&
        receipt["preview_sha256"] == edition.preview_sha256, "DATASET_RECEIPT_BINDING")
      receipt
    end

    def receipt(operation_key:)
      operation_sha = operation_identity(operation_key)
      edition = @models[:edition].find_by(dataset_stream_id: @stream.id, operation_sha256: operation_sha)
      self.class.need(edition, "DATASET_RECEIPT_MISSING")
      validate_stream!
      verified_receipt(edition)
    end

    def operation_identity(value)
      self.class.need(value.is_a?(String) && value.valid_encoding? && !value.strip.empty? &&
        value.bytesize <= 1024, "DATASET_OPERATION_KEY")
      self.class.sha(value)
    end

    def apply_entry(entry, edition)
      values = self.class.unpack(JSON.parse(entry.fetch("after_json")))
      record = entry["target_id"] && @scope.lock.find_by(@pk=>entry["target_id"])
      self.class.need(target_fingerprint(record, values.keys) == entry["target_fingerprint"],
        "DATASET_TARGET_CHANGED", key: entry["key_json"])
      if entry["action"] == "inserted"
        record = @scope.new(values)
        self.class.need(record.save!, "DATASET_MODEL_SAVE")
      elsif record && entry["action"] != "unchanged" && !values.empty?
        record.assign_attributes(values)
        self.class.need(record.save!, "DATASET_MODEL_SAVE")
      end
      if record
        record.reload
        self.class.need(@scope.where(@pk=>record.public_send(@pk)).exists?, "DATASET_TARGET_SCOPE_CHANGED")
        self.class.need(target_values(record, values.keys) == values,
          "DATASET_STORED_VALUES_CHANGED", key: entry["key_json"])
      end
      target_id = record&.public_send(@pk)&.to_s || entry["previous_target_id"]
      state = @models[:row].find_or_initialize_by(dataset_stream_id: @stream.id, key_sha256: entry["key_sha256"])
      self.class.need(state.new_record? || state.id.to_s == entry["state_id"], "DATASET_KEY_STATE_CHANGED")
      state.assign_attributes(key_json: entry["key_json"], target_model: @model.name, target_id: target_id,
        status: entry["action"] == "removed" ? "removed" : "active", last_edition_id: edition.id)
      unless entry["action"] == "removed"
        state.source_row_sha256 = entry["source_row_sha256"]
        state.values_json = entry["after_json"]
      end
      expected_state = state.attributes.slice("dataset_stream_id", "key_sha256", "key_json", "target_model",
        "target_id", "status", "last_edition_id", "source_row_sha256", "values_json")
      self.class.need(state.save!, "DATASET_KEY_STATE_SAVE")
      self.class.need(state.reload.attributes.slice(*expected_state.keys) == expected_state,
        "DATASET_KEY_STATE_WRITE_CHANGED")
      stored = entry.merge("target_id"=>target_id, "edition_id"=>edition.id.to_s)
      raw = self.class.json(stored)
      @models[:entry].create!(dataset_edition_id: edition.id, key_sha256: entry["key_sha256"],
        source_ordinal: entry["source_ordinal"], action: entry["action"], target_id: target_id,
        record_json: raw, record_sha256: self.class.sha(raw))
      stored
    end

    def import!(operation_key:, expected_preview_sha256:)
      self.class.need(expected_preview_sha256.is_a?(String) &&
        /\A[a-f0-9]{64}\z/.match?(expected_preview_sha256), "DATASET_SELECTED_PREVIEW")
      self.class.need(!@stream.class.connection.transaction_open?, "DATASET_IMPORT_TRANSACTION",
        reason: "Call the importer as the job's database transaction boundary.")
      operation_sha = operation_identity(operation_key)
      result, plan = nil, nil
      @stream.with_lock do
        validate_stream!
        existing = @models[:edition].find_by(dataset_stream_id: @stream.id, operation_sha256: operation_sha)
        if existing
          self.class.need(existing.manifest_sha256 == @delivery.manifest_sha256 &&
            existing.mapping_sha256 == @mapping.sha256 && existing.preview_sha256 == expected_preview_sha256,
            "DATASET_OPERATION_CHANGED")
          result = verified_receipt(existing)
        else
          plan = build_preview
          self.class.need(plan.sha256 == expected_preview_sha256, "DATASET_PREVIEW_CHANGED",
            expected: expected_preview_sha256, current: plan.sha256)
          revision = @stream.revision + 1
          edition = @models[:edition].create!(dataset_stream_id: @stream.id, revision: revision,
            operation_sha256: operation_sha, manifest_sha256: @delivery.manifest_sha256,
            source_sha256: @delivery.source_sha256, mapping_sha256: @mapping.sha256,
            preview_sha256: plan.sha256, binding_json: self.class.json(plan.binding))
          retained = Digest::SHA256.new
          plan.each_entry { |entry| retained.update(self.class.json(apply_entry(entry, edition)) + "\n") }
          result = {"schema"=>SCHEMA, "stream_id"=>@stream.id.to_s, "edition_id"=>edition.id.to_s,
            "revision"=>revision, "operation_sha256"=>operation_sha,
            "manifest_sha256"=>@delivery.manifest_sha256, "source_sha256"=>@delivery.source_sha256,
            "mapping_sha256"=>@mapping.sha256, "preview_sha256"=>plan.sha256,
            "preview_entries_sha256"=>plan.entries_sha256, "retained_entries_sha256"=>retained.hexdigest,
            "binding"=>plan.binding, "counts"=>plan.counts, "entry_count"=>plan.row_count,
            "committed_at"=>Time.now.utc.iso8601(6)}
          raw = self.class.json(result)
          edition.update!(receipt_json: raw, receipt_sha256: self.class.sha(raw))
          @stream.update!(revision: revision, latest_edition_id: edition.id, target_model: @model.name,
            scope_sha256: @scope_sha, key_mapping_sha256: @mapping.key_sha256, membership_sha256: @membership_sha)
          @stream.reload
          self.class.need(@stream.revision == revision && @stream.latest_edition_id == edition.id,
            "DATASET_STREAM_WRITE_CHANGED")
          validate_stream!
          self.class.need(verified_receipt(edition.reload) == result, "DATASET_RECEIPT_CHANGED")
        end
      end
      self.class.need(result, "DATASET_IMPORT_ROLLED_BACK")
      result
    ensure
      plan&.close
    end

    # Full original edition export can be reopened independently of the current
    # source edition. Customer records and their source rows remain on the same
    # transaction history, including removed keys and exact original JSON lines.
    def write_receipt(io, operation_key:)
      operation_sha = operation_identity(operation_key)
      edition = @models[:edition].find_by(dataset_stream_id: @stream.id, operation_sha256: operation_sha)
      self.class.need(edition, "DATASET_RECEIPT_MISSING")
      validate_stream!
      selected = verified_receipt(edition)
      io.write(self.class.json(selected).delete_suffix("}") + ',"rows":[')
      first, digest, count = true, Digest::SHA256.new, 0
      @models[:entry].where(dataset_edition_id: edition.id).find_each do |entry|
        raw = entry.record_json
        self.class.need(self.class.sha(raw) == entry.record_sha256, "DATASET_EDITION_ROW_CHANGED")
        digest.update(raw + "\n")
        io.write(",") unless first
        io.write(raw)
        first = false
        count += 1
      end
      self.class.need(count == selected["entry_count"] &&
        digest.hexdigest == selected["retained_entries_sha256"], "DATASET_EDITION_ROWS_CHANGED")
      io.write("]}\n")
      selected
    end
  end
end
