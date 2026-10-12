#!/usr/bin/env ruby
# frozen_string_literal: true
# MIT. Run a real seller request through its original buyer and retain the response.
require "optparse"
require_relative(File.file?(File.join(__dir__,"rails_receiving.rb")) ? "rails_receiving" : "../rails_receiving")

module Starforge
  module CustomerCommand
    module_function
    def settings(path)
      raw = Files.read(path,131_072)
      value = Files.parse(raw)
      allowed = %w[schema runtimeDirectory buyerDirectory jobsDirectory node operatorProfile workspaceDirectory timeout outputLimit responseFile]
      Files.need(value.is_a?(Hash) && (value.keys - allowed).empty? &&
        value["schema"] == "stellar-forge.ruby-customer-settings.v1" &&
        %w[runtimeDirectory buyerDirectory jobsDirectory].all? { |key| value[key].is_a?(String) && value[key].start_with?("/") },
        "RUBY_CUSTOMER_SETTINGS_REQUIRED")
      [value,raw]
    end
    def request_selection(path)
      value = Files.parse(Files.read(path))
      Files.need(value.is_a?(Hash) && (value.keys - %w[operationId inputs maxAtomic acceptIndex paymentFlow]).empty? &&
        value["operationId"].is_a?(String) && value["inputs"].is_a?(Hash) &&
        value["maxAtomic"].is_a?(String), "RUBY_CUSTOMER_REQUEST_REQUIRED")
      Files.values!(value)
    end
    def same_request!(directory,path)
      return if path.nil?
      original = request_selection(File.join(directory,"customer-request.json"))
      Files.need(original == request_selection(path), "RUBY_CUSTOMER_REQUEST_CHANGED")
    end
    def retain_request(directory,path)
      saved = File.join(directory,"customer-request.json")
      if File.exist?(saved)
        same_request!(directory,path)
        request_selection(saved)
      else
        Files.need(path, "RUBY_CUSTOMER_REQUEST_REQUIRED")
        value = request_selection(path)
        Files.once(saved,Files.json(value))
        value
      end
    end
    def request(client,selection,key)
      value = Files.parse(Files.json(selection))
      inputs = value["inputs"]
      if inputs.key?("multipart")
        part = inputs["multipart"]
        Files.need(part.is_a?(Hash) && part.keys.sort == %w[bodyBase64 contentType] &&
          part["bodyBase64"].is_a?(String), "RUBY_MULTIPART_BYTES_REQUIRED")
        bytes = Base64.strict_decode64(part["bodyBase64"])
        Files.need(Base64.strict_encode64(bytes) == part["bodyBase64"], "RUBY_MULTIPART_BYTES_REQUIRED")
        inputs["multipart"] = {"body"=>bytes,"contentType"=>part["contentType"]}
      end
      client.build_request(value["operationId"],inputs,intent_id: Receiving.intent_id(key),
        max_atomic: value["maxAtomic"],accept_index: value["acceptIndex"],payment_flow: value["paymentFlow"])
    end
    def received_result(delivery,key,package_sha)
      native = delivery.json_file("result.json")
      {"schema"=>"stellar-forge.ruby-customer-result.v1","state"=>"RECEIVED","businessKeySha256"=>Receiving.key_id(key),
        "intentId"=>delivery.manifest["intentId"],"sourceSha256"=>delivery.manifest["sourceSha256"],
        "rubyManifestSha256"=>package_sha,"directory"=>delivery.directory,"manifestSha256"=>delivery.manifest_sha256,
        "response"=>delivery.descriptor("response.bin"),"nativeStatus"=>native.dig("native","status"),
        "nativeExitCode"=>native["exitCode"],"nativeRuntimeError"=>native["runtimeError"],
        "files"=>delivery.manifest["files"]}
    end
    def main(argv)
      command = argv.shift
      values = {package: __dir__}
      parser = OptionParser.new do |options|
        options.banner = "ruby customer.rb contract|prepare|review|execute|recover|receive|status|run|reopen [options]"
        options.on("--package DIRECTORY","Complete generated Ruby seller package") { |v| values[:package] = v }
        options.on("--settings FILE","Original private host/customer settings") { |v| values[:settings] = v }
        options.on("--request FILE","Actual operation/input/atomic-limit JSON; omit to reopen the retained request") { |v| values[:request] = v }
        options.on("--key KEY","Stable application business-job key") { |v| values[:key] = v }
        options.on("--jobs-directory DIRECTORY","Original jobs root for offline reopen") { |v| values[:jobs] = v }
        options.on("--manifest-sha256 HASH","Expected original receiving manifest for offline reopen") { |v| values[:manifest] = v }
        options.on("--execute","For run only: invoke the original explicit operator execution") { values[:execute] = true }
        options.on("--help") { puts options; return 0 }
      end
      parser.parse!(argv)
      Files.need(argv.empty? && %w[contract prepare review execute recover receive status run reopen].include?(command),
        "RUBY_CUSTOMER_COMMAND_REQUIRED")
      Files.need(!values[:execute] || command == "run", "RUBY_EXECUTE_OPTION_INVALID")
      if command == "reopen"
        Files.need(values[:jobs] && values[:key], "RUBY_OFFLINE_SELECTION_REQUIRED")
        same_request!(File.join(File.expand_path(values[:jobs]),Receiving.key_id(values[:key])),values[:request])
        delivery = Receiving.received(directory: values[:jobs],key: values[:key],
          expected_manifest_sha256: values[:manifest])
        puts Files.json({"state"=>"REOPENED","intentId"=>delivery.manifest["intentId"],
          "directory"=>delivery.directory,"manifestSha256"=>delivery.manifest_sha256,
          "response"=>delivery.descriptor("response.bin")})
        return 0
      end
      if command == "contract"
        client = SellerClient.new(values[:package])
        puts Files.json({"source"=>client.source,"operations"=>client.operations,"rubyManifestSha256"=>client.manifest_sha256})
        return 0
      end
      Files.need(values[:settings] && values[:key], "RUBY_CUSTOMER_SELECTION_REQUIRED")
      selected,settings_bytes = settings(values[:settings])
      job_directory = File.join(File.expand_path(selected["jobsDirectory"]),Receiving.key_id(values[:key]))
      # A completed repeat reads only the exact original customer packet.
      if File.file?(File.join(job_directory,"received.json"))
        same_request!(job_directory,values[:request])
        Files.need(Files.read(File.join(job_directory,"customer-settings.json"),131_072) == settings_bytes,
          "RUBY_CUSTOMER_SETTINGS_CHANGED")
        delivery = Receiving.received(directory: selected["jobsDirectory"],key: values[:key],
          expected_manifest_sha256: values[:manifest])
        result = received_result(delivery,values[:key],
          Files.parse(Files.read(File.join(job_directory,"job.json"),131_072)).fetch("rubyManifestSha256"))
        if File.file?(File.join(job_directory,"customer-result.json"))
          Files.need(Files.parse(Files.read(File.join(job_directory,"customer-result.json"))) == result,
            "RUBY_CUSTOMER_RESULT_CHANGED")
        end
        Files.once(File.join(job_directory,"customer-result.json"),Files.json(result))
        puts Files.json(result)
        return 0
      end
      Files.directory(selected["jobsDirectory"],create: true)
      Files.directory(job_directory,create: true)
      selected_request = Files.lock(job_directory) do
        Files.once(File.join(job_directory,"customer-settings.json"),settings_bytes)
        retain_request(job_directory,values[:request])
      end
      client = SellerClient.new(values[:package],node: selected.fetch("node","node"))
      buyer = Buyer.new(client: client,runtime_directory: selected["runtimeDirectory"],
        state_directory: selected["buyerDirectory"],node: selected.fetch("node","node"),
        operator_profile: selected["operatorProfile"],workspace_directory: selected["workspaceDirectory"],
        timeout: selected.fetch("timeout",420),output_limit: selected.fetch("outputLimit",16_777_216))
      begin
        bound = File.file?(File.join(job_directory,"request","request-plan.json")) ?
          client.load_request(File.join(job_directory,"request")) : request(client,selected_request,values[:key])
        job = Receiving.new(client: client,buyer: buyer,directory: selected["jobsDirectory"],key: values[:key],
          bound: bound,response_file: selected["responseFile"])
        value = case command
        when "prepare"
          job.prepare
          job.status
        when "review"
          job.review
        when "execute"
          job.execute(review: job.review)
        when "recover"
          {"intentId"=>job.intent_id,"originalResult"=>job.recover}
        when "status"
          job.status
        when "receive"
          delivery = job.receive
          received_result(delivery,values[:key],client.manifest_sha256)
        when "run"
          job.prepare
          review = job.review
          original = job.recover
          original = job.execute(review: review) if original.nil? && values[:execute]
          if original && original.dig("delivery","status") == "SAVED"
            delivery = job.receive
            received_result(delivery,values[:key],client.manifest_sha256)
          else
            {"state"=>original ? "ORIGINAL_RESULT" : "REVIEW_READY","intentId"=>job.intent_id,
              "review"=>review,"originalResult"=>original}
          end
        end
        Files.once(File.join(job.directory,"customer-result.json"),Files.json(value)) if value && value["state"] == "RECEIVED"
        puts Files.json(value)
      ensure
        buyer.close
      end
      0
    end
  end
end

if $PROGRAM_NAME == __FILE__
  begin
    exit Starforge::CustomerCommand.main(ARGV)
  rescue Starforge::Error => error
    warn Starforge::Files.json({"error"=>error.code,"callId"=>error.call_id,"intentId"=>error.intent_id})
    exit 2
  rescue OptionParser::ParseError, ArgumentError, SystemCallError
    warn Starforge::Files.json({"error"=>"RUBY_CUSTOMER_INPUT_OR_IO_FAILED"})
    exit 2
  end
end
