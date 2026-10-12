#!/usr/bin/env ruby
# frozen_string_literal: true
# MIT. Continue one ACTUAL existing dataset acquisition through the Ruby customer.
require_relative(File.file?(File.join(__dir__,"dataset_customer.rb")) ? "dataset_customer" : "../dataset_customer")

module Starforge
  module DatasetLifecycle
    module_function
    def received_rows(delivery)
      hash = Digest::SHA256.new
      types = delivery.fields.to_h { |name| [name,{}] }
      count = 0
      delivery.each_record do |record|
        Files.need(record["ordinal"] == count && Files.hash(record.fetch("raw_json").b) == record["sha256"],
          "RUBY_DATASET_ORIGINAL_ROW_CHANGED")
        hash.update(record.fetch("raw_json").b)
        hash.update("\n".b)
        record.fetch("values").each do |name,value|
          kind = value.nil? ? "null" : value == true || value == false ? "boolean" :
            value.is_a?(BigDecimal) ? "decimal" : value.is_a?(Integer) ? "integer" : "string"
          types.fetch(name)[kind] = types.fetch(name).fetch(kind,0) + 1
        end
        count += 1
      end
      Files.need(count == delivery.row_count && hash.hexdigest == delivery.descriptor("dataset.jsonl")["sha256"],
        "RUBY_DATASET_NATIVE_ROWS_CHANGED")
      {"rows"=>count,"fields"=>delivery.fields,"originalJsonlSha256"=>hash.hexdigest,"nativeTypes"=>types}
    end
    def reopen(output)
      root = Files.directory(output)
      original = Files.parse(Files.read(File.join(root,"dataset-lifecycle-result.json"),MAX_INPUT))
      Files.need(original["schema"] == "stellar-forge.ruby-dataset-lifecycle.v1", "RUBY_DATASET_LIFECYCLE_RESULT_CHANGED")
      delivered = original.fetch("customer")
      source = DatasetDelivery.open(delivered.fetch("directory"),expected_manifest_sha256: delivered.fetch("manifestSha256"))
      recipient = DatasetDelivery.open(File.join(root,"recipient"),expected_manifest_sha256: delivered.fetch("manifestSha256"))
      Files.need(source.manifest == recipient.manifest && received_rows(source) == original.fetch("rows") &&
        received_rows(recipient) == original.fetch("rows"), "RUBY_DATASET_RECIPIENT_CHANGED")
      {"schema"=>"stellar-forge.ruby-dataset-lifecycle-reopen.v1","status"=>"REOPENED",
        "datasetId"=>source.manifest["datasetId"],"snapshot"=>source.snapshot,"rows"=>source.row_count,
        "manifestSha256"=>source.manifest_sha256,"originalResult"=>File.join(root,"dataset-lifecycle-result.json"),
        "customerDirectory"=>source.directory,"recipientDirectory"=>recipient.directory}
    end
    def main(argv)
      command = argv.shift
      values = {}
      parser = OptionParser.new do |o|
        o.banner = "ruby examples/dataset_lifecycle.rb run --package DIR --settings FILE --request FILE --key KEY --session DIR --session-sha256 HASH --out DIR\nruby examples/dataset_lifecycle.rb reopen --out DIR"
        o.on("--package DIRECTORY") { |v| values[:package] = v }
        o.on("--settings FILE") { |v| values[:settings] = v }
        o.on("--request FILE") { |v| values[:request] = v }
        o.on("--key KEY") { |v| values[:key] = v }
        o.on("--session DIRECTORY") { |v| values[:session] = v }
        o.on("--session-sha256 HASH") { |v| values[:session_sha] = v }
        o.on("--out DIRECTORY") { |v| values[:out] = v }
        o.on("--help") { puts o; return 0 }
      end
      parser.parse!(argv)
      Files.need(argv.empty? && %w[run reopen].include?(command) && values[:out], "RUBY_DATASET_LIFECYCLE_SELECTION_REQUIRED")
      if command == "reopen"
        Files.need(values.keys == [:out], "RUBY_DATASET_LIFECYCLE_REOPEN_OPTIONS_INVALID")
        $stdout.write(Files.json(reopen(values[:out])))
        return 0
      end
      Files.need(%i[package settings request key session session_sha].all? { |key| values[key] } &&
        HASH.match?(values[:session_sha].to_s), "RUBY_DATASET_ORIGINAL_LIFECYCLE_SOURCE_REQUIRED")
      output = Files.directory(values.fetch(:out),create: true)
      settings,settings_bytes = CustomerCommand.settings(values.fetch(:settings))
      Files.need(settings["responseFile"].nil?, "RUBY_DATASET_NATIVE_OUTPUT_OPTIONS_REQUIRED")
      selected = CustomerCommand.request_selection(values.fetch(:request))
      plan = {"schema"=>"stellar-forge.ruby-dataset-lifecycle-plan.v1",
        "package"=>File.realpath(values.fetch(:package)),"settingsSha256"=>Files.hash(settings_bytes),
        "request"=>selected,"keySha256"=>DatasetReceiving.key_id(values.fetch(:key)),
        "session"=>File.expand_path(values.fetch(:session)),"sessionSha256"=>values.fetch(:session_sha)}
      Files.once(File.join(output,"lifecycle-plan.json"),Files.json(plan))
      if File.file?(File.join(output,"dataset-lifecycle-result.json"))
        $stdout.write(Files.json(reopen(output)))
        return 0
      end
      source_raw = Files.read(File.join(plan.fetch("session"),"session.json"),262_144)
      Files.need(Files.hash(source_raw) == plan["sessionSha256"], "RUBY_DATASET_ORIGINAL_DEFINITION_CHANGED")
      definition = Files.parse(source_raw)
      Files.need(definition["schema"] == "stellar-forge.sf88.dataset-session.v1" &&
        definition["directory"] == plan["session"], "RUBY_DATASET_ORIGINAL_SESSION_REQUIRED")
      client = SellerClient.new(values.fetch(:package),node: settings.fetch("node","node"))
      Files.need(client.dataset_available?, "RUBY_DATASET_PACKAGE_REQUIRED")
      buyer = Buyer.new(client: client,runtime_directory: settings.fetch("runtimeDirectory"),
        state_directory: settings.fetch("buyerDirectory"),node: settings.fetch("node","node"),
        operator_profile: settings["operatorProfile"],workspace_directory: settings["workspaceDirectory"],
        timeout: settings.fetch("timeout",420),output_limit: settings.fetch("outputLimit",16_777_216))
      begin
        bound = client.build_request(selected.fetch("operationId"),selected.fetch("inputs"),
          intent_id: DatasetReceiving.dataset_id(values.fetch(:key)),max_atomic: selected.fetch("maxAtomic"),
          accept_index: selected["acceptIndex"],payment_flow: selected["paymentFlow"])
        job = DatasetReceiving.new(client: client,buyer: buyer,directory: settings.fetch("jobsDirectory"),
          key: values.fetch(:key),bound: bound,limits: definition.fetch("limits"),
          expected_snapshot: definition["expectedSnapshot"],
          original_session: {"directory"=>plan.fetch("session"),"sha256"=>plan.fetch("sessionSha256")})
        prepared = job.prepare
        Files.once(File.join(output,"prepared.json"),Files.json(prepared))
        original = job.recover
        Files.need(original.dig("native","status") == "COMPLETE" ||
          original["state"] == "RECEIVED", "RUBY_DATASET_ORIGINAL_COMPLETED_ACQUISITION_REQUIRED")
        delivered = job.receive
        rows = received_rows(delivered)
        recipient = delivered.copy_to(File.join(output,"recipient"))
        Files.need(received_rows(recipient) == rows && recipient.manifest_sha256 == delivered.manifest_sha256,
          "RUBY_DATASET_RECIPIENT_CHANGED")
        result = {"schema"=>"stellar-forge.ruby-dataset-lifecycle.v1","status"=>"COMPLETED",
          "ruby"=>RUBY_DESCRIPTION,"rubyManifestSha256"=>client.manifest_sha256,
          "originalSession"=>{"directory"=>plan["session"],"sha256"=>plan["sessionSha256"],
            "sessionId"=>definition.dig("config","operation","intentId"),"configurationSha256"=>definition["configurationSha256"]},
          "prepared"=>prepared,"customer"=>DatasetCommand.result(delivered),"rows"=>rows,
          "recipientDirectory"=>recipient.directory}
        Files.once(File.join(output,"dataset-lifecycle-result.json"),Files.json(result))
      ensure
        buyer.close
      end
      reopened = reopen(output)
      Files.once(File.join(output,"offline-reopen-result.json"),Files.json(reopened))
      $stdout.write(Files.json(reopened))
      0
    end
  end
end
if $PROGRAM_NAME == __FILE__
  begin
    exit Starforge::DatasetLifecycle.main(ARGV)
  rescue Starforge::Error => error
    warn Starforge::Files.json({"error"=>error.code,"callId"=>error.call_id,"intentId"=>error.intent_id})
    exit 2
  rescue OptionParser::ParseError,KeyError,ArgumentError,SystemCallError
    warn Starforge::Files.json({"error"=>"RUBY_DATASET_LIFECYCLE_INPUT_OR_IO_FAILED"})
    exit 2
  end
end
