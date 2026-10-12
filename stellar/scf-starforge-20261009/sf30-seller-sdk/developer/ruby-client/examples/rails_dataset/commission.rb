#!/usr/bin/env ruby
# frozen_string_literal: true
# MIT. Run through the original Rails application's bin/rails runner.
require "optparse"
require_relative "models"

module Starforge
  module DatasetExample
    module Commission
      module_function
      def run(arguments)
        options = {}
        parser = OptionParser.new do |o|
          o.banner = "bin/rails runner /absolute/package/examples/rails_dataset/commission.rb COMMAND -- [options]"
          o.separator "Commands: init, preview, commit, receipt, status"
          o.on("--tenant KEY", "Authenticated application's tenant key") { |v| options[:tenant] = v }
          o.on("--stream NAME", "Stable dataset stream within that tenant") { |v| options[:stream] = v }
          o.on("--delivery DIRECTORY", "Original complete received dataset") { |v| options[:delivery] = v }
          o.on("--manifest-sha256 SHA", "Selected dataset-customer.json SHA-256") { |v| options[:manifest] = v }
          o.on("--mapping PATH", "Application's explicit JSON field mapping") { |v| options[:mapping] = v }
          o.on("--out DIRECTORY", "Existing private complete-output directory") { |v| options[:out] = v }
          o.on("--operation KEY", "Stable application edition operation key") { |v| options[:operation] = v }
          o.on("--preview-sha256 SHA", "Exact full preview selected for commit") { |v| options[:preview] = v }
          o.on("-h", "--help") { puts o; return 0 }
        end
        command = arguments.shift
        if command.nil? || %w[-h --help].include?(command)
          puts parser
          return 0
        end
        # Rails runner retains all following arguments; accept its optional
        # delimiter without allowing unknown flags to disappear silently.
        arguments.shift if arguments.first == "--"
        parser.parse!(arguments)
        RailsDataset.need(arguments.empty? && %w[init preview commit receipt status].include?(command),
          "DATASET_COMMISSION_COMMAND")
        required = [:tenant, :stream]
        required += [:delivery, :manifest, :mapping] if %w[preview commit receipt].include?(command)
        required += [:out] if %w[preview receipt].include?(command)
        required += [:operation, :preview] if command == "commit"
        required += [:operation] if command == "receipt"
        required.each do |key|
          RailsDataset.need(options[key].is_a?(String) && !options[key].strip.empty?,
            "DATASET_COMMISSION_OPTION", option: key)
        end
        stream_scope = DatasetStream.where(tenant_key: options[:tenant], name: options[:stream])
        if command == "init"
          # The unique tenant/name index resolves concurrent job creation.
          stream = stream_scope.create_or_find_by!({})
          puts RailsDataset.json({"stream_id"=>stream.id.to_s, "tenant"=>stream.tenant_key,
            "name"=>stream.name, "revision"=>stream.revision})
          return 0
        end
        stream = stream_scope.take!
        if command == "status"
          editions = DatasetEdition.where(dataset_stream_id: stream.id)
          puts RailsDataset.json({"stream_id"=>stream.id.to_s, "tenant"=>stream.tenant_key, "name"=>stream.name,
            "revision"=>stream.revision, "latest_edition_id"=>stream.latest_edition_id&.to_s,
            "target_model"=>stream.target_model, "scope_sha256"=>stream.scope_sha256,
            "key_mapping_sha256"=>stream.key_mapping_sha256, "membership_sha256"=>stream.membership_sha256,
            "editions"=>editions.count,
            "active_keys"=>DatasetRow.where(dataset_stream_id: stream.id, status: "active").count,
            "removed_keys"=>DatasetRow.where(dataset_stream_id: stream.id, status: "removed").count})
          return 0
        end
        importer = DatasetExample.importer(stream: stream, tenant_key: options[:tenant],
          delivery_directory: options[:delivery], manifest_sha256: options[:manifest], mapping_path: options[:mapping])
        case command
        when "preview"
          directory = Files.directory(options[:out])
          preview = importer.preview
          begin
            stem = "preview-#{preview.sha256}"
            files = [
              Artifacts.write_once(File.join(directory, "#{stem}.json")) { |io| preview.write_json(io) },
              Artifacts.write_once(File.join(directory, "#{stem}.csv")) { |io| preview.write_csv(io) }
            ]
            puts RailsDataset.json(preview.summary.merge("outputs"=>files))
          ensure
            preview.close
          end
        when "commit"
          result = importer.import!(operation_key: options[:operation], expected_preview_sha256: options[:preview])
          if options[:out]
            directory = Files.directory(options[:out])
            name = "edition-#{result.fetch("revision")}-#{result.fetch("operation_sha256")}.json"
            output = Artifacts.write_once(File.join(directory,name)) do |io|
              importer.write_receipt(io, operation_key: options[:operation])
            end
            result = result.merge("complete_receipt"=>output)
          end
          puts RailsDataset.json(result)
        when "receipt"
          directory = Files.directory(options[:out])
          result = importer.receipt(operation_key: options[:operation])
          name = "edition-#{result.fetch("revision")}-#{result.fetch("operation_sha256")}.json"
          output = Artifacts.write_once(File.join(directory,name)) do |io|
            importer.write_receipt(io, operation_key: options[:operation])
          end
          puts RailsDataset.json(result.merge("complete_receipt"=>output))
        end
        0
      rescue Starforge::Error, RailsDataset::ImportError, OptionParser::ParseError => error
        warn JSON.generate({"error"=>error.respond_to?(:code) ? error.code : error.class.name,
          "details"=>error.respond_to?(:details) ? error.details : {"message"=>error.message}})
        2
      end
    end
  end
end

exit Starforge::DatasetExample::Commission.run(ARGV.dup) if File.expand_path($PROGRAM_NAME) == File.expand_path(__FILE__)
