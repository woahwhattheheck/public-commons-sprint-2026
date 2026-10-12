# frozen_string_literal: true
# MIT. Complete Baserow source/attachment receiving beside the original dataset.
require_relative "../../developer/ruby-client/native_dataset_receiving"
require "set"
require "uri"

module Starforge
  module BaserowCustomerFiles
    MANIFEST = "customer-manifest.json"
    SCHEMA = "stellar-forge.baserow-customer-delivery.v1"
    MAX_METADATA = 33_554_432
    MAX_BYTES = 872_415_232
    MAX_FILES = 14_104
    UUID = /\A[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\z/
    FIELD = /\A[A-Za-z][A-Za-z0-9_]{0,47}\z/
    module_function

    def canonical(value)
      case value
      when Hash then value.keys.sort.to_h { |key| [key,canonical(value.fetch(key))] }
      when Array then value.map { |item| canonical(item) }
      else value
      end
    end

    def identity(value)
      Files.hash(JSON.generate(canonical(value),allow_nan: false,max_nesting: 100))
    end

    def same(left, right, code = "BASEROW_CUSTOMER_BINDING_CHANGED")
      Files.need(identity(left) == identity(right),code)
    end

    def limit(name)
      case name
      when "source.json", "attachments.json", MANIFEST then MAX_METADATA
      when "dataset/session.json" then 4096
      when /\Adataset\/pages\/[0-9]{5}\.json\z/ then 2_101_248
      when "dataset/manifest.json" then 4_194_304
      when "dataset/dataset.jsonl", "dataset/dataset.csv", "dataset/review.html" then 268_435_456
      when /\Aattachments\/attachment-[0-9]{6}\.bin\z/ then 33_554_432
      else raise Error, "BASEROW_CUSTOMER_FILE_NAME_INVALID"
      end
    end

    def descriptor(value)
      Files.need(value.is_a?(Hash) && value["name"].is_a?(String) &&
        value["bytes"].is_a?(Integer) && value["bytes"].between?(0,limit(value["name"])) &&
        HASH.match?(value["sha256"].to_s), "BASEROW_CUSTOMER_FILE_DESCRIPTOR_INVALID")
      value.slice("name","bytes","sha256")
    end

    def parent(root, name, create: false)
      parts = name.split("/")
      Files.need(parts.none? { |part| part.empty? || part == "." || part == ".." } &&
        !name.start_with?("/") && !name.include?("\\") && !name.include?("\0"),
        "BASEROW_CUSTOMER_RELATIVE_FILE_REQUIRED")
      parts[0...-1].inject(root) { |path,part| Files.directory(File.join(path,part),create: create) }
    end

    def snapshot(root, name, expected, &block)
      folder = parent(root,name)
      path = File.join(folder,File.basename(name))
      info = File.lstat(path)
      Files.need(info.file? && !info.symlink? && info.uid == Process.uid &&
        (info.mode & 0077).zero? && info.nlink == 1, "BASEROW_CUSTOMER_PRIVATE_FILE_REQUIRED")
      DatasetDelivery.snapshot_file(path,expected,&block)
    end

    def json(root, name, expected, decimals: false)
      snapshot(root,name,expected) { |stream| Files.parse(stream.read,decimals: decimals) }
    end

    def copy_file(source, destination, name, expected)
      folder = parent(destination,name,create: true)
      path = File.join(folder,File.basename(name))
      if File.exist?(path) || File.symlink?(path)
        snapshot(destination,name,expected) { |_stream| }
        return
      end
      temporary = Tempfile.new([".baserow-copy-", ".pending"],folder)
      begin
        temporary.binmode
        snapshot(source,name,expected) do |stream|
          while (chunk = stream.read(1_048_576))
            offset = 0
            while offset < chunk.bytesize
              wrote = temporary.write(chunk.byteslice(offset,chunk.bytesize-offset))
              Files.need(wrote && wrote > 0,"BASEROW_CUSTOMER_COPY_INCOMPLETE")
              offset += wrote
            end
          end
        end
        temporary.flush
        temporary.fsync
        temporary.close
        begin
          File.link(temporary.path,path)
          Files.sync(folder)
        rescue Errno::EEXIST
          snapshot(destination,name,expected) { |_stream| }
        end
      ensure
        temporary.close!
      end
    end

    def separate(source,destination)
      Files.need(source != destination && !destination.start_with?(source+"/") &&
        !source.start_with?(destination+"/"),"BASEROW_CUSTOMER_SEPARATE_DIRECTORY_REQUIRED")
    end

    def freeze(value)
      DatasetDelivery.freeze_value(value)
    end
  end

  class BaserowCustomerPackage
    MANIFEST = BaserowCustomerFiles::MANIFEST
    attr_reader :directory, :manifest, :manifest_sha256, :source, :attachments, :native_manifest

    def self.open(directory:, expected_manifest_sha256:)
      Files.need(HASH.match?(expected_manifest_sha256.to_s),"BASEROW_CUSTOMER_MANIFEST_SHA256_REQUIRED")
      root = Files.directory(directory)
      raw = Files.read(File.join(root,MANIFEST),BaserowCustomerFiles::MAX_METADATA)
      Files.need(Files.hash(raw) == expected_manifest_sha256,"BASEROW_CUSTOMER_MANIFEST_CHANGED")
      new(root,raw)
    end

    def initialize(directory,raw)
      @directory,@manifest_bytes = directory.freeze,raw.dup.freeze
      @manifest_sha256 = Files.hash(raw).freeze
      @manifest = Files.parse(raw)
      m = @manifest
      Files.need(m.is_a?(Hash) && m["schema"] == BaserowCustomerFiles::SCHEMA &&
        BaserowCustomerFiles::UUID.match?(m["requestId"].to_s) && INTENT.match?(m["customerKey"].to_s) &&
        HASH.match?(m["logicalSourceSha256"].to_s) && m["sourceKey"] == "baserow-"+m["logicalSourceSha256"] &&
        BaserowCustomerFiles::FIELD.match?(m["recordIdColumn"].to_s) &&
        m["source"].is_a?(Hash) && m["source"]["file"] == "source.json" &&
        m["attachments"].is_a?(Hash) && m["attachments"]["file"] == "attachments.json" &&
        m["dataset"].is_a?(Hash) && m["dataset"]["directory"] == "dataset" &&
        %w[manifestSha256 snapshot querySha256 chainDigest].all? { |key| HASH.match?(m["dataset"][key].to_s) } &&
        m["dataset"]["rows"].is_a?(Integer) && m["dataset"]["rows"].between?(0,1_000_000) &&
        m["dataset"]["pages"].is_a?(Integer) && m["dataset"]["pages"].between?(1,4096) &&
        m["dataset"]["fields"].is_a?(Array) && m["dataset"]["fields"].length.between?(1,64) &&
        m["dataset"]["fields"].uniq == m["dataset"]["fields"] &&
        m["dataset"]["fields"].all? { |field| BaserowCustomerFiles::FIELD.match?(field.to_s) } &&
        m["files"].is_a?(Array) && m["files"].length.between?(8,BaserowCustomerFiles::MAX_FILES),
        "BASEROW_CUSTOMER_MANIFEST_INVALID")
      @files,total = {},0
      m["files"].each do |raw_file|
        file = BaserowCustomerFiles.descriptor(raw_file)
        Files.need(!@files.key?(file["name"]),"BASEROW_CUSTOMER_DUPLICATE_FILE")
        @files[file["name"]] = file
        total += file["bytes"]
        Files.need(total <= BaserowCustomerFiles::MAX_BYTES,"BASEROW_CUSTOMER_BYTE_LIMIT")
        BaserowCustomerFiles.snapshot(@directory,file["name"],file) { |_stream| }
      end
      %w[source attachments].each do |kind|
        item = m.fetch(kind)
        file = @files.fetch(item["file"]) { raise Error,"BASEROW_CUSTOMER_METADATA_MISSING" }
        Files.need(file["bytes"] == item["bytes"] && file["sha256"] == item["sha256"],
          "BASEROW_CUSTOMER_METADATA_CHANGED")
      end
      Files.need(@files.dig("dataset/manifest.json","sha256") == m["dataset"]["manifestSha256"],
        "BASEROW_CUSTOMER_NATIVE_MANIFEST_CHANGED")
      @source = file_json("source.json")
      @attachments = file_json("attachments.json")
      @native_manifest = file_json("dataset/manifest.json")
      validate_source!
      validate_native_metadata!
      validate_attachments!
      validate_selected_rows!
      [@manifest,@files,@source,@attachments,@native_manifest,@attachment_files,@attachment_refs].each {
        |value| BaserowCustomerFiles.freeze(value)
      }
    end
    private_class_method :new

    def file_descriptor(name)
      @files.fetch(name) { raise Error,"BASEROW_CUSTOMER_FILE_NOT_FOUND" }
    end

    def with_file(name,&block)
      BaserowCustomerFiles.snapshot(@directory,name,file_descriptor(name),&block)
    end

    def file_json(name, decimals: false)
      with_file(name) { |stream| Files.parse(stream.read,decimals: decimals) }
    end

    def attachment_page(offset: 0, limit: 100)
      Files.need(offset.is_a?(Integer) && offset >= 0 && limit.is_a?(Integer) &&
        limit.between?(1,1000),"BASEROW_CUSTOMER_ATTACHMENT_PAGE_INVALID")
      files = attachments.fetch("files")
      page = files.slice(offset,limit) || []
      next_offset = offset+page.length < files.length ? offset+page.length : nil
      {"schema"=>"stellar-forge.baserow-customer-attachment-page.v1","offset"=>offset,"limit"=>limit,
        "total"=>files.length,"next_offset"=>next_offset,"nextOffset"=>next_offset,
        "files"=>page.map { |file| file.merge(
          "filename"=>file.fetch("references").first.fetch("name"),
          "mime_type"=>file.fetch("source").fetch("mimeType"),
          "reference_count"=>file.fetch("references").length,
          "references"=>file.fetch("references").map { |ref| ref.merge("record_id"=>ref.fetch("recordId")) }) },
        "customerManifestSha256"=>manifest_sha256}
    end

    # The caller selects an actual row and output alias. Shared storage bytes
    # retain every original row/field/index link and that link's visible name.
    def attachment(file:, record_id:, column:)
      Files.need(block_given?,"BASEROW_CUSTOMER_ATTACHMENT_BLOCK_REQUIRED")
      selected = @attachment_files.fetch(file) { raise Error,"BASEROW_CUSTOMER_ATTACHMENT_NOT_FOUND" }
      references = selected.fetch("references").select { |ref| ref["recordId"] == record_id && ref["column"] == column }
      Files.need(!references.empty?,"BASEROW_CUSTOMER_ATTACHMENT_ROW_NOT_FOUND")
      metadata = {"file"=>file,"bytes"=>selected["bytes"],"sha256"=>selected["sha256"],
        "source"=>selected["source"],"references"=>references.map { |ref| ref.merge("record_id"=>ref["recordId"]) },
        "name"=>references.first.fetch("name"),"mimeType"=>selected.fetch("source").fetch("mimeType"),
        "filename"=>references.first.fetch("name"),"mime_type"=>selected.fetch("source").fetch("mimeType"),
        "customerManifestSha256"=>manifest_sha256}
      with_file(file) { |io| yield io,BaserowCustomerFiles.freeze(metadata) }
    end

    def copy_to(destination)
      target = Files.directory(destination,create: true)
      BaserowCustomerFiles.separate(directory,target)
      Files.lock(target) do
        Files.once(File.join(target,"customer-copy.json"),Files.json({
          "schema"=>"stellar-forge.baserow-customer-copy.v1","manifestSha256"=>manifest_sha256}))
        @files.each { |name,file| BaserowCustomerFiles.copy_file(directory,target,name,file) }
        Files.once(File.join(target,MANIFEST),@manifest_bytes)
      end
      self.class.open(directory: target,expected_manifest_sha256: manifest_sha256)
    end

    def verify!
      self.class.open(directory: directory,expected_manifest_sha256: manifest_sha256)
    end

    private

    def validate_source!
      s,m = source,manifest
      Files.need(s.is_a?(Hash) && s["schema"] == "stellar-forge.baserow-customer-source.v1" &&
        s["customerKey"] == m["customerKey"] && s["sourceKey"] == m["sourceKey"] &&
        s["logicalSourceSha256"] == m["logicalSourceSha256"] && s["recordIdColumn"] == m["recordIdColumn"] &&
        s["logicalSource"].is_a?(Hash) && s["logicalSource"]["provider"] == "baserow" &&
        BaserowCustomerFiles.identity(s["logicalSource"]) == m["logicalSourceSha256"],
        "BASEROW_CUSTOMER_SOURCE_BINDING_CHANGED")
      logical = s.fetch("logicalSource")
      Files.need(%w[public-grid table].include?(logical["kind"]) &&
        logical["server"].is_a?(String) && !logical["server"].empty? &&
        BaserowCustomerFiles::FIELD.match?(logical["queryName"].to_s) &&
        logical["orderBy"].is_a?(Array) && logical["columns"].is_a?(Array) &&
        logical["columns"].all? { |item| item.is_a?(Hash) } &&
        logical["columns"].map { |item| item["name"] } == m["dataset"]["fields"],
        "BASEROW_CUSTOMER_LOGICAL_SOURCE_INVALID")
      server = URI.parse(logical["server"])
      Files.need(%w[http https].include?(server.scheme) && server.host && !server.userinfo &&
        server.query.nil? && server.fragment.nil?,"BASEROW_CUSTOMER_SERVER_INVALID")
      if logical["kind"] == "public-grid"
        Files.need(/\A[A-Za-z0-9_-]{1,256}\z/.match?(logical["slug"].to_s) &&
          logical["tableId"].nil? && logical["viewId"].nil?,"BASEROW_CUSTOMER_PUBLIC_ID_CHANGED")
      else
        Files.need(logical["slug"].nil? && logical["tableId"].is_a?(Integer) && logical["tableId"] > 0 &&
          (logical["viewId"].nil? || logical["viewId"].is_a?(Integer) && logical["viewId"] > 0),
          "BASEROW_CUSTOMER_TABLE_ID_CHANGED")
      end
      @columns = logical["columns"].to_h { |item| [item.fetch("name"),item] }
      @columns.each do |name,item|
        Files.need(BaserowCustomerFiles::FIELD.match?(name) &&
          %w[string integer number boolean].include?(item["type"]) &&
          [true,false].include?(item["nullable"]) &&
          %w[preserve null].include?(item["empty"]) &&
          %w[native identity-text number-text decimal-number json-text select-value attachments].include?(item["encoding"]) &&
          (["$recordId","$order"].include?(item["source"]) || /\Afield_[1-9][0-9]{0,14}\z/.match?(item["source"].to_s)),
          "BASEROW_CUSTOMER_PROJECTION_INVALID")
      end
      key = @columns[m["recordIdColumn"]]
      Files.need(key && key["source"] == "$recordId" && key["type"] == "string" &&
        key["encoding"] == "identity-text" && key["nullable"] == false,
        "BASEROW_CUSTOMER_ORIGINAL_KEY_REQUIRED")
      publication,capture,query = s["publication"],s["capture"],s["query"]
      Files.need(publication.is_a?(Hash) && publication["state"] == "PUBLISHED" &&
        BaserowCustomerFiles::UUID.match?(publication["runId"].to_s) &&
        publication["planId"].is_a?(Integer) && publication["planId"] > 0 &&
        %w[planDigest sourceHash runtimeSourceHash queryHash candidateDigest csvSha256 datasetConfigSha256].all? {
          |key| HASH.match?(publication[key].to_s) } && publication["snapshot"] == m["dataset"]["snapshot"] &&
        capture.is_a?(Hash) && %w[sha256 selectionSha256 schemaSha256 recordIdentitiesSha256].all? {
          |key| HASH.match?(capture[key].to_s) } &&
        capture["atomicSourceSnapshot"] == false && capture["responseKind"] == "PAGED_TABLE_READ" &&
        capture["rows"].is_a?(Integer) && capture["rows"] >= m["dataset"]["rows"] &&
        capture["pages"].is_a?(Integer) && capture["pages"] >= 1 &&
        query.is_a?(Hash) && query["querySha256"] == m["dataset"]["querySha256"] &&
        query["fields"] == m["dataset"]["fields"],"BASEROW_CUSTOMER_ORIGINAL_EDITION_CHANGED")
      Files.need(s["originalFields"].is_a?(Array) && s["originalFields"].all? { |field| field.is_a?(Hash) },
        "BASEROW_CUSTOMER_FIELD_DEFINITIONS_REQUIRED")
      fields = s["originalFields"].to_h { |field| [field["id"],field] }
      @columns.each_value do |column|
        next if column["source"].start_with?("$")
        original = fields[column["source"].delete_prefix("field_").to_i]
        Files.need(original && original["type"] == column["providerType"],
          "BASEROW_CUSTOMER_FIELD_DEFINITION_CHANGED")
      end
      BaserowCustomerFiles.freeze(@columns)
    rescue URI::InvalidURIError
      raise Error,"BASEROW_CUSTOMER_SERVER_INVALID"
    end

    def validate_native_metadata!
      native,m = @native_manifest,manifest
      Files.need(native.is_a?(Hash) && native["schema"] == "stellar-forge.buyer-delivery-manifest.v1" &&
        native["dataset"].is_a?(Hash) && native["dataset"]["snapshot"] == m["dataset"]["snapshot"] &&
        native["dataset"]["rows"] == m["dataset"]["rows"] &&
        native["dataset"]["projectedFields"] == m["dataset"]["fields"] &&
        native["dataset"]["originalQueryHash"] == m["dataset"]["querySha256"] &&
        native["chainDigest"] == m["dataset"]["chainDigest"] &&
        native["sourcePages"].is_a?(Array) && native["sourcePages"].length == m["dataset"]["pages"] &&
        native["outputs"].is_a?(Hash) && native["outputs"].keys.sort == %w[dataset.csv dataset.jsonl review.html] &&
        !native.key?("semantics"),"BASEROW_CUSTOMER_NATIVE_MANIFEST_CHANGED")
      BaserowCustomerFiles.same(native["dataset"]["filters"],source["query"]["filters"])
      BaserowCustomerFiles.same(native["dataset"]["ranges"],source["query"]["ranges"])
      BaserowCustomerFiles.same(native["dataset"]["order"],source["query"]["order"])
      native["outputs"].each do |name,value|
        expected = @files.fetch("dataset/"+name) { raise Error,"BASEROW_CUSTOMER_NATIVE_OUTPUT_MISSING" }
        Files.need(value == expected.slice("bytes","sha256"),"BASEROW_CUSTOMER_NATIVE_OUTPUT_CHANGED")
      end
      session = file_json("dataset/session.json")
      Files.need(session["schema"] == "stellar-forge.buyer-delivery.v1","BASEROW_CUSTOMER_NATIVE_SESSION_CHANGED")
      @required = %w[source.json attachments.json dataset/session.json dataset/manifest.json
        dataset/dataset.jsonl dataset/dataset.csv dataset/review.html] +
        Array.new(m["dataset"]["pages"]) { |index| format("dataset/pages/%05d.json",index) }
      previous_cursor,count = nil,0
      native["sourcePages"].each_with_index do |original,index|
        archive = file_json(format("dataset/pages/%05d.json",index),decimals: true)
        payload = archive["payload"]
        Files.need(original["index"] == index && archive["index"] == index &&
          archive["schema"] == "stellar-forge.buyer-page-archive.v1" && payload.is_a?(Hash) &&
          payload["schema"] == "stellar-forge.dataset-page.v1" &&
          archive["chain"] == original["recordDigest"] && archive["intent"] == original["intent"] &&
          archive["sourceSha256"] == original["sourceSha256"] &&
          archive["evidenceSha256"] == original["evidenceSha256"] &&
          archive["requestCursor"] == previous_cursor && original["requestedCursor"] == previous_cursor &&
          payload.dig("dataset","snapshot") == m["dataset"]["snapshot"] &&
          payload["fields"] == m["dataset"]["fields"] &&
          payload["page"].is_a?(Hash) && payload["page"]["total"] == m["dataset"]["rows"] &&
          payload["rows"].is_a?(Array) && payload["rows"].length == original["rows"] &&
          payload["rows"].length == payload["page"]["returned"],
          "BASEROW_CUSTOMER_NATIVE_PAGE_CHANGED")
        previous_cursor = payload["page"]["nextCursor"]
        count += payload["rows"].length
      end
      Files.need(previous_cursor.nil? && count == m["dataset"]["rows"],
        "BASEROW_CUSTOMER_NATIVE_PAGES_INCOMPLETE")
    end

    def validate_attachments!
      a,m = attachments,manifest
      Files.need(a.is_a?(Hash) && a["schema"] == "stellar-forge.baserow-customer-attachments.v1" &&
        a["captureSha256"] == source["capture"]["sha256"] &&
        a["logicalSourceSha256"] == m["logicalSourceSha256"] &&
        a["recordIdColumn"] == m["recordIdColumn"] && a["files"].is_a?(Array) &&
        a["files"].length <= 10000,"BASEROW_CUSTOMER_ATTACHMENT_MANIFEST_CHANGED")
      @attachment_files,@attachment_refs = {},{}
      total,count = 0,0
      a["files"].each do |file|
        Files.need(file.is_a?(Hash) && /\Aattachment-[0-9]{6}\.bin\z/.match?(file["originalFile"].to_s) &&
          file["file"] == "attachments/"+file["originalFile"] && !@attachment_files.key?(file["file"]) &&
          file["bytes"].is_a?(Integer) && file["bytes"].between?(0,33_554_432) && HASH.match?(file["sha256"].to_s) &&
          file["source"].is_a?(Hash) && file["source"]["declaredBytes"] == file["bytes"] &&
          %w[url storageName mimeType].all? { |key| file["source"][key].is_a?(String) } &&
          file["references"].is_a?(Array) && !file["references"].empty?,
          "BASEROW_CUSTOMER_ATTACHMENT_FILE_INVALID")
        expected = @files.fetch(file["file"]) { raise Error,"BASEROW_CUSTOMER_ATTACHMENT_FILE_MISSING" }
        Files.need(expected.slice("bytes","sha256") == file.slice("bytes","sha256"),
          "BASEROW_CUSTOMER_ATTACHMENT_FILE_CHANGED")
        @attachment_files[file["file"]] = file
        total += file["bytes"]
        @required << file["file"]
        file["references"].each do |ref|
          spec = ref.is_a?(Hash) && @columns[ref["column"]]
          Files.need(ref.is_a?(Hash) && /\A[1-9][0-9]*\z/.match?(ref["recordId"].to_s) &&
            spec && spec["source"] == ref["field"] && spec["encoding"] == "attachments" &&
            spec["providerType"] == "file" && ref["index"].is_a?(Integer) && ref["index"] >= 0 &&
            ref["name"].is_a?(String),"BASEROW_CUSTOMER_ATTACHMENT_REFERENCE_INVALID")
          key = [ref["recordId"],ref["column"],ref["index"]]
          Files.need(!@attachment_refs.key?(key),"BASEROW_CUSTOMER_DUPLICATE_ATTACHMENT_REFERENCE")
          @attachment_refs[key] = {"file"=>file,"reference"=>ref}
          count += 1
        end
      end
      Files.need(a["files"].length == m["attachments"]["count"] && total == m["attachments"]["totalBytes"] &&
        count == m["attachments"]["referenceCount"] && @required.sort == @files.keys.sort,
        "BASEROW_CUSTOMER_COMPLETE_FILE_SET_CHANGED")
    end

    def validate_selected_rows!
      seen,seen_refs = Set.new,Set.new
      with_file("dataset/dataset.jsonl") do |stream|
        stream.each_line do |raw|
          Files.need(raw.end_with?("\n") && raw.bytesize <= 8_388_608,"BASEROW_CUSTOMER_COMPLETE_ROW_INVALID")
          row = Files.parse(raw,decimals: true)
          Files.need(row.is_a?(Hash) && row.keys.sort == manifest["dataset"]["fields"].sort,
            "BASEROW_CUSTOMER_ROW_FIELDS_CHANGED")
          id = row[manifest["recordIdColumn"]]
          Files.need(id.is_a?(String) && /\A[1-9][0-9]*\z/.match?(id) && !seen.include?(id),
            "BASEROW_CUSTOMER_RECORD_ID_CHANGED")
          seen << id
          @columns.each do |name,spec|
            next unless spec["encoding"] == "attachments"
            next if row[name].nil?
            Files.need(row[name].is_a?(String),"BASEROW_CUSTOMER_ATTACHMENT_VALUE_INVALID")
            values = Files.parse(row[name])
            Files.need(values.is_a?(Array),"BASEROW_CUSTOMER_ATTACHMENT_VALUE_INVALID")
            values.each_with_index do |value,index|
              key = [id,name,index]
              retained = @attachment_refs[key]
              Files.need(retained && !seen_refs.include?(key),"BASEROW_CUSTOMER_ATTACHMENT_ROW_CHANGED")
              file,ref = retained.fetch("file"),retained.fetch("reference")
              Files.need(value.is_a?(Hash) && value["name"] == ref["name"] &&
                value["storageName"] == file["source"]["storageName"] &&
                value["mimeType"] == file["source"]["mimeType"] && value["sourceUrl"] == file["source"]["url"] &&
                value["bytes"] == file["bytes"] && value["sha256"] == file["sha256"],
                "BASEROW_CUSTOMER_ATTACHMENT_VALUE_CHANGED")
              seen_refs << key
            end
          end
        end
      end
      Files.need(seen.length == manifest["dataset"]["rows"] && seen_refs.length == @attachment_refs.length,
        "BASEROW_CUSTOMER_COMPLETE_ROWS_CHANGED")
    end
  end

  class BaserowCustomerDelivery
    MANIFEST = "baserow-delivery.json"
    SCHEMA = "stellar-forge.ruby-baserow-customer-delivery.v1"
    attr_reader :directory, :manifest, :manifest_sha256, :dataset, :customer_package

    def self.open(directory:, expected_manifest_sha256:)
      Files.need(HASH.match?(expected_manifest_sha256.to_s),"BASEROW_CUSTOMER_MANIFEST_SHA256_REQUIRED")
      root = Files.directory(directory)
      raw = Files.read(File.join(root,MANIFEST),1_048_576)
      Files.need(Files.hash(raw) == expected_manifest_sha256,"BASEROW_CUSTOMER_DELIVERY_MANIFEST_CHANGED")
      new(root,raw)
    end

    def initialize(directory, raw)
      @directory,@manifest_bytes = directory.freeze,raw.dup.freeze
      @manifest_sha256 = Files.hash(raw).freeze
      @manifest = Files.parse(raw)
      m = @manifest
      Files.need(m.is_a?(Hash) && m["schema"] == SCHEMA &&
        INTENT.match?(m["datasetId"].to_s) && INTENT.match?(m["sourceKey"].to_s) &&
        m["customer"].is_a?(Hash) && m["customer"]["directory"] == "customer" &&
        m["customer"]["manifest"] == BaserowCustomerPackage::MANIFEST &&
        HASH.match?(m["customer"]["manifestSha256"].to_s) &&
        m["dataset"].is_a?(Hash) && m["dataset"]["directory"] == "dataset" &&
        HASH.match?(m["dataset"]["manifestSha256"].to_s) &&
        HASH.match?(m["requestSha256"].to_s),"BASEROW_CUSTOMER_DELIVERY_MANIFEST_INVALID")
      @customer_package = BaserowCustomerPackage.open(directory: File.join(directory,"customer"),
        expected_manifest_sha256: m["customer"]["manifestSha256"])
      @dataset = DatasetDelivery.open(File.join(directory,"dataset"),
        expected_manifest_sha256: m["dataset"]["manifestSha256"])
      Files.need(dataset.is_a?(NativeDatasetDelivery) && dataset.manifest["datasetId"] == m["datasetId"] &&
        dataset.manifest["sourceKey"] == m["sourceKey"] &&
        customer_package.manifest["sourceKey"] == m["sourceKey"] &&
        dataset.source_sha256 == customer_package.manifest["dataset"]["manifestSha256"] &&
        dataset.row_count == customer_package.manifest["dataset"]["rows"] &&
        dataset.snapshot == customer_package.manifest["dataset"]["snapshot"] &&
        dataset.fields == customer_package.manifest["dataset"]["fields"] &&
        dataset.native_manifest["dataset"]["originalQueryHash"] == customer_package.manifest["dataset"]["querySha256"] &&
        dataset.native_manifest["chainDigest"] == customer_package.manifest["dataset"]["chainDigest"],
        "BASEROW_CUSTOMER_ORIGINAL_DATASET_CHANGED")
      %w[manifest.json dataset.jsonl dataset.csv review.html session.json].each do |name|
        original = customer_package.file_descriptor("dataset/"+name)
        actual = dataset.descriptor(name)
        Files.need(original.slice("bytes","sha256") == actual.slice("bytes","sha256"),
          "BASEROW_CUSTOMER_RECEIVED_FILE_CHANGED")
      end
      dataset.native_manifest.fetch("sourcePages").each_index do |index|
        name = format("pages/%05d.json",index)
        Files.need(customer_package.file_descriptor("dataset/"+name).slice("bytes","sha256") ==
          dataset.descriptor(name).slice("bytes","sha256"),"BASEROW_CUSTOMER_RECEIVED_PAGE_CHANGED")
      end
      BaserowCustomerFiles.freeze(@manifest)
    end
    private_class_method :new

    def source
      customer_package.source
    end

    def attachments
      customer_package.attachments
    end

    def attachment_page(**options)
      customer_package.attachment_page(**options)
    end

    def attachment(**options,&block)
      customer_package.attachment(**options,&block)
    end

    def copy_to(destination)
      target = Files.directory(destination,create: true)
      BaserowCustomerFiles.separate(directory,target)
      Files.lock(target) do
        Files.once(File.join(target,"baserow-copy.json"),Files.json({
          "schema"=>"stellar-forge.ruby-baserow-copy.v1","manifestSha256"=>manifest_sha256}))
        customer_package.copy_to(File.join(target,"customer"))
        dataset.copy_to(File.join(target,"dataset"))
        Files.once(File.join(target,MANIFEST),@manifest_bytes)
      end
      self.class.open(directory: target,expected_manifest_sha256: manifest_sha256)
    end
  end
end
