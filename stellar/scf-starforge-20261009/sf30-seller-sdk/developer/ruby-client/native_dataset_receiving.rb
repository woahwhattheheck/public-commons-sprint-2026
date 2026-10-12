# frozen_string_literal: true
# MIT. Reuse the original Python SF100 scanner/receiver, then retain a complete
# portable Ruby customer edition. This operation only reads the finalized room.
require_relative "native_dataset"
require "time"

module Starforge
  class NativeDatasetReceiving
    RESULT_SCHEMA = "stellar-forge.ruby-native-dataset-received.v1"
    PYTHON_ROOT = "stellar/scf-starforge-20261009/sf88-operator-buyer-cli/python"
    NATIVE_ROOT = "stellar/scf-starforge-20261009/sf88-operator-buyer-cli"
    ENTRY = PYTHON_ROOT + "/native-dataset-receive.py"
    attr_reader :directory

    def self.selected_request(directory)
      root = Files.directory(directory)
      bytes = Files.read(File.join(root,"request.json"),1_048_576)
      request = Files.parse(bytes)
      Files.need(request.is_a?(Hash) && request["schema"] == NativeDatasetDelivery::SELECTION_SCHEMA &&
        request["sourceFormat"] == "SF100_SCAN" &&
        %w[datasetId sourceKey].all? { |key| INTENT.match?(request[key].to_s) } &&
        HASH.match?(request["nativeManifestSha256"].to_s), "RUBY_NATIVE_DATASET_REQUEST_INVALID")
      [root,request,bytes]
    end

    # A completed business operation opens from its own received bytes. Neither
    # the original room nor the original runtime has to remain mounted.
    def self.received(directory:, expected_manifest_sha256: nil)
      root,request,bytes = selected_request(directory)
      receipt = Files.parse(Files.read(File.join(root,"received.json"),1_048_576))
      Files.need(receipt.is_a?(Hash) && receipt["schema"] == RESULT_SCHEMA &&
        receipt["requestSha256"] == Files.hash(bytes) && receipt["datasetId"] == request["datasetId"] &&
        receipt["sourceKey"] == request["sourceKey"] && receipt["sourceId"] == request["nativeManifestSha256"] &&
        receipt["directory"] == File.join(root,"received") &&
        HASH.match?(receipt["manifestSha256"].to_s) &&
        (expected_manifest_sha256.nil? || expected_manifest_sha256 == receipt["manifestSha256"]),
        "RUBY_NATIVE_DATASET_BUSINESS_RECEIPT_CHANGED")
      delivery = DatasetDelivery.open(receipt["directory"],expected_manifest_sha256: receipt["manifestSha256"])
      Files.need(delivery.is_a?(NativeDatasetDelivery) &&
        delivery.file_bytes("selection.json",limit: 1_048_576) == bytes &&
        delivery.manifest["datasetId"] == request["datasetId"] &&
        delivery.manifest["sourceKey"] == request["sourceKey"] &&
        delivery.source_sha256 == request["nativeManifestSha256"] &&
        delivery.descriptor("native-receiving.json")["sha256"] == receipt["nativeReceiptSha256"],
        "RUBY_NATIVE_DATASET_BUSINESS_DELIVERY_CHANGED")
      delivery
    end

    def self.resume(directory:, cancel: nil, timeout: 1800)
      root,request,_bytes = selected_request(directory)
      return received(directory: root) if File.exist?(File.join(root,"received.json"))
      receiver = allocate
      receiver.send(:initialize_retained,root,request,_bytes)
      receiver.receive(cancel: cancel,timeout: timeout)
    end

    def self.status(directory:)
      root,request,bytes = selected_request(directory)
      if File.exist?(File.join(root,"received.json"))
        delivery = received(directory: root)
        return {"schema"=>RESULT_SCHEMA,"state"=>"RECEIVED","directory"=>root,
          "requestSha256"=>Files.hash(bytes),"datasetId"=>request["datasetId"],"sourceKey"=>request["sourceKey"],
          "delivery"=>delivery.directory,"manifestSha256"=>delivery.manifest_sha256,
          "sourceId"=>delivery.source_sha256,"rowCount"=>delivery.row_count,"fields"=>delivery.fields,
          "membership"=>delivery.membership,"files"=>delivery.manifest["files"]}
      end
      {"schema"=>RESULT_SCHEMA,"state"=>File.exist?(File.join(root,"native-receiving.json")) ?
        "NATIVE_RECEIVED" : "PREPARED","directory"=>root,"requestSha256"=>Files.hash(bytes),
        "datasetId"=>request["datasetId"],"sourceKey"=>request["sourceKey"],
        "sourceId"=>request["nativeManifestSha256"]}
    end

    def self.executable(path)
      Files.need(path.is_a?(String) && File.absolute_path(path) == path &&
        !path.include?("\0"), "RUBY_NATIVE_DATASET_EXECUTABLE_REQUIRED")
      real = File.realpath(path)
      Files.need(File.file?(real) && File.executable?(real), "RUBY_NATIVE_DATASET_EXECUTABLE_REQUIRED")
      real
    end

    # Retain the selected original source modules, not a regenerated receiver.
    # The checks bracket the read-only call. Completed packets need no runtime.
    def self.runtime_binding(checkout, python, node)
      checkout = Files.directory(checkout,private: false)
      paths = [ENTRY,"stellar/scf-starforge-20261009/sf100-buyer-dataset-delivery/deliver.mjs"]
      [[NATIVE_ROOT,".mjs"],[PYTHON_ROOT,".mjs"],[PYTHON_ROOT+"/stellar_forge_buyer",".py"]].each do |relative,suffix|
        root = Files.directory(File.join(checkout,relative),private: false)
        Dir.children(root).sort.each do |name|
          paths << relative+"/"+name if name.end_with?(suffix) && /\A[A-Za-z0-9_][A-Za-z0-9_.-]*\z/.match?(name)
        end
      end
      files = paths.uniq.sort.map do |name|
        raw = Files.read(File.join(checkout,name))
        {"name"=>name,"bytes"=>raw.bytesize,"sha256"=>Files.hash(raw)}
      end
      {"directory"=>checkout,"python"=>executable(python),"node"=>executable(node),"files"=>files}
    end

    def initialize(directory:, room:, source_key:, dataset_id:, expected_native_manifest_sha256:,
      checkout:, python:, node:)
      Files.need(INTENT.match?(source_key.to_s) && INTENT.match?(dataset_id.to_s) &&
        HASH.match?(expected_native_manifest_sha256.to_s), "RUBY_NATIVE_DATASET_SELECTION_REQUIRED")
      @room = Files.directory(room)
      Files.directory(File.join(@room,"pages"))
      original = Files.read(File.join(@room,"manifest.json"),4_194_304)
      Files.need(Files.hash(original) == expected_native_manifest_sha256, "RUBY_NATIVE_DATASET_SOURCE_MANIFEST_CHANGED")
      @runtime = self.class.runtime_binding(checkout,python,node)
      @request = {"schema"=>NativeDatasetDelivery::SELECTION_SCHEMA,"sourceFormat"=>"SF100_SCAN",
        "sourceKey"=>source_key,"datasetId"=>dataset_id,"room"=>@room,
        "nativeManifestSha256"=>expected_native_manifest_sha256,"runtime"=>@runtime}
      @request_bytes = Files.json(@request).freeze
      Files.need(@request_bytes.bytesize <= 1_048_576, "RUBY_NATIVE_DATASET_RUNTIME_SELECTION_LIMIT")
      @request_sha256 = Files.hash(@request_bytes).freeze
      @directory = Files.directory(directory,create: true)
      Files.need(@directory != @room && !@directory.start_with?(@room+File::SEPARATOR) &&
        !@room.start_with?(@directory+File::SEPARATOR), "RUBY_NATIVE_DATASET_SEPARATE_RECEIVING_DIRECTORY_REQUIRED")
      Files.lock(@directory) do
        Files.once(File.join(@directory,"request.json"),@request_bytes)
        Files.directory(File.join(@directory,"attempts"),create: true)
        Files.directory(File.join(@directory,"received"),create: true)
      end
      DatasetDelivery.freeze_value(@request)
      DatasetDelivery.freeze_value(@runtime)
    end

    def same_request!
      Files.need(Files.read(File.join(@directory,"request.json"),1_048_576) == @request_bytes,
        "RUBY_NATIVE_DATASET_REQUEST_CHANGED")
    end

    def receive(cancel: nil, timeout: 1800)
      Files.lock(@directory) do
        same_request!
        return self.class.received(directory: @directory) if File.exist?(File.join(@directory,"received.json"))
        receipt_path = File.join(@directory,"native-receiving.json")
        unless File.exist?(receipt_path)
          Files.need(self.class.runtime_binding(@runtime["directory"],@runtime["python"],@runtime["node"]) == @runtime,
            "RUBY_NATIVE_DATASET_RUNTIME_CHANGED")
          Files.need(Files.hash(Files.read(File.join(@room,"manifest.json"),4_194_304)) ==
            @request["nativeManifestSha256"], "RUBY_NATIVE_DATASET_SOURCE_MANIFEST_CHANGED")
          attempt = Files.directory(File.join(@directory,"attempts",SecureRandom.uuid),create: true)
          Files.once(File.join(attempt,"attempt.json"),Files.json({"schema"=>"stellar-forge.ruby-native-dataset-read.v1",
            "requestSha256"=>@request_sha256,"startedAt"=>Time.now.utc.iso8601(6)}))
          environment = {"LANG"=>"C.UTF-8","LC_ALL"=>"C.UTF-8","TZ"=>"UTC"}
          run = Runner.new(node: @runtime["python"],environment: environment).run(
            File.join(@runtime["directory"],ENTRY),
            ["--room",@room,"--node",@runtime["node"]],interpreter_arguments: ["-I","-B"],
            process_group: true,timeout: timeout,limit: 16_777_216,cancel: cancel)
          Files.once(File.join(attempt,"stdout.json"),run[:stdout])
          Files.once(File.join(attempt,"stderr.json"),run[:stderr])
          Files.once(File.join(attempt,"result.json"),Files.json({
            "schema"=>"stellar-forge.ruby-native-dataset-read-result.v1","requestSha256"=>@request_sha256,
            "exitStatus"=>run[:status].exitstatus,"termSignal"=>run[:status].termsig,"error"=>run[:error],
            "stdout"=>{"bytes"=>run[:stdout].bytesize,"sha256"=>Files.hash(run[:stdout])},
            "stderr"=>{"bytes"=>run[:stderr].bytesize,"sha256"=>Files.hash(run[:stderr])},
            "finishedAt"=>Time.now.utc.iso8601(6)}))
          raise Error, run[:error] if run[:error]
          unless run[:status].success?
            native_error = begin
              parsed = Files.parse(run[:stderr])
              parsed.is_a?(Hash) && /\A[A-Z0-9_]{1,120}\z/.match?(parsed["error"].to_s) ? parsed["error"] : nil
            rescue Error
              nil
            end
            raise Error, native_error || "RUBY_NATIVE_DATASET_RECEIVING_FAILED"
          end
          Files.need(self.class.runtime_binding(@runtime["directory"],@runtime["python"],@runtime["node"]) == @runtime,
            "RUBY_NATIVE_DATASET_RUNTIME_CHANGED")
          NativeDatasetDelivery.check_receipt(Files.parse(run[:stdout],decimals: true),
            room: @room,manifest_sha256: @request["nativeManifestSha256"])
          same_request!
          Files.once(receipt_path,run[:stdout])
        end
        raw = Files.read(receipt_path,16_777_216)
        receipt = Files.parse(raw,decimals: true)
        output_names,archive_names = NativeDatasetDelivery.check_receipt(receipt,
          room: @room,manifest_sha256: @request["nativeManifestSha256"])
        native = receipt.fetch("native")
        target = Files.directory(File.join(@directory,"received"))
        files = []
        (output_names+archive_names).each do |name|
          raise Error, "RUBY_NATIVE_CANCELLED" if cancel&.cancelled?
          original = native["outputs"][name] || native["archives"][name]
          descriptor = {"name"=>name,"bytes"=>original["bytes"],"sha256"=>original["sha256"]}
          copy_original(target,name,descriptor)
          files << descriptor
        end
        dictionary = files.find { |item| item["name"] == "semantics.json" }
        semantics = if dictionary
          DatasetDelivery.snapshot_file(File.join(target,"semantics.json"),dictionary) do |stream|
            Files.parse(stream.read,decimals: true)
          end
        end
        source = {"schema"=>NativeDatasetDelivery::SOURCE_SCHEMA,"sourceFormat"=>"SF100_SCAN",
          "sourceKey"=>@request["sourceKey"],"datasetId"=>@request["datasetId"],"originalRoom"=>@room,
          "sourceId"=>receipt["sourceId"],"manifestSha256"=>receipt["manifestSha256"],
          "sourceBindingSha256"=>receipt["sourceBindingSha256"],
          "datasetName"=>native["originalNativeScan"]["name"],"columns"=>receipt["columns"],
          "providerIdentity"=>NativeDatasetDelivery.provider_identity(semantics),"semanticsFile"=>dictionary}
        metadata = {"selection.json"=>@request_bytes,"native-receiving.json"=>raw,"source.json"=>Files.json(source)}
        metadata.each do |name,bytes|
          NativeDatasetDelivery.check_descriptor(name,{"bytes"=>bytes.bytesize,"sha256"=>Files.hash(bytes)})
          Files.once(File.join(target,name),bytes)
          files << {"name"=>name,"bytes"=>bytes.bytesize,"sha256"=>Files.hash(bytes)}
        end
        scan = native.fetch("originalNativeScan")
        manifest = {"schema"=>NativeDatasetDelivery::SCHEMA,"sourceFormat"=>"SF100_SCAN",
          "sourceKey"=>@request["sourceKey"],"datasetId"=>@request["datasetId"],
          "sourceSha256"=>receipt["sourceId"],"nativeManifestSha256"=>receipt["manifestSha256"],
          "sourceBindingSha256"=>receipt["sourceBindingSha256"],"nativeReceiptSha256"=>Files.hash(raw),
          "sourceRecordSha256"=>Files.hash(metadata["source.json"]),"selectionSha256"=>@request_sha256,
          "snapshot"=>scan["snapshot"],"rowCount"=>scan["count"],"fields"=>scan["fields"],"files"=>files}
        bytes = Files.json(manifest)
        same_request!
        Files.once(File.join(target,DatasetDelivery::MANIFEST),bytes)
        delivery = DatasetDelivery.open(target,expected_manifest_sha256: Files.hash(bytes))
        completion = {"schema"=>RESULT_SCHEMA,"requestSha256"=>@request_sha256,
          "datasetId"=>@request["datasetId"],"sourceKey"=>@request["sourceKey"],
          "sourceId"=>receipt["sourceId"],"nativeReceiptSha256"=>Files.hash(raw),
          "directory"=>target,"manifestSha256"=>delivery.manifest_sha256}
        Files.once(File.join(@directory,"received.json"),Files.json(completion))
        self.class.received(directory: @directory)
      end
    end

    private
    def initialize_retained(root, request, bytes)
      runtime = request["runtime"]
      Files.need(request["room"].is_a?(String) && File.expand_path(request["room"]) == request["room"] &&
        runtime.is_a?(Hash) && runtime["files"].is_a?(Array) &&
        %w[directory python node].all? { |key| runtime[key].is_a?(String) &&
          File.expand_path(runtime[key]) == runtime[key] }, "RUBY_NATIVE_DATASET_RUNTIME_SELECTION_INVALID")
      @directory,@request,@request_bytes = root,request,bytes.dup.freeze
      @room,@runtime,@request_sha256 = request["room"],runtime,Files.hash(bytes).freeze
      DatasetDelivery.freeze_value(@request)
      Files.directory(File.join(root,"attempts"))
      Files.directory(File.join(root,"received"))
    end

    def copy_original(target, name, expected)
      parent = DatasetDelivery.parent_directory(target,name,create: true)
      destination = File.join(parent,File.basename(name))
      if File.exist?(destination) || File.symlink?(destination)
        DatasetDelivery.snapshot_file(destination,expected) { |_stream| }
        return
      end
      # The same descriptor is fully verified before any bytes enter the packet.
      # Atomic create-only publication lets an interrupted transfer resume.
      DatasetDelivery.parent_directory(@room,name)
      temp = Tempfile.new([".native-dataset-", ".pending"],parent)
      begin
        temp.binmode
        DatasetDelivery.snapshot_file(File.join(@room,name),expected) do |source|
          while (chunk = source.read(1_048_576))
            written = 0
            while written < chunk.bytesize
              count = temp.write(chunk.byteslice(written,chunk.bytesize-written))
              Files.need(count && count > 0, "RUBY_NATIVE_DATASET_COPY_FAILED")
              written += count
            end
          end
        end
        temp.flush
        temp.fsync
        temp.close
        begin
          File.link(temp.path,destination)
          Files.sync(parent)
        rescue Errno::EEXIST
          DatasetDelivery.snapshot_file(destination,expected) { |_stream| }
        end
      ensure
        temp.close!
      end
    end
  end
end
