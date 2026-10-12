#!/usr/bin/env ruby
# frozen_string_literal: true
# MIT. Continue one original Baserow publication through complete customer receiving.
require "optparse"
require "rbconfig"
require "time"
require_relative "baserow_customer_receiving"

module Starforge
  module BaserowCustomerLifecycle
    INPUT_SCHEMA = "stellar-forge.baserow-rails-customer-input.v1"
    RESULT_SCHEMA = "stellar-forge.baserow-rails-customer-journey.v1"
    SOURCE_ROOT = "stellar/scf-starforge-20261009/sf30-seller-sdk"
    NODE_ENTRY = SOURCE_ROOT+"/baserow/customer/cli.mjs"
    CLIENT_MANIFEST = "baserow-ruby-client.json"
    ORIGINAL_OPERATION = "BASEROW-PUBLIC-CATALOG-CAPTURE-0D0B-20261012"
    OPERATOR_FILES = ["examples/rails_dataset/operator/workspace.rb","examples/rails_dataset/operator/jobs.rb","examples/rails_dataset/operator/controller.rb","examples/rails_dataset/operator/commission.rb","examples/rails_dataset/operator/README.md","examples/rails_dataset/operator/install.rb","examples/rails_dataset/operator/operator.css","examples/rails_dataset/operator/views/layouts/starforge_dataset_operator.html.erb","examples/rails_dataset/operator/views/starforge_dataset_operator/index.html.erb","examples/rails_dataset/operator/views/starforge_dataset_operator/show.html.erb","examples/rails_dataset/operator/views/starforge_dataset_operator/changes.html.erb","examples/rails_dataset/operator/views/starforge_dataset_operator/history.html.erb","examples/rails_dataset/operator/views/starforge_dataset_operator/attachments.html.erb","examples/rails_dataset/operator/views/starforge_dataset_operator/error.html.erb"].freeze
    module_function

    def read_input(root)
      raw = Files.read(File.join(root,"lifecycle-input.json"),4_194_304)
      input = Files.parse(raw)
      Files.need(input.is_a?(Hash) && input["schema"] == INPUT_SCHEMA &&
        input["operation"] == ORIGINAL_OPERATION &&
        BaserowCustomerFiles::UUID.match?(input["requestId"].to_s) &&
        HASH.match?(input["originalResultSha256"].to_s) && HASH.match?(input["captureSha256"].to_s) &&
        HASH.match?(input["candidateSha256"].to_s) && HASH.match?(input["snapshot"].to_s) &&
        HASH.match?(input["sourceSha256"].to_s) && INTENT.match?(input["customerKey"].to_s) &&
        INTENT.match?(input["datasetId"].to_s) && input["runtime"].is_a?(Hash) && [nil,"selected-absolute"].include?(input["runtimePathMode"]),
        "BASEROW_CUSTOMER_LIFECYCLE_SELECTION_CHANGED")
      [input,raw]
    end

    def runtime_files(checkout)
      names = %w[
        baserow/customer/model.mjs baserow/customer/files.mjs baserow/customer/cli.mjs
        baserow/customer/export.mjs baserow/customer/baserow_customer.rb
        baserow/customer/baserow_customer_receiving.rb baserow/customer/customer.rb
        baserow/customer/lifecycle.rb baserow/declaration.mjs baserow/capture.mjs
        baserow/source.mjs baserow/values.mjs baserow/publisher/driver.mjs
        baserow/publisher/model.mjs postgres/publisher/model.mjs dataset-handler.mjs
        developer/ruby-client/export.mjs developer/ruby-client/dataset_delivery.rb
        developer/ruby-client/native_dataset.rb developer/ruby-client/native_dataset_receiving.rb
        developer/ruby-client/rails_dataset.rb
      ].map { |name| SOURCE_ROOT+"/"+name } +
        ["stellar/scf-starforge-20261009/sf100-buyer-dataset-delivery/deliver.mjs"] +
        OPERATOR_FILES.map { |name| SOURCE_ROOT+"/developer/ruby-client/"+name }
      names.sort.map do |name|
        raw = Files.read(File.join(checkout,name))
        {"name"=>name,"bytes"=>raw.bytesize,"sha256"=>Files.hash(raw)}
      end
    end

    def prepare_input(options, original: nil)
      native = Files.directory(options.fetch(:native_run))
      result_raw = Files.read(File.join(native,"native-result.json"),8_388_608)
      result = Files.parse(result_raw)
      Files.need(result.is_a?(Hash) && result["schema"] == "stellar-forge.baserow-native-customer-journey.v1" &&
        result["operation"] == ORIGINAL_OPERATION && result["state"] == "COMPLETED" &&
        result["directory"] == native && result["publication"].is_a?(Hash) && result["source"].is_a?(Hash) &&
        result["publication"]["state"] == "PUBLISHED" && result["publication"]["reopened"] == true &&
        result["publication"]["publisherDirectory"] == File.join(native,"publisher") &&
        BaserowCustomerFiles::UUID.match?(result["publication"]["runId"].to_s) &&
        %w[snapshot originalCandidateDigest].all? { |key| HASH.match?(result["publication"][key].to_s) } &&
        HASH.match?(result["source"]["sha256"].to_s) &&
        HASH.match?(result["source"]["captureSha256"].to_s),"BASEROW_CUSTOMER_ORIGINAL_NATIVE_RESULT_REQUIRED")
      checkout = Files.directory(options.fetch(:checkout),private: false)
      Files.need(/\A[a-f0-9]{40}\z/.match?(options[:source_ref].to_s) &&
        INTENT.match?(options[:customer_key].to_s) && INTENT.match?(options[:dataset_id].to_s) &&
        options.fetch(:query,"").is_a?(String),"BASEROW_CUSTOMER_LIFECYCLE_OPTIONS_REQUIRED")
      {"schema"=>INPUT_SCHEMA,"operation"=>ORIGINAL_OPERATION,
        "requestId"=>original ? original.fetch("requestId") : SecureRandom.uuid,
        "originalRun"=>native,"originalResultSha256"=>Files.hash(result_raw),
        "sourceRef"=>options[:source_ref],"customerKey"=>options[:customer_key],"datasetId"=>options[:dataset_id],
        "query"=>options.fetch(:query,""),"runtimePathMode"=>"selected-absolute",
        "publisherDirectory"=>result["publication"]["publisherDirectory"],
        "runId"=>result["publication"]["runId"],"candidateSha256"=>result["publication"]["originalCandidateDigest"],
        "snapshot"=>result["publication"]["snapshot"],"sourceSha256"=>result["source"]["sha256"],
        "captureSha256"=>result["source"]["captureSha256"],"originalSourceRows"=>result["source"]["rows"],
        "originalSourceVersion"=>result.dig("workspaceReceiving","sourceVersion"),
        "originalRecipientVersion"=>result.dig("workspaceReceiving","recipientVersion"),
        "runtime"=>{"checkout"=>checkout,"python"=>NativeDatasetReceiving.executable(options.fetch(:python)),
          "node"=>NativeDatasetReceiving.executable(options.fetch(:node)),
          "ruby"=>NativeDatasetReceiving.executable(RbConfig.ruby),"files"=>runtime_files(checkout)}}
    end

    def check_runtime(input)
      actual = runtime_files(input.fetch("runtime").fetch("checkout"))
      Files.need(actual == input["runtime"]["files"],"BASEROW_CUSTOMER_LIFECYCLE_RUNTIME_CHANGED")
    end

    def process_call(root, input, name, executable, script, args, cancel, timeout: 3600)
      raise Error,"BASEROW_CUSTOMER_CANCELLED" if cancel&.cancelled?
      attempts = Files.directory(File.join(root,"attempts"),create: true)
      attempt = Files.directory(File.join(attempts,name+"-"+SecureRandom.uuid),create: true)
      request = {"schema"=>"stellar-forge.baserow-customer-native-call.v1",
        "requestId"=>input["requestId"],"name"=>name,"executable"=>executable,
        "script"=>script,"arguments"=>args,"startedAt"=>Time.now.utc.iso8601(6)}
      Files.once(File.join(attempt,"request.json"),Files.json(request))
      run = Runner.new(node: executable).run(script,args,timeout: timeout,limit: 134_217_728,
        process_group: true,cancel: cancel)
      Files.once(File.join(attempt,"stdout.json"),run[:stdout])
      Files.once(File.join(attempt,"stderr.txt"),run[:stderr])
      report = {"schema"=>"stellar-forge.baserow-customer-native-call-result.v1",
        "requestId"=>input["requestId"],"name"=>name,"exitStatus"=>run[:status].exitstatus,
        "termSignal"=>run[:status].termsig,"error"=>run[:error],"completedAt"=>Time.now.utc.iso8601(6),
        "stdout"=>{"bytes"=>run[:stdout].bytesize,"sha256"=>Files.hash(run[:stdout])},
        "stderr"=>{"bytes"=>run[:stderr].bytesize,"sha256"=>Files.hash(run[:stderr])}}
      Files.once(File.join(attempt,"result.json"),Files.json(report))
      raise Error,run[:error] if run[:error]
      unless run[:status].success?
        detail = begin Files.parse(run[:stderr]); rescue Error; nil; end
        raise Error, detail.is_a?(Hash) && /\A[A-Z0-9_]{1,160}\z/.match?(detail["error"].to_s) ?
          detail["error"] : "BASEROW_CUSTOMER_NATIVE_CALL_FAILED"
      end
      value = Files.parse(run[:stdout])
      {"directory"=>attempt,"value"=>value,"result"=>report}
    end

    def node_call(root,input,name,args,cancel)
      check_runtime(input)
      runtime = input.fetch("runtime")
      result = process_call(root,input,name,runtime["node"],File.join(runtime["checkout"],NODE_ENTRY),args,cancel)
      check_runtime(input)
      result
    end

    def packet(root,input,cancel)
      directory = File.join(root,"customer-packet")
      marker = File.join(root,"source-packet.json")
      if File.exist?(marker)
        selected = Files.parse(Files.read(marker,1_048_576))
        Files.need(selected["requestId"] == input["requestId"] && selected["directory"] == "customer-packet",
          "BASEROW_CUSTOMER_LIFECYCLE_PACKET_CHANGED")
        value = BaserowCustomerPackage.open(directory: directory,
          expected_manifest_sha256: selected["manifestSha256"])
      else
        if File.exist?(File.join(directory,BaserowCustomerPackage::MANIFEST))
          raw = Files.read(File.join(directory,BaserowCustomerPackage::MANIFEST),BaserowCustomerFiles::MAX_METADATA)
          value = BaserowCustomerPackage.open(directory: directory,expected_manifest_sha256: Files.hash(raw))
        else
          node_call(root,input,"original-publication",[
            "prepare","--publisher",input["publisherDirectory"],"--run",input["runId"],
            "--candidate-sha256",input["candidateSha256"],"--snapshot",input["snapshot"],
            "--customer-key",input["customerKey"],"--request-id",input["requestId"],
            "--query",input["query"],"--out",directory
          ],cancel)
          raw = Files.read(File.join(directory,BaserowCustomerPackage::MANIFEST),BaserowCustomerFiles::MAX_METADATA)
          value = BaserowCustomerPackage.open(directory: directory,expected_manifest_sha256: Files.hash(raw))
        end
        check_packet(value,input)
        Files.once(marker,Files.json({"schema"=>"stellar-forge.baserow-customer-native-packet.v1",
          "requestId"=>input["requestId"],"directory"=>"customer-packet",
          "manifestSha256"=>value.manifest_sha256}))
      end
      check_packet(value,input)
      value
    end

    def check_packet(value,input)
      publication = value.source.fetch("publication")
      Files.need(value.manifest["requestId"] == input["requestId"] &&
        value.manifest["customerKey"] == input["customerKey"] &&
        publication["runId"] == input["runId"] && publication["candidateDigest"] == input["candidateSha256"] &&
        publication["snapshot"] == input["snapshot"] && publication["sourceHash"] == input["sourceSha256"] &&
        value.source["capture"]["sha256"] == input["captureSha256"],
        "BASEROW_CUSTOMER_LIFECYCLE_ORIGINAL_SOURCE_CHANGED")
    end

    def receive(root,input,package,cancel)
      directory = File.join(root,"receiving")
      value = if File.exist?(File.join(directory,"request.json"))
        _root,request,_raw = BaserowCustomerReceiving.request(directory)
        Files.need(request["datasetId"] == input["datasetId"] &&
          request["customerDirectory"] == package.directory &&
          request["customerManifestSha256"] == package.manifest_sha256,
          "BASEROW_CUSTOMER_LIFECYCLE_RECEIVING_CHANGED")
        BaserowCustomerReceiving.resume(directory: directory,cancel: cancel,timeout: 3600)
      else
        runtime = input.fetch("runtime")
        BaserowCustomerReceiving.new(directory: directory,customer_package: package,
          dataset_id: input["datasetId"],checkout: runtime["checkout"],
          python: runtime["python"],node: runtime["node"]).receive(cancel: cancel,timeout: 3600)
      end
      Files.need(value.dataset.manifest["datasetId"] == input["datasetId"] &&
        value.customer_package.manifest_sha256 == package.manifest_sha256,
        "BASEROW_CUSTOMER_LIFECYCLE_RECEIVING_CHANGED")
      value
    end

    def receive_files(customer,cancel)
      offset,files,references,total = 0,[],0,0
      loop do
        page = customer.attachment_page(offset: offset,limit: 100)
        page.fetch("files").each do |file|
          raise Error,"BASEROW_CUSTOMER_CANCELLED" if cancel&.cancelled?
          ref = file.fetch("references").first
          customer.attachment(file: file.fetch("file"),record_id: ref.fetch("record_id"),
            column: ref.fetch("column")) do |io,metadata|
            hash,bytes = Digest::SHA256.new,0
            while (chunk = io.read(1_048_576))
              hash.update(chunk);bytes += chunk.bytesize
            end
            Files.need(bytes == file["bytes"] && hash.hexdigest == file["sha256"],
              "BASEROW_CUSTOMER_LIFECYCLE_FILE_CHANGED")
            files << {"file"=>file["file"],"bytes"=>bytes,"sha256"=>file["sha256"],
              "referenceCount"=>file["references"].length}
            references += file["references"].length
            total += bytes
          end
        end
        break unless page["next_offset"]
        Files.need(page["next_offset"] > offset,"BASEROW_CUSTOMER_LIFECYCLE_FILE_PAGE_CHANGED")
        offset = page["next_offset"]
      end
      {"files"=>files,"count"=>files.length,"referenceCount"=>references,"bytes"=>total}
    end

    def source_client(root,input,cancel)
      marker = File.join(root,"client-package.json")
      directory = File.join(root,"customer-client")
      if File.exist?(marker)
        selected = Files.parse(Files.read(marker,1_048_576))
        Files.need(selected["requestId"] == input["requestId"] && HASH.match?(selected["manifestSha256"].to_s),
          "BASEROW_CUSTOMER_LIFECYCLE_CLIENT_CHANGED")
        expected = selected["manifestSha256"]
      else
        result = node_call(root,input,"client-source",["client-export","--out",directory],cancel)["value"]
        Files.need(result["state"] == "COMPLETE" && result["directory"] == directory &&
          HASH.match?(result["manifestSha256"].to_s),"BASEROW_CUSTOMER_LIFECYCLE_CLIENT_CHANGED")
        expected = result["manifestSha256"]
        Files.once(marker,Files.json({"schema"=>"stellar-forge.baserow-customer-native-client.v1",
          "requestId"=>input["requestId"],"directory"=>"customer-client","manifestSha256"=>expected}))
      end
      received = File.join(root,"delivered-client")
      selected = {"directory"=>"delivered-client","manifestSha256"=>expected}
      unless File.exist?(File.join(received,CLIENT_MANIFEST))
        node_call(root,input,"client-copy",["client-copy","--directory",directory,
          "--manifest-sha256",expected,"--out",received],cancel)
      end
      verify_client(root,selected)
      selected
    end

    def restore_producers(root)
      restore_application(root)
      marker = File.join(root,"producer-parking.json")
      return unless File.exist?(marker)
      selected = Files.parse(Files.read(marker,1_048_576))
      Files.need(selected["schema"] == "stellar-forge.baserow-customer-producer-parking.v1" &&
        selected["directories"] == %w[customer-packet receiving customer-client] &&
        selected["inputSha256"] == Files.hash(Files.read(File.join(root,"lifecycle-input.json"),4_194_304)),
        "BASEROW_CUSTOMER_LIFECYCLE_PARKING_CHANGED")
      selected["directories"].reverse_each do |name|
        original,parked = File.join(root,name),File.join(root,"parked-"+name)
        next unless File.exist?(parked) || File.symlink?(parked)
        Files.directory(parked)
        Files.need(!File.exist?(original) && !File.symlink?(original),"BASEROW_CUSTOMER_LIFECYCLE_PRODUCER_CHANGED")
        File.rename(parked,original);Files.sync(root)
      end
    end

    def detached_customer(root,input,client,customer,cancel)
      Files.once(File.join(root,"producer-parking.json"),Files.json({
        "schema"=>"stellar-forge.baserow-customer-producer-parking.v1",
        "directories"=>%w[customer-packet receiving customer-client],
        "inputSha256"=>Files.hash(Files.read(File.join(root,"lifecycle-input.json"),4_194_304))}))
      begin
        %w[customer-packet receiving customer-client].each do |name|
          original,parked = File.join(root,name),File.join(root,"parked-"+name)
          Files.directory(original)
          Files.need(!File.exist?(parked) && !File.symlink?(parked),"BASEROW_CUSTOMER_LIFECYCLE_PRODUCER_CHANGED")
          File.rename(original,parked);Files.sync(root)
        end
        result = process_call(root,input,"copied-ruby-reopen",NativeDatasetReceiving.executable(RbConfig.ruby),
          File.join(root,client["directory"],"baserow/customer/customer.rb"),
          ["inspect","--delivery",customer.directory,"--manifest-sha256",customer.manifest_sha256],cancel)["value"]
        Files.need(result["state"] == "RECEIVED" && result["manifestSha256"] == customer.manifest_sha256 &&
          result["datasetId"] == input["datasetId"] && result["rowCount"] == customer.dataset.row_count &&
          result["fields"] == customer.dataset.fields,"BASEROW_CUSTOMER_LIFECYCLE_COPIED_REOPEN_CHANGED")
        result
      ensure
        restore_producers(root)
      end
    end

    def complete_customer(root,input,cancel)
      restore_producers(root)
      package = packet(root,input,cancel)
      original = receive(root,input,package,cancel)
      customer = original.copy_to(File.join(root,"delivered-customer"))
      files = receive_files(customer,cancel)
      Files.need(files["count"] == package.manifest["attachments"]["count"] &&
        files["referenceCount"] == package.manifest["attachments"]["referenceCount"] &&
        files["bytes"] == package.manifest["attachments"]["totalBytes"],
        "BASEROW_CUSTOMER_LIFECYCLE_FILES_INCOMPLETE")
      client = source_client(root,input,cancel)
      reopened = detached_customer(root,input,client,customer,cancel)
      {"customer"=>customer,"client"=>client,"files"=>files,"reopened"=>reopened}
    end


    def relative_file?(name)
      name.is_a?(String) && name.bytesize.between?(1,512) &&
        !name.start_with?("/") && name.split("/",-1).all? do |part|
          !part.empty? && part != "." && part != ".." && /\A[A-Za-z0-9_.-]+\z/.match?(part)
        end
    end

    def verify_client(root,selected)
      Files.need(selected.is_a?(Hash) && selected["directory"] == "delivered-client" &&
        HASH.match?(selected["manifestSha256"].to_s),"BASEROW_CUSTOMER_LIFECYCLE_CLIENT_CHANGED")
      directory = Files.directory(File.join(root,selected["directory"]))
      raw = Files.read(File.join(directory,CLIENT_MANIFEST),8_388_608)
      manifest = Files.parse(raw)
      Files.need(Files.hash(raw) == selected["manifestSha256"] &&
        manifest.is_a?(Hash) && manifest["schema"] == "stellar-forge.baserow-ruby-client.v1" &&
        manifest["native"].is_a?(Hash) && manifest["native"]["directory"] == "developer/ruby-client" &&
        manifest["native"]["manifest"] == "native-dataset-client.json" &&
        HASH.match?(manifest["native"]["manifestSha256"].to_s) &&
        manifest["files"].is_a?(Array) && manifest["customerFiles"].is_a?(Array),
        "BASEROW_CUSTOMER_LIFECYCLE_CLIENT_CHANGED")
      files,total = {},0
      manifest["files"].each do |file|
        Files.need(file.is_a?(Hash) && file.keys.sort == %w[bytes name sha256] &&
          relative_file?(file["name"]) && !files.key?(file["name"]) &&
          file["bytes"].is_a?(Integer) && file["bytes"].between?(1,8_388_608) &&
          HASH.match?(file["sha256"].to_s),"BASEROW_CUSTOMER_LIFECYCLE_CLIENT_CHANGED")
        actual = Files.read(File.join(directory,file["name"]),8_388_608)
        Files.need(actual.bytesize == file["bytes"] && Files.hash(actual) == file["sha256"],
          "BASEROW_CUSTOMER_LIFECYCLE_CLIENT_CHANGED")
        files[file["name"]] = file;total += actual.bytesize
      end
      Files.need(total <= 67_108_864,"BASEROW_CUSTOMER_LIFECYCLE_CLIENT_TOO_LARGE")
      native_raw = Files.read(File.join(directory,"developer/ruby-client/native-dataset-client.json"),8_388_608)
      native_selected = Files.read(File.join(directory,"developer/ruby-client/native-client-source.json"),8_388_608)
      native = Files.parse(native_raw)
      Files.need(Files.hash(native_raw) == manifest["native"]["manifestSha256"] &&
        native_selected == native_raw && native.is_a?(Hash) && native["files"].is_a?(Array) &&
        native["files"].all? { |file| file.is_a?(Hash) && relative_file?(file["name"]) },
        "BASEROW_CUSTOMER_LIFECYCLE_ORIGINAL_CLIENT_CHANGED")
      addons = %w[baserow_customer.rb baserow_customer_receiving.rb customer.rb lifecycle.rb README.md]
        .map { |name| "baserow/customer/"+name }
      expected = addons + ["client-source.json","developer/ruby-client/native-client-source.json",
        "developer/ruby-client/native-dataset-client.json"] +
        native["files"].map { |file| "developer/ruby-client/"+file["name"] }
      Files.need(expected.uniq.length == expected.length && files.keys.sort == expected.sort &&
        OPERATOR_FILES.all? { |name| files.key?("developer/ruby-client/"+name) } &&
        manifest["customerFiles"].map { |file| file["name"] } == addons &&
        manifest["customerFiles"].all? { |file| files[file["name"]] == file },
        "BASEROW_CUSTOMER_LIFECYCLE_COMPLETE_CLIENT_REQUIRED")
      native["files"].each do |file|
        actual = files.fetch("developer/ruby-client/"+file["name"])
        Files.need(actual["bytes"] == file["bytes"] && actual["sha256"] == file["sha256"],
          "BASEROW_CUSTOMER_LIFECYCLE_ORIGINAL_CLIENT_CHANGED")
      end
      selection = Files.parse(Files.read(File.join(directory,"client-source.json"),8_388_608))
      Files.need(selection.is_a?(Hash) && selection["schema"] == "stellar-forge.baserow-ruby-source.v1" &&
        selection["files"] == manifest["customerFiles"] &&
        manifest["selection"] == files["client-source.json"] &&
        Files.hash(Files.read(File.join(directory,CLIENT_MANIFEST),8_388_608)) == selected["manifestSha256"],
        "BASEROW_CUSTOMER_LIFECYCLE_CLIENT_CHANGED")
      {"directory"=>directory,"manifest"=>manifest,"manifestSha256"=>selected["manifestSha256"]}
    end

    # This process loads only the completed copied client. Its Rails connection,
    # application state and framework constants are separate from source receiving.
    OPERATOR_CALL = <<~'RUBY'.freeze
      # frozen_string_literal: true
      require "json"
      require "digest"
      require "bigdecimal"
      require "time"
      begin
        mode,client,directory,customer,manifest,source_key,record_id_column = ARGV
        raise ArgumentError,"BASEROW_OPERATOR_CALL_SELECTION" unless
          %w[run reopen].include?(mode) && client && directory &&
          (mode == "run" ? ARGV.length == 7 : ARGV.length == 3)
        require File.expand_path("../../baserow/customer/baserow_customer_receiving",client)
        require File.join(client,"examples/rails_dataset/operator/commission")
        result = if mode == "run"
          Starforge::DatasetOperator::Commission.run(
            customer_directory: customer,manifest_sha256: manifest,directory: directory,
            source_key: source_key,record_id_column: record_id_column)
        else
          Starforge::DatasetOperator::Commission.reopen(directory: directory)
        end
        raise ArgumentError,"BASEROW_OPERATOR_INCOMPLETE_RESULT" unless result.is_a?(Hash) &&
          result["schema"] == "stellar-forge.baserow-rails-operator-application.v1" && result["state"] == "COMPLETE"
        $stdout.write(JSON.pretty_generate(result)+"\n")
      rescue StandardError, LoadError => error
        code = error.respond_to?(:code) ? error.code.to_s : error.message.to_s
        code = "BASEROW_OPERATOR_NATIVE_FAILURE" unless /\A[A-Z0-9_]{1,160}\z/.match?(code)
        $stderr.write(JSON.generate({"error"=>code,"class"=>error.class.name})+"\n")
        exit 2
      end
    RUBY

    def operator_call(root,input,client,mode,cancel,customer: nil,application: "application")
      verified = verify_client(root,client)
      script = File.join(root,"operator-call.rb")
      Files.once(script,OPERATOR_CALL)
      Files.need(%w[application delivered-application].include?(application),
        "BASEROW_CUSTOMER_LIFECYCLE_APPLICATION_DIRECTORY")
      args = [mode,File.join(verified["directory"],"developer/ruby-client"),File.join(root,application)]
      if mode == "run"
        Files.need(customer.is_a?(BaserowCustomerDelivery),
          "BASEROW_CUSTOMER_LIFECYCLE_OPERATOR_SOURCE_REQUIRED")
        args += [customer.directory,customer.manifest_sha256,customer.manifest["sourceKey"],
          customer.source.fetch("recordIdColumn")]
      end
      value = process_call(root,input,"rails-operator-"+mode,
        NativeDatasetReceiving.executable(RbConfig.ruby),script,args,cancel)["value"]
      Files.need(value.is_a?(Hash) && value["schema"] == "stellar-forge.baserow-rails-operator-application.v1" &&
        value["state"] == "COMPLETE","BASEROW_CUSTOMER_LIFECYCLE_OPERATOR_INCOMPLETE")
      value
    end

    # Copy the closed native application using its complete original file set.
    # Preview/history files can exceed the input dataset, so stream their full
    # declared bytes rather than applying the dataset reader's input-size cap.
    def application_file(directory,descriptor,cancel)
      name = descriptor.fetch("name")
      folder = BaserowCustomerFiles.parent(directory,name)
      File.open(File.join(folder,File.basename(name)),File::RDONLY | File::NOFOLLOW | File::NONBLOCK) do |io|
        before = io.stat
        Files.need(before.file? && before.uid == Process.uid && (before.mode & 0077).zero? &&
          before.size == descriptor.fetch("bytes"),
          "BASEROW_CUSTOMER_APPLICATION_FILE_CHANGED")
        count,digest = 0,Digest::SHA256.new
        while (chunk = io.read(1_048_576))
          raise Error,"BASEROW_CUSTOMER_CANCELLED" if cancel&.cancelled?
          count += chunk.bytesize
          Files.need(count <= descriptor["bytes"],"BASEROW_CUSTOMER_APPLICATION_FILE_CHANGED")
          digest.update(chunk)
          yield chunk if block_given?
        end
        after = io.stat
        Files.need(count == descriptor["bytes"] && digest.hexdigest == descriptor["sha256"] &&
          [before.dev,before.ino,before.size,before.mtime,before.ctime] ==
          [after.dev,after.ino,after.size,after.mtime,after.ctime],
          "BASEROW_CUSTOMER_APPLICATION_FILE_CHANGED")
      end
    end

    def application_file_names(directory)
      names = []
      visit = lambda do |base,prefix|
        Dir.children(base).sort.each do |name|
          next if name.start_with?(".")
          logical = prefix.empty? ? name : prefix+"/"+name
          Files.need(relative_file?(logical),"BASEROW_CUSTOMER_APPLICATION_FILE_NAME")
          child = File.join(base,name)
          stat = File.lstat(child)
          Files.need(!stat.symlink? && stat.uid == Process.uid && (stat.mode & 0077).zero?,
            "BASEROW_CUSTOMER_APPLICATION_PRIVATE_FILE")
          if stat.directory?
            visit.call(Files.directory(child),logical)
          else
            Files.need(stat.file?,"BASEROW_CUSTOMER_APPLICATION_PRIVATE_FILE")
            names << logical
          end
        end
      end
      visit.call(Files.directory(directory),"")
      names.sort
    end

    def copy_application(root,value,cancel)
      source = Files.directory(File.join(root,"application"))
      destination = Files.directory(File.join(root,"delivered-application"),create: true)
      Files.need(value.is_a?(Hash) && value["schema"] == "stellar-forge.baserow-rails-operator-application.v1" &&
        value["state"] == "COMPLETE" && value["files"].is_a?(Array),
        "BASEROW_CUSTOMER_APPLICATION_RESULT_REQUIRED")
      raw = Files.read(File.join(source,"operator-result.json"),16_777_216)
      Files.need(BaserowCustomerFiles.identity(Files.parse(raw)) == BaserowCustomerFiles.identity(value),
        "BASEROW_CUSTOMER_APPLICATION_RESULT_CHANGED")
      descriptors = value.fetch("files")
      names = Set.new
      descriptors.each do |file|
        Files.need(file.is_a?(Hash) && file.keys.sort == %w[bytes name sha256] &&
          relative_file?(file["name"]) && !file["name"].split("/").any? { |part| part.start_with?(".") } &&
          file["name"] != "operator-result.json" && names.add?(file["name"]) &&
          file["bytes"].is_a?(Integer) && file["bytes"] >= 0 && HASH.match?(file["sha256"].to_s),
          "BASEROW_CUSTOMER_APPLICATION_FILE_DESCRIPTOR")
      end
      completed = {"name"=>"operator-result.json","bytes"=>raw.bytesize,"sha256"=>Files.hash(raw)}
      all = descriptors+[completed]
      expected_names = all.map { |file| file.fetch("name") }.sort
      Files.need((application_file_names(destination)-expected_names).empty?,
        "BASEROW_CUSTOMER_APPLICATION_COPY_CONFLICT")
      all.each do |file|
        folder = BaserowCustomerFiles.parent(destination,file["name"],create: true)
        target = File.join(folder,File.basename(file["name"]))
        if File.exist?(target) || File.symlink?(target)
          application_file(destination,file,cancel)
          next
        end
        temporary = Tempfile.new([".baserow-application-",".pending"],folder)
        begin
          temporary.binmode
          application_file(source,file,cancel) do |chunk|
            offset = 0
            while offset < chunk.bytesize
              count = temporary.write(chunk.byteslice(offset,chunk.bytesize-offset))
              Files.need(count && count > 0,"BASEROW_CUSTOMER_APPLICATION_COPY_INCOMPLETE")
              offset += count
            end
          end
          temporary.flush
          temporary.fsync
          temporary.close
          begin
            File.link(temporary.path,target)
            Files.sync(folder)
          rescue Errno::EEXIST
            application_file(destination,file,cancel)
          end
        ensure
          temporary.close!
        end
      end
      Files.need(application_file_names(destination) == expected_names &&
        Files.read(File.join(source,"operator-result.json"),16_777_216) == raw,
        "BASEROW_CUSTOMER_APPLICATION_COPY_CHANGED")
      destination
    end

    def restore_application(root)
      marker = File.join(root,"application-parking.json")
      return unless File.exist?(marker)
      selected = Files.parse(Files.read(marker,1_048_576))
      Files.need(selected["schema"] == "stellar-forge.baserow-customer-application-parking.v1" &&
        selected["directory"] == "application" && selected["receiver"] == "delivered-application" &&
        selected["inputSha256"] == Files.hash(Files.read(File.join(root,"lifecycle-input.json"),4_194_304)) &&
        selected["resultSha256"] == Files.hash(Files.read(File.join(root,"operator-result.json"),16_777_216)),
        "BASEROW_CUSTOMER_APPLICATION_PARKING_CHANGED")
      original,parked = File.join(root,"application"),File.join(root,"parked-application")
      return unless File.exist?(parked) || File.symlink?(parked)
      Files.directory(parked)
      Files.need(!File.exist?(original) && !File.symlink?(original),
        "BASEROW_CUSTOMER_APPLICATION_PRODUCER_CHANGED")
      File.rename(parked,original)
      Files.sync(root)
    end

    def detached_application(root,input,client,cancel)
      restore_application(root)
      Files.once(File.join(root,"application-parking.json"),Files.json({
        "schema"=>"stellar-forge.baserow-customer-application-parking.v1",
        "directory"=>"application","receiver"=>"delivered-application",
        "inputSha256"=>Files.hash(Files.read(File.join(root,"lifecycle-input.json"),4_194_304)),
        "resultSha256"=>Files.hash(Files.read(File.join(root,"operator-result.json"),16_777_216))}))
      original,parked = File.join(root,"application"),File.join(root,"parked-application")
      begin
        Files.directory(original)
        Files.need(!File.exist?(parked) && !File.symlink?(parked),
          "BASEROW_CUSTOMER_APPLICATION_PRODUCER_CHANGED")
        File.rename(original,parked)
        Files.sync(root)
        operator_call(root,input,client,"reopen",cancel,application: "delivered-application")
      ensure
        restore_application(root)
      end
    end

    def operator_phase(root,input,client,customer,cancel)
      path = File.join(root,"operator-result.json")
      if File.exist?(path)
        raw = Files.read(path,16_777_216)
        value = Files.parse(raw)
      else
        value = operator_call(root,input,client,"run",cancel,customer: customer)
        raw = Files.json(value)
        Files.once(path,raw)
      end
      copy_application(root,value,cancel)
      reopened = detached_application(root,input,client,cancel)
      Files.need(BaserowCustomerFiles.identity(value) == BaserowCustomerFiles.identity(reopened),
        "BASEROW_CUSTOMER_LIFECYCLE_OPERATOR_REOPEN_CHANGED")
      {"file"=>"operator-result.json","bytes"=>raw.bytesize,"sha256"=>Files.hash(raw)}
    end

    def check_run_options(options,input)
      values = {native_run: input["originalRun"],checkout: input.dig("runtime","checkout")}
      legacy = input["runtimePathMode"].nil?
      Files.need(values.all? { |key,value| File.expand_path(options.fetch(key)) == value } &&
        NativeDatasetReceiving.matches_executable?(options.fetch(:python),input.dig("runtime","python"),legacy: legacy) &&
        NativeDatasetReceiving.matches_executable?(options.fetch(:node),input.dig("runtime","node"),legacy: legacy) &&
        options[:source_ref] == input["sourceRef"] && options[:customer_key] == input["customerKey"] &&
        options[:dataset_id] == input["datasetId"] && options.fetch(:query,"") == input["query"],
        "BASEROW_CUSTOMER_LIFECYCLE_ORIGINAL_REQUEST_CHANGED")
    end

    def reopen_locked(root,cancel)
      restore_producers(root)
      input,input_raw = read_input(root)
      raw = Files.read(File.join(root,"native-result.json"),16_777_216)
      result = Files.parse(raw)
      Files.need(result.is_a?(Hash) && result["schema"] == RESULT_SCHEMA &&
        result["state"] == "COMPLETED" && result["operation"] == ORIGINAL_OPERATION &&
        result["requestId"] == input["requestId"] && result["inputSha256"] == Files.hash(input_raw) &&
        result["sourceRef"] == input["sourceRef"] && result["originalResultSha256"] == input["originalResultSha256"] &&
        result["customer"].is_a?(Hash) && result["customer"]["directory"] == "delivered-customer" &&
        result["applicationDirectory"] == "delivered-application" &&
        HASH.match?(result["customer"]["manifestSha256"].to_s),
        "BASEROW_CUSTOMER_LIFECYCLE_RESULT_CHANGED")
      customer = BaserowCustomerDelivery.open(directory: File.join(root,"delivered-customer"),
        expected_manifest_sha256: result["customer"]["manifestSha256"])
      check_packet(customer.customer_package,input)
      Files.need(customer.dataset.manifest["datasetId"] == input["datasetId"] &&
        customer.dataset.manifest_sha256 == result["datasetManifestSha256"] &&
        customer.dataset.row_count == result["rowCount"] && customer.dataset.fields == result["fields"] &&
        customer.manifest["sourceKey"] == result["sourceKey"] &&
        customer.dataset.membership == result["membership"],
        "BASEROW_CUSTOMER_LIFECYCLE_DATASET_CHANGED")
      files = receive_files(customer,cancel)
      Files.need(files == result["files"],"BASEROW_CUSTOMER_LIFECYCLE_FILES_CHANGED")
      verify_client(root,result.fetch("client"))
      descriptor = result.fetch("operator")
      Files.need(descriptor.is_a?(Hash) && descriptor["file"] == "operator-result.json" &&
        descriptor["bytes"].is_a?(Integer) && descriptor["bytes"].between?(1,16_777_216) &&
        HASH.match?(descriptor["sha256"].to_s),"BASEROW_CUSTOMER_LIFECYCLE_OPERATOR_CHANGED")
      operator_raw = Files.read(File.join(root,"operator-result.json"),16_777_216)
      Files.need(operator_raw.bytesize == descriptor["bytes"] && Files.hash(operator_raw) == descriptor["sha256"],
        "BASEROW_CUSTOMER_LIFECYCLE_OPERATOR_CHANGED")
      reopened = operator_call(root,input,result.fetch("client"),"reopen",cancel,application: "delivered-application")
      Files.need(BaserowCustomerFiles.identity(Files.parse(operator_raw)) == BaserowCustomerFiles.identity(reopened) &&
        Files.read(File.join(root,"native-result.json"),16_777_216) == raw,
        "BASEROW_CUSTOMER_LIFECYCLE_OPERATOR_REOPEN_CHANGED")
      result.merge("directory"=>root,"reopenVerified"=>true)
    end

    def run(options,cancel)
      out,native,checkout = %i[out native_run checkout].map { |key| File.expand_path(options.fetch(key)) }
      Files.need(out != native && !native.start_with?(out+File::SEPARATOR) &&
        out != checkout && !out.start_with?(checkout+File::SEPARATOR) &&
        !checkout.start_with?(out+File::SEPARATOR),"BASEROW_CUSTOMER_LIFECYCLE_SEPARATE_OUTPUT_REQUIRED")
      root = Files.directory(out,create: true)
      Files.lock(root) do
        restore_producers(root)
        if File.exist?(File.join(root,"lifecycle-input.json"))
          input,input_raw = read_input(root)
          check_run_options(options,input)
        else
          input = prepare_input(options)
          input_raw = Files.json(input)
          Files.once(File.join(root,"lifecycle-input.json"),input_raw)
        end
        return reopen_locked(root,cancel) if File.exist?(File.join(root,"native-result.json"))
        complete_locked(root,input,input_raw,cancel)
      end
    end

    def complete_locked(root,input,input_raw,cancel)
      products = complete_customer(root,input,cancel)
      customer,client = products.fetch("customer"),products.fetch("client")
      operator = operator_phase(root,input,client,customer,cancel)
      result = {
        "schema"=>RESULT_SCHEMA,"state"=>"COMPLETED","operation"=>ORIGINAL_OPERATION,
        "requestId"=>input["requestId"],"inputSha256"=>Files.hash(input_raw),
        "sourceRef"=>input["sourceRef"],"originalResultSha256"=>input["originalResultSha256"],
        "originalSourceVersion"=>input["originalSourceVersion"],
        "originalRecipientVersion"=>input["originalRecipientVersion"],
        "captureSha256"=>input["captureSha256"],"candidateSha256"=>input["candidateSha256"],
        "snapshot"=>input["snapshot"],"sourceKey"=>customer.manifest["sourceKey"],
        "customer"=>{"directory"=>"delivered-customer","manifestSha256"=>customer.manifest_sha256},
        "customerManifestSha256"=>customer.customer_package.manifest_sha256,
        "datasetManifestSha256"=>customer.dataset.manifest_sha256,
        "nativeReceiptSha256"=>customer.dataset.descriptor("native-receiving.json").fetch("sha256"),
        "rowCount"=>customer.dataset.row_count,"fields"=>customer.dataset.fields,
        "membership"=>customer.dataset.membership,"files"=>products.fetch("files"),
        "client"=>client,"applicationDirectory"=>"delivered-application","operator"=>operator,
        "copiedClientReopen"=>true,"producerDirectoriesUnavailableDuringCustomerReopen"=>true,
        "operatorReopen"=>true
      }
      Files.once(File.join(root,"native-result.json"),Files.json(result))
      result.merge("directory"=>root,"reopenVerified"=>true)
    end

    def resume(directory,cancel)
      root = Files.directory(directory)
      Files.lock(root) do
        restore_producers(root)
        input,raw = read_input(root)
        return reopen_locked(root,cancel) if File.exist?(File.join(root,"native-result.json"))
        complete_locked(root,input,raw,cancel)
      end
    end

    def reopen(directory,cancel)
      root = Files.directory(directory)
      Files.lock(root) { reopen_locked(root,cancel) }
    end

    def status(directory)
      root = Files.directory(directory)
      Files.lock(root) do
        restore_producers(root)
        input,raw = read_input(root)
        completed = File.exist?(File.join(root,"native-result.json"))
        markers = %w[source-packet.json client-package.json operator-result.json native-result.json]
        {"schema"=>RESULT_SCHEMA,"operation"=>ORIGINAL_OPERATION,"requestId"=>input["requestId"],
          "state"=>completed ? "COMPLETED" : "IN_PROGRESS","directory"=>root,
          "inputSha256"=>Files.hash(raw),"customerKey"=>input["customerKey"],
          "datasetId"=>input["datasetId"],"sourceRef"=>input["sourceRef"],
          "completedPhases"=>markers.select { |name| File.exist?(File.join(root,name)) }}
      end
    end

    def main(argv)
      command = argv.shift
      options = {}
      parser = OptionParser.new do |o|
        o.banner = "Complete original Baserow publication → customer files → configured Rails operator\n\n"+
          "  ruby lifecycle.rb run --native-run ORIGINAL_COMPLETED_BASEROW_RUN --out PRIVATE_PHASE\n"+
          "    --source-ref EXACT_CHECKOUT_SHA --checkout SOURCE --python ABS --node ABS\n"+
          "    --customer-key STABLE_KEY --dataset-id STABLE_ID [--query ORIGINAL_QUERY]\n"+
          "  ruby lifecycle.rb resume|reopen|status --directory ORIGINAL_PHASE\n"
        %w[native-run out source-ref checkout python node customer-key dataset-id query directory].each do |name|
          key = name.tr("-","_").to_sym
          o.on("--"+name+" VALUE") do |value|
            Files.need(!options.key?(key),"BASEROW_CUSTOMER_LIFECYCLE_DUPLICATE_OPTION")
            options[key] = value
          end
        end
        o.on("--help") { puts o; return 0 }
      end
      if command == "--help" || command.nil?
        puts parser; return 0
      end
      parser.parse!(argv)
      Files.need(argv.empty? && %w[run resume reopen status].include?(command),
        "BASEROW_CUSTOMER_LIFECYCLE_COMMAND_REQUIRED")
      if command == "run"
        required = %i[native_run out source_ref checkout python node customer_key dataset_id]
        Files.need(required.all? { |key| options[key].is_a?(String) && !options[key].empty? } &&
          (options.keys-(required+[:query])).empty?,"BASEROW_CUSTOMER_LIFECYCLE_SELECTION_REQUIRED")
        %i[native_run out checkout python node].each { |key| options[key] = File.expand_path(options[key]) }
      else
        Files.need(options.keys == [:directory] && !options[:directory].empty?,
          "BASEROW_CUSTOMER_LIFECYCLE_ORIGINAL_DIRECTORY_REQUIRED")
      end
      old_umask = File.umask(0077)
      interrupted = false
      cancellation = Object.new
      cancellation.define_singleton_method(:cancelled?) { interrupted }
      old_int = Signal.trap("INT") { interrupted = true }
      old_term = Signal.trap("TERM") { interrupted = true }
      begin
        value = case command
        when "run" then run(options,cancellation)
        when "resume" then resume(options.fetch(:directory),cancellation)
        when "reopen" then reopen(options.fetch(:directory),cancellation)
        else status(options.fetch(:directory))
        end
        $stdout.write(Files.json(value));0
      ensure
        Signal.trap("INT",old_int);Signal.trap("TERM",old_term)
        File.umask(old_umask)
      end
    rescue Starforge::Error, OptionParser::ParseError, KeyError => error
      code = error.respond_to?(:code) ? error.code : "BASEROW_CUSTOMER_LIFECYCLE_OPTIONS"
      $stderr.write(JSON.generate({"error"=>code,"details"=>error.respond_to?(:details) ? error.details : {}})+"\n")
      2
    end
  end
end
exit Starforge::BaserowCustomerLifecycle.main(ARGV.dup) if File.expand_path($PROGRAM_NAME) == File.expand_path(__FILE__)
