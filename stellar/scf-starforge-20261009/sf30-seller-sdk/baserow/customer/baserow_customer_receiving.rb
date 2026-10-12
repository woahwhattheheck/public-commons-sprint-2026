# frozen_string_literal: true
# MIT. One retained Baserow customer job over the original native SF100 receiver.
require_relative "baserow_customer"

module Starforge
  class BaserowCustomerReceiving
    REQUEST_SCHEMA = "stellar-forge.ruby-baserow-customer-request.v1"
    RESULT_SCHEMA = "stellar-forge.ruby-baserow-customer-received.v1"
    attr_reader :directory

    def self.request(directory)
      root = Files.directory(directory)
      raw = Files.read(File.join(root,"request.json"),1_048_576)
      value = Files.parse(raw)
      Files.need(value.is_a?(Hash) && value["schema"] == REQUEST_SCHEMA &&
        INTENT.match?(value["datasetId"].to_s) && INTENT.match?(value["sourceKey"].to_s) &&
        HASH.match?(value["customerManifestSha256"].to_s) && HASH.match?(value["nativeManifestSha256"].to_s) &&
        value["customerDirectory"].is_a?(String) && File.absolute_path(value["customerDirectory"]) == value["customerDirectory"] &&
        value["runtime"].is_a?(Hash) && %w[checkout python node].all? { |key|
          value["runtime"][key].is_a?(String) && File.absolute_path(value["runtime"][key]) == value["runtime"][key]
        },"BASEROW_CUSTOMER_ORIGINAL_REQUEST_INVALID")
      [root,value,raw]
    end

    def self.received(directory:, expected_manifest_sha256: nil)
      root,request,request_bytes = self.request(directory)
      result = Files.parse(Files.read(File.join(root,"received.json"),1_048_576))
      Files.need(result.is_a?(Hash) && result["schema"] == RESULT_SCHEMA &&
        result["requestSha256"] == Files.hash(request_bytes) && result["datasetId"] == request["datasetId"] &&
        result["sourceKey"] == request["sourceKey"] && result["directory"] == "received" &&
        HASH.match?(result["manifestSha256"].to_s) &&
        (expected_manifest_sha256.nil? || expected_manifest_sha256 == result["manifestSha256"]),
        "BASEROW_CUSTOMER_BUSINESS_RECEIPT_CHANGED")
      delivery = BaserowCustomerDelivery.open(directory: File.join(root,"received"),
        expected_manifest_sha256: result["manifestSha256"])
      Files.need(delivery.manifest["requestSha256"] == Files.hash(request_bytes) &&
        delivery.manifest["datasetId"] == request["datasetId"] &&
        delivery.manifest["sourceKey"] == request["sourceKey"] &&
        delivery.customer_package.manifest_sha256 == request["customerManifestSha256"] &&
        delivery.dataset.source_sha256 == request["nativeManifestSha256"],
        "BASEROW_CUSTOMER_BUSINESS_SOURCE_CHANGED")
      delivery
    end

    def self.resume(directory:, cancel: nil, timeout: 1800)
      root,request,raw = self.request(directory)
      return received(directory: root) if File.exist?(File.join(root,"received.json"))
      instance = allocate
      instance.send(:initialize_retained,root,request,raw)
      instance.receive(cancel: cancel,timeout: timeout)
    end

    def self.status(directory:)
      root,request,raw = self.request(directory)
      if File.exist?(File.join(root,"received.json"))
        delivery = received(directory: root)
        return {"schema"=>RESULT_SCHEMA,"state"=>"RECEIVED","directory"=>root,
          "requestSha256"=>Files.hash(raw),"datasetId"=>request["datasetId"],"sourceKey"=>request["sourceKey"],
          "delivery"=>delivery.directory,"manifestSha256"=>delivery.manifest_sha256,
          "datasetManifestSha256"=>delivery.dataset.manifest_sha256,
          "rowCount"=>delivery.dataset.row_count,"fields"=>delivery.dataset.fields,
          "attachmentCount"=>delivery.attachments.fetch("files").length,
          "customerManifestSha256"=>delivery.customer_package.manifest_sha256,
          "source"=>delivery.source,"membership"=>delivery.dataset.membership}
      end
      state = if File.exist?(File.join(root,"native","received.json"))
        "DATASET_RECEIVED"
      elsif File.exist?(File.join(root,"source",BaserowCustomerPackage::MANIFEST))
        "SOURCE_RECEIVED"
      else
        "PREPARED"
      end
      {"schema"=>RESULT_SCHEMA,"state"=>state,"directory"=>root,"requestSha256"=>Files.hash(raw),
        "datasetId"=>request["datasetId"],"sourceKey"=>request["sourceKey"],
        "customerManifestSha256"=>request["customerManifestSha256"]}
    end

    def initialize(directory:, customer_package:, dataset_id:, checkout:, python:, node:)
      Files.need(customer_package.is_a?(BaserowCustomerPackage) && INTENT.match?(dataset_id.to_s),
        "BASEROW_CUSTOMER_PACKAGE_REQUIRED")
      selected = customer_package.verify!
      runtime = {"checkout"=>Files.directory(checkout,private: false),
        "python"=>NativeDatasetReceiving.executable(python),"node"=>NativeDatasetReceiving.executable(node)}
      request = {"schema"=>REQUEST_SCHEMA,"datasetId"=>dataset_id,
        "sourceKey"=>selected.manifest.fetch("sourceKey"),"customerDirectory"=>selected.directory,
        "customerManifestSha256"=>selected.manifest_sha256,
        "nativeManifestSha256"=>selected.manifest.fetch("dataset").fetch("manifestSha256"),
        "runtime"=>runtime}
      root = Files.directory(directory,create: true)
      BaserowCustomerFiles.separate(selected.directory,root)
      raw = Files.json(request)
      Files.lock(root) { Files.once(File.join(root,"request.json"),raw) }
      initialize_retained(root,request,raw)
    end

    def receive(cancel: nil, timeout: 1800)
      Files.lock(directory) do
        same_request!
        return self.class.received(directory: directory) if File.exist?(File.join(directory,"received.json"))
        raise Error,"BASEROW_CUSTOMER_CANCELLED" if cancel&.cancelled?
        source_directory = File.join(directory,"source")
        source = if File.exist?(File.join(source_directory,BaserowCustomerPackage::MANIFEST))
          BaserowCustomerPackage.open(directory: source_directory,
            expected_manifest_sha256: @request["customerManifestSha256"])
        else
          original = BaserowCustomerPackage.open(directory: @request["customerDirectory"],
            expected_manifest_sha256: @request["customerManifestSha256"])
          original.copy_to(source_directory)
        end
        Files.need(source.manifest["sourceKey"] == @request["sourceKey"] &&
          source.manifest["dataset"]["manifestSha256"] == @request["nativeManifestSha256"],
          "BASEROW_CUSTOMER_SOURCE_CHANGED")
        native_directory = File.join(directory,"native")
        if File.exist?(File.join(native_directory,"request.json"))
          _root,original_request,_bytes = NativeDatasetReceiving.selected_request(native_directory)
          Files.need(original_request["sourceKey"] == @request["sourceKey"] &&
            original_request["datasetId"] == @request["datasetId"] &&
            original_request["room"] == File.join(source_directory,"dataset") &&
            original_request["nativeManifestSha256"] == @request["nativeManifestSha256"] &&
            original_request["runtime"].is_a?(Hash) &&
            original_request["runtime"]["directory"] == @request["runtime"]["checkout"] &&
            %w[python node].all? { |key| original_request["runtime"][key] == @request["runtime"][key] },
            "BASEROW_CUSTOMER_NATIVE_REQUEST_CHANGED")
          dataset = NativeDatasetReceiving.resume(directory: native_directory,cancel: cancel,timeout: timeout)
        else
          runtime = @request.fetch("runtime")
          receiver = NativeDatasetReceiving.new(directory: native_directory,
            room: File.join(source_directory,"dataset"),source_key: @request["sourceKey"],
            dataset_id: @request["datasetId"],expected_native_manifest_sha256: @request["nativeManifestSha256"],
            checkout: runtime["checkout"],python: runtime["python"],node: runtime["node"])
          dataset = receiver.receive(cancel: cancel,timeout: timeout)
        end
        raise Error,"BASEROW_CUSTOMER_CANCELLED" if cancel&.cancelled?
        target = Files.directory(File.join(directory,"received"),create: true)
        source.copy_to(File.join(target,"customer"))
        dataset.copy_to(File.join(target,"dataset"))
        same_request!
        manifest = {"schema"=>BaserowCustomerDelivery::SCHEMA,"datasetId"=>@request["datasetId"],
          "sourceKey"=>@request["sourceKey"],"requestSha256"=>Files.hash(@request_bytes),
          "customer"=>{"directory"=>"customer","manifest"=>BaserowCustomerPackage::MANIFEST,
            "manifestSha256"=>source.manifest_sha256},
          "dataset"=>{"directory"=>"dataset","manifestSha256"=>dataset.manifest_sha256}}
        raw = Files.json(manifest)
        Files.once(File.join(target,BaserowCustomerDelivery::MANIFEST),raw)
        delivery = BaserowCustomerDelivery.open(directory: target,expected_manifest_sha256: Files.hash(raw))
        Files.once(File.join(directory,"received.json"),Files.json({"schema"=>RESULT_SCHEMA,
          "requestSha256"=>Files.hash(@request_bytes),"datasetId"=>@request["datasetId"],
          "sourceKey"=>@request["sourceKey"],"directory"=>"received",
          "manifestSha256"=>delivery.manifest_sha256}))
        self.class.received(directory: directory)
      end
    end

    private
    def initialize_retained(root,request,bytes)
      @directory,@request,@request_bytes = root.freeze,request,bytes.dup.freeze
      BaserowCustomerFiles.freeze(@request)
    end

    def same_request!
      Files.need(Files.read(File.join(directory,"request.json"),1_048_576) == @request_bytes,
        "BASEROW_CUSTOMER_REQUEST_CHANGED")
    end
  end
end
