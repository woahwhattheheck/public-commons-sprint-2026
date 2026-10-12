# frozen_string_literal: true
# MIT. Durable business-job receiving over the original seller and Node Buyer.
require_relative "seller_client"

module Starforge
  # Keep the key in your application's job/database record. The same key selects
  # one native intent across Active Job retries and process restarts.
  class Receiving
    attr_reader :directory, :intent_id
    def self.key_id(key)
      Files.need(key.is_a?(String) && !key.strip.empty? && key.bytesize <= 1024 &&
        key.valid_encoding?, "RUBY_BUSINESS_KEY_REQUIRED")
      Files.hash(key.b)
    end
    def self.intent_id(key)
      "ruby:" + key_id(key)
    end
    def self.received(directory:, key:, expected_manifest_sha256: nil)
      root = Files.directory(directory)
      path = Files.directory(File.join(root,key_id(key)))
      job_bytes = Files.read(File.join(path,"job.json"),131_072)
      job = Files.parse(job_bytes)
      receipt = Files.parse(Files.read(File.join(path,"received.json"),131_072))
      Files.need(job["schema"] == "stellar-forge.ruby-business-job.v1" &&
        job["keySha256"] == key_id(key) && job["intentId"] == intent_id(key) &&
        receipt["schema"] == "stellar-forge.ruby-business-received.v1" &&
        receipt["jobSha256"] == Files.hash(job_bytes) &&
        receipt["intentId"] == job["intentId"] && receipt["sourceSha256"] == job["sourceSha256"] &&
        receipt["directory"] == File.join(path,"received"), "RUBY_BUSINESS_RECEIPT_CHANGED")
      Files.need(expected_manifest_sha256.nil? || receipt["manifestSha256"] == expected_manifest_sha256,
        "RUBY_DELIVERY_MANIFEST_CHANGED")
      delivery = Delivery.open(receipt["directory"],expected_manifest_sha256: receipt.fetch("manifestSha256"))
      Files.need(delivery.manifest["intentId"] == job["intentId"] &&
        delivery.manifest["sourceSha256"] == job["sourceSha256"], "RUBY_BUSINESS_DELIVERY_CHANGED")
      delivery
    end

    def initialize(client:, buyer:, directory:, key:, bound:, response_file: nil)
      Files.need(client.is_a?(SellerClient) && buyer.is_a?(Buyer) && bound.is_a?(BoundRequest),
        "RUBY_BUSINESS_SOURCE_REQUIRED")
      @client, @buyer, @key = client, buyer, key.dup.freeze
      @root = Files.directory(directory,create: true)
      @directory = Files.directory(File.join(@root,self.class.key_id(key)),create: true)
      @intent_id = self.class.intent_id(key)
      Files.need(bound.intent_id == @intent_id && bound.source_sha256 == client.source["sourceSha256"],
        "RUBY_BUSINESS_INTENT_CHANGED")
      Files.need(response_file.nil? || response_file.is_a?(Hash), "RUBY_RESPONSE_OPTIONS_REQUIRED")
      @response_file = response_file.nil? ? nil : Files.parse(Files.json(Files.values!(response_file)))
      @bound = bound
      Files.lock(@directory) do
        bound.save(File.join(@directory,"request"))
        plan = Files.read(File.join(@directory,"request","request-plan.json"),131_072)
        job = {"schema"=>"stellar-forge.ruby-business-job.v1","keySha256"=>self.class.key_id(key),
          "intentId"=>@intent_id,"buyerDirectory"=>buyer.directory,"sourceSha256"=>bound.source_sha256,
          "rubyManifestSha256"=>client.manifest_sha256,"requestPlanSha256"=>Files.hash(plan),
          "requestSha256"=>Files.hash(bound.record_bytes),"responseFile"=>@response_file}
        @job_bytes = Files.json(job).freeze
        @job_sha = Files.hash(@job_bytes)
        Files.once(File.join(@directory,"job.json"),@job_bytes)
      end
    end

    def bound
      @client.load_request(File.join(@directory,"request"))
    end
    def operation
      Operation.new(@buyer,@intent_id,@bound.source_sha256)
    end
    def same_job!
      Files.need(Files.read(File.join(@directory,"job.json"),131_072) == @job_bytes,
        "RUBY_BUSINESS_JOB_CHANGED")
    end
    def complete?
      File.file?(File.join(@directory,"received.json"))
    end
    def delivery
      self.class.received(directory: @root,key: @key)
    end

    # Repeating preparation adopts the exact existing native operation. The
    # original native intent and bound request, not a transport UUID, own it.
    def prepare(cancel: nil)
      Files.lock(@directory) do
        same_job!
        prepare_inside(cancel: cancel)
      end
    end
    def prepare_inside(cancel: nil)
      path = File.join(@directory,"prepared.json")
      if File.exist?(path)
        saved = Files.parse(Files.read(path,131_072))
        Files.need(saved["jobSha256"] == @job_sha && saved["intentId"] == @intent_id,
          "RUBY_BUSINESS_PREPARATION_CHANGED")
        return operation
      end
      selected = bound
      prepared = @client.prepare(@buyer,selected,response_file: @response_file,cancel: cancel)
      Files.once(path,Files.json({"schema"=>"stellar-forge.ruby-business-prepared.v1",
        "jobSha256"=>@job_sha,"intentId"=>@intent_id}))
      prepared
    end
    private :prepare_inside

    def review(cancel: nil)
      Files.lock(@directory) do
        same_job!
        selected = prepare_inside(cancel: cancel)
        path = File.join(@directory,"review.json")
        if File.exist?(path)
          saved = Files.parse(Files.read(path))
          Files.need(saved["intentId"] == @intent_id, "RUBY_BUSINESS_REVIEW_CHANGED")
          return saved
        end
        value = selected.review(cancel: cancel)
        Files.once(path,Files.json(value))
        value
      end
    end

    # Call only from the explicit operator action. A worker retry uses recover
    # and receive; it never grants a new paid attempt.
    def execute(review:, cancel: nil)
      Files.lock(@directory) do
        same_job!
        review_bytes = Files.read(File.join(@directory,"review.json"))
        Files.need(Files.parse(review_bytes) == review && review["intentId"] == @intent_id,
          "RUBY_BUSINESS_REVIEW_CHANGED")
        path = File.join(@directory,"execution.json")
        plan = if File.exist?(path)
          Files.parse(Files.read(path,131_072))
        else
          value = {"schema"=>"stellar-forge.ruby-business-execution.v1",
            "jobSha256"=>@job_sha,"intentId"=>@intent_id,"reviewSha256"=>Files.hash(review_bytes),
            "callId"=>SecureRandom.uuid}
          Files.once(path,Files.json(value))
          value
        end
        Files.need(plan["jobSha256"] == @job_sha && plan["intentId"] == @intent_id &&
          plan["reviewSha256"] == Files.hash(review_bytes) && CALL_ID.match?(plan["callId"] || ""),
          "RUBY_BUSINESS_EXECUTION_CHANGED")
        begin
          operation.execute(review: review,call_id: plan["callId"],cancel: cancel)
        rescue Error => cause
          # Reading an original result is safe after a lost native reply. A null
          # recovery preserves the actual original error for the operator.
          recovered = operation.recover(cancel: cancel) unless cancel&.cancelled?
          raise cause if recovered.nil?
          recovered
        end
      end
    end

    def recover(cancel: nil)
      Files.lock(@directory) do
        same_job!
        operation.recover(cancel: cancel)
      end
    end
    def status(cancel: nil)
      Files.lock(@directory) do
        same_job!
        return {"state"=>"RECEIVED","intentId"=>@intent_id,"delivery"=>delivery.manifest} if complete?
        {"state"=>File.exist?(File.join(@directory,"execution.json")) ? "ORIGINAL_ATTEMPT" :
          File.exist?(File.join(@directory,"prepared.json")) ? "PREPARED" : "REQUEST_RETAINED",
          "intentId"=>@intent_id,"operation"=>File.exist?(File.join(@directory,"prepared.json")) ?
            operation.status(cancel: cancel) : nil}
      end
    end

    def receive(cancel: nil)
      Files.lock(@directory) do
        same_job!
        return delivery if complete?
        result = operation.recover(cancel: cancel)
        Files.need(result && result.dig("delivery","status") == "SAVED", "RUBY_ORIGINAL_RESPONSE_REQUIRED")
        received = operation.receive(File.join(@directory,"received"),cancel: cancel)
        Files.once(File.join(@directory,"received.json"),Files.json({
          "schema"=>"stellar-forge.ruby-business-received.v1","jobSha256"=>@job_sha,
          "intentId"=>@intent_id,"sourceSha256"=>@bound.source_sha256,
          "directory"=>received.directory,"manifestSha256"=>received.manifest_sha256}))
        received
      end
    end
  end
end
