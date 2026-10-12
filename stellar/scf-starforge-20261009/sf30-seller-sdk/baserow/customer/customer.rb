#!/usr/bin/env ruby
# frozen_string_literal: true
# MIT. Receive, inspect, copy and use a complete Baserow customer edition.
require "optparse"
require_relative "baserow_customer_receiving"

module Starforge
  module BaserowCustomerCommand
    module_function
    def delivery(options)
      if options[:directory]
        Files.need(!options[:delivery] && !options[:manifest],"BASEROW_CUSTOMER_ONE_DELIVERY_REQUIRED")
        BaserowCustomerReceiving.received(directory: options[:directory])
      else
        Files.need(options[:delivery] && options[:manifest],"BASEROW_CUSTOMER_DELIVERY_REQUIRED")
        BaserowCustomerDelivery.open(directory: options[:delivery],
          expected_manifest_sha256: options[:manifest])
      end
    end

    def summary(value)
      {"schema"=>"stellar-forge.ruby-baserow-customer-result.v1","state"=>"RECEIVED",
        "directory"=>value.directory,"manifest"=>BaserowCustomerDelivery::MANIFEST,
        "manifestSha256"=>value.manifest_sha256,"datasetId"=>value.manifest["datasetId"],
        "sourceKey"=>value.manifest["sourceKey"],"customerManifestSha256"=>value.customer_package.manifest_sha256,
        "datasetManifestSha256"=>value.dataset.manifest_sha256,
        "rowCount"=>value.dataset.row_count,"fields"=>value.dataset.fields,"snapshot"=>value.dataset.snapshot,
        "membership"=>value.dataset.membership,"source"=>value.source,
        "attachmentCount"=>value.attachments["files"].length,
        "attachmentReferenceCount"=>value.customer_package.manifest["attachments"]["referenceCount"],
        "attachmentBytes"=>value.customer_package.manifest["attachments"]["totalBytes"]}
    end

    def exported_file(path, descriptor, cancel: nil)
      target = File.expand_path(path)
      parent = Files.directory(File.dirname(target))
      temp = Tempfile.new([".baserow-export-", ".pending"],parent)
      begin
        temp.binmode
        yield lambda { |bytes|
          raise Error,"BASEROW_CUSTOMER_CANCELLED" if cancel&.cancelled?
          offset = 0
          while offset < bytes.bytesize
            written = temp.write(bytes.byteslice(offset,bytes.bytesize-offset))
            Files.need(written && written > 0,"BASEROW_CUSTOMER_EXPORT_INCOMPLETE")
            offset += written
          end
        }
        temp.flush
        temp.fsync
        temp.close
        DatasetDelivery.snapshot_file(temp.path,descriptor) { |_stream| }
        begin
          File.link(temp.path,target)
          Files.sync(parent)
        rescue Errno::EEXIST
          DatasetDelivery.snapshot_file(target,descriptor) { |_stream| }
        end
        {"file"=>target,"bytes"=>descriptor["bytes"],"sha256"=>descriptor["sha256"]}
      ensure
        temp.close!
      end
    end

    # Re-enter the retained request directly. A completed command can reopen
    # without the producer directory; changed explicit inputs remain an error.
    def receive(options, cancel)
      required = %i[package manifest directory dataset_id checkout python node]
      Files.need(required.all? { |key| options[key] },"BASEROW_CUSTOMER_RECEIVING_SELECTION_REQUIRED")
      root = File.expand_path(options[:directory])
      if File.exist?(File.join(root,"request.json"))
        _root,request,_raw = BaserowCustomerReceiving.request(root)
        runtime = request["runtime"]
        legacy_runtime = request["runtimePathMode"].nil?
        Files.need(request["customerDirectory"] == File.expand_path(options[:package]) &&
          request["customerManifestSha256"] == options[:manifest] &&
          request["datasetId"] == options[:dataset_id] &&
          runtime["checkout"] == File.expand_path(options[:checkout]) &&
          NativeDatasetReceiving.matches_executable?(options[:python],runtime["python"],legacy: legacy_runtime) &&
          NativeDatasetReceiving.matches_executable?(options[:node],runtime["node"],legacy: legacy_runtime),"BASEROW_CUSTOMER_REQUEST_CHANGED")
        BaserowCustomerReceiving.resume(directory: root,cancel: cancel,timeout: options.fetch(:timeout,1800))
      else
        package = BaserowCustomerPackage.open(directory: options[:package],
          expected_manifest_sha256: options[:manifest])
        receiver = BaserowCustomerReceiving.new(directory: root,customer_package: package,
          dataset_id: options[:dataset_id],checkout: options[:checkout],
          python: options[:python],node: options[:node])
        receiver.receive(cancel: cancel,timeout: options.fetch(:timeout,1800))
      end
    end

    def main(argv)
      command = argv.shift
      options = {}
      assign = lambda { |key,value|
        Files.need(!options.key?(key),"BASEROW_CUSTOMER_DUPLICATE_OPTION")
        options[key] = value
      }
      parser = OptionParser.new do |o|
        o.banner = "ruby customer.rb COMMAND [options]"
        o.separator "receive --package NODE_PACKET --manifest-sha256 SHA --directory JOB --dataset-id ID --checkout SOURCE --python ABS --node ABS"
        o.separator "resume|status --directory ORIGINAL_JOB"
        o.separator "inspect|rows|copy|file|attachments|attachment --directory ORIGINAL_JOB"
        o.separator "inspect|rows|copy|file|attachments|attachment --delivery COMPLETE_DELIVERY --manifest-sha256 SHA"
        o.separator "copy adds --out DIRECTORY; file adds --file ORIGINAL_DATASET_FILE --out FILE"
        o.separator "attachments adds [--offset N --limit N]; every file retains all original references"
        o.separator "attachment adds --file attachments/attachment-NNNNNN.bin --record-id ID --column ALIAS --out FILE"
        o.on("--package DIRECTORY") { |v| assign.call(:package,v) }
        o.on("--directory DIRECTORY") { |v| assign.call(:directory,v) }
        o.on("--delivery DIRECTORY") { |v| assign.call(:delivery,v) }
        o.on("--manifest-sha256 SHA") { |v| assign.call(:manifest,v) }
        o.on("--dataset-id ID") { |v| assign.call(:dataset_id,v) }
        o.on("--checkout DIRECTORY") { |v| assign.call(:checkout,v) }
        o.on("--python ABSOLUTE_PATH") { |v| assign.call(:python,v) }
        o.on("--node ABSOLUTE_PATH") { |v| assign.call(:node,v) }
        o.on("--out PATH") { |v| assign.call(:out,v) }
        o.on("--file NAME") { |v| assign.call(:file,v) }
        o.on("--record-id ID") { |v| assign.call(:record_id,v) }
        o.on("--column ALIAS") { |v| assign.call(:column,v) }
        o.on("--offset N",Integer) { |v| assign.call(:offset,v) }
        o.on("--limit N",Integer) { |v| assign.call(:limit,v) }
        o.on("--timeout SECONDS",Integer) { |v| assign.call(:timeout,v) }
        o.on("-h","--help") { puts o; return 0 }
      end
      if command.nil? || %w[-h --help].include?(command)
        puts parser
        return 0
      end
      parser.parse!(argv)
      Files.need(argv.empty? && %w[receive resume status inspect rows copy file attachments attachment].include?(command),
        "BASEROW_CUSTOMER_COMMAND_INVALID")
      selected = %i[directory delivery manifest]
      allowed = case command
      when "receive" then %i[package manifest directory dataset_id checkout python node timeout]
      when "resume" then %i[directory timeout]
      when "status" then [:directory]
      when "inspect","rows" then selected
      when "copy" then selected+[:out]
      when "file" then selected+%i[file out]
      when "attachments" then selected+%i[offset limit]
      when "attachment" then selected+%i[file record_id column out]
      end
      Files.need((options.keys-allowed).empty?,"BASEROW_CUSTOMER_COMMAND_OPTIONS_INVALID")
      Files.need(!options[:timeout] || options[:timeout].between?(1,7200),"BASEROW_CUSTOMER_TIMEOUT_INVALID")
      interrupted = false
      cancellation = Object.new
      cancellation.define_singleton_method(:cancelled?) { interrupted }
      previous_int = Signal.trap("INT") { interrupted = true }
      previous_term = Signal.trap("TERM") { interrupted = true }
      begin
        result = case command
        when "receive" then summary(receive(options,cancellation))
        when "resume"
          Files.need(options[:directory],"BASEROW_CUSTOMER_ORIGINAL_REQUEST_REQUIRED")
          summary(BaserowCustomerReceiving.resume(directory: options[:directory],
            cancel: cancellation,timeout: options.fetch(:timeout,1800)))
        when "status"
          Files.need(options[:directory],"BASEROW_CUSTOMER_ORIGINAL_REQUEST_REQUIRED")
          BaserowCustomerReceiving.status(directory: options[:directory])
        else
          value = delivery(options)
          case command
          when "inspect" then summary(value)
          when "rows"
            $stdout.binmode
            value.dataset.each_chunk("dataset.jsonl") do |bytes|
              raise Error,"BASEROW_CUSTOMER_CANCELLED" if cancellation.cancelled?
              $stdout.write(bytes)
            end
            return 0
          when "copy"
            Files.need(options[:out],"BASEROW_CUSTOMER_COPY_DESTINATION_REQUIRED")
            summary(value.copy_to(options[:out]))
          when "file"
            Files.need(options[:file] && options[:out],"BASEROW_CUSTOMER_FILE_SELECTION_REQUIRED")
            descriptor = value.dataset.descriptor(options[:file])
            exported_file(options[:out],descriptor,cancel: cancellation) { |write|
              value.dataset.each_chunk(options[:file]) { |bytes| write.call(bytes) }
            }.merge("manifestSha256"=>value.manifest_sha256,"datasetFile"=>options[:file])
          when "attachments"
            value.attachment_page(offset: options.fetch(:offset,0),limit: options.fetch(:limit,100))
          when "attachment"
            Files.need(%i[file record_id column out].all? { |key| options[key] },
              "BASEROW_CUSTOMER_ATTACHMENT_SELECTION_REQUIRED")
            result = nil
            value.attachment(file: options[:file],record_id: options[:record_id],column: options[:column]) do |io,metadata|
              result = exported_file(options[:out],metadata,cancel: cancellation) { |write|
                while (bytes = io.read(1_048_576))
                  write.call(bytes)
                end
              }.merge("manifestSha256"=>value.manifest_sha256,"attachment"=>metadata)
            end
            result
          end
        end
        $stdout.write(Files.json(result))
        0
      ensure
        Signal.trap("INT",previous_int)
        Signal.trap("TERM",previous_term)
      end
    rescue Error, OptionParser::ParseError, SystemCallError => issue
      code = issue.respond_to?(:code) ? issue.code : issue.is_a?(OptionParser::ParseError) ?
        "BASEROW_CUSTOMER_COMMAND_INVALID" : "BASEROW_CUSTOMER_FILE_UNAVAILABLE"
      $stderr.write(JSON.generate({"error"=>code})+"\n")
      2
    end
  end
end
exit Starforge::BaserowCustomerCommand.main(ARGV.dup) if File.expand_path($PROGRAM_NAME) == File.expand_path(__FILE__)
