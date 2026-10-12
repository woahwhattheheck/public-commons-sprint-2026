# frozen_string_literal: true
# MIT. Offline complete SF100 data-room receiving for Ruby and Rails.
require_relative "seller_client"
require "uri"

module Starforge
  class DatasetDelivery
    SCHEMA = "stellar-forge.ruby-dataset-delivery.v1"
    MANIFEST = "dataset-customer.json"
    MAX_FILE = 256 * 1024 * 1024
    REQUIRED = %w[source.json selection.json acquisition.json native-delivery.json manifest.json dataset.jsonl dataset.csv review.html].freeze
    OPTIONAL = %w[semantics.json].freeze
    attr_reader :directory, :manifest_sha256, :manifest, :native_manifest, :semantics

    def self.freeze_value(value)
      if value.is_a?(Hash)
        value.each { |key, child| key.freeze; freeze_value(child) }
      elsif value.is_a?(Array)
        value.each { |child| freeze_value(child) }
      end
      value.freeze
    end

    # The selected original bytes are copied and hashed before the caller sees
    # any byte or row. The snapshot has no filesystem name and is closed on
    # complete consumption, an exception, or early block return.
    def self.snapshot_file(path, descriptor)
      Files.need(descriptor.is_a?(Hash) && descriptor["bytes"].is_a?(Integer) &&
        descriptor["bytes"].between?(0,MAX_FILE) && HASH.match?(descriptor["sha256"].to_s),
        "RUBY_DATASET_FILE_DESCRIPTOR_INVALID")
      snapshot = Tempfile.new(["starforge-dataset-", ".snapshot"])
      begin
        snapshot.binmode
        snapshot.unlink
        File.open(path, File::RDONLY | File::NOFOLLOW | File::NONBLOCK) do |source|
          before = source.stat
          Files.need(before.file? && before.size == descriptor["bytes"], "RUBY_DATASET_FILE_CHANGED")
          digest, count = Digest::SHA256.new, 0
          while count < descriptor["bytes"]
            chunk = source.read([1_048_576,descriptor["bytes"] - count].min)
            Files.need(chunk && !chunk.empty?, "RUBY_DATASET_FILE_CHANGED")
            count += chunk.bytesize
            digest.update(chunk)
            written = 0
            while written < chunk.bytesize
              amount = snapshot.write(chunk.byteslice(written,chunk.bytesize-written))
              Files.need(amount && amount > 0, "RUBY_DATASET_SNAPSHOT_WRITE_FAILED")
              written += amount
            end
          end
          tail = source.read(1)
          after = source.stat
          Files.need(tail.nil? && count == descriptor["bytes"] && digest.hexdigest == descriptor["sha256"] &&
            [before.dev,before.ino,before.size,before.mtime,before.ctime] ==
            [after.dev,after.ino,after.size,after.mtime,after.ctime], "RUBY_DATASET_FILE_CHANGED")
        end
        snapshot.flush
        snapshot.rewind
        yield snapshot
      ensure
        snapshot.close!
      end
    end

    def self.open(directory, expected_manifest_sha256:)
      Files.need(HASH.match?(expected_manifest_sha256.to_s), "RUBY_DATASET_MANIFEST_SHA256_REQUIRED")
      root = Files.directory(directory)
      raw = Files.read(File.join(root,MANIFEST),4_194_304)
      Files.need(Files.hash(raw) == expected_manifest_sha256, "RUBY_DATASET_MANIFEST_CHANGED")
      if self == DatasetDelivery && Files.parse(raw)["schema"] == "stellar-forge.ruby-native-dataset-delivery.v1"
        require_relative "native_dataset"
        return NativeDatasetDelivery.open(root,expected_manifest_sha256: expected_manifest_sha256)
      end
      new(root,raw)
    end

    def initialize(directory, raw)
      @directory, @manifest_bytes = directory.freeze, raw.dup.freeze
      @manifest_sha256 = Files.hash(raw).freeze
      @manifest = Files.parse(raw)
      Files.need(@manifest.is_a?(Hash) && @manifest["schema"] == SCHEMA &&
        %w[datasetId intentId seedIntentId].all? { |key| INTENT.match?(@manifest[key].to_s) } &&
        %w[sourceSha256 selectionSha256 configurationSha256 sourceBindingSha256 nativeManifestSha256 snapshot].all? {
          |key| HASH.match?(@manifest[key].to_s)
        } && @manifest["rowCount"].is_a?(Integer) && @manifest["rowCount"].between?(0,1_000_000) &&
        @manifest["fields"].is_a?(Array) && @manifest["fields"].length.between?(1,64) &&
        @manifest["fields"].all? { |field| field.is_a?(String) && !field.empty? && field.valid_encoding? } &&
        @manifest["fields"].uniq == @manifest["fields"] && @manifest["files"].is_a?(Array),
        "RUBY_DATASET_MANIFEST_INVALID")
      @files = {}
      @manifest["files"].each do |file|
        Files.need(file.is_a?(Hash) && (REQUIRED + OPTIONAL).include?(file["name"]) && !@files.key?(file["name"]) &&
          file["bytes"].is_a?(Integer) && file["bytes"].between?(0,MAX_FILE) && HASH.match?(file["sha256"].to_s),
          "RUBY_DATASET_FILE_DESCRIPTOR_INVALID")
        @files[file["name"]] = file
      end
      Files.need((REQUIRED - @files.keys).empty? && (@files.keys - REQUIRED - OPTIONAL).empty?,
        "RUBY_DATASET_COMPLETE_FILES_REQUIRED")
      @files.each do |name, descriptor|
        self.class.snapshot_file(File.join(@directory,name),descriptor) { |_snapshot| }
      end
      @source = json_file("source.json")
      @selection = json_file("selection.json")
      @acquisition = json_file("acquisition.json")
      @native_delivery = json_file("native-delivery.json")
      @native_manifest = json_file("manifest.json")
      @semantics = @files.key?("semantics.json") ? json_file("semantics.json") : nil
      validate_bindings!
      [@manifest,@files,@source,@selection,@acquisition,@native_delivery,@native_manifest,@semantics].each {
        |value| self.class.freeze_value(value)
      }
    end
    private_class_method :new

    def fields
      @manifest.fetch("fields")
    end
    def row_count
      @manifest.fetch("rowCount")
    end
    def snapshot
      @manifest.fetch("snapshot")
    end
    def source_sha256
      @manifest.fetch("sourceSha256")
    end
    def source_format
      "SF88_SESSION"
    end
    # Preserve the original Rails stream object byte-for-byte in meaning. A
    # direct finalized room overrides this with its native logical provider.
    def membership
      @membership ||= begin
        request = source["request"]
        Files.need(request.is_a?(Hash) && request["method"] == "GET" &&
          source["operationId"].is_a?(String) && !source["operationId"].empty?,
          "RUBY_DATASET_SOURCE_OPERATION_REQUIRED")
        endpoint = URI.parse(request.fetch("url"))
        Files.need(%w[http https].include?(endpoint.scheme) && endpoint.host && !endpoint.userinfo,
          "RUBY_DATASET_SOURCE_ENDPOINT_INVALID")
        endpoint.query = nil
        endpoint.fragment = nil
        self.class.freeze_value({"source_sha256"=>source_sha256,
          "operation_id"=>source["operationId"],"method"=>"GET","endpoint"=>endpoint.to_s,
          "query_sha256"=>native_manifest.dig("dataset","originalQueryHash"),
          "projected_fields"=>fields})
      rescue URI::InvalidURIError, KeyError, TypeError
        raise Error, "RUBY_DATASET_SOURCE_ENDPOINT_INVALID"
      end
    end
    def selection
      @selection
    end
    def acquisition
      @acquisition
    end
    def native_delivery
      @native_delivery
    end
    def source
      @source
    end
    def descriptor(name)
      Files.need(@files.key?(name), "RUBY_DATASET_FILE_NAME_INVALID")
      @files.fetch(name)
    end
    def self.parent_directory(root, name, create: false)
      Files.need(name.is_a?(String) && name.split("/").all? { |part|
        /\A[A-Za-z0-9][A-Za-z0-9_.-]*\z/.match?(part) && !%w[. ..].include?(part)
      } && !name.start_with?("/") && !name.end_with?("/"), "RUBY_DATASET_FILE_NAME_INVALID")
      parent = Files.directory(root)
      name.split("/")[0...-1].each do |part|
        parent = Files.directory(File.join(parent,part),create: create)
      end
      parent
    end
    def with_snapshot(name, &block)
      expected = descriptor(name)
      self.class.parent_directory(@directory,name)
      self.class.snapshot_file(File.join(@directory,name),expected,&block)
    end
    def file_bytes(name, limit: 8_388_608)
      Files.need(limit.is_a?(Integer) && limit.between?(0,MAX_FILE) && descriptor(name)["bytes"] <= limit,
        "RUBY_DATASET_READ_LIMIT_USE_CHUNKS")
      with_snapshot(name) { |snapshot| snapshot.read || "".b }
    end
    def each_chunk(name, chunk_size: 65_536)
      return enum_for(__method__,name,chunk_size: chunk_size) unless block_given?
      Files.need(chunk_size.is_a?(Integer) && chunk_size.between?(1,1_048_576), "RUBY_DATASET_CHUNK_SIZE_INVALID")
      with_snapshot(name) do |snapshot|
        while (chunk = snapshot.read(chunk_size))
          yield chunk
        end
      end
      nil
    end
    def json_file(name, limit: MAX_INPUT)
      Files.parse(file_bytes(name,limit: limit),decimals: true)
    end

    # Ordinals and raw JSON retain the original SF100 row order and exact JSON
    # numeric spelling. Ruby Integer and BigDecimal keep the original precision.
    def each_record(max_row_bytes: 16_777_216)
      return enum_for(__method__,max_row_bytes: max_row_bytes) unless block_given?
      Files.need(max_row_bytes.is_a?(Integer) && max_row_bytes.between?(1,MAX_FILE), "RUBY_DATASET_ROW_LIMIT_INVALID")
      ordinal = 0
      with_snapshot("dataset.jsonl") do |snapshot|
        while (line = snapshot.gets("\n",max_row_bytes + 2))
          Files.need(line.end_with?("\n") || snapshot.eof?, "RUBY_DATASET_ROW_LIMIT")
          raw = line.end_with?("\n") ? line.byteslice(0,line.bytesize-1) : line
          Files.need(!raw.empty? && raw.bytesize <= max_row_bytes && ordinal < row_count, "RUBY_DATASET_ROW_COUNT_OR_SIZE_CHANGED")
          text = raw.dup.force_encoding(Encoding::UTF_8)
          Files.need(text.valid_encoding?, "RUBY_DATASET_ROW_UTF8_INVALID")
          values = Files.parse(text,decimals: true)
          Files.need(values.is_a?(Hash) && values.keys.sort == fields.sort && values.values.all? { |value|
            value.nil? || value == true || value == false || value.is_a?(String) ||
              value.is_a?(Integer) || value.is_a?(BigDecimal) && value.finite?
          }, "RUBY_DATASET_ROW_SHAPE_CHANGED")
          yield self.class.freeze_value({"ordinal"=>ordinal,"values"=>values,"raw_json"=>text,
            "sha256"=>Files.hash(raw)})
          ordinal += 1
        end
      end
      Files.need(ordinal == row_count, "RUBY_DATASET_ROW_COUNT_CHANGED")
      nil
    end
    def each_row(**options)
      return enum_for(__method__,**options) unless block_given?
      each_record(**options) { |record| yield record.fetch("values") }
      nil
    end

    # A complete delivery is portable. No original buyer/runtime, Rails app,
    # source host, signer or network connection is opened during copy/reopen.
    def copy_to(destination)
      target = Files.directory(destination,create: true)
      Files.need(target != @directory, "RUBY_DATASET_COPY_DESTINATION_REQUIRED")
      Files.lock(target) do
        Files.once(File.join(target,"dataset-copy.json"),Files.json({
          "schema"=>"stellar-forge.ruby-dataset-copy.v1","manifestSha256"=>manifest_sha256}))
        @files.each do |name, expected|
          parent = self.class.parent_directory(target,name,create: true)
          path = File.join(parent,File.basename(name))
          if File.exist?(path) || File.symlink?(path)
            self.class.snapshot_file(path,expected) { |_snapshot| }
            next
          end
          temp = Tempfile.new([".dataset-copy-", ".pending"],parent)
          begin
            temp.binmode
            with_snapshot(name) do |source|
              while (chunk = source.read(1_048_576))
                offset = 0
                while offset < chunk.bytesize
                  written = temp.write(chunk.byteslice(offset,chunk.bytesize-offset))
                  Files.need(written && written > 0, "RUBY_DATASET_COPY_WRITE_FAILED")
                  offset += written
                end
              end
            end
            temp.flush
            temp.fsync
            temp.close
            begin
              File.link(temp.path,path)
              Files.sync(parent)
            rescue Errno::EEXIST
              self.class.snapshot_file(path,expected) { |_snapshot| }
            end
          ensure
            temp.close!
          end
        end
        Files.once(File.join(target,MANIFEST),@manifest_bytes)
      end
      self.class.open(target,expected_manifest_sha256: manifest_sha256)
    end

    private
    def validate_bindings!
      m, s, a, delivery, native = @manifest,@selection,@acquisition,@native_delivery,@native_manifest
      Files.need(@source["schema"] == "stellar-forge.ruby-seller-operation.v1" &&
        @source["sourceSha256"] == source_sha256 && @source.dig("request","intentId") == m["seedIntentId"] &&
        s["schema"] == "stellar-forge.ruby-dataset-selection.v1" && s["datasetId"] == m["datasetId"] &&
        s["seedIntentId"] == m["seedIntentId"] && s["nativeSessionId"] == m["intentId"] &&
        s["sourceSha256"] == source_sha256 && s["configurationSha256"] == m["configurationSha256"] &&
        s["sourceRecordSha256"] == descriptor("source.json")["sha256"] &&
        descriptor("selection.json")["sha256"] == m["selectionSha256"], "RUBY_DATASET_SOURCE_BINDING_CHANGED")
      Files.need(a["schema"] == "stellar-forge.sf88.dataset-acquisition.v1" && a["status"] == "COMPLETE" &&
        a["sessionId"] == m["intentId"] && a["configurationSha256"] == m["configurationSha256"] &&
        a["expectedSnapshot"] == s["expectedSnapshot"] && a["limits"] == s["limits"] &&
        a["snapshot"] == snapshot && a["totalRows"] == row_count && a["acquiredRows"] == row_count &&
        a["pages"].is_a?(Array) && !a["pages"].empty? && a["completedPages"] == a["pages"].length,
        "RUBY_DATASET_ACQUISITION_CHANGED")
      Files.need(delivery["schema"] == "stellar-forge.sf88.dataset-delivery.v1" &&
        delivery["sourceDirectory"] == a["directory"] && delivery["sourceBindingSha256"] == m["sourceBindingSha256"] &&
        delivery.dig("nativeStatus","finalized") == true && delivery.dig("nativeStatus","complete") == true &&
        delivery.dig("nativeStatus","snapshot") == snapshot &&
        delivery.dig("nativeStatus","rows") == row_count && delivery["outputs"].is_a?(Hash),
        "RUBY_DATASET_NATIVE_DELIVERY_CHANGED")
      Files.need(native["schema"] == "stellar-forge.buyer-delivery-manifest.v1" &&
        native.dig("dataset","snapshot") == snapshot && native.dig("dataset","rows") == row_count &&
        native.dig("dataset","projectedFields") == fields && native["outputs"].is_a?(Hash) &&
        descriptor("manifest.json")["sha256"] == m["nativeManifestSha256"] &&
        native["sourcePages"].is_a?(Array) && native["sourcePages"].length == a["pages"].length,
        "RUBY_DATASET_NATIVE_MANIFEST_CHANGED")
      names = %w[dataset.jsonl dataset.csv review.html] + (@semantics.nil? ? [] : ["semantics.json"])
      Files.need(native["outputs"].keys.sort == names.sort &&
        delivery["outputs"].keys.sort == (names + ["manifest.json"]).sort,
        "RUBY_DATASET_NATIVE_OUTPUT_SET_CHANGED")
      (names + ["manifest.json"]).each do |name|
        d = descriptor(name)
        original = delivery["outputs"][name]
        Files.need(original.is_a?(Hash) && original["path"] == File.join(delivery["directory"],name) &&
          %w[bytes sha256].all? { |key| original[key] == d[key] }, "RUBY_DATASET_NATIVE_OUTPUT_CHANGED")
        next if name == "manifest.json"
        Files.need(native["outputs"][name] == {"bytes"=>d["bytes"],"sha256"=>d["sha256"]},
          "RUBY_DATASET_NATIVE_OUTPUT_CHANGED")
      end
      previous_cursor, count = nil, 0
      a["pages"].each_with_index do |page,index|
        original = native["sourcePages"][index]
        Files.need(page.is_a?(Hash) && original.is_a?(Hash) && page["index"] == index+1 &&
          original["index"] == index && original["intent"] == page["intentId"] &&
          original["sourceSha256"] == page["sha256"] && original["evidenceSha256"] == page["evidenceSha256"] &&
          original["rows"] == page["returned"] && original["requestedCursor"] == previous_cursor &&
          page["offset"] == count && page["snapshot"] == snapshot && page["fields"] == fields &&
          page["returned"].is_a?(Integer) && page["returned"] >= 0, "RUBY_DATASET_PAGE_BINDING_CHANGED")
        count += page["returned"]
        Files.need(page["nextOffset"] == count, "RUBY_DATASET_PAGE_RANGE_CHANGED")
        previous_cursor = page["nextCursor"]
      end
      Files.need(count == row_count && previous_cursor.nil?, "RUBY_DATASET_COMPLETE_RANGE_REQUIRED")
      if @semantics.nil?
        Files.need(!native.key?("semantics") && !delivery.key?("semantics"), "RUBY_DATASET_SEMANTICS_CHANGED")
      else
        binding = native["semantics"]
        Files.need(binding.is_a?(Hash) && @semantics.is_a?(Hash) && binding["file"] == "semantics.json" &&
          binding["scope"] == "PUBLISHED_DATASET" && binding["typedRowsFile"] == "dataset.jsonl" &&
          binding["selectedFields"] == fields && %w[schema sha256 definitionSha256].all? { |key|
            binding[key] == @semantics[key] && binding[key] == delivery.dig("semantics",key)
          } && binding["captureManifestSha256"] == @semantics.dig("source","captureManifestSha256") &&
          binding["captureManifestSha256"] == delivery.dig("semantics","captureManifestSha256"),
          "RUBY_DATASET_SEMANTICS_CHANGED")
      end
    end
  end
end
