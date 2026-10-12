# frozen_string_literal: true
# MIT. Portable Ruby receiving of a completed original SF100 data room.
require_relative "dataset_delivery"

module Starforge
  class NativeDatasetDelivery < DatasetDelivery
    SCHEMA = "stellar-forge.ruby-native-dataset-delivery.v1"
    SOURCE_SCHEMA = "stellar-forge.ruby-native-dataset-source.v1"
    SELECTION_SCHEMA = "stellar-forge.ruby-native-dataset-selection.v1"
    RECEIPT_SCHEMA = "stellar-forge.finalized-dataset-receiving.v1"
    MAX_PAGE = 2_097_152 + 4096
    MAX_PAGES = 4096
    METADATA = %w[source.json selection.json native-receiving.json].freeze
    OUTPUTS = %w[manifest.json dataset.jsonl dataset.csv review.html].freeze
    attr_reader :native_receipt

    def self.file_limit(name)
      return MAX_PAGE if /\Apages\/[0-9]{5}\.json\z/.match?(name.to_s)
      return 4096 if name == "session.json"
      return 2_097_152 if name == "semantics.json"
      return 4_194_304 if name == "manifest.json"
      return 16_777_216 if name == "native-receiving.json"
      return 1_048_576 if %w[source.json selection.json].include?(name)
      return MAX_FILE if %w[dataset.jsonl dataset.csv review.html].include?(name)
      raise Error, "RUBY_NATIVE_DATASET_FILE_NAME_INVALID"
    end

    def self.check_descriptor(name, descriptor)
      Files.need(descriptor.is_a?(Hash) && descriptor["bytes"].is_a?(Integer) &&
        descriptor["bytes"].between?(0,file_limit(name)) && HASH.match?(descriptor["sha256"].to_s),
        "RUBY_NATIVE_DATASET_FILE_DESCRIPTOR_INVALID")
      descriptor
    end

    # Provider identity is read from the original producer's dictionary schema.
    # Attribution and definition/capture hashes remain on their original edition.
    def self.provider_identity(semantics)
      return nil if semantics.nil?
      Files.need(semantics.is_a?(Hash) && semantics["source"].is_a?(Hash),
        "RUBY_NATIVE_DATASET_SEMANTICS_INVALID")
      original = semantics.fetch("source")
      value = case semantics["schema"]
      when "stellar-forge.ckan-semantics.v1"
        {"provider"=>"ckan","catalog_origin"=>original["catalogOrigin"],
         "package_id"=>original["packageId"],"resource_id"=>original["resourceId"]}
      when "stellar-forge.odata-semantics.v1"
        Files.need(original["provider"] == "odata4", "RUBY_NATIVE_DATASET_PROVIDER_CHANGED")
        {"provider"=>"odata4","service_url"=>original["serviceUrl"],
         "entity_container"=>original["entityContainer"],"entity_set"=>original["entitySet"]}
      else
        raise Error, "RUBY_NATIVE_DATASET_SEMANTICS_INVALID"
      end
      Files.need(value.values.all? { |item| item.is_a?(String) && !item.empty? &&
        item.valid_encoding? && item.bytesize <= 16_384 }, "RUBY_NATIVE_DATASET_PROVIDER_CHANGED")
      value
    end

    # Validate the original receiver envelope before following any original path.
    # Every returned file must resolve to the selected room and native filename.
    def self.check_receipt(receipt, room:, manifest_sha256:)
      Files.need(receipt.is_a?(Hash) && receipt["schema"] == RECEIPT_SCHEMA &&
        receipt["sourceFormat"] == "SF100_SCAN" && receipt["session"].nil? &&
        receipt["room"] == room && receipt["sourceId"] == manifest_sha256 &&
        receipt["manifestSha256"] == manifest_sha256 &&
        HASH.match?(receipt["sourceBindingSha256"].to_s) &&
        receipt["sourceFiles"] == {} && receipt["native"].is_a?(Hash),
        "RUBY_NATIVE_DATASET_RECEIPT_CHANGED")
      native = receipt.fetch("native")
      scan, status = native["originalNativeScan"],native["nativeStatus"]
      Files.need(native["schema"] == "stellar-forge.sf100.dataset-delivery.v1" &&
        native["sourceFormat"] == "SF100_SCAN" && native["directory"] == room &&
        native["sourceBindingSha256"] == receipt["sourceBindingSha256"] &&
        scan.is_a?(Hash) && scan["out"] == room && scan["finalized"] == true &&
        scan["nextCursor"].nil? && scan["count"].is_a?(Integer) &&
        scan["count"].between?(0,1_000_000) && scan["total"] == scan["count"] &&
        scan["name"].is_a?(String) && !scan["name"].empty? &&
        %w[snapshot chain queryHash].all? { |key| HASH.match?(scan[key].to_s) } &&
        scan["pages"].is_a?(Array) && scan["pages"].length.between?(1,MAX_PAGES) &&
        scan["fields"].is_a?(Array) && scan["fields"].length.between?(1,64) &&
        scan["fields"].uniq == scan["fields"] && scan["fields"].all? { |field|
          field.is_a?(String) && /\A[A-Za-z][A-Za-z0-9_]{0,47}\z/.match?(field)
        } && status.is_a?(Hash) && status["complete"] == true && status["finalized"] == true &&
        status["pages"] == scan["pages"].length && status["rows"] == scan["count"] &&
        status["total"] == scan["total"] && status["snapshot"] == scan["snapshot"] &&
        status["lastRecordDigest"] == scan["chain"], "RUBY_NATIVE_DATASET_COMPLETE_SCAN_REQUIRED")
      Files.need(receipt["columns"].is_a?(Array) &&
        receipt["columns"].map { |column| column.is_a?(Hash) && column["name"] } == scan["fields"] &&
        receipt["columns"].all? { |column|
          %w[string integer number boolean].include?(column["type"]) &&
            [true,false].include?(column["nullable"])
        }, "RUBY_NATIVE_DATASET_COLUMNS_CHANGED")
      outputs = OUTPUTS + (native["semantics"].nil? ? [] : ["semantics.json"])
      archives = ["session.json"] + Array.new(scan["pages"].length) { |index| format("pages/%05d.json",index) }
      Files.need(native["outputs"].is_a?(Hash) && native["outputs"].keys.sort == outputs.sort &&
        native["archives"].is_a?(Hash) && native["archives"].keys.sort == archives.sort &&
        receipt["archives"] == native["archives"], "RUBY_NATIVE_DATASET_FILE_SET_CHANGED")
      (outputs + archives).each do |name|
        item = native["outputs"][name] || native["archives"][name]
        check_descriptor(name,item)
        Files.need(item["path"] == File.join(room,name), "RUBY_NATIVE_DATASET_SOURCE_PATH_CHANGED")
      end
      Files.need(native["outputs"]["manifest.json"]["sha256"] == manifest_sha256 &&
        archives.drop(1).sum { |name| native["archives"][name]["bytes"] } <= MAX_FILE,
        "RUBY_NATIVE_DATASET_SOURCE_MANIFEST_CHANGED")
      [outputs,archives]
    end

    def initialize(directory, raw)
      @directory,@manifest_bytes = directory.freeze,raw.dup.freeze
      @manifest_sha256 = Files.hash(raw).freeze
      @manifest = Files.parse(raw)
      Files.need(@manifest.is_a?(Hash) && @manifest["schema"] == SCHEMA &&
        @manifest["sourceFormat"] == "SF100_SCAN" &&
        %w[datasetId sourceKey].all? { |key| INTENT.match?(@manifest[key].to_s) } &&
        %w[sourceSha256 nativeManifestSha256 sourceBindingSha256 nativeReceiptSha256
          sourceRecordSha256 selectionSha256 snapshot].all? { |key| HASH.match?(@manifest[key].to_s) } &&
        @manifest["sourceSha256"] == @manifest["nativeManifestSha256"] &&
        @manifest["rowCount"].is_a?(Integer) && @manifest["rowCount"].between?(0,1_000_000) &&
        @manifest["fields"].is_a?(Array) && @manifest["files"].is_a?(Array) &&
        @manifest["files"].length.between?(8,MAX_PAGES+10), "RUBY_NATIVE_DATASET_MANIFEST_INVALID")
      @files = {}
      @manifest["files"].each do |file|
        Files.need(file.is_a?(Hash) && file["name"].is_a?(String) && !@files.key?(file["name"]),
          "RUBY_NATIVE_DATASET_FILE_DESCRIPTOR_INVALID")
        self.class.check_descriptor(file["name"],file)
        @files[file["name"]] = file
      end
      Files.need((METADATA + OUTPUTS + ["session.json"] - @files.keys).empty?,
        "RUBY_NATIVE_DATASET_COMPLETE_FILES_REQUIRED")
      @selection = json_file("selection.json",limit: self.class.file_limit("selection.json"))
      @source = json_file("source.json",limit: self.class.file_limit("source.json"))
      @native_receipt = json_file("native-receiving.json",limit: self.class.file_limit("native-receiving.json"))
      @native_delivery = @native_receipt["native"]
      @acquisition = nil
      @native_manifest = json_file("manifest.json",limit: self.class.file_limit("manifest.json"))
      @semantics = @files.key?("semantics.json") ? json_file("semantics.json",limit: 2_097_152) : nil
      validate_native_bindings!
      validate_original_rows!
      %w[dataset.csv review.html].each { |name| with_snapshot(name) { |_snapshot| } }
      [@manifest,@files,@selection,@source,@native_receipt,@native_delivery,
        @native_manifest,@semantics].each { |value| self.class.freeze_value(value) }
      membership
    end
    private_class_method :new

    def source_format
      "SF100_SCAN"
    end
    def membership
      @membership ||= self.class.freeze_value({
        "source_format"=>"SF100_SCAN","source_key"=>@manifest.fetch("sourceKey"),
        "dataset"=>@native_manifest.fetch("dataset").fetch("name"),
        "provider_source"=>self.class.provider_identity(@semantics),
        "query_sha256"=>@native_manifest.fetch("dataset").fetch("originalQueryHash"),
        "projected_fields"=>fields})
    end

    private
    def validate_native_bindings!
      m,s,native = @manifest,@selection,@native_manifest
      Files.need(s.is_a?(Hash) && s["schema"] == SELECTION_SCHEMA &&
        s["sourceFormat"] == "SF100_SCAN" && s["datasetId"] == m["datasetId"] &&
        s["sourceKey"] == m["sourceKey"] && s["nativeManifestSha256"] == source_sha256 &&
        s["room"].is_a?(String) && File.expand_path(s["room"]) == s["room"] &&
        descriptor("selection.json")["sha256"] == m["selectionSha256"] &&
        descriptor("source.json")["sha256"] == m["sourceRecordSha256"] &&
        descriptor("native-receiving.json")["sha256"] == m["nativeReceiptSha256"],
        "RUBY_NATIVE_DATASET_SELECTION_CHANGED")
      outputs,archives = self.class.check_receipt(@native_receipt,
        room: s["room"],manifest_sha256: source_sha256)
      Files.need(@files.keys.sort == (outputs+archives+METADATA).sort &&
        @native_receipt["sourceBindingSha256"] == m["sourceBindingSha256"],
        "RUBY_NATIVE_DATASET_COMPLETE_FILES_REQUIRED")
      (outputs+archives).each do |name|
        original = @native_delivery["outputs"][name] || @native_delivery["archives"][name]
        Files.need(%w[bytes sha256].all? { |key| original[key] == descriptor(name)[key] },
          "RUBY_NATIVE_DATASET_ORIGINAL_FILE_CHANGED")
      end
      scan = @native_delivery.fetch("originalNativeScan")
      dataset = native.is_a?(Hash) && native["dataset"]
      Files.need(native.is_a?(Hash) && native["schema"] == "stellar-forge.buyer-delivery-manifest.v1" &&
        dataset.is_a?(Hash) && dataset["name"] == scan["name"] &&
        dataset["rows"] == row_count && row_count == scan["count"] &&
        dataset["snapshot"] == snapshot && snapshot == scan["snapshot"] &&
        dataset["projectedFields"] == fields && fields == scan["fields"] &&
        dataset["filters"] == scan["filters"] && dataset["ranges"] == scan["ranges"] &&
        dataset["order"] == (scan["order"] || "csv-record-order") &&
        dataset["originalQueryHash"] == scan["queryHash"] && HASH.match?(dataset["originalQueryHash"].to_s) &&
        dataset["originalQuerySignature"] == scan["pages"][0]["signature"] &&
        native["chainDigest"] == scan["chain"] &&
        native["paymentStatus"] == @native_delivery["paymentStatus"] &&
        native["sourcePages"].is_a?(Array) && native["sourcePages"].length == scan["pages"].length &&
        descriptor("manifest.json")["sha256"] == source_sha256 &&
        native["outputs"].is_a?(Hash) && native["outputs"].keys.sort == (outputs-["manifest.json"]).sort,
        "RUBY_NATIVE_DATASET_ORIGINAL_MANIFEST_CHANGED")
      native["outputs"].each do |name,item|
        Files.need(item == descriptor(name).slice("bytes","sha256"), "RUBY_NATIVE_DATASET_ORIGINAL_OUTPUT_CHANGED")
      end
      original_session = json_file("session.json",limit: 4096)
      Files.need(original_session == scan["session"] &&
        original_session["schema"] == "stellar-forge.buyer-delivery.v1",
        "RUBY_NATIVE_DATASET_SESSION_CHANGED")
      if @semantics
        binding = native["semantics"]
        Files.need(binding.is_a?(Hash) && binding == @native_delivery["semantics"] &&
          binding["file"] == "semantics.json" && binding["selectedFields"] == fields &&
          binding["scope"] == "PUBLISHED_DATASET" && binding["typedRowsFile"] == "dataset.jsonl" &&
          %w[schema sha256 definitionSha256].all? { |key| binding[key] == @semantics[key] } &&
          binding["captureManifestSha256"] == @semantics.dig("source","captureManifestSha256") &&
          @semantics == scan["semanticDocument"], "RUBY_NATIVE_DATASET_SEMANTICS_CHANGED")
      else
        Files.need(native["semantics"].nil? && @native_delivery["semantics"].nil? &&
          scan["semanticDocument"].nil?, "RUBY_NATIVE_DATASET_SEMANTICS_CHANGED")
      end
      Files.need(@source.is_a?(Hash) && @source["schema"] == SOURCE_SCHEMA &&
        @source["sourceFormat"] == "SF100_SCAN" && @source["sourceKey"] == m["sourceKey"] &&
        @source["datasetId"] == m["datasetId"] && @source["originalRoom"] == s["room"] &&
        @source["sourceId"] == source_sha256 && @source["manifestSha256"] == source_sha256 &&
        @source["sourceBindingSha256"] == m["sourceBindingSha256"] &&
        @source["datasetName"] == dataset["name"] && @source["columns"] == @native_receipt["columns"] &&
        @source["providerIdentity"] == self.class.provider_identity(@semantics) &&
        @source["semanticsFile"] == (@semantics ? descriptor("semantics.json") : nil),
        "RUBY_NATIVE_DATASET_SOURCE_BINDING_CHANGED")
    end

    def same_typed_value?(left, right)
      return false unless left.class == right.class
      if left.is_a?(Hash)
        left.keys.sort == right.keys.sort && left.all? { |key,value| same_typed_value?(value,right[key]) }
      elsif left.is_a?(Array)
        left.length == right.length && left.zip(right).all? { |a,b| same_typed_value?(a,b) }
      else
        left == right
      end
    end

    # Reopening binds each original page record to its complete native JSONL.
    # Hash the native compact record bytes, preserving original number lexemes.
    def validate_original_rows!
      scan = @native_delivery.fetch("originalNativeScan")
      count,previous,cursor = 0,nil,nil
      intents,source_hashes = {},{}
      with_snapshot("dataset.jsonl") do |rows|
        scan["pages"].each_with_index do |page,index|
          Files.need(page.is_a?(Hash) && page["index"] == index && page["previous"] == previous &&
            page["requestCursor"] == cursor && page["returned"].is_a?(Integer) && page["returned"] >= 0 &&
            %w[chain sourceSha256 signature].all? { |key| HASH.match?(page[key].to_s) } &&
            INTENT.match?(page["intent"].to_s) && !intents[page["intent"]] && !source_hashes[page["sourceSha256"]],
            "RUBY_NATIVE_DATASET_PAGE_CHANGED")
          Files.need(page["signature"] == scan["pages"][0]["signature"], "RUBY_NATIVE_DATASET_QUERY_CHANGED")
          expected = {"index"=>index,"intent"=>page["intent"],"sourceSha256"=>page["sourceSha256"],
            "evidenceSha256"=>page["evidenceSha256"],"recordDigest"=>page["chain"],
            "rows"=>page["returned"],"requestedCursor"=>page["requestCursor"]}
          Files.need(@native_manifest["sourcePages"][index] == expected, "RUBY_NATIVE_DATASET_PAGE_CHANGED")
          raw = file_bytes(format("pages/%05d.json",index),limit: MAX_PAGE)
          archive = Files.parse(raw,decimals: true)
          suffix = ',"chain":"' + page["chain"] + "\"}\n"
          Files.need(raw.end_with?(suffix) &&
            Files.hash(raw.byteslice(0,raw.bytesize-suffix.bytesize) + "}") == page["chain"] &&
            archive.is_a?(Hash) && archive["schema"] == "stellar-forge.buyer-page-archive.v1" &&
            %w[schema index previous intent requestCursor sourceSha256 evidenceSha256 signature chain].all? {
              |key| archive[key] == page[key]
            }, "RUBY_NATIVE_DATASET_ARCHIVE_CHANGED")
          payload = archive["payload"]
          Files.need(payload.is_a?(Hash) && payload["schema"] == "stellar-forge.dataset-page.v1" &&
            payload["fields"] == fields && payload.dig("dataset","snapshot") == snapshot &&
            payload.dig("dataset","name") == scan["name"] && payload["rows"].is_a?(Array) &&
            payload["rows"].length == page["returned"] &&
            payload.dig("page","returned") == page["returned"] && payload.dig("page","total") == row_count,
            "RUBY_NATIVE_DATASET_ARCHIVE_ROWS_CHANGED")
          columns = payload.dig("dataset","columns")
          Files.need(columns.is_a?(Array) && columns.all? { |column| column.is_a?(Hash) } &&
            fields.map { |name| columns.find { |column| column["name"] == name } } == @native_receipt["columns"] &&
            payload["semantics"] == @semantics, "RUBY_NATIVE_DATASET_PAGE_MEANING_CHANGED")
          payload["rows"].each do |original|
            line = rows.gets("\n",2_097_153)
            Files.need(line && line.end_with?("\n") && line.bytesize <= 2_097_152 &&
              same_typed_value?(Files.parse(line,decimals: true),original),
              "RUBY_NATIVE_DATASET_JSONL_SOURCE_CHANGED")
            count += 1
          end
          cursor = payload.dig("page","nextCursor")
          Files.need(count <= row_count && (index == scan["pages"].length-1 ? cursor.nil? : cursor.is_a?(String)),
            "RUBY_NATIVE_DATASET_PAGE_RANGE_CHANGED")
          if cursor
            Files.need(/\A[A-Za-z0-9_-]{1,512}\z/.match?(cursor), "RUBY_NATIVE_DATASET_CURSOR_CHANGED")
            decoded = Base64.urlsafe_decode64(cursor)
            Files.need(Base64.urlsafe_encode64(decoded,padding: false) == cursor &&
              Files.parse(decoded) == {"v"=>1,"s"=>snapshot,"q"=>scan["queryHash"],"n"=>count},
              "RUBY_NATIVE_DATASET_CURSOR_CHANGED")
          end
          previous = page["chain"]
          intents[page["intent"]] = true
          source_hashes[page["sourceSha256"]] = true
        end
        Files.need(rows.read(1).nil? && count == row_count && cursor.nil? && previous == scan["chain"],
          "RUBY_NATIVE_DATASET_COMPLETE_ROWS_REQUIRED")
      end
    end
  end
end
