# frozen_string_literal: true
# MIT. Private review and import workspace for the application's original dataset models.
require "securerandom"
require "fileutils"
require "rubygems/package"
require_relative "../models"

module Starforge
  module DatasetOperator
    UUID = /\A[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}\z/
    HASH = /\A[a-f0-9]{64}\z/
    PAGE_SIZE = 100
    GROUPS = %w[all inserted updated unchanged removed adopted restored source_changed].freeze

    # Resolve the same authorized application context in web requests and jobs.
    # The host application installs this resolver; it is never read from HTTP input.
    class << self
      attr_accessor :workspace_resolver
      def workspace(tenant_key)
        Files.need(workspace_resolver.respond_to?(:call), "DATASET_OPERATOR_RESOLVER_REQUIRED")
        result = workspace_resolver.call(tenant_key.to_s)
        Files.need(result.is_a?(Workspace) && result.tenant_key == tenant_key.to_s,
          "DATASET_OPERATOR_TENANT_CHANGED")
        result
      end
    end

    class Download
      attr_reader :bytes, :sha256, :filename, :content_type
      def initialize(filename:, content_type:)
        @filename, @content_type = filename, content_type
        @file = Tempfile.new(["dataset-operator-", ".download"])
        @file.binmode
        @file.unlink
        yield @file
        @file.flush
        @bytes = @file.size
        @file.rewind
        digest = Digest::SHA256.new
        chunk = nil
        digest.update(chunk) while (chunk = @file.read(1_048_576))
        @sha256 = digest.hexdigest
        @file.rewind
      rescue Exception
        @file&.close
        raise
      end
      def each
        return enum_for(__method__) unless block_given?
        @file.rewind
        chunk = nil
        yield chunk while (chunk = @file.read(1_048_576))
      ensure
        close if block_given?
      end
      def close
        @file&.close unless @file&.closed?
      end
    end

    module Store
      module_function
      def read(path)
        Files.parse(Files.read(path, 64 * 1024 * 1024))
      end
      def present?(path)
        File.exist?(path) || File.symlink?(path)
      end
      def replace(path, value)
        raw = Files.json(value)
        temp = Tempfile.new([".operator-state-", ".pending"], File.dirname(path))
        begin
          temp.binmode
          temp.write(raw)
          temp.flush
          temp.fsync
          if present?(path)
            stat = File.lstat(path)
            Files.need(stat.file? && !stat.symlink? && stat.uid == Process.uid &&
              (stat.mode & 0077).zero?, "DATASET_OPERATOR_STATE_CHANGED")
          end
          File.rename(temp.path, path)
          Files.sync(File.dirname(path))
        ensure
          temp.close!
        end
      end
      def write(path, &block)
        value = DatasetExample::Artifacts.write_once(path, &block)
        {"name"=>File.basename(path), "bytes"=>value.fetch("bytes"), "sha256"=>value.fetch("sha256")}
      end
      # Application previews and receipts can be larger than the original input.
      # Verify the whole selected file before exposing a row or download.
      def snapshot(path, expected)
        Files.need(expected.is_a?(Hash) && expected["bytes"].is_a?(Integer) &&
          expected["bytes"] >= 0 && HASH.match?(expected["sha256"].to_s),
          "DATASET_OPERATOR_FILE_DESCRIPTOR")
        temp = Tempfile.new(["dataset-operator-", ".snapshot"])
        begin
          temp.binmode
          temp.unlink
          File.open(path, File::RDONLY | File::NOFOLLOW | File::NONBLOCK) do |input|
            before = input.stat
            Files.need(before.file? && before.size == expected["bytes"], "DATASET_OPERATOR_FILE_CHANGED")
            digest, count = Digest::SHA256.new, 0
            while (chunk = input.read(1_048_576))
              count += chunk.bytesize
              Files.need(count <= expected["bytes"], "DATASET_OPERATOR_FILE_CHANGED")
              digest.update(chunk)
              temp.write(chunk)
            end
            after = input.stat
            Files.need(count == expected["bytes"] && digest.hexdigest == expected["sha256"] &&
              [before.dev,before.ino,before.size,before.mtime,before.ctime] ==
              [after.dev,after.ino,after.size,after.mtime,after.ctime], "DATASET_OPERATOR_FILE_CHANGED")
          end
          temp.flush
          temp.rewind
          yield temp
        ensure
          temp.close!
        end
      end
    end

    class Workspace
      attr_reader :tenant_key
      def initialize(directory:, tenant_key:, streams:, target_scope:, models:, catalog:, formats: {})
        Files.need(tenant_key.is_a?(String) && !tenant_key.empty? && tenant_key.bytesize <= 128,
          "DATASET_OPERATOR_TENANT_REQUIRED")
        Files.need(streams.is_a?(ActiveRecord::Relation) && target_scope.respond_to?(:call) &&
          catalog.respond_to?(:call), "DATASET_OPERATOR_APPLICATION_CONTEXT")
        @tenant_key, @streams, @target_scope, @models, @catalog = tenant_key, streams, target_scope, models, catalog
        root = Files.directory(directory, create: true)
        @directory = Files.directory(File.join(root, Digest::SHA256.hexdigest(tenant_key)), create: true)
        @formats = {"dataset"=>lambda { |directory, sha|
          DatasetDelivery.open(directory, expected_manifest_sha256: sha)
        }}.merge(formats.transform_keys(&:to_s))
        Files.need(@formats.values.all? { |opener| opener.respond_to?(:call) }, "DATASET_OPERATOR_FORMAT")
      end

      def candidates
        values = @catalog.call
        Files.need(values.is_a?(Array), "DATASET_OPERATOR_CATALOG")
        ids = Set.new
        values.map do |input|
          value = input.transform_keys(&:to_s)
          Files.need(value["id"].is_a?(String) && /\A[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}\z/.match?(value["id"]) &&
            ids.add?(value["id"]) && value["title"].is_a?(String) &&
            @formats.key?(value.fetch("format","dataset")) && HASH.match?(value["manifest_sha256"].to_s),
            "DATASET_OPERATOR_CANDIDATE")
          stream(value.fetch("stream_id"))
          mapping = value["mapping"]
          mapping = Files.parse(Files.read(value.fetch("mapping_path"))) if mapping.nil?
          Files.need(mapping.is_a?(Hash), "DATASET_OPERATOR_MAPPING")
          chosen = {"id"=>value["id"], "title"=>value["title"], "stream_id"=>value["stream_id"].to_s,
            "directory"=>Files.directory(value.fetch("directory")), "format"=>value.fetch("format","dataset"),
            "manifest_sha256"=>value["manifest_sha256"], "mapping"=>RailsDataset.copy_json(mapping)}
          chosen.merge("selection_sha256"=>RailsDataset.fingerprint(chosen))
        end
      end

      def stream(id)
        value = @streams.find(id)
        Files.need(value.tenant_key.to_s == @tenant_key, "DATASET_OPERATOR_TENANT_CHANGED")
        value
      end

      def path(id, create: false)
        Files.need(UUID.match?(id.to_s), "DATASET_OPERATOR_REVIEW_ID")
        Files.directory(File.join(@directory,id), create: create)
      end

      def selection(id)
        value = Store.read(File.join(path(id),"selection.json"))
        Files.need(value["schema"] == "stellar-forge.dataset-operator-selection.v1" &&
          value["id"] == id && value["tenant_key"] == @tenant_key &&
          HASH.match?(value.dig("candidate","selection_sha256").to_s), "DATASET_OPERATOR_SELECTION")
        stream(value.dig("candidate","stream_id"))
        original = value.fetch("candidate").reject { |key,_| key == "selection_sha256" }
        Files.need(RailsDataset.fingerprint(original) == value["candidate"]["selection_sha256"],
          "DATASET_OPERATOR_SELECTION_CHANGED")
        value
      end

      def select(id:, candidate_id:, selection_sha256:, actor:)
        Files.need(actor.is_a?(String) && !actor.empty? && actor.bytesize <= 512,
          "DATASET_OPERATOR_ACTOR_REQUIRED")
        directory = path(id, create: true)
        Files.lock(directory) do
          original_path = File.join(directory,"selection.json")
          if Store.present?(original_path)
            saved = selection(id)
            Files.need(saved.dig("candidate","id") == candidate_id &&
              saved.dig("candidate","selection_sha256") == selection_sha256,
              "DATASET_OPERATOR_SELECTION_CHANGED")
            return saved
          end
          candidate = candidates.find { |item| item["id"] == candidate_id }
          Files.need(candidate && candidate["selection_sha256"] == selection_sha256,
            "DATASET_OPERATOR_CANDIDATE_CHANGED")
          saved = {"schema"=>"stellar-forge.dataset-operator-selection.v1", "id"=>id,
            "tenant_key"=>@tenant_key, "actor"=>actor, "selected_at"=>Time.now.utc.iso8601(6),
            "operation_key"=>"dataset-operator/#{Digest::SHA256.hexdigest(@tenant_key)}/#{id}",
            "candidate"=>candidate}
          Files.once(original_path, Files.json(saved))
          state(id, "selected")
          saved
        end
      end

      def refresh(id, new_id:, actor:)
        Files.need(actor.is_a?(String) && !actor.empty? && actor.bytesize <= 512,
          "DATASET_OPERATOR_ACTOR_REQUIRED")
        original = selection(id)
        review(id)
        selected_delivery(id)
        candidate = RailsDataset.copy_json(original.fetch("candidate"))
        candidate.delete("selection_sha256")
        candidate["directory"] = File.join(path(id),"received")
        candidate["selection_sha256"] = RailsDataset.fingerprint(candidate)
        directory = path(new_id,create: true)
        Files.lock(directory) do
          file = File.join(directory,"selection.json")
          if Store.present?(file)
            saved = selection(new_id)
            Files.need(saved["original_review_id"] == id &&
              saved.dig("candidate","selection_sha256") == candidate["selection_sha256"],
              "DATASET_OPERATOR_SELECTION_CHANGED")
            return saved
          end
          saved = {"schema"=>"stellar-forge.dataset-operator-selection.v1","id"=>new_id,
            "tenant_key"=>@tenant_key,"actor"=>actor,"selected_at"=>Time.now.utc.iso8601(6),
            "original_review_id"=>id,
            "operation_key"=>"dataset-operator/#{Digest::SHA256.hexdigest(@tenant_key)}/#{new_id}",
            "candidate"=>candidate}
          Files.once(file,Files.json(saved))
          state(new_id,"selected")
          saved
        end
      end

      def state(id, phase = nil, details = {})
        file = File.join(path(id),"state.json")
        if phase
          value = {"phase"=>phase, "updated_at"=>Time.now.utc.iso8601(6)}.merge(details)
          Store.replace(file, value)
          value
        elsif Store.present?(file)
          Store.read(file)
        else
          {"phase"=>"selected"}
        end
      end

      def selected_delivery(id)
        chosen = selection(id).fetch("candidate")
        @formats.fetch(chosen.fetch("format")).call(File.join(path(id),"received"), chosen.fetch("manifest_sha256"))
      end

      def importer(id)
        chosen = selection(id).fetch("candidate")
        record = stream(chosen.fetch("stream_id"))
        package = selected_delivery(id)
        dataset = package.respond_to?(:dataset) ? package.dataset : package
        RailsDataset.new(delivery: dataset, stream: record, scope: @target_scope.call(record),
          models: @models, mapping: chosen.fetch("mapping"))
      end

      def prepare(id)
        directory = path(id)
        Files.lock(directory) do
          if Store.present?(File.join(directory,"review.json"))
            saved = review(id)
            phase = if Store.present?(File.join(directory,"committed.json"))
              "complete"
            elsif Store.present?(File.join(directory,"approval.json"))
              state(id)["phase"] == "import_error" ? "import_error" : "approved"
            else
              "ready"
            end
            state(id,phase)
            return saved
          end
          chosen = selection(id).fetch("candidate")
          state(id,"preparing")
          begin
            receiver = File.join(directory,"received")
            if Store.present?(File.join(directory,"received.json"))
              package = selected_delivery(id)
            else
              package = @formats.fetch(chosen.fetch("format")).call(chosen.fetch("directory"), chosen.fetch("manifest_sha256"))
              package.copy_to(receiver)
              package = selected_delivery(id)
              Files.once(File.join(directory,"received.json"), Files.json({
                "manifest_sha256"=>package.manifest_sha256, "format"=>chosen.fetch("format")}))
            end
            Files.need(package.manifest_sha256 == chosen.fetch("manifest_sha256"), "DATASET_OPERATOR_DELIVERY_CHANGED")
            preview = retained_preview(id)
            begin
              descriptors = []
              descriptors << Store.write(File.join(directory,"preview.json")) { |io| preview.write_json(io) }
              descriptors << Store.write(File.join(directory,"preview.csv")) { |io| preview.write_csv(io) }
              groups = GROUPS.to_h { |name| [name, {"count"=>0,"pages"=>[]}] }
              descriptors << Store.write(File.join(directory,"changes.jsonl")) do |io|
                preview.each_entry do |row|
                  GROUPS.each do |name|
                    next unless name == "all" || row["action"] == name || row[name] == true
                    group = groups.fetch(name)
                    group["pages"] << io.pos if (group["count"] % PAGE_SIZE).zero?
                    group["count"] += 1
                  end
                  io.write(RailsDataset.json(row) + "\n")
                end
              end
              descriptors << Store.write(File.join(directory,"mapping.json")) { |io| io.write(Files.json(chosen.fetch("mapping"))) }
              record = {"schema"=>"stellar-forge.dataset-operator-review.v1", "id"=>id,
                "selection_sha256"=>Files.hash(Files.read(File.join(directory,"selection.json"))),
                "prepared_at"=>Time.now.utc.iso8601(6), "summary"=>preview.summary,
                "groups"=>groups, "files"=>descriptors}
              Files.once(File.join(directory,"review.json"), Files.json(record))
              state(id,"ready")
              record
            ensure
              preview.close
            end
          rescue Exception => error
            state(id,"prepare_error", "code"=>error.respond_to?(:code) ? error.code : error.class.name,
              "message"=>error.message.to_s[0,4000])
            raise
          end
        end
      end

      # Save the complete original review before deriving any browser/export files.
      # A crash during export replays this exact preview even if targets later change.
      def retained_preview(id)
        file = File.join(path(id),"preview.bundle")
        unless Store.present?(file)
          selected = importer(id).preview
          begin
            Store.write(file) do |io|
              io.write(Files.json(selected.summary))
              selected.each_entry { |entry| io.write(RailsDataset.json(entry) + "\n") }
            end
          ensure
            selected.close
          end
        end
        reopened = nil
        File.open(file, File::RDONLY | File::NOFOLLOW | File::NONBLOCK) do |io|
          before = io.stat
          Files.need(before.file?, "DATASET_OPERATOR_PREVIEW_CHANGED")
          header = Files.parse(io.gets.to_s)
          reopened = RailsDataset::Preview.new(header.fetch("binding"))
          io.each_line { |line| reopened.append(Files.parse(line)) }
          reopened.seal
          after = io.stat
          Files.need(reopened.summary == header &&
            [before.dev,before.ino,before.size,before.mtime,before.ctime] ==
            [after.dev,after.ino,after.size,after.mtime,after.ctime], "DATASET_OPERATOR_PREVIEW_CHANGED")
          current = importer(id).binding
          %w[stream_id target_model scope_sha256 source mapping mapping_sha256 schema_sha256].each do |key|
            Files.need(header.fetch("binding").fetch(key) == current.fetch(key),
              "DATASET_OPERATOR_REVIEW_INPUT_CHANGED")
          end
        end
        reopened
      rescue Exception
        reopened&.close
        raise
      end

      def review(id)
        directory = path(id)
        selection(id)
        record = Store.read(File.join(directory,"review.json"))
        Files.need(record["schema"] == "stellar-forge.dataset-operator-review.v1" && record["id"] == id &&
          record["selection_sha256"] == Files.hash(Files.read(File.join(directory,"selection.json"))),
          "DATASET_OPERATOR_REVIEW_CHANGED")
        summary = record.fetch("summary")
        Files.need(summary["preview_sha256"] == RailsDataset.fingerprint({
          "schema"=>summary["schema"], "binding"=>summary["binding"], "counts"=>summary["counts"],
          "row_count"=>summary["row_count"], "entries_sha256"=>summary["entries_sha256"]}),
          "DATASET_OPERATOR_PREVIEW_CHANGED")
        record
      end

      def changes(id, group: "all", page: 0)
        Files.need(GROUPS.include?(group) && page.is_a?(Integer) && page >= 0, "DATASET_OPERATOR_PAGE")
        record = review(id)
        index = record.fetch("groups").fetch(group)
        pages = [1,(index.fetch("count") + PAGE_SIZE - 1) / PAGE_SIZE].max
        Files.need(page < pages, "DATASET_OPERATOR_PAGE")
        selected = record.fetch("files").find { |file| file["name"] == "changes.jsonl" }
        rows = []
        Store.snapshot(File.join(path(id),"changes.jsonl"),selected) do |io|
          offset = index.fetch("pages")[page]
          if offset
            io.seek(offset)
            while rows.length < PAGE_SIZE && (line = io.gets)
              row = Files.parse(line)
              rows << row if group == "all" || row["action"] == group || row[group] == true
            end
          end
        end
        {"rows"=>rows, "page"=>page, "pages"=>pages, "total"=>index.fetch("count"), "group"=>group}
      end

      def approve(id, preview_sha256:, actor:)
        directory = path(id)
        Files.lock(directory) do
          value = review(id)
          Files.need(value.dig("summary","preview_sha256") == preview_sha256 &&
            actor.is_a?(String) && !actor.empty? && actor.bytesize <= 512, "DATASET_OPERATOR_APPROVAL")
          file = File.join(directory,"approval.json")
          if Store.present?(file)
            approved = Store.read(file)
            Files.need(approved["preview_sha256"] == preview_sha256, "DATASET_OPERATOR_APPROVAL_CHANGED")
          else
            approved = {"preview_sha256"=>preview_sha256, "actor"=>actor, "approved_at"=>Time.now.utc.iso8601(6)}
            Files.once(file,Files.json(approved))
          end
          state(id,"approved") unless Store.present?(File.join(directory,"committed.json"))
          approved
        end
      end

      def commit(id)
        directory = path(id)
        Files.lock(directory) do
          ready = review(id)
          approved = Store.read(File.join(directory,"approval.json"))
          Files.need(approved["preview_sha256"] == ready.dig("summary","preview_sha256"),
            "DATASET_OPERATOR_APPROVAL_CHANGED")
          original = selection(id)
          state(id,"importing")
          begin
            value = importer(id)
            receipt = value.import!(operation_key: original.fetch("operation_key"),
              expected_preview_sha256: approved.fetch("preview_sha256"))
            # A retry after the database commit uses the same original operation.
            # A complete receipt export is retained before publishing completion.
            descriptor = Store.write(File.join(directory,"receipt.json")) do |io|
              value.write_receipt(io, operation_key: original.fetch("operation_key"))
            end
            completed = {"schema"=>"stellar-forge.dataset-operator-commit.v1", "id"=>id,
              "receipt"=>receipt, "file"=>descriptor}
            Files.once(File.join(directory,"committed.json"), Files.json(completed))
            state(id,"complete")
            completed
          rescue Exception => error
            state(id,"import_error", "code"=>error.respond_to?(:code) ? error.code : error.class.name,
              "message"=>error.message.to_s[0,4000])
            raise
          end
        end
      end

      def detail(id)
        directory = path(id)
        chosen = selection(id)
        ready = Store.present?(File.join(directory,"review.json")) ? review(id) : nil
        committed = Store.present?(File.join(directory,"committed.json")) ? Store.read(File.join(directory,"committed.json")) : nil
        if committed
          original_receipt = importer(id).receipt(operation_key: chosen.fetch("operation_key"))
          Files.need(committed["receipt"] == original_receipt, "DATASET_OPERATOR_COMMIT_CHANGED")
        end
        {"selection"=>chosen, "state"=>state(id), "review"=>ready, "committed"=>committed,
          "approved"=>Store.present?(File.join(directory,"approval.json"))}
      end

      def list(before: nil, limit: 30)
        Files.need(limit.is_a?(Integer) && limit.between?(1,100), "DATASET_OPERATOR_PAGE")
        names = Dir.children(@directory).select { |id| UUID.match?(id) }
        values = names.filter_map do |id|
          next unless Store.present?(File.join(path(id),"selection.json"))
          selected = selection(id)
          cursor = selected.fetch("selected_at") + "/" + id
          next if before && cursor >= before
          {"id"=>id,"cursor"=>cursor,"title"=>selected.dig("candidate","title"),
            "selected_at"=>selected["selected_at"],"actor"=>selected["actor"],"state"=>state(id)}
        end.sort_by { |item| item["cursor"] }.reverse
        selected = values.first(limit)
        {"items"=>selected, "next_before"=>values.length > limit ? selected.last["cursor"] : nil}
      end

      def history(id, before: nil, limit: 50)
        chosen = selection(id)
        relation = @models.fetch(:edition).where(dataset_stream_id: stream(chosen.dig("candidate","stream_id")).id)
        relation = relation.where("id < ?",Integer(before,10)) if before
        rows = relation.order(id: :desc).limit(limit + 1).to_a
        value = importer(id)
        selected = rows.first(limit).map do |edition|
          receipt = value.verified_receipt(edition)
          {"id"=>edition.id.to_s,"revision"=>edition.revision,"receipt_sha256"=>edition.receipt_sha256,
            "receipt"=>receipt}
        end
        {"items"=>selected,"next_before"=>rows.length > limit ? selected.last["id"] : nil}
      end

      def export(id, name)
        directory = path(id)
        record = review(id)
        if name == "receipt.json"
          committed = Store.read(File.join(directory,"committed.json"))
          descriptor = committed.fetch("file")
        else
          descriptor = record.fetch("files").find { |file| file["name"] == name }
        end
        Files.need(descriptor, "DATASET_OPERATOR_EXPORT")
        content_type = name.end_with?(".csv") ? "text/csv; charset=utf-8" : "application/json"
        Download.new(filename: name,content_type: content_type) do |out|
          Store.snapshot(File.join(directory,name),descriptor) { |io| IO.copy_stream(io,out) }
        end
      end

      def historical_receipt(id, edition_id)
        chosen = selection(id)
        edition = @models.fetch(:edition).where(
          dataset_stream_id: stream(chosen.dig("candidate","stream_id")).id).find(edition_id)
        receipt = importer(id).verified_receipt(edition)
        Download.new(filename: "dataset-edition-#{edition.revision}.json",content_type: "application/json") do |out|
          out.write(RailsDataset.json(receipt).delete_suffix("}") + ',"rows":[')
          first, count, digest = true, 0, Digest::SHA256.new
          @models.fetch(:entry).where(dataset_edition_id: edition.id).find_each do |entry|
            raw = entry.record_json
            Files.need(Files.hash(raw) == entry.record_sha256, "DATASET_EDITION_ROW_CHANGED")
            out.write(",") unless first
            out.write(raw)
            digest.update(raw + "\n")
            count += 1
            first = false
          end
          Files.need(count == receipt["entry_count"] && digest.hexdigest == receipt["retained_entries_sha256"],
            "DATASET_EDITION_ROWS_CHANGED")
          out.write("]}\n")
        end
      end

      # A single download carries the original received delivery, selected mapping,
      # complete review, approvals and available committed receipt. The application
      # continues to use its own source deployment and database backup workflow.
      def handoff(id)
        directory = path(id)
        result = nil
        Files.lock(directory) do
          review(id)
          files = []
          visit = lambda do |base,relative|
            Dir.children(base).sort.each do |name|
              next if name.start_with?(".")
              child, logical = File.join(base,name), (relative.empty? ? name : relative + "/" + name)
              stat = File.lstat(child)
              Files.need(!stat.symlink? && stat.uid == Process.uid && (stat.mode & 0077).zero?,
                "DATASET_OPERATOR_HANDOFF_FILE")
              if stat.directory?
                Files.directory(child)
                visit.call(child,logical)
              else
                Files.need(stat.file?, "DATASET_OPERATOR_HANDOFF_FILE")
                bytes, digest = 0, Digest::SHA256.new
                File.open(child,File::RDONLY | File::NOFOLLOW | File::NONBLOCK) do |io|
                  while (chunk = io.read(1_048_576))
                    bytes += chunk.bytesize
                    digest.update(chunk)
                  end
                end
                files << {"name"=>logical,"bytes"=>bytes,"sha256"=>digest.hexdigest}
              end
            end
          end
          visit.call(directory,"")
          manifest = {"schema"=>"stellar-forge.dataset-operator-handoff.v1","review_id"=>id,
            "tenant_key"=>@tenant_key,"files"=>files}
          result = Download.new(filename: "dataset-review-#{id}.tar",content_type: "application/x-tar") do |out|
            Gem::Package::TarWriter.new(out) do |archive|
              bytes = Files.json(manifest)
              archive.add_file_simple("handoff.json",0600,bytes.bytesize) { |io| io.write(bytes) }
              files.each do |descriptor|
                Store.snapshot(File.join(directory,descriptor["name"]),descriptor) do |input|
                  archive.add_file_simple("review/" + descriptor["name"],0600,descriptor["bytes"]) do |io|
                    IO.copy_stream(input,io)
                  end
                end
              end
            end
          end
        end
        result
      end

      def attachments(id, offset: 0)
        package = selected_delivery(id)
        return {"offset"=>0,"total"=>0,"next_offset"=>nil,"files"=>[]} unless package.respond_to?(:attachment_page)
        package.attachment_page(offset: offset, limit: PAGE_SIZE)
      end

      def attachment(id, file:, record_id:, column:)
        package = selected_delivery(id)
        Files.need(package.respond_to?(:attachment), "DATASET_OPERATOR_ATTACHMENT")
        result = nil
        package.attachment(file: file,record_id: record_id,column: column) do |io,metadata|
          result = Download.new(filename: metadata.fetch("filename",File.basename(file)),
            content_type: "application/octet-stream") { |out| IO.copy_stream(io,out) }
        end
        Files.need(result, "DATASET_OPERATOR_ATTACHMENT")
        result
      end
    end
  end
end
