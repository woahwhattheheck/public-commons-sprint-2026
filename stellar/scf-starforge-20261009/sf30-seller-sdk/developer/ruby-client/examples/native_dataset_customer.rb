#!/usr/bin/env ruby
# frozen_string_literal: true
# MIT. Receive and use a complete original finalized SF100 room.
require "optparse"
require_relative(File.file?(File.join(__dir__,"native_dataset_receiving.rb")) ?
  "native_dataset_receiving" : "../native_dataset_receiving")

module Starforge
  module NativeDatasetCommand
    module_function
    def open_delivery(options)
      if options[:directory]
        Files.need(!options[:delivery] && !options[:manifest], "RUBY_NATIVE_DATASET_ONE_SELECTION")
        NativeDatasetReceiving.received(directory: options[:directory])
      else
        Files.need(options[:delivery] && options[:manifest], "RUBY_NATIVE_DATASET_DELIVERY_REQUIRED")
        delivery = DatasetDelivery.open(options[:delivery],expected_manifest_sha256: options[:manifest])
        Files.need(delivery.is_a?(NativeDatasetDelivery), "RUBY_NATIVE_DATASET_DELIVERY_REQUIRED")
        delivery
      end
    end

    def summary(delivery)
      {"schema"=>NativeDatasetReceiving::RESULT_SCHEMA,"state"=>"RECEIVED",
        "directory"=>delivery.directory,"manifestSha256"=>delivery.manifest_sha256,
        "sourceFormat"=>delivery.source_format,"sourceId"=>delivery.source_sha256,
        "datasetId"=>delivery.manifest["datasetId"],"sourceKey"=>delivery.manifest["sourceKey"],
        "snapshot"=>delivery.snapshot,"rowCount"=>delivery.row_count,"fields"=>delivery.fields,
        "membership"=>delivery.membership,"nativeSourceBindingSha256"=>delivery.manifest["sourceBindingSha256"],
        "nativeReceiptSha256"=>delivery.descriptor("native-receiving.json")["sha256"],
        "columns"=>delivery.native_receipt["columns"],
        "semantics"=>delivery.native_manifest["semantics"],"files"=>delivery.manifest["files"]}
    end

    def export_file(delivery, name, path)
      expected = delivery.descriptor(name)
      path = File.expand_path(path)
      parent = Files.directory(File.dirname(path))
      Files.need(path != File.join(delivery.directory,name), "RUBY_NATIVE_DATASET_EXPORT_DESTINATION_REQUIRED")
      temp = Tempfile.new([".native-dataset-export-", ".pending"],parent)
      begin
        temp.binmode
        delivery.each_chunk(name) { |bytes| temp.write(bytes) }
        temp.flush
        temp.fsync
        temp.close
        begin
          File.link(temp.path,path)
          Files.sync(parent)
        rescue Errno::EEXIST
          DatasetDelivery.snapshot_file(path,expected) { |_snapshot| }
        end
        {"path"=>path,"name"=>name,"bytes"=>expected["bytes"],"sha256"=>expected["sha256"],
          "manifestSha256"=>delivery.manifest_sha256}
      ensure
        temp.close!
      end
    end

    def main(argv)
      command = argv.shift
      options = {}
      parser = OptionParser.new do |o|
        o.banner = "ruby native_dataset_customer.rb COMMAND [options]"
        o.separator "receive --directory DIR --room ORIGINAL_ROOM --source-key KEY --dataset-id ID --native-manifest-sha256 SHA --checkout SOURCE --python ABS --node ABS"
        o.separator "resume|status --directory ORIGINAL_RECEIVING"
        o.separator "inspect|rows|copy|file --directory ORIGINAL_RECEIVING"
        o.separator "inspect|rows|copy|file --delivery COMPLETE_PACKET --manifest-sha256 SHA"
        o.separator "copy adds --out DIRECTORY; file adds --file ORIGINAL_NAME --out NEW_FILE"
        o.on("--directory DIRECTORY") { |v| options[:directory] = v }
        o.on("--room DIRECTORY") { |v| options[:room] = v }
        o.on("--source-key KEY") { |v| options[:source_key] = v }
        o.on("--dataset-id ID") { |v| options[:dataset_id] = v }
        o.on("--native-manifest-sha256 SHA") { |v| options[:native_manifest] = v }
        o.on("--checkout DIRECTORY") { |v| options[:checkout] = v }
        o.on("--python ABSOLUTE_PATH") { |v| options[:python] = v }
        o.on("--node ABSOLUTE_PATH") { |v| options[:node] = v }
        o.on("--delivery DIRECTORY") { |v| options[:delivery] = v }
        o.on("--manifest-sha256 SHA") { |v| options[:manifest] = v }
        o.on("--file NAME") { |v| options[:file] = v }
        o.on("--out PATH") { |v| options[:out] = v }
        o.on("--timeout SECONDS",Integer) { |v| options[:timeout] = v }
        o.on("-h","--help") { puts o; return 0 }
      end
      if command.nil? || %w[-h --help].include?(command)
        puts parser
        return 0
      end
      parser.parse!(argv)
      Files.need(argv.empty? && %w[receive resume status inspect rows copy file].include?(command),
        "RUBY_NATIVE_DATASET_COMMAND_INVALID")
      selection_keys = %i[directory delivery manifest]
      allowed = case command
      when "receive" then %i[directory room source_key dataset_id native_manifest checkout python node timeout]
      when "resume" then %i[directory timeout]
      when "status" then [:directory]
      when "inspect","rows" then selection_keys
      when "copy" then selection_keys+[:out]
      when "file" then selection_keys+%i[file out]
      end
      Files.need((options.keys-allowed).empty?, "RUBY_NATIVE_DATASET_COMMAND_OPTIONS_INVALID")
      interrupted = false
      cancellation = Object.new
      cancellation.define_singleton_method(:cancelled?) { interrupted }
      old_int = Signal.trap("INT") { interrupted = true }
      old_term = Signal.trap("TERM") { interrupted = true }
      begin
        result = case command
        when "receive"
          required = %i[directory room source_key dataset_id native_manifest checkout python node]
          Files.need(required.all? { |key| options[key] }, "RUBY_NATIVE_DATASET_SELECTION_REQUIRED")
          receiver = NativeDatasetReceiving.new(directory: options[:directory],room: options[:room],
            source_key: options[:source_key],dataset_id: options[:dataset_id],
            expected_native_manifest_sha256: options[:native_manifest],checkout: options[:checkout],
            python: options[:python],node: options[:node])
          summary(receiver.receive(cancel: cancellation,timeout: options.fetch(:timeout,1800)))
        when "resume"
          Files.need(options[:directory], "RUBY_NATIVE_DATASET_SELECTION_REQUIRED")
          summary(NativeDatasetReceiving.resume(directory: options[:directory],
            cancel: cancellation,timeout: options.fetch(:timeout,1800)))
        when "status"
          Files.need(options[:directory], "RUBY_NATIVE_DATASET_SELECTION_REQUIRED")
          NativeDatasetReceiving.status(directory: options[:directory])
        else
          delivery = open_delivery(options)
          case command
          when "inspect" then summary(delivery)
          when "rows"
            $stdout.binmode
            delivery.each_chunk("dataset.jsonl") { |bytes| $stdout.write(bytes) }
            return 0
          when "copy"
            Files.need(options[:out], "RUBY_NATIVE_DATASET_EXPORT_DESTINATION_REQUIRED")
            summary(delivery.copy_to(options[:out]))
          when "file"
            Files.need(options[:file] && options[:out], "RUBY_NATIVE_DATASET_EXPORT_SELECTION_REQUIRED")
            export_file(delivery,options[:file],options[:out])
          end
        end
        $stdout.write(Files.json(result))
        0
      ensure
        Signal.trap("INT",old_int)
        Signal.trap("TERM",old_term)
      end
    rescue Error, OptionParser::ParseError, SystemCallError => error
      code = error.respond_to?(:code) ? error.code : error.is_a?(OptionParser::ParseError) ?
        "RUBY_NATIVE_DATASET_COMMAND_INVALID" : "RUBY_NATIVE_DATASET_FILE_UNAVAILABLE"
      $stderr.write(JSON.generate({"error"=>code})+"\n")
      2
    end
  end
end
exit Starforge::NativeDatasetCommand.main(ARGV.dup) if File.expand_path($PROGRAM_NAME) == File.expand_path(__FILE__)
