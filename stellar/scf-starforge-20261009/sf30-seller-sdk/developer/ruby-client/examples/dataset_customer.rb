#!/usr/bin/env ruby
# frozen_string_literal: true
# MIT. Complete dataset commissioning through the original Ruby customer package.
require "optparse"
require_relative(File.file?(File.join(__dir__,"dataset_receiving.rb")) ? "dataset_receiving" : "../dataset_receiving")
require_relative "customer"

module Starforge
  module DatasetCommand
    module_function
    def result(delivery, state = "RECEIVED")
      {"schema"=>"stellar-forge.ruby-dataset-customer-result.v1","state"=>state,
        "datasetId"=>delivery.manifest["datasetId"],"intentId"=>delivery.manifest["intentId"],
        "sourceSha256"=>delivery.source_sha256,"snapshot"=>delivery.snapshot,
        "rows"=>delivery.row_count,"fields"=>delivery.fields,"directory"=>delivery.directory,
        "manifestSha256"=>delivery.manifest_sha256,"selectionSha256"=>delivery.manifest["selectionSha256"],
        "configurationSha256"=>delivery.manifest["configurationSha256"],
        "sourceBindingSha256"=>delivery.manifest["sourceBindingSha256"],
        "nativeManifestSha256"=>delivery.manifest["nativeManifestSha256"],
        "paymentStatus"=>delivery.native_delivery["paymentStatus"],"files"=>delivery.manifest["files"]}
    end
    def options_from_file(path)
      value = Files.parse(Files.read(path,262_144))
      Files.need(value.is_a?(Hash) && (value.keys - %w[maxPages maxTotalAtomic maxRows maxPageBytes expectedSnapshot]).empty?,
        "RUBY_DATASET_LIMITS_REQUIRED")
      {"limits"=>{"maxPages"=>value.fetch("maxPages"),"maxTotalAtomic"=>value.fetch("maxTotalAtomic"),
        "maxRows"=>value.fetch("maxRows",1_000_000),"maxPageBytes"=>value.fetch("maxPageBytes",1_048_576)},
        "expectedSnapshot"=>value["expectedSnapshot"]}
    end
    def retained_options(directory, values, create: false)
      path = File.join(directory,"dataset-options.json")
      saved = File.file?(path) ? Files.parse(Files.read(path,262_144)) : nil
      Files.need(saved.nil? || saved["schema"] == "stellar-forge.ruby-dataset-customer-options.v1",
        "RUBY_DATASET_OPTIONS_CHANGED")
      selected = values[:limits] ? options_from_file(values[:limits]) :
        saved ? {"limits"=>saved.fetch("limits"),"expectedSnapshot"=>saved["expectedSnapshot"]} : nil
      Files.need(selected, "RUBY_DATASET_LIMITS_REQUIRED")
      original = if values[:session] || values[:session_sha]
        Files.need(values[:session] && HASH.match?(values[:session_sha].to_s), "RUBY_DATASET_ORIGINAL_SESSION_REQUIRED")
        {"directory"=>File.expand_path(values[:session]),"sha256"=>values[:session_sha]}
      else
        saved && saved["originalSession"]
      end
      DatasetReceiving.normalize_limits(selected.fetch("limits"),historical: !original.nil?)
      current = {"schema"=>"stellar-forge.ruby-dataset-customer-options.v1",**selected,"originalSession"=>original}
      Files.need(saved.nil? || saved == current, "RUBY_DATASET_OPTIONS_CHANGED")
      Files.once(path,Files.json(current)) if saved.nil? && create
      Files.need(saved || create, "RUBY_DATASET_RETAINED_OPTIONS_REQUIRED")
      current
    end
    def same_review!(directory, path, dataset_id, selection_sha)
      return if path.nil?
      bytes = Files.read(path,MAX_INPUT)
      value = Files.parse(bytes)
      Files.need(value.is_a?(Hash) && value["datasetId"] == dataset_id &&
        value["selectionSha256"] == selection_sha && HASH.match?(value["reviewSha256"].to_s),
        "RUBY_DATASET_REVIEW_CHANGED")
      retained = Files.read(File.join(directory,"reviews",value.fetch("reviewSha256")+".json"),MAX_INPUT)
      Files.need(Files.json(value) == retained, "RUBY_DATASET_REVIEW_CHANGED")
      value
    end
    def emit(value, destination = nil)
      raw = Files.json(value)
      if destination
        path = File.expand_path(destination)
        Files.directory(File.dirname(path))
        Files.once(path,raw)
      end
      $stdout.write(raw)
    end
    def main(argv)
      command = argv.shift
      values = {package: File.file?(File.join(__dir__,"ruby-client.json")) ? __dir__ : File.expand_path("..",__dir__),
        offset: 0, limit: 20}
      parser = OptionParser.new do |o|
        o.banner = "ruby dataset_customer.rb prepare|review|run|recover|receive|status|reopen|inspect|rows|copy [options]"
        o.on("--package DIRECTORY","Complete generated Ruby seller package") { |v| values[:package] = v }
        o.on("--settings FILE","Existing ruby-customer-settings.v1 host settings") { |v| values[:settings] = v }
        o.on("--request FILE","Original operationId/inputs/maxAtomic selection; omit on reopen") { |v| values[:request] = v }
        o.on("--limits FILE","Whole dataset limits: new maxPages<=4096, maxPageBytes<=2097152; optional expectedSnapshot") { |v| values[:limits] = v }
        o.on("--key KEY","Stable dataset business key") { |v| values[:key] = v }
        o.on("--original-session DIRECTORY","Attach an existing original SF88 acquisition") { |v| values[:session] = v }
        o.on("--session-sha256 HASH","Exact original session.json digest for attachment") { |v| values[:session_sha] = v }
        o.on("--review FILE","Exact retained original review for an explicit run") { |v| values[:review] = v }
        o.on("--action-key KEY","Stable application action key for this explicit run") { |v| values[:action_key] = v }
        o.on("--jobs-directory DIRECTORY","Existing jobs root for offline business receipt reopen") { |v| values[:jobs] = v }
        o.on("--directory DIRECTORY","Complete offline dataset customer packet") { |v| values[:directory] = v }
        o.on("--manifest-sha256 HASH","Exact expected dataset-customer.json digest") { |v| values[:manifest] = v }
        o.on("--out PATH","Create-only result JSON, or complete new packet directory for copy") { |v| values[:out] = v }
        o.on("--offset INTEGER",Integer,"First original row ordinal for rows") { |v| values[:offset] = v }
        o.on("--limit INTEGER",Integer,"Maximum original rows to display") { |v| values[:limit] = v }
        o.on("--help") { puts o; return 0 }
      end
      parser.parse!(argv)
      Files.need(argv.empty? && %w[prepare review run recover receive status reopen inspect rows copy].include?(command),
        "RUBY_DATASET_COMMAND_REQUIRED")
      Files.need(command == "run" ? values[:review] && values[:action_key] : values[:action_key].nil?,
        "RUBY_DATASET_EXPLICIT_RUN_SELECTION_REQUIRED")
      Files.need(command == "rows" || values[:offset] == 0 && values[:limit] == 20, "RUBY_DATASET_ROW_OPTIONS_INVALID")
      if %w[inspect rows copy].include?(command)
        Files.need(values[:directory] && HASH.match?(values[:manifest].to_s), "RUBY_DATASET_OFFLINE_PACKET_REQUIRED")
        Files.need(!values[:settings] && !values[:request] && !values[:limits] && !values[:session] && !values[:review],
          "RUBY_DATASET_OFFLINE_OPTIONS_INVALID")
        delivery = DatasetDelivery.open(values[:directory],expected_manifest_sha256: values[:manifest])
        if command == "rows"
          Files.need(values[:out].nil? && values[:offset].between?(0,delivery.row_count) &&
            values[:limit].between?(1,1000), "RUBY_DATASET_ROW_RANGE_INVALID")
          count = 0
          delivery.each_record do |record|
            next if record["ordinal"] < values[:offset]
            break if count >= values[:limit]
            $stdout.write(record.fetch("raw_json"))
            $stdout.write("\n")
            count += 1
          end
        elsif command == "copy"
          Files.need(values[:out], "RUBY_DATASET_COPY_DESTINATION_REQUIRED")
          emit(result(delivery.copy_to(values[:out]),"COPIED"))
        else
          emit(result(delivery,"REOPENED"),values[:out])
        end
        return 0
      end
      if command == "reopen"
        Files.need(values[:jobs] && values[:key] && !values[:settings], "RUBY_DATASET_OFFLINE_SELECTION_REQUIRED")
        directory = DatasetReceiving.directory_for(values[:jobs],values[:key])
        CustomerCommand.same_request!(directory,values[:request])
        retained_options(directory,values)
        delivery = DatasetReceiving.received(directory: values[:jobs],key: values[:key],expected_manifest_sha256: values[:manifest])
        same_review!(directory,values[:review],delivery.manifest["datasetId"],delivery.manifest["selectionSha256"])
        emit(result(delivery,"REOPENED"),values[:out])
        return 0
      end
      Files.need(values[:settings] && values[:key] && !values[:directory] && !values[:jobs],
        "RUBY_DATASET_CUSTOMER_SELECTION_REQUIRED")
      settings, settings_bytes = CustomerCommand.settings(values[:settings])
      Files.need(settings["responseFile"].nil?, "RUBY_DATASET_NATIVE_OUTPUT_OPTIONS_REQUIRED")
      directory = File.join(File.expand_path(settings.fetch("jobsDirectory")),"datasets",DatasetReceiving.key_id(values[:key]))
      if File.file?(File.join(directory,"received.json"))
        CustomerCommand.same_request!(directory,values[:request])
        retained_options(directory,values)
        Files.need(Files.read(File.join(directory,"customer-settings.json"),131_072) == settings_bytes,
          "RUBY_CUSTOMER_SETTINGS_CHANGED")
        delivery = DatasetReceiving.received(directory: settings["jobsDirectory"],key: values[:key],
          expected_manifest_sha256: values[:manifest])
        same_review!(directory,values[:review],delivery.manifest["datasetId"],delivery.manifest["selectionSha256"])
        value = result(delivery)
        Files.once(File.join(directory,"dataset-result.json"),Files.json(value))
        emit(value,values[:out])
        return 0
      end
      directory = DatasetReceiving.directory_for(settings["jobsDirectory"],values[:key],create: true)
      selected_request, selected_options = Files.lock(directory) do
        Files.once(File.join(directory,"customer-settings.json"),settings_bytes)
        [CustomerCommand.retain_request(directory,values[:request]),retained_options(directory,values,create: true)]
      end
      client = SellerClient.new(values[:package],node: settings.fetch("node","node"))
      buyer = Buyer.new(client: client,runtime_directory: settings.fetch("runtimeDirectory"),
        state_directory: settings.fetch("buyerDirectory"),node: settings.fetch("node","node"),
        operator_profile: settings["operatorProfile"],workspace_directory: settings["workspaceDirectory"],
        timeout: settings.fetch("timeout",420),output_limit: settings.fetch("outputLimit",16_777_216))
      cancel = Cancellation.new
      old_int, old_term = Signal.trap("INT") { Thread.new { cancel.cancel } },Signal.trap("TERM") { Thread.new { cancel.cancel } }
      begin
        bound = if File.file?(File.join(directory,"request","request-plan.json"))
          client.load_request(File.join(directory,"request"))
        else
          client.build_request(selected_request.fetch("operationId"),selected_request.fetch("inputs"),
            intent_id: DatasetReceiving.dataset_id(values[:key]),max_atomic: selected_request.fetch("maxAtomic"),
            accept_index: selected_request["acceptIndex"],payment_flow: selected_request["paymentFlow"])
        end
        job = DatasetReceiving.new(client: client,buyer: buyer,directory: settings["jobsDirectory"],key: values[:key],
          bound: bound,limits: selected_options.fetch("limits"),expected_snapshot: selected_options["expectedSnapshot"],
          original_session: selected_options["originalSession"])
        value = case command
        when "prepare" then job.prepare(cancel: cancel)
        when "review" then job.review(cancel: cancel)
        when "status" then job.status(cancel: cancel)
        when "recover" then job.recover(cancel: cancel)
        when "run"
          review = Files.parse(Files.read(values.fetch(:review),MAX_INPUT))
          job.run(review: review,action_key: values.fetch(:action_key),cancel: cancel)
        when "receive"
          result(job.receive(cancel: cancel))
        end
        Files.once(File.join(directory,"dataset-result.json"),Files.json(value)) if value && value["state"] == "RECEIVED"
        emit(value,values[:out])
        value && value["outcome"] == "ORIGINAL_STATE_OBSERVED" ? 3 : 0
      ensure
        buyer.close
        Signal.trap("INT",old_int)
        Signal.trap("TERM",old_term)
      end
    end
  end
end

if $PROGRAM_NAME == __FILE__
  begin
    exit Starforge::DatasetCommand.main(ARGV)
  rescue Starforge::Error => error
    warn Starforge::Files.json({"error"=>error.code,"callId"=>error.call_id,"intentId"=>error.intent_id})
    exit 2
  rescue OptionParser::ParseError, KeyError, ArgumentError, SystemCallError
    warn Starforge::Files.json({"error"=>"RUBY_DATASET_INPUT_OR_IO_FAILED"})
    exit 2
  end
end
