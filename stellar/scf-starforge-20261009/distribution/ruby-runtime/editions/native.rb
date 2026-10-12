# frozen_string_literal: true
# MIT. Later complete dataset editions in the original managed Rails application.
require_relative "../engine"

module StarforgeRubyRuntime
  module Editions
    extend StarforgeRubyRuntime
    module_function

    SCHEMA = "stellar-forge.ruby-application-data-edition.v1"
    READY = "stellar-forge.ruby-application-data-source.v1"
    UUID = /\A[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}\z/
    ID = /\A[A-Za-z0-9][A-Za-z0-9._-]{0,79}\z/
    FORMATS = %w[native baserow].freeze
    module Helpers
      module_function
      def same(left,right)
        Starforge::RailsDataset.fingerprint(left) == Starforge::RailsDataset.fingerprint(right)
      end
    end

    def edition_path(root,id,create: false)
      need(id.is_a?(String) && ID.match?(id),"RUBY_EDITION_ID_INVALID")
      base = File.join(root,"data-editions")
      private_directory(base,create: true) if create
      private_directory(File.join(base,id),create: create)
    end
    def review_id(value)
      need(value.is_a?(String) && UUID.match?(value),"RUBY_EDITION_REVIEW_ID_INVALID")
      value
    end
    def actor(value)
      need(value.is_a?(String) && !value.strip.empty? && value.bytesize <= 512 &&
        value.valid_encoding? && !value.include?("\0"),"RUBY_EDITION_ACTOR_REQUIRED")
      value
    end
    def opener(format,directory,sha)
      need(FORMATS.include?(format) && HASH.match?(sha.to_s),"RUBY_EDITION_SOURCE_INVALID")
      if format == "native"
        Application::NativePackage.open(directory,sha)
      else
        Starforge::BaserowCustomerDelivery.open(directory: directory,expected_manifest_sha256: sha)
      end
    end
    def baseline(root)
      marker = parse(File.join(root,Application::MARKER))
      need(marker["schema"] == "stellar-forge.managed-ruby-application.v1",
        "RUBY_APPLICATION_MARKER_INVALID")
      package,key,mapping = Application.base_package(root,marker)
      {root: root,marker: marker,base: package,key: key,mapping: mapping,
        tenant: Starforge::NativeDatasetLifecycle::TENANT}
    end
    def context(root,connect: true)
      data = baseline(private_directory(root))
      database = if data.fetch(:marker).fetch("format") == "native"
        original = File.join(root,"application.sqlite3")
        working = File.join(root,"operating.sqlite3")
        copy_file(original,working,file_descriptor(original)) unless File.exist?(working)
        working
      else
        File.join(root,"application.sqlite3")
      end
      if connect
        current = begin
          ActiveRecord::Base.connection_db_config&.configuration_hash
        rescue ActiveRecord::ConnectionNotEstablished
          nil
        end
        selected = current && current[:adapter] == "sqlite3" &&
          File.expand_path(current.fetch(:database)) == database
        Starforge::NativeDatasetLifecycle.connect(database) unless selected && ActiveRecord::Base.connected?
      end
      streams = Starforge::DatasetExample::DatasetStream.where(tenant_key: data.fetch(:tenant))
      stream = streams.find_by!(name: data.fetch(:key))
      data.merge(database: database,streams: streams,stream: stream)
    end
    def source_record(root,id,data = nil)
      path = edition_path(root,id)
      selected = parse(File.join(path,"selection.json"))
      need(selected["schema"] == SCHEMA && selected["id"] == id &&
        selected["source"].is_a?(Hash) && FORMATS.include?(selected.dig("source","format")) &&
        HASH.match?(selected.dig("source","manifestSha256").to_s) &&
        identity(selected.reject { |key,_| key == "sha256" }) == selected["sha256"],
        "RUBY_EDITION_SELECTION_CHANGED")
      current = data || baseline(root)
      need(selected["originalApplicationManifestSha256"] == current.fetch(:marker).fetch("originalManifestSha256") &&
        selected["tenantKey"] == current.fetch(:tenant) && selected["sourceKey"] == current.fetch(:key) &&
        selected["mappingSha256"] == Starforge::RailsDataset.fingerprint(current.fetch(:mapping)),
        "RUBY_EDITION_APPLICATION_CHANGED")
      selected
    end
    def ready(root,id,data = nil)
      selected = source_record(root,id,data)
      value = parse(File.join(edition_path(root,id),"source.json"))
      need(value["schema"] == READY && value["selectionSha256"] == selected.fetch("sha256") &&
        value["format"] == selected.dig("source","format") &&
        value["manifestSha256"] == selected.dig("source","manifestSha256") &&
        HASH.match?(value["datasetManifestSha256"].to_s) && HASH.match?(value["sourceSha256"].to_s),
        "RUBY_EDITION_SOURCE_CHANGED")
      [selected,value]
    end
    def complete_sources(data)
      root = data.fetch(:root)
      base = File.join(root,"data-editions")
      return [] unless File.directory?(base)
      private_directory(base)
      Dir.children(base).sort.filter_map do |id|
        next unless ID.match?(id)
        path = edition_path(root,id)
        next unless File.exist?(File.join(path,"source.json"))
        selected,source = ready(root,id,data)
        {"id"=>"data-edition-" + id,"title"=>selected.fetch("title"),
          "stream_id"=>data.fetch(:stream).id,"directory"=>File.join(path,"source"),
          "format"=>source.fetch("format"),"manifest_sha256"=>source.fetch("manifestSha256"),
          "mapping"=>data.fetch(:mapping)}
      end
    end
    def workspace(root,data = nil)
      data ||= context(root)
      base = data.fetch(:base)
      format = data.fetch(:marker).fetch("format")
      folder = format == "native" ? "dataset" : "customer"
      catalog = lambda {
        [{"id"=>"received-" + format,"title"=>"Original received " + format + " dataset",
          "stream_id"=>data.fetch(:stream).id,"directory"=>File.join(root,folder),
          "format"=>format,"manifest_sha256"=>base.manifest_sha256,"mapping"=>data.fetch(:mapping)}] +
          complete_sources(data)
      }
      Starforge::DatasetOperator::Workspace.new(directory: File.join(root,"operator"),
        tenant_key: data.fetch(:tenant),streams: data.fetch(:streams),
        target_scope: lambda { |_stream|
          Starforge::NativeDatasetLifecycle::SourceRow.where(tenant_key: data.fetch(:tenant))
        },models: Starforge::DatasetExample::MODELS,catalog: catalog,
        formats: FORMATS.to_h { |kind| [kind,lambda { |directory,sha| opener(kind,directory,sha) }] })
    end
    def importer(data,package,mapping = nil)
      Starforge::RailsDataset.new(delivery: package.dataset,
        scope: Starforge::NativeDatasetLifecycle::SourceRow.where(tenant_key: data.fetch(:tenant)),
        stream: data.fetch(:stream),models: Starforge::DatasetExample::MODELS,
        mapping: mapping || data.fetch(:mapping))
    end
    def review_directory(root,tenant)
      File.join(root,"operator",Digest::SHA256.hexdigest(tenant))
    end
    def reviews(data)
      root = review_directory(data.fetch(:root),data.fetch(:tenant))
      return [] unless File.directory?(root)
      private_directory(root)
      Dir.children(root).sort.filter_map do |id|
        next unless UUID.match?(id)
        path = File.join(root,id)
        next unless File.exist?(File.join(path,"selection.json"))
        value = parse(File.join(path,"selection.json"))
        [id,value]
      end
    end
    # The database commit already selects the current edition and operation.
    # Resolve that original operation's retained source; a second file pointer
    # would otherwise leave an interruption window after the SQL commit.
    def current_package(root,data = nil)
      data ||= context(root)
      stream = data.fetch(:stream).reload
      latest = Starforge::DatasetExample::DatasetEdition.where(
        dataset_stream_id: stream.id,id: stream.latest_edition_id).take!
      original = reviews(data).select { |_id,value|
        value["operation_key"].is_a?(String) &&
          Digest::SHA256.hexdigest(value["operation_key"]) == latest.operation_sha256
      }
      need(original.length <= 1,"RUBY_EDITION_OPERATION_AMBIGUOUS")
      if original.any?
        id = original.first.first
        owner = workspace(root,data)
        chosen = owner.selection(id)
        need(chosen.dig("candidate","stream_id").to_s == stream.id.to_s,
          "RUBY_EDITION_STREAM_CHANGED")
        package = owner.selected_delivery(id)
        mapping = chosen.fetch("candidate").fetch("mapping")
      else
        package,mapping = data.fetch(:base),data.fetch(:mapping)
      end
      value = importer(data,package,mapping)
      binding = value.binding
      receipt = value.verified_receipt(latest)
      need(latest.manifest_sha256 == package.dataset.manifest_sha256 &&
        latest.source_sha256 == package.dataset.source_sha256 &&
        latest.mapping_sha256 == binding.fetch("mapping_sha256"),
        "RUBY_EDITION_CURRENT_SOURCE_CHANGED")
      [package,data.fetch(:key),mapping,receipt]
    end
    def verify_current_targets(value,delivery,data)
      preview = value.preview
      begin
        summary = preview.summary
        counts = summary.fetch("counts")
        need(summary.fetch("row_count") == delivery.row_count &&
          counts.fetch("unchanged") == delivery.row_count &&
          %w[inserted updated removed adopted restored source_changed].all? { |name| counts.fetch(name) == 0 },
          "RUBY_EDITION_CURRENT_TARGETS_CHANGED")
        seen = 0
        preview.each_entry do |entry|
          need(entry.fetch("action") == "unchanged","RUBY_EDITION_CURRENT_TARGETS_CHANGED")
          seen += 1
        end
        stream = data.fetch(:stream)
        active = Starforge::DatasetExample::DatasetRow.where(dataset_stream_id: stream.id,status: "active").count
        removed = Starforge::DatasetExample::DatasetRow.where(dataset_stream_id: stream.id,status: "removed").count
        need(seen == delivery.row_count && active == delivery.row_count,"RUBY_EDITION_CURRENT_TARGETS_CHANGED")
        summary.merge("active_source_rows"=>active,"retained_removed_keys"=>removed,
          "application_target_rows"=>Starforge::NativeDatasetLifecycle::SourceRow.where(
            tenant_key: data.fetch(:tenant)).count)
      ensure
        preview.close
      end
    end
    def stage(record,input)
      root = private_directory(record.fetch("directory"))
      data = context(root)
      id = input.fetch("editionId")
      path = edition_path(root,id,create: true)
      source = {"format"=>input.fetch("format"),"originalDirectory"=>File.expand_path(input.fetch("directory")),
        "manifestSha256"=>input.fetch("expectedManifestSha256")}
      need(FORMATS.include?(source["format"]) && HASH.match?(source["manifestSha256"].to_s),
        "RUBY_EDITION_SOURCE_INVALID")
      title = input.fetch("title")
      need(title.is_a?(String) && !title.strip.empty? && title.length <= 160 &&
        !title.include?("\0"),"RUBY_EDITION_TITLE_INVALID")
      original = {"schema"=>SCHEMA,"id"=>id,"title"=>title,
        "originalApplicationManifestSha256"=>data.fetch(:marker).fetch("originalManifestSha256"),
        "originalApplicationId"=>record.fetch("id"),"tenantKey"=>data.fetch(:tenant),
        "sourceKey"=>data.fetch(:key),"mappingSha256"=>Starforge::RailsDataset.fingerprint(data.fetch(:mapping)),
        "source"=>source,"requestId"=>input.fetch("operationId"),"actor"=>actor(input.fetch("actor"))}
      retained = optional(File.join(path,"selection.json"))
      if retained
        need(retained.reject { |key,_| %w[createdAt sha256].include?(key) } == original,
          "RUBY_EDITION_SELECTION_CHANGED")
        selected = source_record(root,id,data)
      else
        selected = original.merge("createdAt"=>stamp)
        selected["sha256"] = identity(selected)
        save(File.join(path,"selection.json"),selected)
      end
      destination = File.join(path,"source")
      ready_file = File.join(path,"source.json")
      unless File.exist?(ready_file)
        completed_name = source.fetch("format") == "native" ? Starforge::DatasetDelivery::MANIFEST :
          Starforge::BaserowCustomerDelivery::MANIFEST
        if File.exist?(File.join(destination,completed_name))
          package = opener(source.fetch("format"),destination,source.fetch("manifestSha256"))
        else
          original_folder = private_directory(source.fetch("originalDirectory"))
          need(original_folder != destination && !original_folder.start_with?(destination + "/") &&
            !destination.start_with?(original_folder + "/"),"RUBY_EDITION_SEPARATE_SOURCE")
          package = opener(source.fetch("format"),original_folder,source.fetch("manifestSha256"))
          package.copy_to(destination)
          package = opener(source.fetch("format"),destination,source.fetch("manifestSha256"))
        end
        value = importer(data,package)
        value.binding
        save(ready_file,{"schema"=>READY,"selectionSha256"=>selected.fetch("sha256"),
          "format"=>source.fetch("format"),"manifestSha256"=>package.manifest_sha256,
          "datasetManifestSha256"=>package.dataset.manifest_sha256,
          "sourceSha256"=>package.dataset.source_sha256,
          "membershipSha256"=>Starforge::RailsDataset.fingerprint(package.dataset.membership),
          "rows"=>package.dataset.row_count,"fields"=>package.dataset.fields,
          "files"=>inventory(destination)})
      end
      ready(root,id,data)
      prepare(record,input,data)
    end
    def prepare(record,input,data = nil)
      root = private_directory(record.fetch("directory"))
      data ||= context(root)
      id = input.fetch("editionId")
      selected,source = ready(root,id,data)
      review = review_id(input.fetch("reviewId"))
      owner = workspace(root,data)
      candidate = owner.candidates.find { |item| item["id"] == "data-edition-" + id }
      need(candidate,"RUBY_EDITION_SOURCE_INCOMPLETE")
      owner.select(id: review,candidate_id: candidate.fetch("id"),
        selection_sha256: candidate.fetch("selection_sha256"),actor: actor(input.fetch("actor")))
      owner.prepare(review)
      result(record,input,owner,"PREPARED",data)
    end
    def commit(record,input)
      root = private_directory(record.fetch("directory"))
      data = context(root)
      ready(root,input.fetch("editionId"),data)
      review = review_id(input.fetch("reviewId"))
      owner = workspace(root,data)
      chosen = owner.selection(review)
      need(chosen.dig("candidate","id") == "data-edition-" + input.fetch("editionId"),
        "RUBY_EDITION_REVIEW_CHANGED")
      owner.approve(review,preview_sha256: input.fetch("expectedPreviewSha256"),
        actor: actor(input.fetch("actor")))
      owner.commit(review)
      answer = result(record,input,owner,"COMMITTED",data)
      answer["application"] = Application.verify_working(root,http: false)
      answer
    end
    def result(record,input,owner,phase,data = nil)
      root = record.fetch("directory")
      id,review = input.fetch("editionId"),review_id(input.fetch("reviewId"))
      selected,source = ready(root,id,data)
      details = owner.detail(review)
      files = details.fetch("review").fetch("files").map do |file|
        file.merge("path"=>"operator/" + Digest::SHA256.hexdigest(selected.fetch("tenantKey")) +
          "/" + review + "/" + file.fetch("name"))
      end
      if details["committed"]
        file = details.fetch("committed").fetch("file")
        files << file.merge("path"=>"operator/" + Digest::SHA256.hexdigest(selected.fetch("tenantKey")) +
          "/" + review + "/" + file.fetch("name"))
      end
      {"schema"=>"stellar-forge.ruby-application-edition-operation.v1",
        "applicationId"=>record.fetch("id"),"editionId"=>id,"reviewId"=>review,
        "phase"=>phase,"selection"=>selected,"source"=>source,"detail"=>details,"files"=>files}
    end
    def run(record,input)
      root = private_directory(record.fetch("directory"))
      command = input.fetch("command")
      Starforge::Files.lock(root) do
        case command
        when "stage" then stage(record,input)
        when "prepare" then prepare(record,input)
        when "commit" then commit(record,input)
        else raise Error.new("RUBY_EDITION_COMMAND_INVALID")
        end
      end
    ensure
      Starforge::NativeDatasetLifecycle.disconnect
    end
  end
end
