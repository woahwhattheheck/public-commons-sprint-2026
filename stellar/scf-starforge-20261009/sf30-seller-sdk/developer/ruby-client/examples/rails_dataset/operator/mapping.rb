# frozen_string_literal: true
# MIT. Source-first field mapping in the original authorized Rails workspace.
module Starforge
  module DatasetOperator
    class Workspace
      # A form selects the complete retained source and the application's current
      # allowed schema. The original source/review is never edited in place.
      def mapping_context(id)
        selected = selection(id)
        summary = source_summary(id)
        target = mapping_target(id)
        Files.need(summary["id"] == id &&
          summary.dig("source","delivery_manifest_sha256") == selected.dig("candidate","manifest_sha256"),
          "DATASET_OPERATOR_SOURCE_CHANGED")
        definition = RailsDataset.copy_json(selected.dig("candidate","mapping"))
        definition = {"schema"=>"stellar-forge.rails-dataset-mapping.v1",
          "columns"=>{},"key_columns"=>[],"removal"=>{"strategy"=>"retain"}} unless definition.is_a?(Hash)
        definition["columns"] = {} unless definition["columns"].is_a?(Hash)
        definition["columns"].select! { |name,spec| name.is_a?(String) && spec.is_a?(Hash) }
        keys = definition["key_columns"]
        definition["key_columns"] = [] unless keys.is_a?(Array) &&
          keys.all? { |name| name.is_a?(String) }
        removal = definition["removal"]
        definition["removal"] = {"strategy"=>"retain"} unless removal.is_a?(Hash) &&
          %w[retain archive].include?(removal["strategy"])
        if (key = target["key_mapping"])
          definition["key_columns"] = key.fetch("key_columns").dup
          key.fetch("columns").each { |name,spec| definition["columns"][name] = RailsDataset.copy_json(spec) }
        end
        context = {"schema"=>"stellar-forge.dataset-operator-mapping-context.v1",
          "review_id"=>id,"selection_sha256"=>RailsDataset.fingerprint(selected),
          "source_summary_sha256"=>summary.fetch("summary_sha256"),
          "source"=>summary.fetch("source"),"source_columns"=>summary.fetch("columns"),
          "target"=>target,"mapping"=>definition}
        context.merge("context_sha256"=>RailsDataset.fingerprint(context))
      end

      def source_available?(id)
        selection(id)
        Store.present?(File.join(path(id),"source-summary.json"))
      end

      # Browser form values are deliberately limited to existing source columns,
      # supported application fields and the application's real unique indexes.
      # Type, model, relation, scope values and paths come from the server.
      def mapping_from_form(context, input)
        Files.need(context.is_a?(Hash) && input.is_a?(Hash), "DATASET_OPERATOR_MAPPING_FORM")
        target = context.fetch("target")
        allowed = target.fetch("columns").to_h { |column| [column.fetch("name"),column] }
        fields = context.fetch("source").fetch("fields")
        rows = mapping_form_rows(input.fetch("rows",{}),allowed.length)
        definition = {"schema"=>"stellar-forge.rails-dataset-mapping.v1","columns"=>{},
          "key_columns"=>[],"removal"=>{"strategy"=>"retain"}}
        seen = Set.new
        rows.each do |row|
          Files.need(row.is_a?(Hash) && (row.keys - %w[column field null missing stringify]).empty?,
            "DATASET_OPERATOR_MAPPING_FORM")
          name, field = row["column"], row.fetch("field","")
          Files.need(name.is_a?(String) && allowed.key?(name) && seen.add?(name),
            "DATASET_OPERATOR_MAPPING_COLUMN")
          Files.need(field.is_a?(String), "DATASET_OPERATOR_MAPPING_FIELD")
          next if field.empty?
          Files.need(fields.include?(field), "DATASET_OPERATOR_MAPPING_FIELD")
          null, missing, stringify = row.fetch("null","assign"), row.fetch("missing","error"),
            row.fetch("stringify","0")
          Files.need(%w[assign preserve].include?(null) && %w[error preserve].include?(missing) &&
            %w[0 1].include?(stringify), "DATASET_OPERATOR_MAPPING_FORM")
          type = allowed.fetch(name).fetch("type")
          Files.need(type == "string" || stringify == "0", "DATASET_OPERATOR_MAPPING_TEXT")
          definition["columns"][name] = {"field"=>field,"type"=>type,"null"=>null,
            "missing"=>missing,"stringify"=>stringify == "1"}
        end
        if (key = target["key_mapping"])
          # Retain every original option and its order, including omitted defaults.
          # A later edition may map other columns but keeps the same business key.
          definition["key_columns"] = key.fetch("key_columns").dup
          key.fetch("columns").each do |name,spec|
            Files.need(allowed.key?(name) && fields.include?(spec.fetch("field")),
              "DATASET_OPERATOR_KEY_SOURCE_CHANGED")
            definition["columns"][name] = RailsDataset.copy_json(spec)
          end
        else
          choice = input.fetch("key_index","")
          Files.need(choice.is_a?(String), "DATASET_OPERATOR_KEY_INDEX")
          index = target.fetch("unique_keys").find { |item| item["name"] == choice }
          Files.need(index && !index.fetch("columns").empty?, "DATASET_OPERATOR_KEY_INDEX")
          definition["key_columns"] = index.fetch("columns").dup
          definition["key_columns"].each do |name|
            spec = definition["columns"][name]
            Files.need(spec, "DATASET_OPERATOR_KEY_SOURCE_REQUIRED")
            spec["null"], spec["missing"] = "assign","error"
          end
        end
        removal = input.fetch("removal","retain")
        Files.need(%w[retain archive].include?(removal), "DATASET_OPERATOR_REMOVAL_POLICY")
        if removal == "archive"
          name = input.fetch("archive_column","")
          Files.need(name.is_a?(String) && allowed.dig(name,"type") == "boolean" &&
            !definition["columns"].key?(name), "DATASET_OPERATOR_ARCHIVE_COLUMN")
          active = input.fetch("archive_active","true")
          Files.need(%w[true false].include?(active),"DATASET_OPERATOR_REMOVAL_POLICY")
          definition["removal"] = {"strategy"=>"archive","column"=>name,
            "active"=>active == "true","inactive"=>active != "true"}
        end
        definition
      end

      # Programmatic and browser callers use the same durable mapping selection.
      def remap(id, new_id:, actor:, mapping:, expected_context_sha256:)
        select_mapping_review(id,new_id: new_id,actor: actor,
          input: {"kind"=>"definition","value"=>mapping},
          expected_context_sha256: expected_context_sha256)
      end

      def remap_form(id, new_id:, actor:, form:, expected_context_sha256:)
        select_mapping_review(id,new_id: new_id,actor: actor,
          input: {"kind"=>"form","value"=>form},
          expected_context_sha256: expected_context_sha256)
      end

      # A selected mapping is downloadable even if a later row conversion needs
      # correction. It remains the exact original definition for that review.
      def mapping_export(id)
        chosen = selection(id)
        Download.new(filename: "dataset-mapping.json",content_type: "application/json") do |out|
          out.write(Files.json(chosen.fetch("candidate").fetch("mapping")))
        end
      end

      private

      # Admission retains the original input, validated context and selected
      # review together before publishing the component files. A retry after an
      # interrupted save finishes that exact selection even if the live schema
      # or stream has advanced; the ordinary preview/import then uses its normal
      # current-record checks before applying any edition.
      def select_mapping_review(id, new_id:, actor:, input:, expected_context_sha256:)
        Files.need(UUID.match?(new_id.to_s) && new_id != id &&
          actor.is_a?(String) && !actor.empty? && actor.bytesize <= 512 &&
          HASH.match?(expected_context_sha256.to_s) && input["value"].is_a?(Hash),
          "DATASET_OPERATOR_MAPPING_SELECTION")
        request = {"schema"=>"stellar-forge.dataset-operator-mapping-request.v1",
          "original_review_id"=>id,"review_id"=>new_id,"actor"=>actor,
          "expected_context_sha256"=>expected_context_sha256,"input"=>RailsDataset.copy_json(input)}
        request_sha256 = RailsDataset.fingerprint(request)
        directory = path(new_id,create: true)
        Files.lock(directory) do
          admission_path = File.join(directory,"mapping-admission.json")
          selected_path = File.join(directory,"selection.json")
          if Store.present?(admission_path)
            admission = Store.read(admission_path)
            Files.need(admission["schema"] == "stellar-forge.dataset-operator-mapping-admission.v1" &&
              admission["request"] == request && admission["request_sha256"] == request_sha256 &&
              admission.dig("context","context_sha256") == expected_context_sha256 &&
              RailsDataset.fingerprint(admission.fetch("context").reject { |key,_| key == "context_sha256" }) ==
                expected_context_sha256,
              "DATASET_OPERATOR_MAPPING_SELECTION_CHANGED")
            selected = admission.fetch("selection")
            Files.need(selected["id"] == new_id && selected["tenant_key"] == @tenant_key &&
              selected["original_review_id"] == id && selected["actor"] == actor &&
              selected["mapping_request_sha256"] == request_sha256,
              "DATASET_OPERATOR_MAPPING_SELECTION_CHANGED")
            stream(selected.dig("candidate","stream_id"))
          else
            Files.need(!Store.present?(selected_path), "DATASET_OPERATOR_MAPPING_SELECTION_CHANGED")
            original = selection(id)
            context = mapping_context(id)
            Files.need(context.fetch("context_sha256") == expected_context_sha256,
              "DATASET_OPERATOR_MAPPING_CONTEXT_CHANGED")
            definition = input["kind"] == "form" ? mapping_from_form(context,input.fetch("value")) :
              RailsDataset.copy_json(input.fetch("value"))
            package = selected_delivery(id)
            dataset = package.respond_to?(:dataset) ? package.dataset : package
            record = stream(original.dig("candidate","stream_id"))
            importer = RailsDataset.new(delivery: dataset,stream: record,models: @models,
              scope: @target_scope.call(record),mapping: definition)
            # The existing importer owns all key/schema/scope/source checks.
            importer.binding
            candidate = RailsDataset.copy_json(original.fetch("candidate"))
            candidate.delete("selection_sha256")
            candidate["directory"] = File.join(path(id),"received")
            candidate["mapping"] = definition
            candidate["selection_sha256"] = RailsDataset.fingerprint(candidate)
            selected = {"schema"=>"stellar-forge.dataset-operator-selection.v1","id"=>new_id,
              "tenant_key"=>@tenant_key,"actor"=>actor,"selected_at"=>Time.now.utc.iso8601(6),
              "original_review_id"=>id,"mapping_request_sha256"=>request_sha256,
              "mapping_context_sha256"=>expected_context_sha256,
              "operation_key"=>"dataset-operator/#{Digest::SHA256.hexdigest(@tenant_key)}/#{new_id}",
              "candidate"=>candidate}
            admission = {"schema"=>"stellar-forge.dataset-operator-mapping-admission.v1",
              "request"=>request,"request_sha256"=>request_sha256,"context"=>context,"selection"=>selected}
            Files.once(admission_path,Files.json(admission))
          end
          Files.once(File.join(directory,"mapping-request.json"),Files.json(admission.fetch("request")))
          Files.once(File.join(directory,"mapping-context.json"),Files.json(admission.fetch("context")))
          Files.once(selected_path,Files.json(selected))
          verified = selection(new_id)
          Files.need(verified == selected, "DATASET_OPERATOR_MAPPING_SELECTION_CHANGED")
          state(new_id,"selected") unless Store.present?(File.join(directory,"state.json"))
          verified
        end
      end

      def mapping_form_rows(value, maximum)
        if value.is_a?(Hash)
          Files.need(value.keys.all? { |key| /\A(?:0|[1-9][0-9]*)\z/.match?(key.to_s) },
            "DATASET_OPERATOR_MAPPING_FORM")
          rows = value.keys.sort_by { |key| Integer(key.to_s,10) }.map { |key| value[key] }
        else
          Files.need(value.is_a?(Array), "DATASET_OPERATOR_MAPPING_FORM")
          rows = value
        end
        Files.need(rows.length <= maximum && rows.all? { |row| row.is_a?(Hash) },
          "DATASET_OPERATOR_MAPPING_FORM")
        rows
      end
    end
  end
end
