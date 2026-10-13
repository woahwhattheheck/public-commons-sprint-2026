# frozen_string_literal: true
# MIT. Complete original-source intake before application mapping or import.
require "csv"

module Starforge
  module DatasetOperator
    SOURCE_SCHEMA = "stellar-forge.dataset-operator-source.v1"
    SOURCE_INDEX_SCHEMA = "stellar-forge.dataset-operator-source-index.v1"
    SOURCE_REQUEST_SCHEMA = "stellar-forge.dataset-operator-source-request.v1"

    class Workspace
      # The original review's private lock belongs to prepare/prepare_source.
      # A complete copied package can be adopted after interrupted receipt publication.
      def receive_delivery(id)
        directory = path(id)
        chosen = selection(id).fetch("candidate")
        marker = File.join(directory,"received.json")
        if Store.present?(marker)
          receipt = Store.read(marker)
          Files.need(receipt["manifest_sha256"] == chosen.fetch("manifest_sha256") &&
            receipt["format"] == chosen.fetch("format"), "DATASET_OPERATOR_DELIVERY_CHANGED")
          package = selected_delivery(id)
        else
          begin
            package = selected_delivery(id)
          rescue Errno::ENOENT
            package = nil
          end
          unless package
            package = @formats.fetch(chosen.fetch("format")).call(
              chosen.fetch("directory"), chosen.fetch("manifest_sha256"))
            package.copy_to(File.join(directory,"received"))
            package = selected_delivery(id)
          end
          Files.once(marker,Files.json({"manifest_sha256"=>package.manifest_sha256,
            "format"=>chosen.fetch("format")}))
        end
        Files.need(package.manifest_sha256 == chosen.fetch("manifest_sha256"),
          "DATASET_OPERATOR_DELIVERY_CHANGED")
        package
      end
      private :receive_delivery

      def source_dataset(id)
        package = selected_delivery(id)
        dataset = package.respond_to?(:dataset) ? package.dataset : package
        Files.need(dataset.is_a?(DatasetDelivery), "DATASET_ORIGINAL_DELIVERY")
        [package,dataset]
      end
      private :source_dataset

      def source_file(record,name)
        selected = record.fetch("files").find { |item| item["name"] == name }
        Files.need(selected && selected["bytes"].is_a?(Integer) && selected["bytes"] >= 0 &&
          HASH.match?(selected["sha256"].to_s), "DATASET_OPERATOR_SOURCE_FILE")
        selected
      end
      private :source_file

      def source_selection_sha(id)
        Files.hash(Files.read(File.join(path(id),"selection.json")))
      end
      private :source_selection_sha

      def prepare_source(id)
        directory = path(id)
        Files.lock(directory) do
          if Store.present?(File.join(directory,"source-summary.json"))
            saved = source_summary(id)
            state(id,"source_ready") unless Store.present?(File.join(directory,"review.json"))
            return saved
          end
          chosen = selection(id).fetch("candidate")
          change_state = !Store.present?(File.join(directory,"review.json"))
          state(id,"source_preparing") if change_state
          begin
            package = receive_delivery(id)
            dataset = package.respond_to?(:dataset) ? package.dataset : package
            Files.need(dataset.is_a?(DatasetDelivery), "DATASET_ORIGINAL_DELIVERY")
            selected_sha = source_selection_sha(id)
            original_source = {"delivery_manifest_sha256"=>package.manifest_sha256,
              "manifest_sha256"=>dataset.manifest_sha256, "source_sha256"=>dataset.source_sha256,
              "source_format"=>dataset.source_format, "row_count"=>dataset.row_count,
              "fields"=>RailsDataset.copy_json(dataset.fields),
              "snapshot"=>RailsDataset.pack(dataset.snapshot),
              "membership"=>RailsDataset.copy_json(dataset.membership),
              "native_manifest_json"=>RailsDataset.exact_json(dataset.native_manifest),
              "dataset_files"=>RailsDataset.copy_json(dataset.manifest.fetch("files"))}
            request_file = File.join(directory,"source-preparation.json")
            identity = {"schema"=>SOURCE_REQUEST_SCHEMA,"id"=>id,"selection_sha256"=>selected_sha,
              "source"=>original_source}
            if Store.present?(request_file)
              request = Store.read(request_file)
              Files.need(request.reject { |key,_| key == "selected_at" } == identity,
                "DATASET_OPERATOR_SOURCE_CHANGED")
            else
              request = identity.merge("selected_at"=>Time.now.utc.iso8601(6))
              Files.once(request_file,Files.json(request))
            end
            fields = original_source.fetch("fields")
            profiles = fields.to_h do |name|
              [name,{"name"=>name,"types"=>{},"null_count"=>0,"missing_count"=>0,
                "present_count"=>0,"string_min_chars"=>nil,"string_max_chars"=>nil,"string_max_bytes"=>0}]
            end
            pages, ordinal, current_page = [], 0, nil
            row_descriptor = Store.write(File.join(directory,"source-rows.jsonl")) do |io|
              dataset.each_record do |row|
                raw, values = row.fetch("raw_json"), row.fetch("values")
                Files.need(row["ordinal"] == ordinal && raw.is_a?(String) &&
                  Files.hash(raw) == row["sha256"] && values.is_a?(Hash) && values.keys.sort == fields.sort,
                  "DATASET_OPERATOR_ORIGINAL_SOURCE_ROW")
                values.each do |name,value|
                  profile = profiles.fetch(name)
                  tag = case value
                  when NilClass then "null"
                  when TrueClass,FalseClass then "boolean"
                  when String then "string"
                  when Integer then "integer"
                  when BigDecimal then "decimal"
                  else raise RailsDataset::ImportError.new("DATASET_EXACT_VALUE",type:value.class.name)
                  end
                  profile["present_count"] += 1
                  profile["types"][tag] = profile["types"].fetch(tag,0) + 1
                  profile["null_count"] += 1 if value.nil?
                  if value.is_a?(String)
                    length = value.length
                    profile["string_min_chars"] = [profile["string_min_chars"] || length,length].min
                    profile["string_max_chars"] = [profile["string_max_chars"] || length,length].max
                    profile["string_max_bytes"] = [profile["string_max_bytes"],value.bytesize].max
                  end
                end
                envelope = {"ordinal"=>ordinal,"raw_json"=>raw,"sha256"=>row.fetch("sha256"),
                  "values_json"=>RailsDataset.exact_json(values)}
                line = RailsDataset.json(envelope) + "\n"
                current_page ||= {"offset"=>io.pos,"bytes"=>0,"rows"=>0,
                  "first_ordinal"=>ordinal,"digest"=>Digest::SHA256.new}
                io.write(line)
                current_page["bytes"] += line.bytesize
                current_page["rows"] += 1
                current_page["digest"].update(line)
                ordinal += 1
                if current_page["rows"] == PAGE_SIZE
                  digest = current_page.delete("digest")
                  pages << current_page.merge("sha256"=>digest.hexdigest)
                  current_page = nil
                end
              end
              RailsDataset.need(ordinal == dataset.row_count, "DATASET_COMPLETE_ROWS",
                actual:ordinal,declared:dataset.row_count)
            end
            if current_page
              digest = current_page.delete("digest")
              pages << current_page.merge("sha256"=>digest.hexdigest)
            end
            index = {"schema"=>SOURCE_INDEX_SCHEMA,"id"=>id,"selection_sha256"=>selected_sha,
              "fields"=>fields,"row_count"=>ordinal,"page_size"=>PAGE_SIZE,
              "file"=>row_descriptor,"pages"=>pages}
            index_descriptor = Store.write(File.join(directory,"source-index.json")) do |io|
              io.write(Files.json(index))
            end
            summary = {"schema"=>SOURCE_SCHEMA,"id"=>id,"selection_sha256"=>selected_sha,
              "selected_at"=>request.fetch("selected_at"),"source"=>original_source,
              "columns"=>fields.map { |name| profiles.fetch(name) },
              "files"=>[row_descriptor,index_descriptor],
              "pages"=>[1,pages.length].max,"page_size"=>PAGE_SIZE}
            summary["summary_sha256"] = RailsDataset.fingerprint(summary)
            Files.once(File.join(directory,"source-summary.json"),Files.json(summary))
            state(id,"source_ready") if change_state
            source_summary(id)
          rescue Exception => error
            state(id,"source_error","code"=>error.respond_to?(:code) ? error.code : error.class.name,
              "message"=>error.message.to_s[0,4000]) if change_state
            raise
          end
        end
      end

      def source_summary(id)
        selection(id)
        summary = Store.read(File.join(path(id),"source-summary.json"))
        Files.need(summary["schema"] == SOURCE_SCHEMA && summary["id"] == id &&
          summary["selection_sha256"] == source_selection_sha(id) &&
          summary["summary_sha256"] == RailsDataset.fingerprint(
            summary.reject { |key,_| key == "summary_sha256" }), "DATASET_OPERATOR_SOURCE_CHANGED")
        request = Store.read(File.join(path(id),"source-preparation.json"))
        Files.need(request["schema"] == SOURCE_REQUEST_SCHEMA && request["id"] == id &&
          request["selection_sha256"] == summary["selection_sha256"] &&
          request["source"] == summary["source"] && request["selected_at"] == summary["selected_at"],
          "DATASET_OPERATOR_SOURCE_CHANGED")
        selected = selection(id).fetch("candidate")
        receipt = Store.read(File.join(path(id),"received.json"))
        Files.need(summary.dig("source","delivery_manifest_sha256") == selected.fetch("manifest_sha256") &&
          receipt["manifest_sha256"] == selected.fetch("manifest_sha256") &&
          receipt["format"] == selected.fetch("format"), "DATASET_OPERATOR_DELIVERY_CHANGED")
        summary
      end

      def source_index(id,summary)
        result = nil
        descriptor = source_file(summary,"source-index.json")
        Store.snapshot(File.join(path(id),descriptor.fetch("name")),descriptor) do |io|
          result = Files.parse(io.read)
        end
        Files.need(result["schema"] == SOURCE_INDEX_SCHEMA && result["id"] == id &&
          result["selection_sha256"] == summary["selection_sha256"] &&
          result["fields"] == summary.dig("source","fields") &&
          result["row_count"] == summary.dig("source","row_count") &&
          result["file"] == source_file(summary,"source-rows.jsonl") &&
          result["page_size"] == PAGE_SIZE && result["pages"].is_a?(Array),
          "DATASET_OPERATOR_SOURCE_INDEX")
        offset,ordinal = 0,0
        result["pages"].each_with_index do |page,index|
          Files.need(page.is_a?(Hash) && page["offset"] == offset && page["first_ordinal"] == ordinal &&
            page["rows"].is_a?(Integer) && page["rows"].between?(1,PAGE_SIZE) &&
            (index == result["pages"].length-1 || page["rows"] == PAGE_SIZE) &&
            page["bytes"].is_a?(Integer) && page["bytes"] > 0 && HASH.match?(page["sha256"].to_s),
            "DATASET_OPERATOR_SOURCE_INDEX")
          offset += page["bytes"]
          ordinal += page["rows"]
        end
        Files.need(offset == result.dig("file","bytes") && ordinal == result["row_count"] &&
          summary["pages"] == [1,result["pages"].length].max,
          "DATASET_OPERATOR_SOURCE_INDEX")
        result
      end
      private :source_index

      def source_page_snapshot(id,descriptor,page)
        snapshot = Tempfile.new(["dataset-source-page-",".snapshot"])
        begin
          snapshot.binmode
          snapshot.unlink
          File.open(File.join(path(id),descriptor.fetch("name")),
            File::RDONLY | File::NOFOLLOW | File::NONBLOCK) do |input|
            before = input.stat
            Files.need(before.file? && before.uid == Process.uid && (before.mode & 0077).zero? &&
              before.size == descriptor.fetch("bytes"), "DATASET_OPERATOR_SOURCE_CHANGED")
            input.seek(page.fetch("offset"))
            remaining,digest = page.fetch("bytes"),Digest::SHA256.new
            while remaining > 0
              chunk = input.read([remaining,1_048_576].min)
              Files.need(chunk && !chunk.empty?, "DATASET_OPERATOR_SOURCE_CHANGED")
              snapshot.write(chunk)
              digest.update(chunk)
              remaining -= chunk.bytesize
            end
            after = input.stat
            Files.need(digest.hexdigest == page.fetch("sha256") &&
              [before.dev,before.ino,before.size,before.mtime,before.ctime] ==
              [after.dev,after.ino,after.size,after.mtime,after.ctime], "DATASET_OPERATOR_SOURCE_CHANGED")
          end
          snapshot.flush
          snapshot.rewind
          yield snapshot
        ensure
          snapshot.close!
        end
      end
      private :source_page_snapshot

      def source_rows(id,page: 0)
        Files.need(page.is_a?(Integer) && page >= 0, "DATASET_OPERATOR_PAGE")
        summary = source_summary(id)
        index = source_index(id,summary)
        Files.need(page < summary.fetch("pages"), "DATASET_OPERATOR_PAGE")
        records,span = [],index.fetch("pages")[page]
        if span
          source_page_snapshot(id,index.fetch("file"),span) do |io|
            io.each_line do |line|
              record = Files.parse(line)
              Files.need(record["ordinal"] == span.fetch("first_ordinal") + records.length &&
                record["raw_json"].is_a?(String) && Files.hash(record["raw_json"]) == record["sha256"] &&
                record["values_json"].is_a?(String), "DATASET_OPERATOR_SOURCE_CHANGED")
              records << record
            end
          end
          Files.need(records.length == span.fetch("rows"), "DATASET_OPERATOR_SOURCE_CHANGED")
        end
        {"page"=>page,"pages"=>summary.fetch("pages"),"total"=>index.fetch("row_count"),
          "fields"=>index.fetch("fields"),"rows"=>records,"summary_sha256"=>summary.fetch("summary_sha256")}
      end

      # A complete source can be delivered before any target mapping is valid.
      # Verify every retained source byte against its original completed profile.
      def validate_source_handoff(id)
        summary = source_summary(id)
        source_index(id,summary)
        package,dataset = source_dataset(id)
        Files.need(package.manifest_sha256 == summary.dig("source","delivery_manifest_sha256") &&
          dataset.manifest_sha256 == summary.dig("source","manifest_sha256") &&
          dataset.source_sha256 == summary.dig("source","source_sha256") &&
          dataset.row_count == summary.dig("source","row_count") &&
          dataset.fields == summary.dig("source","fields"), "DATASET_OPERATOR_SOURCE_CHANGED")
        summary.fetch("files").each do |descriptor|
          Store.snapshot(File.join(path(id),descriptor.fetch("name")),descriptor) { |_input| }
        end
        summary
      end
      private :validate_source_handoff

      def source_export(id,format:)
        Files.need(%w[jsonl csv].include?(format), "DATASET_OPERATOR_SOURCE_FORMAT")
        summary = source_summary(id)
        package,dataset = source_dataset(id)
        Files.need(package.manifest_sha256 == summary.dig("source","delivery_manifest_sha256") &&
          dataset.manifest_sha256 == summary.dig("source","manifest_sha256"),
          "DATASET_OPERATOR_SOURCE_CHANGED")
        name = "dataset.#{format}"
        original = summary.fetch("source").fetch("dataset_files").find { |item| item["name"] == name }
        Files.need(original && dataset.descriptor(name) == original, "DATASET_OPERATOR_SOURCE_CHANGED")
        Download.new(filename:name,content_type:format == "csv" ?
          "text/csv; charset=utf-8" : "application/x-ndjson; charset=utf-8") do |out|
          dataset.with_snapshot(name) { |input| IO.copy_stream(input,out) }
        end
      end

      def mapping_target(id)
        selected = selection(id)
        original = stream(selected.dig("candidate","stream_id"))
        result = nil
        original.with_lock do
          # Re-evaluate the authorized application relation inside the same original lock.
          scoped = stream(selected.dig("candidate","stream_id"))
          Files.need(scoped.id == original.id && scoped.tenant_key.to_s == @tenant_key,
            "DATASET_OPERATOR_TENANT_CHANGED")
          target = RailsDataset::TargetContext.new(scope:@target_scope.call(original),
            stream:original,models:@models)
          result = target.metadata
        end
        result
      end
    end
  end
end
