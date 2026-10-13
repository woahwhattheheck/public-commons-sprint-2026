#!/usr/bin/env ruby
# frozen_string_literal: true
# MIT. Receive, map, review and import the application's original complete source.
require_relative "records_cli"

module StarforgeDatasetSourceCLI
  module_function

  def parse(argv)
    values = {}
    parser = OptionParser.new do |options|
      options.banner = "source_cli.rb COMMAND --review UUID [selection]"
      options.on("--tenant KEY") { |value| values[:tenant] = value }
      options.on("--application DIRECTORY") { |value| values[:application] = value }
      options.on("--runtime-source DIRECTORY") { |value| values[:runtime_source] = value }
      options.on("--environment DIRECTORY") { |value| values[:environment] = value }
      options.on("--review UUID") { |value| values[:review] = value }
      options.on("--candidate ID") { |value| values[:candidate] = value }
      options.on("--selection-sha256 SHA256") { |value| values[:selection_sha256] = value }
      options.on("--id UUID") { |value| values[:id] = value }
      options.on("--actor ID") { |value| values[:actor] = value }
      options.on("--context-sha256 SHA256") { |value| values[:context_sha256] = value }
      options.on("--preview-sha256 SHA256") { |value| values[:preview_sha256] = value }
      options.on("--input FILE") { |value| values[:input] = value }
      options.on("--page INTEGER", Integer) { |value| values[:page] = value }
      options.on("--group NAME") { |value| values[:group] = value }
      options.on("--before CURSOR") { |value| values[:before] = value }
      options.on("--limit INTEGER", Integer) { |value| values[:limit] = value }
      options.on("--format FORMAT") { |value| values[:format] = value }
      options.on("--name NAME") { |value| values[:name] = value }
      options.on("--edition ID") { |value| values[:edition] = value }
      options.on("--out FILE") { |value| values[:out] = value }
      options.on("--help") { values[:help] = true }
    end
    command = argv.first && !argv.first.start_with?("-") ? argv.shift : nil
    parser.parse!(argv)
    raise ArgumentError, "Unexpected arguments: " + argv.join(" ") unless argv.empty?
    [command, values, parser]
  end

  def required(options,key)
    options.fetch(key) { raise ArgumentError, "Select --" + key.to_s.tr("_","-") }
  end

  def input(options)
    Starforge::Files.parse(Starforge::Files.read(required(options,:input), 1_048_576))
  end

  def result(value, options)
    if value.is_a?(Starforge::DatasetOperator::Download)
      StarforgeDatasetRecordsCLI.save_download(value, options)
    else
      StarforgeDatasetRecordsCLI.save_result(value, options)
    end
  end

  def main(argv = ARGV)
    command, options, parser = parse(argv.dup)
    if options[:help] || !command
      puts parser
      puts <<~GUIDE

        Source and original selection:
          candidates       Read the application's authorized received-source catalogue.
          select           Retain --review, --candidate and --selection-sha256 with --actor.
          prepare-source   Receive and profile every original source row under that review.
          summary          Read its complete source schema, profiles and file identities.
          rows             Read a full 100-row source page; --page is zero-based.
          source-export    Write the original --format csv or jsonl bytes to --out.
          handoff          Write the complete original review/source TAR to --out.
          status           Read the saved selection, current phase and available review.
          list             Read the tenant's retained reviews; continue with --before.

        Application mapping and complete import:
          target           Read actual supported target columns and current key binding.
          context          Read the complete source/target mapping context.
          mapping          Read or save the selected mapping through its original exporter.
          remap            Save --input mapping JSON as --id, using --context-sha256 and --actor.
          remap-form       Save the original mapping form JSON with the same selected fields.
          prepare-import   Build the whole target-change preview for the selected --review.
          preview          Read that saved import preview summary.
          changes          Read --group all/inserted/updated/unchanged/removed/adopted/restored/source_changed.
          approve          Retain --preview-sha256 and --actor on that same review.
          commit           Apply its original saved approval and reopen the complete receipt.
          export           Receive --name preview.json/preview.csv/mapping.json/receipt.json to --out.
          history          Read the original stream's retained editions, with --before pagination.
          receipt          Receive the complete --edition original receipt and rows to --out.

        Existing Rails application:
          bin/rails runner /absolute/operator/source_cli.rb candidates --tenant ACCOUNT
          bin/rails runner /absolute/operator/source_cli.rb prepare-source --tenant ACCOUNT --review UUID

        Managed received application:
          bundle exec ruby /absolute/operator/source_cli.rb summary \
            --application PRIVATE_APP --runtime-source INSTALLED_RUBY_RUNTIME \
            --environment PRIVATE_ENVIRONMENT --review UUID

        Complete operation:
          Select one original candidate with a persistent review UUID and its selection hash.
          Prepare its whole source, inspect profiles/pages and save the complete mapping context.
          Submit mapping JSON with a new persistent --id and that exact context hash.
          Use the returned new review for prepare-import, preview and complete preview export.
          Approve its exact preview SHA, commit, then receive the full original receipt/handoff.
          An interrupted phase resumes with the same review or remap ID and original input.

        The application declares the target model, tenant scope, streams and source catalogue.
        Original JSON numbers and values remain in raw source rows and exact tagged values_json.
        All output files are created once and verified on retry; use the original output path.
        A source-only handoff remains available before the configured mapping can be imported.
      GUIDE
      return
    end

    allowed = %w[candidates select prepare-source summary rows source-export handoff status list
      target context mapping remap remap-form prepare-import preview changes approve commit
      export history receipt]
    raise ArgumentError, "Unknown command #{command}" unless allowed.include?(command)
    if options.key?(:limit)
      raise ArgumentError, "Select --limit between 1 and 100" unless options[:limit].between?(1,100)
    end
    if options.key?(:page)
      raise ArgumentError, "Select a nonnegative --page" unless options[:page] >= 0
    end
    owner = StarforgeDatasetRecordsCLI.original_workspace(options)
    raise ArgumentError, "Open the complete source-mapping operator edition" unless
      owner.respond_to?(:prepare_source) && owner.respond_to?(:mapping_context) &&
      defined?(Starforge::RailsDataset::TargetContext)
    return result(owner.candidates, options) if command == "candidates"
    return result(owner.list(before:options[:before],limit:options.fetch(:limit,30)), options) if command == "list"

    id = required(options,:review)
    value = case command
    when "select"
      owner.select(id:id,candidate_id:required(options,:candidate),
        selection_sha256:required(options,:selection_sha256),actor:required(options,:actor))
    when "prepare-source"
      owner.prepare_source(id)
    when "summary"
      owner.source_summary(id)
    when "rows"
      owner.source_rows(id,page:options.fetch(:page,0))
    when "source-export"
      owner.source_export(id,format:required(options,:format))
    when "handoff"
      owner.handoff(id)
    when "status"
      owner.detail(id)
    when "target"
      owner.mapping_target(id)
    when "context"
      owner.mapping_context(id)
    when "mapping"
      owner.mapping_export(id)
    when "remap"
      owner.remap(id,new_id:required(options,:id),actor:required(options,:actor),
        mapping:input(options),expected_context_sha256:required(options,:context_sha256))
    when "remap-form"
      owner.remap_form(id,new_id:required(options,:id),actor:required(options,:actor),
        form:input(options),expected_context_sha256:required(options,:context_sha256))
    when "prepare-import"
      owner.prepare(id)
    when "preview"
      owner.review(id)
    when "changes"
      owner.changes(id,group:options.fetch(:group,"all"),page:options.fetch(:page,0))
    when "approve"
      owner.approve(id,preview_sha256:required(options,:preview_sha256),actor:required(options,:actor))
    when "commit"
      owner.commit(id)
    when "export"
      owner.export(id,required(options,:name))
    when "history"
      owner.history(id,before:options[:before],limit:options.fetch(:limit,50))
    when "receipt"
      owner.historical_receipt(id,required(options,:edition))
    end
    result(value, options)
  end
end

if File.expand_path($PROGRAM_NAME) == File.expand_path(__FILE__)
  saved_umask = File.umask(0077)
  begin
    StarforgeDatasetSourceCLI.main
  rescue Exception => error
    warn JSON.generate({"error"=>{"code"=>error.respond_to?(:code) ? error.code : error.class.name,
      "message"=>error.message.to_s[0,4000]}})
    exit 1
  ensure
    File.umask(saved_umask)
  end
end
