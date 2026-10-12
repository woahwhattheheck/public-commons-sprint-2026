#!/usr/bin/env ruby
# frozen_string_literal: true
# MIT. Operate the existing application's committed dataset from its trusted CLI.
require "optparse"
require "json"

module StarforgeDatasetRecordsCLI
  module_function
  def parse(argv)
    values = {}
    parser = OptionParser.new do |options|
      options.banner = "records_cli.rb COMMAND --review UUID [selection]"
      options.on("--tenant KEY") { |value| values[:tenant] = value }
      options.on("--application DIRECTORY") { |value| values[:application] = value }
      options.on("--runtime-source DIRECTORY") { |value| values[:runtime_source] = value }
      options.on("--environment DIRECTORY") { |value| values[:environment] = value }
      options.on("--review UUID") { |value| values[:review] = value }
      options.on("--capture UUID") { |value| values[:capture] = value }
      options.on("--id UUID") { |value| values[:id] = value }
      options.on("--actor ID") { |value| values[:actor] = value }
      options.on("--revision INTEGER",Integer) { |value| values[:revision] = value }
      options.on("--receipt-sha256 SHA256") { |value| values[:receipt_sha256] = value }
      options.on("--query SHA256") { |value| values[:query] = value }
      options.on("--input FILE") { |value| values[:input] = value }
      options.on("--key SHA256") { |value| values[:key] = value }
      options.on("--page INTEGER",Integer) { |value| values[:page] = value }
      options.on("--before CURSOR") { |value| values[:before] = value }
      options.on("--limit INTEGER",Integer) { |value| values[:limit] = value }
      options.on("--format FORMAT") { |value| values[:format] = value }
      options.on("--out FILE") { |value| values[:out] = value }
      options.on("--file NAME") { |value| values[:file] = value }
      options.on("--record-id ID") { |value| values[:record_id] = value }
      options.on("--column NAME") { |value| values[:column] = value }
      options.on("--index INTEGER",Integer) { |value| values[:index] = value }
      options.on("--help") { values[:help] = true }
    end
    command = argv.first && !argv.first.start_with?("-") ? argv.shift : nil
    parser.parse!(argv)
    raise ArgumentError,"Unexpected arguments: " + argv.join(" ") unless argv.empty?
    [command,values,parser]
  end

  def original_workspace(options)
    if options[:application]
      required = %i[application runtime_source environment]
      raise ArgumentError,"Select --application, --runtime-source and --environment together" unless required.all? { |key| options[key] }
      raise ArgumentError,"Use the managed application's retained tenant" if options[:tenant]
      runtime = File.realpath(options.fetch(:runtime_source))
      raise ArgumentError,"Select the exact original runtime directory" unless runtime == File.expand_path(options[:runtime_source])
      require File.join(runtime,"application")
      StarforgeRubyRuntime::Application.load_client(options.fetch(:environment))
      # A host may run this additive reader against an earlier compatible
      # Workspace. The original import/receipt classes are retained unchanged.
      require_relative "records" unless defined?(Starforge::DatasetOperator::Records)
      StarforgeRubyRuntime::Application.open_workspace(options.fetch(:application))
    else
      raise ArgumentError,"Use the managed options together" if options[:runtime_source] || options[:environment]
      require_relative "workspace"
      raise ArgumentError,"Select the authenticated application's tenant resolver with --tenant" unless options[:tenant]
      Starforge::DatasetOperator.workspace(options.fetch(:tenant))
    end
  end

  def save_result(value,options)
    bytes = Starforge::Files.json(value)
    if options[:out]
      path = File.expand_path(options.fetch(:out))
      Starforge::Files.directory(File.dirname(path))
      descriptor = Starforge::DatasetOperator::Store.write(path) { |io| io.write(bytes) }
      puts JSON.generate({"file"=>path,"bytes"=>descriptor.fetch("bytes"),"sha256"=>descriptor.fetch("sha256")})
    else
      STDOUT.write(bytes)
    end
  end

  def save_download(download,options)
    raise ArgumentError,"Select --out for a complete file download" unless options[:out]
    path = File.expand_path(options.fetch(:out))
    Starforge::Files.directory(File.dirname(path))
    descriptor = Starforge::DatasetOperator::Store.write(path) do |io|
      download.each { |chunk| io.write(chunk) }
    end
    Starforge::Files.need(descriptor.fetch("bytes") == download.bytes &&
      descriptor.fetch("sha256") == download.sha256,"DATASET_DATA_DOWNLOAD_CHANGED")
    puts JSON.generate({"file"=>path,"bytes"=>descriptor.fetch("bytes"),"sha256"=>descriptor.fetch("sha256"),
      "content_type"=>download.content_type})
  ensure
    download&.close
  end

  def main(argv = ARGV)
    command,options,parser = parse(argv.dup)
    if options[:help] || !command
      puts parser
      puts <<~GUIDE
        Commands:
          current      List retained captures and the current native edition.
          capture      Capture every working/source row with a retained UUID.
          resume       Complete the same selected capture after an interruption.
          status       Read one original capture request/result.
          query        Select a complete typed query from --input JSON.
          rows         Read --page of that exact retained --query.
          record       Read the full source/working row for --key.
          export       Write the complete selected CSV or exact JSON to --out.
          attachment   Receive the original row/alias/index file into --out.

        Existing Rails application:
          bin/rails runner /absolute/operator/records_cli.rb current --tenant ACCOUNT --review UUID
        Managed received application:
          bundle exec ruby /absolute/operator/records_cli.rb current \\
            --application PRIVATE_APP --runtime-source INSTALLED_RUBY_RUNTIME \\
            --environment PRIVATE_ENVIRONMENT --review UUID

        See records.md for complete capture, query, receiving and retry examples.
      GUIDE
      return
    end
    allowed = %w[current capture resume status query rows record export attachment]
    raise ArgumentError,"Unknown command #{command}" unless allowed.include?(command)
    owner = original_workspace(options)
    id = options.fetch(:review) { raise ArgumentError,"Select --review" }
    result = case command
    when "current"
      owner.data_captures(id,before: options[:before],limit: options.fetch(:limit,30))
    when "capture"
      owner.capture_data(id,id: options.fetch(:id),actor: options.fetch(:actor),
        expected_revision: options.fetch(:revision),expected_receipt_sha256: options.fetch(:receipt_sha256))
    when "resume"
      owner.complete_data_capture(id,options.fetch(:capture))
    when "status"
      owner.data_capture_state(id,options.fetch(:capture))
    when "query"
      input = Starforge::Files.parse(Starforge::Files.read(options.fetch(:input),1_048_576))
      owner.query_data(id,options.fetch(:capture),query: input)
    when "rows"
      owner.data_rows(id,options.fetch(:capture),options.fetch(:query),page: options.fetch(:page,0))
    when "record"
      owner.data_record(id,options.fetch(:capture),key_sha256: options.fetch(:key))
    when "export"
      return save_download(owner.data_export(id,options.fetch(:capture),options.fetch(:query),
        format: options.fetch(:format)),options)
    when "attachment"
      return save_download(owner.data_attachment(id,options.fetch(:capture),
        key_sha256: options.fetch(:key),file: options.fetch(:file),record_id: options.fetch(:record_id),
        column: options.fetch(:column),index: options.fetch(:index)),options)
    end
    save_result(result,options)
  end
end

if File.expand_path($PROGRAM_NAME) == File.expand_path(__FILE__)
  saved_umask = File.umask(0077)
  begin
    StarforgeDatasetRecordsCLI.main
  rescue Exception => error
    warn JSON.generate({"error"=>{"code"=>error.respond_to?(:code) ? error.code : error.class.name,
      "message"=>error.message.to_s[0,4000]}})
    exit 1
  ensure
    File.umask(saved_umask)
  end
end
