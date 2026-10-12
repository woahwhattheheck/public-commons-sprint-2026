#!/usr/bin/env ruby
# frozen_string_literal: true
# MIT. Commission the complete original finalized dataset in a customer Rails
# data layer, export every preview/receipt row, and reopen its recipient offline.
require "optparse"
require_relative "../native_dataset_receiving"
require_relative "rails_dataset/models"
require_relative "rails_dataset/create_dataset_import_tables"

module Starforge
  module NativeDatasetLifecycle
    SCHEMA = "stellar-forge.ruby-native-dataset-lifecycle.v1"
    APP_SCHEMA = "stellar-forge.ruby-native-dataset-application.v1"
    APP_MANIFEST = "application-delivery.json"
    APP_FILES = %w[application.sqlite3 mapping.json selection.json receipt.json preview.json preview.csv edition.json].freeze
    DETACH_SCHEMA = "stellar-forge.ruby-native-dataset-producer-detach.v1"
    PRODUCER_PATHS = %w[lifecycle-input.json mapping.json commit-plan.json application-commit.json outputs recipient receiving application.sqlite3].freeze
    TENANT = "native-customer"
    TABLE = "starforge_native_dataset_records"
    class SourceRow < DatasetExample::Record
      self.table_name = TABLE
    end
    module_function

    def disconnect
      ActiveRecord::Base.connection_pool.disconnect! if ActiveRecord::Base.connected?
    end

    def connect(path)
      disconnect
      ActiveRecord::Base.establish_connection(adapter: "sqlite3",database: path,timeout: 5000)
      connection = ActiveRecord::Base.connection
      connection.execute("PRAGMA foreign_keys=ON")
      connection.execute("PRAGMA journal_mode=DELETE")
      SourceRow.reset_column_information
      connection
    end

    def mapping_for(delivery, selected_keys)
      keys = selected_keys.empty? && delivery.semantics&.dig("primaryKey","complete") == true ?
        delivery.semantics.fetch("primaryKey").fetch("projected") : selected_keys
      Files.need(keys.is_a?(Array) && !keys.empty? && keys.uniq == keys &&
        keys.all? { |key| delivery.fields.include?(key) }, "RUBY_NATIVE_DATASET_ORIGINAL_KEYS_REQUIRED")
      columns = delivery.native_receipt.fetch("columns")
      specs = columns.each_with_index.to_h do |column,index|
        name = format("value_%03d",index)
        native_type = column.fetch("type")
        type = {"string"=>"string","integer"=>"integer","number"=>"string","boolean"=>"boolean"}.fetch(native_type)
        [name,{"field"=>column.fetch("name"),"type"=>type,"null"=>"assign","missing"=>"error",
          "stringify"=>native_type == "number"}]
      end
      {"schema"=>"stellar-forge.rails-dataset-mapping.v1","columns"=>specs,
        "key_columns"=>keys.map { |key| specs.find { |_name,item| item["field"] == key }.first },
        "removal"=>{"strategy"=>"retain"}}
    end

    def initialize_database(path, delivery, mapping)
      connection = connect(path)
      names = %w[starforge_dataset_streams starforge_dataset_editions starforge_dataset_rows
        starforge_dataset_entries starforge_dataset_catalog_records]
      present = names.map { |name| connection.table_exists?(name) }
      Files.need(present.all? || present.none?, "RUBY_NATIVE_DATASET_APPLICATION_SCHEMA_INCOMPLETE")
      unless present.all?
        connection.transaction do
          ActiveRecord::Migration.suppress_messages { CreateDatasetImportTables.new.migrate(:up) }
          connection.create_table(TABLE) do |table|
            table.string :tenant_key,null: false,limit: 128
            delivery.native_receipt.fetch("columns").each_with_index do |column,index|
              name = format("value_%03d",index)
              options = {null: column.fetch("nullable")}
              case column.fetch("type")
              when "integer" then table.bigint(name,**options)
              when "boolean" then table.boolean(name,**options)
              else table.text(name,**options)
              end
            end
            table.integer :lock_version,null: false,default: 0
            table.timestamps
          end
          connection.add_index(TABLE,["tenant_key"]+mapping.fetch("key_columns"),
            unique: true,name: "sf_native_source_key")
        end
      end
      Files.need(connection.table_exists?(TABLE), "RUBY_NATIVE_DATASET_APPLICATION_SCHEMA_INCOMPLETE")
      SourceRow.reset_column_information
      Files.need(File.stat(path).uid == Process.uid && (File.stat(path).mode & 0077).zero?,
        "RUBY_NATIVE_DATASET_PRIVATE_DATABASE_REQUIRED")
    end

    def importer(delivery, source_key, mapping)
      stream = DatasetExample::DatasetStream.where(tenant_key: TENANT,name: source_key).take!
      RailsDataset.new(delivery: delivery,scope: SourceRow.where(tenant_key: TENANT),
        stream: stream,models: DatasetExample::MODELS,mapping: mapping)
    end

    def file_descriptor(path)
      File.open(path,File::RDONLY | File::NOFOLLOW | File::NONBLOCK) do |file|
        before = file.stat
        Files.need(before.file? && before.uid == Process.uid && (before.mode & 0077).zero?,
          "RUBY_NATIVE_DATASET_PRIVATE_OUTPUT_REQUIRED")
        digest,count = Digest::SHA256.new,0
        while (chunk = file.read(1_048_576))
          digest.update(chunk)
          count += chunk.bytesize
        end
        after = file.stat
        Files.need(count == before.size && [before.dev,before.ino,before.size,before.mtime,before.ctime] ==
          [after.dev,after.ino,after.size,after.mtime,after.ctime], "RUBY_NATIVE_DATASET_OUTPUT_CHANGED")
        {"path"=>path,"bytes"=>count,"sha256"=>digest.hexdigest}
      end
    end

    def write_output(path,&block)
      DatasetExample::Artifacts.write_once(path,&block)
    end


    def descriptor_at(root, relative)
      file_descriptor(File.join(root,relative)).merge("path"=>relative)
    end

    # Verify the complete selected file while writing the unpublished output.
    # Its size may exceed the native dataset input ceiling (database/history).
    def copy_output(source_path, target_path, expected)
      write_output(target_path) do |io|
        File.open(source_path,File::RDONLY | File::NOFOLLOW | File::NONBLOCK) do |source|
          before = source.stat
          Files.need(before.file? && before.uid == Process.uid && (before.mode & 0077).zero? &&
            before.size == expected.fetch("bytes"), "RUBY_NATIVE_DATASET_PRIVATE_OUTPUT_REQUIRED")
          count,digest = 0,Digest::SHA256.new
          while (chunk = source.read(1_048_576))
            count += chunk.bytesize
            Files.need(count <= expected.fetch("bytes"), "RUBY_NATIVE_DATASET_OUTPUT_CHANGED")
            digest.update(chunk)
            written = 0
            while written < chunk.bytesize
              amount = io.write(chunk.byteslice(written,chunk.bytesize-written))
              Files.need(amount.is_a?(Integer) && amount > 0, "RUBY_NATIVE_DATASET_OUTPUT_WRITE")
              written += amount
            end
          end
          after = source.stat
          Files.need(count == expected.fetch("bytes") && digest.hexdigest == expected.fetch("sha256") &&
            [before.dev,before.ino,before.size,before.mtime,before.ctime] ==
            [after.dev,after.ino,after.size,after.mtime,after.ctime], "RUBY_NATIVE_DATASET_OUTPUT_CHANGED")
        end
      end
    end

    def receiving_database(recipient, expected)
      artifact = File.join(recipient,"application.sqlite3")
      working = File.join(recipient,"readback.sqlite3")
      unless File.exist?(working) || File.symlink?(working)
        copy_output(artifact,working,expected)
      end
      File.open(working,File::RDONLY | File::NOFOLLOW | File::NONBLOCK) do |file|
        stat = file.stat
        Files.need(stat.file? && stat.uid == Process.uid && (stat.mode & 0077).zero? &&
          stat.nlink == 1 && File.realpath(working) == working,
          "RUBY_NATIVE_DATASET_PRIVATE_DATABASE_REQUIRED")
      end
      connect(working)
    end

    def verify_complete_receipt(import, operation_key, expected)
      digest,count = Digest::SHA256.new,0
      sink = Object.new
      sink.define_singleton_method(:write) do |bytes|
        digest.update(bytes.b)
        count += bytes.bytesize
        bytes.bytesize
      end
      import.write_receipt(sink,operation_key: operation_key)
      Files.need(count == expected.fetch("bytes") && digest.hexdigest == expected.fetch("sha256"),
        "RUBY_NATIVE_DATASET_COMPLETE_APPLICATION_ROWS_CHANGED")
    end

    def verify_current_targets(import, delivery)
      preview = import.preview
      begin
        summary = preview.summary
        counts = summary.fetch("counts")
        Files.need(summary.fetch("row_count") == delivery.row_count &&
          counts.fetch("unchanged") == delivery.row_count &&
          %w[inserted updated removed adopted restored source_changed].all? { |name| counts.fetch(name) == 0 } &&
          SourceRow.where(tenant_key: TENANT).count == delivery.row_count,
          "RUBY_NATIVE_DATASET_CURRENT_APPLICATION_ROWS_CHANGED")
        # Reading every sealed entry also verifies the complete preview stream.
        seen = 0
        preview.each_entry do |entry|
          Files.need(entry.fetch("action") == "unchanged", "RUBY_NATIVE_DATASET_CURRENT_APPLICATION_ROWS_CHANGED")
          seen += 1
        end
        Files.need(seen == delivery.row_count, "RUBY_NATIVE_DATASET_CURRENT_APPLICATION_ROWS_CHANGED")
        summary
      ensure
        preview.close
      end
    end

    def row_summary(delivery)
      count,digest,types = 0,Digest::SHA256.new,delivery.fields.to_h { |name| [name,{}] }
      delivery.each_record do |record|
        digest.update(record.fetch("raw_json").b)
        digest.update("\n")
        record.fetch("values").each do |name,value|
          kind = value.nil? ? "null" : value == true || value == false ? "boolean" :
            value.is_a?(BigDecimal) ? "decimal" : value.is_a?(Integer) ? "integer" : "string"
          types.fetch(name)[kind] = types.fetch(name).fetch(kind,0)+1
        end
        count += 1
      end
      Files.need(count == delivery.row_count && digest.hexdigest == delivery.descriptor("dataset.jsonl")["sha256"],
        "RUBY_NATIVE_DATASET_ROWS_CHANGED")
      {"rows"=>count,"fields"=>delivery.fields,"jsonlSha256"=>digest.hexdigest,"types"=>types}
    end


    def application_manifest_path(root)
      File.join(root,APP_MANIFEST)
    end

    # This reader needs only the moved application folder and its selected hash.
    # Original room/runtime paths in selection.json remain provenance values.
    def read_application(root, expected_manifest_sha256:)
      root = Files.directory(root)
      Files.need(HASH.match?(expected_manifest_sha256.to_s), "RUBY_NATIVE_DATASET_APPLICATION_HASH_REQUIRED")
      bytes = Files.read(application_manifest_path(root),4_194_304)
      Files.need(Files.hash(bytes) == expected_manifest_sha256, "RUBY_NATIVE_DATASET_APPLICATION_CHANGED")
      manifest = Files.parse(bytes)
      Files.need(manifest["schema"] == APP_SCHEMA && manifest["dataset"].is_a?(Hash) &&
        manifest["dataset"]["directory"] == "dataset" &&
        HASH.match?(manifest["dataset"]["manifestSha256"].to_s) &&
        manifest["outputs"].is_a?(Array) && manifest["outputs"].length == APP_FILES.length &&
        manifest["outputs"].all? { |item| item.is_a?(Hash) && item["path"].is_a?(String) } &&
        manifest["outputs"].map { |item| item.fetch("path") }.sort == APP_FILES.sort,
        "RUBY_NATIVE_DATASET_APPLICATION_MANIFEST")
      outputs = manifest.fetch("outputs").to_h do |descriptor|
        name = descriptor.fetch("path")
        Files.need(descriptor.keys.sort == %w[bytes path sha256] &&
          descriptor["bytes"].is_a?(Integer) && descriptor["bytes"] >= 0 &&
          HASH.match?(descriptor["sha256"].to_s) &&
          descriptor_at(root,name) == descriptor, "RUBY_NATIVE_DATASET_APPLICATION_FILE_CHANGED")
        [name,descriptor]
      end
      delivery = DatasetDelivery.open(File.join(root,"dataset"),
        expected_manifest_sha256: manifest.fetch("dataset").fetch("manifestSha256"))
      selected = Files.parse(Files.read(File.join(root,"selection.json"),1_048_576))
      mapping = Files.parse(Files.read(File.join(root,"mapping.json"),1_048_576))
      receipt = Files.parse(Files.read(File.join(root,"receipt.json"),16_777_216))
      Files.need(selected.is_a?(Hash) && mapping.is_a?(Hash) && receipt.is_a?(Hash) &&
        selected["source_key"] == delivery.manifest["sourceKey"] &&
        selected["dataset_id"] == delivery.manifest["datasetId"] &&
        selected["native_manifest"] == delivery.source_sha256 &&
        manifest["inputSha256"] == outputs.fetch("selection.json").fetch("sha256") &&
        manifest["sourceId"] == delivery.source_sha256 &&
        manifest["sourceKey"] == selected["source_key"] && manifest["datasetId"] == selected["dataset_id"] &&
        manifest["membership"] == delivery.membership &&
        manifest["rows"] == row_summary(delivery) &&
        manifest["receiptSha256"] == RailsDataset.sha(RailsDataset.json(receipt)) &&
        receipt["manifest_sha256"] == delivery.manifest_sha256 &&
        receipt["source_sha256"] == delivery.source_sha256,
        "RUBY_NATIVE_DATASET_APPLICATION_BINDING_CHANGED")
      {"root"=>root,"bytes"=>bytes,"manifest"=>manifest,"manifestSha256"=>expected_manifest_sha256,
        "delivery"=>delivery,"selected"=>selected,"mapping"=>mapping,"receipt"=>receipt,"outputs"=>outputs}
    end

    def receive_application(root, expected_manifest_sha256:)
      root = Files.directory(root)
      Files.lock(root) do
        package = read_application(root,expected_manifest_sha256: expected_manifest_sha256)
        selected,delivery = package.fetch("selected"),package.fetch("delivery")
        receiving_database(root,package.fetch("outputs").fetch("application.sqlite3"))
        application = importer(delivery,selected.fetch("source_key"),package.fetch("mapping"))
        received = application.receipt(operation_key: selected.fetch("dataset_id"))
        Files.need(received == package.fetch("receipt"), "RUBY_NATIVE_DATASET_APPLICATION_RECEIPT_CHANGED")
        verify_complete_receipt(application,selected.fetch("dataset_id"),package.fetch("outputs").fetch("edition.json"))
        current = verify_current_targets(application,delivery)
        {"schema"=>APP_SCHEMA,"status"=>"APPLICATION_REOPENED","directory"=>root,
          "applicationManifestSha256"=>expected_manifest_sha256,"deliveryManifestSha256"=>delivery.manifest_sha256,
          "sourceId"=>delivery.source_sha256,"sourceKey"=>selected.fetch("source_key"),
          "datasetId"=>selected.fetch("dataset_id"),"rows"=>delivery.row_count,"revision"=>received.fetch("revision"),
          "receiptSha256"=>RailsDataset.sha(RailsDataset.json(received)),"currentTargets"=>current}
      end
    ensure
      disconnect
    end

    def publish_application(root, recipient, delivery, mapping, selected, receipt, artifacts, database_descriptor, observed)
      Files.once(File.join(recipient,"mapping.json"),Files.json(mapping))
      Files.once(File.join(recipient,"selection.json"),Files.read(File.join(root,"lifecycle-input.json"),1_048_576))
      Files.once(File.join(recipient,"receipt.json"),Files.json(receipt))
      Files.need(artifacts.map { |item| item.fetch("path") }.sort ==
        %w[outputs/edition.json outputs/preview.csv outputs/preview.json], "RUBY_NATIVE_DATASET_APPLICATION_OUTPUT_SELECTION")
      artifacts.each do |descriptor|
        name = File.basename(descriptor.fetch("path"))
        copy_output(File.join(root,descriptor.fetch("path")),File.join(recipient,name),descriptor)
      end
      database = File.join(root,"application.sqlite3")
      copy_output(database,File.join(recipient,"application.sqlite3"),database_descriptor)
      manifest = {"schema"=>APP_SCHEMA,"inputSha256"=>Files.hash(Files.read(File.join(root,"lifecycle-input.json"),1_048_576)),
        "sourceId"=>delivery.source_sha256,"sourceKey"=>selected.fetch("source_key"),
        "datasetId"=>selected.fetch("dataset_id"),"membership"=>delivery.membership,
        "dataset"=>{"directory"=>"dataset","manifestSha256"=>delivery.manifest_sha256},
        "rows"=>row_summary(delivery),"receiptSha256"=>RailsDataset.sha(RailsDataset.json(receipt)),"runtime"=>observed,
        "outputs"=>APP_FILES.map { |name| descriptor_at(recipient,name) }}
      bytes = Files.json(manifest)
      Files.once(application_manifest_path(recipient),bytes)
      read_application(recipient,expected_manifest_sha256: Files.hash(bytes))
    end

    def copy_application(root, expected_manifest_sha256:, out:)
      root = Files.directory(root)
      out = File.expand_path(out)
      Files.need(out != root && !out.start_with?(root+File::SEPARATOR) &&
        !root.start_with?(out+File::SEPARATOR), "RUBY_NATIVE_DATASET_APPLICATION_COPY_TARGET")
      package = read_application(root,expected_manifest_sha256: expected_manifest_sha256)
      out = Files.directory(out,create: true)
      Files.lock(out) do
        if File.exist?(application_manifest_path(out))
          read_application(out,expected_manifest_sha256: expected_manifest_sha256)
          return {"schema"=>APP_SCHEMA,"status"=>"APPLICATION_COPIED","directory"=>out,
            "applicationManifestSha256"=>expected_manifest_sha256}
        end
        Files.once(File.join(out,"application-copy.json"),
          Files.json({"schema"=>"stellar-forge.ruby-native-dataset-application-copy.v1",
            "manifestSha256"=>expected_manifest_sha256}))
        copied = package.fetch("delivery").copy_to(File.join(out,"dataset"))
        Files.need(copied.manifest_sha256 == package.fetch("delivery").manifest_sha256,
          "RUBY_NATIVE_DATASET_APPLICATION_COPY_CHANGED")
        package.fetch("outputs").each do |name,descriptor|
          copy_output(File.join(root,name),File.join(out,name),descriptor)
        end
        Files.need(Files.read(application_manifest_path(root),4_194_304) == package.fetch("bytes"),
          "RUBY_NATIVE_DATASET_APPLICATION_CHANGED")
        Files.once(application_manifest_path(out),package.fetch("bytes"))
        read_application(out,expected_manifest_sha256: expected_manifest_sha256)
        {"schema"=>APP_SCHEMA,"status"=>"APPLICATION_COPIED","directory"=>out,
          "applicationManifestSha256"=>expected_manifest_sha256}
      end
    end

    def present?(path)
      File.exist?(path) || File.symlink?(path)
    end

    # A process interruption may leave our own producer paths parked here.
    # Restore the exact selected paths before any run/reopen selection is made.
    def restore_producer(root)
      staging = File.join(root,"producer-retained")
      return unless present?(staging)
      Files.directory(staging)
      marker = File.join(staging,"detach.json")
      unless File.exist?(marker)
        Files.need(Dir.children(staging).empty?, "RUBY_NATIVE_DATASET_PRODUCER_RESTORE_SELECTION")
        Dir.rmdir(staging)
        Files.sync(root)
        return
      end
      state = Files.parse(Files.read(marker,1_048_576))
      Files.need(state["schema"] == DETACH_SCHEMA && state["paths"] == PRODUCER_PATHS &&
        HASH.match?(state["inputSha256"].to_s), "RUBY_NATIVE_DATASET_PRODUCER_RESTORE_SELECTION")
      original_input = File.join(root,"lifecycle-input.json")
      input_path = present?(original_input) ? original_input : File.join(staging,"lifecycle-input.json")
      Files.need(Files.hash(Files.read(input_path,1_048_576)) == state.fetch("inputSha256"),
        "RUBY_NATIVE_DATASET_PRODUCER_RESTORE_SELECTION")
      PRODUCER_PATHS.each do |name|
        parked,original = File.join(staging,name),File.join(root,name)
        if present?(parked)
          Files.need(!present?(original), "RUBY_NATIVE_DATASET_PRODUCER_RESTORE_CONFLICT")
          File.rename(parked,original)
          Files.sync(staging)
          Files.sync(root)
        else
          Files.need(present?(original), "RUBY_NATIVE_DATASET_PRODUCER_RESTORE_MISSING")
        end
      end
      Files.need(Dir.children(staging) == ["detach.json"], "RUBY_NATIVE_DATASET_PRODUCER_RESTORE_SELECTION")
      File.unlink(marker)
      Files.sync(staging)
      Dir.rmdir(staging)
      Files.sync(root)
    end

    def detached_receive(root, recipient, expected_manifest_sha256:)
      restore_producer(root)
      Files.need(PRODUCER_PATHS.all? { |name| present?(File.join(root,name)) },
        "RUBY_NATIVE_DATASET_PRODUCER_SELECTION")
      staging = Files.directory(File.join(root,"producer-retained"),create: true)
      state = {"schema"=>DETACH_SCHEMA,"inputSha256"=>Files.hash(Files.read(File.join(root,"lifecycle-input.json"),1_048_576)),
        "paths"=>PRODUCER_PATHS}
      Files.once(File.join(staging,"detach.json"),Files.json(state))
      begin
        PRODUCER_PATHS.each do |name|
          Files.need(!present?(File.join(staging,name)), "RUBY_NATIVE_DATASET_PRODUCER_RESTORE_CONFLICT")
          File.rename(File.join(root,name),File.join(staging,name))
          Files.sync(root)
          Files.sync(staging)
        end
        Files.need(PRODUCER_PATHS.none? { |name| present?(File.join(root,name)) },
          "RUBY_NATIVE_DATASET_PRODUCER_STILL_AVAILABLE")
        received = receive_application(recipient,expected_manifest_sha256: expected_manifest_sha256)
        received.merge("producerPathsUnavailable"=>true,"detachedProducerPaths"=>PRODUCER_PATHS)
      ensure
        restore_producer(root)
      end
    end

    def reopen_locked(root)
      restore_producer(root)
      selected = Files.parse(Files.read(File.join(root,"lifecycle-input.json"),1_048_576))
      result = Files.parse(Files.read(File.join(root,"native-rails-result.json"),16_777_216))
      Files.need(result["schema"] == SCHEMA && result["inputSha256"] ==
        Files.hash(Files.read(File.join(root,"lifecycle-input.json"),1_048_576)) &&
        result["recipient"] == "recipient" && result["receivedApplication"] == "received-application",
        "RUBY_NATIVE_DATASET_LIFECYCLE_CHANGED")
      expected = result.fetch("applicationManifestSha256")
      package = read_application(File.join(root,"recipient"),expected_manifest_sha256: expected)
      Files.need(package.fetch("selected") == selected &&
        package.fetch("manifest").fetch("rows") == result.fetch("rows") &&
        package.fetch("manifest").fetch("membership") == result.fetch("membership") &&
        package.fetch("receipt") == result.fetch("receipt") &&
        package.fetch("manifest").fetch("dataset").fetch("manifestSha256") == result.fetch("deliveryManifestSha256") &&
        package.fetch("manifest").fetch("outputs") == result.fetch("outputs"),
        "RUBY_NATIVE_DATASET_LIFECYCLE_CHANGED")
      received = receive_application(File.join(root,"received-application"),expected_manifest_sha256: expected)
      {"schema"=>SCHEMA,"status"=>"REOPENED","directory"=>root,"result"=>"native-rails-result.json",
        "applicationManifestSha256"=>expected,"manifestSha256"=>received.fetch("deliveryManifestSha256"),
        "sourceId"=>received.fetch("sourceId"),"rows"=>received.fetch("rows"),"revision"=>received.fetch("revision"),
        "receiptSha256"=>received.fetch("receiptSha256"),"recipient"=>"received-application",
        "currentTargets"=>received.fetch("currentTargets")}
    end

    def reopen(root)
      root = Files.directory(root)
      Files.lock(root) { reopen_locked(root) }
    ensure
      disconnect
    end

    def run(selected, cancel)
      root = Files.directory(selected.fetch("out"),create: true)
      input = selected.reject { |key,_value| key == "out" }
      input_bytes = Files.json(input)
      Files.lock(root) do
        restore_producer(root)
        Files.once(File.join(root,"lifecycle-input.json"),input_bytes)
        return reopen_locked(root) if File.exist?(File.join(root,"native-rails-result.json"))
        receiving = File.join(root,"receiving")
        delivery = if File.exist?(File.join(receiving,"request.json"))
          NativeDatasetReceiving.resume(directory: receiving,cancel: cancel)
        else
          NativeDatasetReceiving.new(directory: receiving,room: selected.fetch("room"),
            source_key: selected.fetch("source_key"),dataset_id: selected.fetch("dataset_id"),
            expected_native_manifest_sha256: selected.fetch("native_manifest"),
            checkout: selected.fetch("checkout"),python: selected.fetch("python"),node: selected.fetch("node"))
            .receive(cancel: cancel)
        end
        Files.need(delivery.source_sha256 == selected.fetch("native_manifest") &&
          delivery.manifest["sourceKey"] == selected.fetch("source_key") &&
          delivery.manifest["datasetId"] == selected.fetch("dataset_id"), "RUBY_NATIVE_DATASET_ORIGINAL_SELECTION_CHANGED")
        mapping = mapping_for(delivery,selected.fetch("keys"))
        Files.once(File.join(root,"mapping.json"),Files.json(mapping))
        recipient = Files.directory(File.join(root,"recipient"),create: true)
        delivery.copy_to(File.join(recipient,"dataset"))
        outputs = Files.directory(File.join(root,"outputs"),create: true)
        database = File.join(root,"application.sqlite3")
        phase_path = File.join(root,"application-commit.json")
        if File.exist?(phase_path)
          phase = Files.parse(Files.read(phase_path,16_777_216))
          plan_bytes = Files.read(File.join(root,"commit-plan.json"),1_048_576)
          plan = Files.parse(plan_bytes)
          Files.need(phase["schema"] == "stellar-forge.ruby-native-dataset-application-commit.v1" &&
            phase["inputSha256"] == Files.hash(input_bytes) &&
            phase["deliveryManifestSha256"] == delivery.manifest_sha256 &&
            phase["planSha256"] == Files.hash(plan_bytes), "RUBY_NATIVE_DATASET_COMMIT_SELECTION_CHANGED")
          receipt,observed,artifacts = phase.fetch("receipt"),phase.fetch("runtime"),phase.fetch("artifacts")
          database_descriptor = phase.fetch("database")
          Files.need(database_descriptor.fetch("path") == "application.sqlite3" &&
            descriptor_at(root,"application.sqlite3") == database_descriptor,
            "RUBY_NATIVE_DATASET_DATABASE_COPY_CHANGED")
        else
          initialize_database(database,delivery,mapping)
          stream = DatasetExample::DatasetStream.where(tenant_key: TENANT,name: selected.fetch("source_key")).create_or_find_by!({})
          original = importer(delivery,selected.fetch("source_key"),mapping)
          commit_path = File.join(root,"commit-plan.json")
          if File.exist?(commit_path)
            plan = Files.parse(Files.read(commit_path,1_048_576))
            Files.need(plan["inputSha256"] == Files.hash(input_bytes) &&
              plan["operationKey"] == selected.fetch("dataset_id") &&
              plan["deliveryManifestSha256"] == delivery.manifest_sha256, "RUBY_NATIVE_DATASET_COMMIT_SELECTION_CHANGED")
          else
            preview = original.preview
            begin
              write_output(File.join(outputs,"preview.json")) { |io| preview.write_json(io) }
              write_output(File.join(outputs,"preview.csv")) { |io| preview.write_csv(io) }
              artifacts = %w[outputs/preview.json outputs/preview.csv].map { |name| descriptor_at(root,name) }
              plan = {"schema"=>"stellar-forge.ruby-native-dataset-commission.v1",
                "inputSha256"=>Files.hash(input_bytes),"operationKey"=>selected.fetch("dataset_id"),
                "deliveryManifestSha256"=>delivery.manifest_sha256,"preview"=>preview.summary,"outputs"=>artifacts}
              Files.once(commit_path,Files.json(plan))
            ensure
              preview.close
            end
          end
          Files.need(!cancel&.cancelled?, "RUBY_NATIVE_CANCELLED")
          receipt = original.import!(operation_key: selected.fetch("dataset_id"),
            expected_preview_sha256: plan.fetch("preview").fetch("preview_sha256"))
          Files.need(original.receipt(operation_key: selected.fetch("dataset_id")) == receipt,
            "RUBY_NATIVE_DATASET_APPLICATION_RECEIPT_CHANGED")
          write_output(File.join(outputs,"edition.json")) { |io|
            original.write_receipt(io,operation_key: selected.fetch("dataset_id"))
          }
          artifacts = plan.fetch("outputs") + [descriptor_at(root,"outputs/edition.json")]
          observed = {"ruby"=>RUBY_VERSION,"activeRecord"=>ActiveRecord::VERSION::STRING,
            "sqlite"=>ActiveRecord::Base.connection.select_value("SELECT sqlite_version()"),
            "currentRevision"=>stream.reload.revision,
            "sourceRows"=>SourceRow.where(tenant_key: TENANT).count}
          disconnect
          database_descriptor = descriptor_at(root,"application.sqlite3")
          phase = {"schema"=>"stellar-forge.ruby-native-dataset-application-commit.v1",
            "inputSha256"=>Files.hash(input_bytes),"deliveryManifestSha256"=>delivery.manifest_sha256,
            "planSha256"=>Files.hash(Files.read(File.join(root,"commit-plan.json"),1_048_576)),
            "receipt"=>receipt,"runtime"=>observed,"artifacts"=>artifacts,"database"=>database_descriptor}
          Files.once(phase_path,Files.json(phase))
        end
        package = publish_application(root,recipient,delivery,mapping,selected,receipt,artifacts,database_descriptor,observed)
        expected = package.fetch("manifestSha256")
        # Close over every source, mapping, metadata and output byte before the
        # independent copy. The original customer room is never renamed.
        first = receive_application(recipient,expected_manifest_sha256: expected)
        copied_root = File.join(root,"received-application")
        copy_application(recipient,expected_manifest_sha256: expected,out: copied_root)
        detached = detached_receive(root,copied_root,expected_manifest_sha256: expected)
        result = {"schema"=>SCHEMA,"status"=>"COMMITTED_AND_REOPENED",
          "inputSha256"=>Files.hash(input_bytes),"sourceId"=>delivery.source_sha256,
          "nativeReceiptSha256"=>delivery.descriptor("native-receiving.json")["sha256"],
          "nativeSourceBindingSha256"=>delivery.manifest["sourceBindingSha256"],
          "deliveryManifestSha256"=>delivery.manifest_sha256,"membership"=>delivery.membership,
          "rows"=>package.fetch("manifest").fetch("rows"),"preview"=>plan.fetch("preview"),"receipt"=>receipt,
          "runtime"=>observed,"applicationDatabase"=>"application.sqlite3",
          "applicationManifestSha256"=>expected,"applicationManifest"=>APP_MANIFEST,
          "outputs"=>package.fetch("manifest").fetch("outputs"),"recipient"=>"recipient",
          "receivedApplication"=>"received-application",
          "firstReceiving"=>first.reject { |key,_value| key == "directory" },
          "detachedReceiving"=>detached.reject { |key,_value| key == "directory" }}
        Files.once(File.join(root,"native-rails-result.json"),Files.json(result))
        reopen_locked(root)
      end
    ensure
      disconnect
    end

    def main(argv)
      command = argv.shift
      options = {"keys"=>[]}
      parser = OptionParser.new do |o|
        o.banner = "ruby examples/native_dataset_lifecycle.rb run --out PRIVATE_DIR --room ORIGINAL_ROOM --native-manifest-sha256 SHA --source-key KEY --dataset-id ID --checkout SOURCE --python ABS --node ABS [--key ORIGINAL_FIELD]\nruby examples/native_dataset_lifecycle.rb reopen --out PRIVATE_DIR\nruby examples/native_dataset_lifecycle.rb receive --delivery APPLICATION_FOLDER --manifest-sha256 SHA\nruby examples/native_dataset_lifecycle.rb copy --delivery APPLICATION_FOLDER --manifest-sha256 SHA --out NEW_FOLDER"
        %w[out room source-key dataset-id checkout python node delivery].each do |name|
          o.on("--"+name+" VALUE") { |value| options[name.tr("-","_")] = value }
        end
        o.on("--native-manifest-sha256 SHA") { |value| options["native_manifest"] = value }
        o.on("--manifest-sha256 SHA") { |value| options["manifest"] = value }
        o.on("--key FIELD") { |value| options["keys"] << value }
        o.on("--help") { puts o; return 0 }
      end
      parser.parse!(argv)
      Files.need(argv.empty? && %w[run reopen receive copy].include?(command),
        "RUBY_NATIVE_DATASET_LIFECYCLE_OPTIONS")
      old_umask = File.umask(0077)
      begin
        if command == "reopen"
          Files.need(options["out"] && (options.keys-%w[out keys]).empty? && options["keys"].empty?,
            "RUBY_NATIVE_DATASET_OFFLINE_OPTIONS")
          $stdout.write(Files.json(reopen(options["out"])))
          return 0
        end
        if %w[receive copy].include?(command)
          allowed = command == "copy" ? %w[delivery manifest keys out] : %w[delivery manifest keys]
          Files.need(options["delivery"] && HASH.match?(options["manifest"].to_s) &&
            (options.keys-allowed).empty? && options["keys"].empty? &&
            (command != "copy" || options["out"]), "RUBY_NATIVE_DATASET_OFFLINE_OPTIONS")
          value = if command == "receive"
            receive_application(options.fetch("delivery"),expected_manifest_sha256: options.fetch("manifest"))
          else
            copy_application(options.fetch("delivery"),expected_manifest_sha256: options.fetch("manifest"),
              out: options.fetch("out"))
          end
          $stdout.write(Files.json(value))
          return 0
        end
        Files.need(%w[out room source_key dataset_id native_manifest checkout python node].all? { |key| options[key] } &&
          (options.keys-%w[out room source_key dataset_id native_manifest checkout python node keys]).empty? &&
          HASH.match?(options["native_manifest"].to_s), "RUBY_NATIVE_DATASET_LIFECYCLE_SELECTION")
        %w[out room checkout python node].each { |key| options[key] = File.expand_path(options.fetch(key)) }
        interrupted = false
        cancellation = Object.new
        cancellation.define_singleton_method(:cancelled?) { interrupted }
        old_int = Signal.trap("INT") { interrupted = true }
        old_term = Signal.trap("TERM") { interrupted = true }
        begin
          $stdout.write(Files.json(run(options,cancellation)))
          0
        ensure
          Signal.trap("INT",old_int)
          Signal.trap("TERM",old_term)
        end
      ensure
        File.umask(old_umask)
      end
    rescue Starforge::Error, RailsDataset::ImportError, OptionParser::ParseError => error
      $stderr.write(JSON.generate({"error"=>error.respond_to?(:code) ? error.code : "RUBY_NATIVE_DATASET_LIFECYCLE_OPTIONS",
        "details"=>error.respond_to?(:details) ? error.details : {}})+"\n")
      2
    end
  end
end
exit Starforge::NativeDatasetLifecycle.main(ARGV.dup) if File.expand_path($PROGRAM_NAME) == File.expand_path(__FILE__)
