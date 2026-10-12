# frozen_string_literal: true
# MIT. Retained Ruby business operations over original SF88 dataset sessions.
require_relative "dataset_delivery"
require_relative "rails_receiving"

module Starforge
  class DatasetReceiving
    JOB_SCHEMA = "stellar-forge.ruby-dataset-job.v1"
    attr_reader :directory, :dataset_id

    def self.key_id(key)
      Receiving.key_id(key)
    end
    def self.dataset_id(key)
      "ruby-dataset:" + key_id(key)
    end
    def self.directory_for(directory, key, create: false)
      root = Files.directory(directory,create: create)
      datasets = Files.directory(File.join(root,"datasets"),create: create)
      Files.directory(File.join(datasets,key_id(key)),create: create)
    end
    def self.retained_job(directory:, key:)
      path = directory_for(directory,key)
      raw = Files.read(File.join(path,"job.json"),262_144)
      job = Files.parse(raw)
      Files.need(job["schema"] == JOB_SCHEMA && job["keySha256"] == key_id(key) &&
        job["datasetId"] == dataset_id(key), "RUBY_DATASET_JOB_CHANGED")
      {"directory"=>path,"bytes"=>raw,"job"=>job}
    end
    def self.received(directory:, key:, expected_manifest_sha256: nil)
      saved = retained_job(directory: directory,key: key)
      job, path = saved.fetch("job"),saved.fetch("directory")
      receipt = Files.parse(Files.read(File.join(path,"received.json"),262_144))
      Files.need(receipt["schema"] == "stellar-forge.ruby-dataset-received.v1" &&
        receipt["jobSha256"] == Files.hash(saved.fetch("bytes")) && receipt["datasetId"] == job["datasetId"] &&
        receipt["sourceSha256"] == job["sourceSha256"] && receipt["directory"] == File.join(path,"received") &&
        (expected_manifest_sha256.nil? || receipt["manifestSha256"] == expected_manifest_sha256),
        "RUBY_DATASET_RECEIPT_CHANGED")
      delivery = DatasetDelivery.open(receipt.fetch("directory"),expected_manifest_sha256: receipt.fetch("manifestSha256"))
      request_bytes = Files.read(File.join(path,"request","request.json"),MAX_INPUT)
      request = Files.parse(request_bytes)
      Files.need(Files.hash(request_bytes) == job["requestSha256"] &&
        request.is_a?(Hash) && request.all? { |name,value| name == "schema" || delivery.source[name] == value } &&
        delivery.manifest["datasetId"] == job["datasetId"] && delivery.source_sha256 == job["sourceSha256"] &&
        delivery.source["rubyManifestSha256"] == job["rubyManifestSha256"] &&
        delivery.selection["limits"] == job["limits"] && delivery.selection["originalSession"] == job["originalSession"] &&
        (job["expectedSnapshot"].nil? || delivery.selection["expectedSnapshot"] == job["expectedSnapshot"]) &&
        delivery.manifest["selectionSha256"] == receipt["selectionSha256"] &&
        delivery.manifest["intentId"] == receipt["intentId"], "RUBY_DATASET_BUSINESS_DELIVERY_CHANGED")
      delivery
    end

    NEW_MAX_PAGES = 4096
    NEW_MAX_PAGE_BYTES = 2_097_152

    # Native historical definitions remain attachable with their original limits.
    # New acquisitions fit the paired original SF100 delivery implementation.
    def self.normalize_limits(limits, historical: false)
      Files.need(limits.is_a?(Hash) && (limits.keys - %w[maxPages maxTotalAtomic maxRows maxPageBytes]).empty?,
        "RUBY_DATASET_LIMITS_REQUIRED")
      value = {"maxPages"=>limits.fetch("maxPages"),"maxTotalAtomic"=>limits.fetch("maxTotalAtomic"),
        "maxRows"=>limits.fetch("maxRows",1_000_000),"maxPageBytes"=>limits.fetch("maxPageBytes",1_048_576)}
      Files.need(value["maxPages"].is_a?(Integer) && value["maxPages"].between?(1,historical ? 10_000 : NEW_MAX_PAGES) &&
        value["maxRows"].is_a?(Integer) && value["maxRows"].between?(1,1_000_000) &&
        value["maxPageBytes"].is_a?(Integer) && value["maxPageBytes"].between?(1024,historical ? 16_777_216 : NEW_MAX_PAGE_BYTES) &&
        value["maxTotalAtomic"].is_a?(String) && /\A[1-9][0-9]{0,38}\z/.match?(value["maxTotalAtomic"]) &&
        value["maxTotalAtomic"].to_i <= 170_141_183_460_469_231_731_687_303_715_884_105_727,
        "RUBY_DATASET_LIMITS_INVALID")
      value
    end

    def initialize(client:, buyer:, directory:, key:, bound:, limits:, expected_snapshot: nil, original_session: nil)
      Files.need(client.is_a?(SellerClient) && buyer.is_a?(Buyer) && bound.is_a?(BoundRequest),
        "RUBY_DATASET_BUSINESS_SOURCE_REQUIRED")
      @client,@buyer,@key,@bound = client,buyer,key.dup.freeze,bound
      @dataset_id = self.class.dataset_id(key).freeze
      Files.need(bound.intent_id == @dataset_id && bound.source_sha256 == client.source.fetch("sourceSha256") &&
        bound.body.nil? && bound.describe.dig("request","method") == "GET", "RUBY_DATASET_GET_REQUEST_REQUIRED")
      @limits = self.class.normalize_limits(limits,historical: !original_session.nil?)
      Files.need(expected_snapshot.nil? || HASH.match?(expected_snapshot.to_s), "RUBY_DATASET_SNAPSHOT_INVALID")
      @expected_snapshot = expected_snapshot
      @original_session = if original_session.nil?
        nil
      else
        Files.need(original_session.is_a?(Hash) && original_session.keys.sort == %w[directory sha256] &&
          HASH.match?(original_session["sha256"].to_s), "RUBY_DATASET_ORIGINAL_SESSION_REQUIRED")
        {"directory"=>Files.directory(original_session.fetch("directory")),"sha256"=>original_session.fetch("sha256")}
      end
      @root = Files.directory(directory,create: true)
      @directory = self.class.directory_for(@root,key,create: true)
      Files.lock(@directory) do
        bound.save(File.join(@directory,"request"))
        plan = Files.read(File.join(@directory,"request","request-plan.json"),262_144)
        job = {"schema"=>JOB_SCHEMA,"keySha256"=>self.class.key_id(key),"datasetId"=>@dataset_id,
          "buyerDirectory"=>buyer.directory,"sourceSha256"=>bound.source_sha256,
          "rubyManifestSha256"=>client.manifest_sha256,"requestPlanSha256"=>Files.hash(plan),
          "requestSha256"=>Files.hash(bound.record_bytes),"limits"=>@limits,
          "expectedSnapshot"=>@expected_snapshot,"originalSession"=>@original_session}
        @job_bytes = Files.json(job).freeze
        @job_sha256 = Files.hash(@job_bytes).freeze
        Files.once(File.join(@directory,"job.json"),@job_bytes)
        %w[reviews actions].each { |name| Files.directory(File.join(@directory,name),create: true) }
      end
    end

    def same_job!
      Files.need(Files.read(File.join(@directory,"job.json"),262_144) == @job_bytes, "RUBY_DATASET_JOB_CHANGED")
    end
    def complete?
      File.file?(File.join(@directory,"received.json"))
    end
    def delivery
      self.class.received(directory: @root,key: @key)
    end
    def native_call(action, arguments = {}, **options)
      @buyer.invoke("dataset."+action,@dataset_id,{"sourceSha256"=>@bound.source_sha256}.merge(arguments),**options)
    end
    private :native_call

    # The generated source and initial request are prepared offline. Creating or
    # attaching the original native session does not acquire any page.
    def prepare(cancel: nil)
      Files.lock(@directory) { same_job!; prepare_inside(cancel: cancel) }
    end
    def prepare_inside(cancel: nil)
      path = File.join(@directory,"prepared.json")
      if File.exist?(path)
        saved = Files.parse(Files.read(path,262_144))
        Files.need(saved["jobSha256"] == @job_sha256 && saved["datasetId"] == @dataset_id &&
          saved.dig("native","datasetId") == @dataset_id && HASH.match?(saved.dig("native","selectionSha256").to_s),
          "RUBY_DATASET_PREPARATION_CHANGED")
        return saved.fetch("native")
      end
      selected = @client.load_request(File.join(@directory,"request"))
      Files.need(selected.record_bytes == @bound.record_bytes, "RUBY_DATASET_REQUEST_CHANGED")
      @client.prepare(@buyer,selected,cancel: cancel)
      result = native_call("prepare",{"limits"=>@limits,"expectedSnapshot"=>@expected_snapshot,
        "originalSession"=>@original_session},cancel: cancel)
      Files.need(result.is_a?(Hash) && result["datasetId"] == @dataset_id &&
        result.dig("selection","sourceSha256") == @bound.source_sha256 &&
        HASH.match?(result["selectionSha256"].to_s), "RUBY_DATASET_PREPARATION_CHANGED")
      Files.once(path,Files.json({"schema"=>"stellar-forge.ruby-dataset-prepared.v1",
        "jobSha256"=>@job_sha256,"datasetId"=>@dataset_id,"native"=>result}))
      result
    end
    private :prepare_inside

    def retain_review(value)
      Files.need(value.is_a?(Hash) && value["schema"] == "stellar-forge.ruby-dataset-review.v1" &&
        value["datasetId"] == @dataset_id && HASH.match?(value["reviewSha256"].to_s),
        "RUBY_DATASET_REVIEW_INVALID")
      Files.once(File.join(@directory,"reviews",value.fetch("reviewSha256")+".json"),Files.json(value))
      value
    end
    private :retain_review

    def review(cancel: nil)
      Files.lock(@directory) do
        same_job!
        prepare_inside(cancel: cancel)
        retain_review(native_call("review",{},cancel: cancel))
      end
    end
    def recover(cancel: nil)
      Files.lock(@directory) do
        same_job!
        return {"state"=>"RECEIVED","datasetId"=>@dataset_id,"delivery"=>delivery.manifest} if complete?
        prepare_inside(cancel: cancel)
        retain_review(native_call("recover",{},cancel: cancel))
      end
    end
    def status(cancel: nil)
      Files.lock(@directory) do
        same_job!
        return {"state"=>"RECEIVED","datasetId"=>@dataset_id,"delivery"=>delivery.manifest} if complete?
        unless File.exist?(File.join(@directory,"prepared.json"))
          return {"state"=>"REQUEST_RETAINED","datasetId"=>@dataset_id}
        end
        native_call("status",{},cancel: cancel)
      end
    end

    # An explicit caller action owns this stable key. Retrying it reopens the
    # exact same call; a later continuation needs a fresh review and action key.
    # Recovery observes existing native attempts and never acquires a new page.
    def run(review:, action_key:, cancel: nil)
      action_id = self.class.key_id(action_key)
      Files.lock(@directory) do
        same_job!
        prepared = prepare_inside(cancel: cancel)
        Files.need(review.is_a?(Hash) && HASH.match?(review["reviewSha256"].to_s) &&
          review["datasetId"] == @dataset_id && review["selectionSha256"] == prepared["selectionSha256"],
          "RUBY_DATASET_REVIEW_CHANGED")
        review_bytes = Files.read(File.join(@directory,"reviews",review.fetch("reviewSha256")+".json"),MAX_INPUT)
        Files.need(review_bytes == Files.json(review), "RUBY_DATASET_REVIEW_CHANGED")
        scope = Files.directory(File.join(@directory,"actions",action_id),create: true)
        path = File.join(scope,"request.json")
        plan = if File.exist?(path)
          Files.parse(Files.read(path,262_144))
        else
          value = {"schema"=>"stellar-forge.ruby-dataset-action.v1","jobSha256"=>@job_sha256,
            "actionKeySha256"=>action_id,"datasetId"=>@dataset_id,"reviewSha256"=>Files.hash(review_bytes),
            "callId"=>SecureRandom.uuid}
          Files.once(path,Files.json(value))
          value
        end
        Files.need(plan["schema"] == "stellar-forge.ruby-dataset-action.v1" &&
          plan["jobSha256"] == @job_sha256 && plan["actionKeySha256"] == action_id &&
          plan["datasetId"] == @dataset_id && plan["reviewSha256"] == Files.hash(review_bytes) &&
          CALL_ID.match?(plan["callId"].to_s), "RUBY_DATASET_ACTION_CHANGED")
        begin
          result = native_call("run",{"review"=>review},call_id: plan.fetch("callId"),cancel: cancel)
          retain_review(result)
          Files.once(File.join(scope,"result.json"),Files.json(result))
          result
        rescue Error => cause
          raise if cancel&.cancelled?
          observed = retain_review(native_call("recover",{},cancel: cancel))
          result = {"schema"=>"stellar-forge.ruby-dataset-action-recovery.v1",
            "outcome"=>"ORIGINAL_STATE_OBSERVED","datasetId"=>@dataset_id,
            "callId"=>plan.fetch("callId"),"originalError"=>cause.code,"review"=>observed}
          # Every recovery observation retains its own complete source result.
          Files.once(File.join(scope,"recovery-"+observed.fetch("reviewSha256")+".json"),Files.json(result))
          result
        end
      end
    end

    def receive(cancel: nil)
      Files.lock(@directory) do
        same_job!
        return delivery if complete?
        prepared = prepare_inside(cancel: cancel)
        result = native_call("receive",{"directory"=>File.join(@directory,"received")},cancel: cancel)
        Files.need(result.is_a?(Hash) && result["directory"] == File.join(@directory,"received") &&
          HASH.match?(result["manifestSha256"].to_s), "RUBY_DATASET_RECEIVING_RESULT_CHANGED")
        received = DatasetDelivery.open(result.fetch("directory"),expected_manifest_sha256: result.fetch("manifestSha256"))
        Files.need(received.manifest["datasetId"] == @dataset_id && received.source_sha256 == @bound.source_sha256 &&
          received.manifest["selectionSha256"] == prepared["selectionSha256"] &&
          received.manifest["intentId"] == prepared.dig("selection","nativeSessionId"),
          "RUBY_DATASET_BUSINESS_DELIVERY_CHANGED")
        Files.once(File.join(@directory,"received.json"),Files.json({
          "schema"=>"stellar-forge.ruby-dataset-received.v1","jobSha256"=>@job_sha256,
          "datasetId"=>@dataset_id,"intentId"=>received.manifest["intentId"],
          "sourceSha256"=>@bound.source_sha256,"selectionSha256"=>prepared["selectionSha256"],
          "directory"=>received.directory,"manifestSha256"=>received.manifest_sha256}))
        received
      end
    end
  end
end
