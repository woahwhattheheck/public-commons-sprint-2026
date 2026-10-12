#!/usr/bin/env ruby
# frozen_string_literal: true
# MIT. The complete saved-data operator on an original received managed application.
require "optparse"
require "rbconfig"
require "json"
require_relative "commission"

module Starforge
  module DatasetOperator
    module RecordsExample
      SCHEMA = "stellar-forge.dataset-operator-records-journey.v1"
      RESULT = "records-result.json"
      module_function

      def need(value,code)
        Files.need(value,code)
      end
      def load_runtime(path)
        path = Files.directory(File.expand_path(path),private: false)
        # A compound customer includes the actual original provider beside Ruby.
        root = File.expand_path("../../..",__dir__)
        provider = File.expand_path("../../baserow/customer/baserow_customer_receiving.rb",root)
        require provider if File.file?(provider)
        require File.join(path,"application")
        path
      end
      def descriptor(root,path)
        value = NativeDatasetLifecycle.file_descriptor(path)
        value.delete("path")
        value.merge("name"=>Pathname.new(path).relative_path_from(Pathname.new(root)).to_s)
      end
      def save(root,name,value)
        path = File.join(root,name)
        Files.directory(File.dirname(path))
        Store.write(path) { |io| io.write(Files.json(value)) }
        value
      end
      def retain_file(root,name,download)
        path = File.join(root,name)
        item = Store.write(path) { |io| download.each { |bytes| io.write(bytes) } }
        need(item.fetch("bytes") == download.bytes && item.fetch("sha256") == download.sha256,
          "DATASET_RECORDS_DOWNLOAD_CHANGED")
        item.merge("name"=>name)
      ensure
        download&.close
      end
      def source_files(runtime)
        files = Dir.glob(File.join(__dir__,"**","*")).select { |path| File.file?(path) }.sort.map do |path|
          descriptor(__dir__,path)
        end
        %w[engine.rb application.rb editions/native.rb].each do |name|
          path = File.join(runtime,name)
          value = NativeDatasetLifecycle.file_descriptor(path)
          value.delete("path")
          files << value.merge("name"=>"runtime/"+name)
        end
        files
      end
      def verify_files(root,files)
        files.each do |item|
          name = StarforgeRubyRuntime.member(item.fetch("name"))
          path = File.join(root,name)
          parent = File.dirname(path)
          Files.directory(parent)
          need(descriptor(root,path) == item.slice("name","bytes","sha256") &&
            (!item.key?("executable") || ((File.stat(path).mode & 0111).positive? == item["executable"])),
            "DATASET_RECORDS_OUTPUT_CHANGED")
        end
      end
      def application_record(root)
        path = File.join(File.dirname(root),"application.json")
        value = Store.read(path)
        need(value["schema"] == "stellar-forge.ruby-application.v1" &&
          value["directory"] == root &&
          StarforgeRubyRuntime.identity(value.reject { |key,_| key == "sha256" }) == value["sha256"],
          "DATASET_RECORDS_APPLICATION_SELECTION")
        value
      end
      def current_review(workspace,selected = nil)
        if selected
          need(UUID.match?(selected),"DATASET_RECORDS_REVIEW_SELECTION")
          current = workspace.data_captures(selected).fetch("current")
          need(current["can_capture"],"DATASET_RECORDS_CURRENT_REVIEW")
          return selected
        end
        before = nil
        loop do
          page = workspace.list(before: before,limit: 100)
          page.fetch("items").each do |item|
            id = item.fetch("id")
            next unless workspace.detail(id)["committed"]
            current = workspace.data_captures(id).fetch("current")
            return id if current["can_capture"]
          end
          before = page["next_before"]
          break unless before
        end
        raise Error,"DATASET_RECORDS_CURRENT_REVIEW"
      end
      def session(root,workspace)
        app = StarforgeRubyRuntime::Application.open_app(root,workspace)
        Commission::Session.new(app,Files.read(File.join(root,"access-key"),1024).strip)
      end
      def screens(root)
        Files.directory(File.join(root,"screens"),create: true)
        Files.directory(File.join(root,"downloads"),create: true)
      end

      def observe(workspace,session,root,selection,create_query: false)
        review_id,capture_id = selection.values_at("review_id","capture_id")
        capture = workspace.data_capture(review_id,capture_id)
        need(capture.fetch("sha256") == selection.fetch("capture_sha256"),"DATASET_RECORDS_CAPTURE_CHANGED")
        query = if create_query
          workspace.query_data(review_id,capture_id,query: {"sort"=>[
            {"column"=>"@key","direction"=>"asc","nulls"=>"last"}]})
        else
          page = workspace.data_rows(review_id,capture_id,selection.fetch("query_id"),page: 0)
          page.fetch("query")
        end
        query_id = query.fetch("id")
        need(!selection["query_id"] || selection["query_id"] == query_id,"DATASET_RECORDS_QUERY_CHANGED")
        route = "/dataset_imports/" + review_id
        rows,links = 0,0
        digest = Digest::SHA256.new
        attachment_files = {}
        first = nil
        query.fetch("pages").times do |page_number|
          page = workspace.data_rows(review_id,capture_id,query_id,page: page_number)
          session.request("GET",route+"/records",params: {
            capture_id: capture_id,query_id: query_id,page: page_number+1}) do |response|
            response.save(File.join(root,"screens",format("records-%06d.html",page_number)))
          end
          page.fetch("rows").each_with_index do |record,ordinal|
            first ||= record
            original = workspace.data_record(review_id,capture_id,key_sha256: record.fetch("key_sha256"))
            need(original.fetch("record") == record,"DATASET_RECORDS_DETAIL_CHANGED")
            digest.update(RailsDataset.json(record) + "\n")
            rows += 1
            if ordinal.zero?
              session.request("GET",route+"/record",params: {
                capture_id: capture_id,query_id: query_id,page: page_number+1,
                key_sha256: record.fetch("key_sha256")}) do |response|
                response.save(File.join(root,"screens",format("record-%06d.html",page_number)))
              end
            end
            record.fetch("attachments").each do |link|
              arguments = {key_sha256: record.fetch("key_sha256"),file: link.fetch("file"),
                record_id: link.fetch("record_id"),column: link.fetch("column"),index: link.fetch("index")}
              file = workspace.data_attachment(review_id,capture_id,**arguments)
              name = "downloads/original-"+link.fetch("sha256")+".bin"
              received = retain_file(root,name,file)
              need(received.slice("bytes","sha256") == link.slice("bytes","sha256"),
                "DATASET_RECORDS_ATTACHMENT_CHANGED")
              session.request("GET",route+"/data_attachment",params: arguments.merge(capture_id: capture_id)) do |response|
                need(response.matches?(received),"DATASET_RECORDS_HTTP_ATTACHMENT_CHANGED")
              end
              attachment_files[link.fetch("sha256")] = received
              links += 1
            end
          end
        end
        need(rows == capture.dig("counts","total") && rows == query.fetch("total"),
          "DATASET_RECORDS_FULL_SELECTION")
        exports = %w[csv json].map do |format|
          item = retain_file(root,"downloads/records."+format,
            workspace.data_export(review_id,capture_id,query_id,format: format))
          session.request("GET",route+"/data_export",params: {
            capture_id: capture_id,query_id: query_id,format: format}) do |response|
            need(response.matches?(item),"DATASET_RECORDS_HTTP_EXPORT_CHANGED")
          end
          item
        end
        csv_rows = 0
        CSV.foreach(File.join(root,"downloads","records.csv"),headers: true) do |row|
          need(HASH.match?(row.fetch("key_sha256").to_s),"DATASET_RECORDS_CSV_KEY")
          csv_rows += 1
        end
        need(csv_rows == rows,"DATASET_RECORDS_COMPLETE_CSV")
        selected_query = nil
        if first && create_query
          # Use an actual selected key, keeping all state choices and all matching
          # records; the query exercises the same exact typed filter as the form.
          input = {"filters"=>[{"column"=>"@key","operator"=>"eq","value"=>first.fetch("key_text")}],
            "sort"=>[{"column"=>"@key","direction"=>"desc","nulls"=>"last"}]}
          selected_query = workspace.query_data(review_id,capture_id,query: input)
          found = 0
          selected_query.fetch("pages").times do |number|
            workspace.data_rows(review_id,capture_id,selected_query.fetch("id"),page: number).fetch("rows").each do |record|
              need(record.fetch("key_text") == first.fetch("key_text"),"DATASET_RECORDS_FILTER_CHANGED")
              found += 1
            end
          end
          need(found.positive? && found == selected_query.fetch("total"),"DATASET_RECORDS_COMPLETE_FILTER")
        end
        {"capture_id"=>capture_id,"capture_sha256"=>capture.fetch("sha256"),
          "query_id"=>query_id,"query"=>query.slice("id","query","total","pages","page_size"),
          "rows"=>rows,"row_order_sha256"=>digest.hexdigest,
          "counts"=>capture.fetch("counts"),"attachment_links"=>links,
          "attachment_files"=>attachment_files.values.sort_by { |item| item.fetch("name") },
          "exports"=>exports,"filtered_query"=>selected_query && selected_query.slice("id","query","total","pages")}
      end

      def parking(root)
        Store.present?(File.join(root,"parking.json")) ? Store.read(File.join(root,"parking.json")) : nil
      end
      def restore(root)
        saved = parking(root)
        return unless saved
        original,parked = saved.values_at("original","parked")
        if File.exist?(parked) || File.symlink?(parked)
          need(!File.exist?(original) && !File.symlink?(original),"DATASET_RECORDS_RESTORE_CONFLICT")
          Files.directory(parked)
          Files.lock(parked) do
            need(StarforgeRubyRuntime.inventory(parked,exclude: [".ruby.lock"]) == saved.fetch("files"),
              "DATASET_RECORDS_PARKED_SOURCE_CHANGED")
            File.rename(parked,original)
            Files.sync(File.dirname(original))
          end
        end
      end
      def with_parked(root,application,files)
        selected = Store.read(File.join(root,"selection.json"))
        parked = application + ".records-parked-" + selected.fetch("id")
        value = {"original"=>application,"parked"=>parked,"files"=>files}
        save(root,"parking.json",value)
        need(!File.exist?(parked) && !File.symlink?(parked),"DATASET_RECORDS_PARKING_CONFLICT")
        need(StarforgeRubyRuntime.inventory(application,exclude: [".ruby.lock"]) == files,
          "DATASET_RECORDS_APPLICATION_CHANGED")
        File.rename(application,parked)
        Files.sync(File.dirname(application))
        begin
          yield
        ensure
          need(!File.exist?(application) && !File.symlink?(application),"DATASET_RECORDS_RESTORE_CONFLICT")
          need(StarforgeRubyRuntime.inventory(parked,exclude: [".ruby.lock"]) == files,
            "DATASET_RECORDS_PARKED_SOURCE_CHANGED")
          File.rename(parked,application)
          Files.sync(File.dirname(application))
        end
      end

      def receive(root,runtime,expected)
        recipient = Files.directory(File.join(root,"recipient"))
        verify_files(recipient,expected.fetch("files"))
        need(StarforgeRubyRuntime.inventory(recipient,exclude: [".ruby.lock"]) == expected.fetch("files"),
          "DATASET_RECORDS_RECIPIENT_CHANGED")
        profile = expected.fetch("workingCapture")
        observation = StarforgeRubyRuntime::Application.verify_working(recipient,working_capture: profile)
        need(observation == expected.fetch("snapshot").fetch("observation"),
          "DATASET_RECORDS_RECEIVED_WORKING_STATE")
        workspace = StarforgeRubyRuntime::Application.open_workspace(recipient)
        native = session(recipient,workspace)
        folder = Files.directory(File.join(root,"receiver-review"),create: true)
        screens(folder)
        observed = observe(workspace,native,folder,expected.fetch("selection"))
        need(observed.reject { |key,_| key == "filtered_query" } ==
          expected.fetch("observed").reject { |key,_| key == "filtered_query" },
          "DATASET_RECORDS_RECEIVED_SELECTION_CHANGED")
        NativeDatasetLifecycle.disconnect
        need(StarforgeRubyRuntime.inventory(recipient,exclude: [".ruby.lock"]) == expected.fetch("files"),
          "DATASET_RECORDS_RECIPIENT_CHANGED")
        {"schema"=>SCHEMA,"state"=>"COMPLETE","profile"=>"captured-working-state",
          "application"=>observation,"records"=>observed.reject { |key,_| key == "filtered_query" }}
      ensure
        NativeDatasetLifecycle.disconnect
      end

      def child_receive(root,runtime,expected)
        save(root,"receiving.json",expected)
        cancellation = Cancellation.new
        old_int = Signal.trap("INT") { cancellation.cancel }
        old_term = Signal.trap("TERM") { cancellation.cancel }
        result = Runner.new(node: RbConfig.ruby,environment: ENV.to_h).run(__FILE__,
          ["_receive","--out",root,"--runtime-source",runtime],timeout: 7200,
          limit: 16*1024*1024,cancel: cancellation,process_group: true)
        save(root,"receiver-process.json",{"exit_code"=>result[:status]&.exitstatus,
          "signal"=>result[:status]&.termsig,"error"=>result[:error]}) if result[:status]&.success? && !result[:error]
        unless !result[:error] && result[:status]&.success?
          Store.replace(File.join(root,"receiver-error.json"),{"exit_code"=>result[:status]&.exitstatus,
            "signal"=>result[:status]&.termsig,"error"=>result[:error],
            "stdout"=>result.fetch(:stdout),"stderr"=>result.fetch(:stderr)})
          raise Error,"DATASET_RECORDS_RECEIVER_FAILED"
        end
        value = Files.parse(result.fetch(:stdout))
        need(value["schema"] == SCHEMA && value["state"] == "COMPLETE","DATASET_RECORDS_RECEIVER_RESULT")
        save(root,"receiver-result.json",value)
        value
      ensure
        Signal.trap("INT",old_int) if old_int
        Signal.trap("TERM",old_term) if old_term
      end

      def reopen(root,runtime)
        result = Store.read(File.join(root,RESULT))
        need(result["schema"] == SCHEMA && result["state"] == "COMPLETE","DATASET_RECORDS_RESULT")
        selected = Store.read(File.join(root,"selection.json"))
        need(result["selection"] == selected && source_files(runtime) == selected.fetch("runtime_files"),
          "DATASET_RECORDS_SOURCE_CHANGED")
        verify_files(root,result.fetch("files"))
        receiver = child_receive(root,runtime,Store.read(File.join(root,"receiving.json")))
        need(receiver == result.fetch("receiver"),"DATASET_RECORDS_REOPEN_CHANGED")
        result
      end

      def run(application:,runtime_source:,directory:,review_id: nil)
        root = Files.directory(File.expand_path(directory),create: true)
        runtime = load_runtime(runtime_source)
        original = File.expand_path(application)
        need(root != original && !root.start_with?(original+"/") && !original.start_with?(root+"/"),
          "DATASET_RECORDS_OUTPUT_DIRECTORY")
        Files.lock(root) do
          restore(root)
          input_path = File.join(root,"selection.json")
          if Store.present?(input_path)
            selected = Store.read(input_path)
            need(selected["application"] == original && selected["runtime_source"] == runtime &&
              (!review_id || selected["review_id"] == review_id) &&
              source_files(runtime) == selected.fetch("runtime_files"),"DATASET_RECORDS_SELECTION_CHANGED")
            return reopen(root,runtime) if Store.present?(File.join(root,RESULT))
          else
            original = Files.directory(original)
            record = application_record(original)
            workspace = StarforgeRubyRuntime::Application.open_workspace(original)
            chosen = current_review(workspace,review_id)
            NativeDatasetLifecycle.disconnect
            selected = {"schema"=>SCHEMA,"id"=>SecureRandom.uuid,"application"=>original,
              "runtime_source"=>runtime,"runtime_files"=>source_files(runtime),"review_id"=>chosen,
              "application_record"=>record,"ruby"=>RUBY_DESCRIPTION}
            save(root,"selection.json",selected)
          end
          screens(root)
          Files.directory(original)
          Files.lock(original) do
            need(application_record(original) == selected.fetch("application_record"),
              "DATASET_RECORDS_APPLICATION_CHANGED")
            workspace = StarforgeRubyRuntime::Application.open_workspace(original)
            review = selected.fetch("review_id")
            native = session(original,workspace)
            html = nil
            route = "/dataset_imports/"+review
            native.request("GET",route+"/records") do |response|
              response.save(File.join(root,"screens","capture-selection.html"))
              html = response.body
            end
            values = Commission.form(html,route+"/capture_data")
            values,payload = Commission.original_selection(root,values,"data_capture","capture-selection.json")
            need(payload["review_id"] == review,"DATASET_RECORDS_REVIEW_CHANGED")
            capture_id = payload.fetch("capture_id")
            native.request("POST",route+"/capture_data",params: values,status: 303) {}
            capture = workspace.complete_data_capture(review,capture_id)
            # Repeat the original signed request after completion. It must reopen.
            native.request("POST",route+"/capture_data",params: values,status: 303) {}
            need(workspace.data_capture(review,capture_id) == capture,"DATASET_RECORDS_CAPTURE_REPLAY")
            working = {"reviewId"=>review,"captureId"=>capture_id,"expectedCaptureSha256"=>capture.fetch("sha256")}
            binding = {"review_id"=>review,"capture_id"=>capture_id,"capture_sha256"=>capture.fetch("sha256")}
            observed = observe(workspace,native,root,binding,create_query: true)
            binding["query_id"] = observed.fetch("query_id")
            save(root,"capture.json",capture)
            save(root,"records-observation.json",observed)
            NativeDatasetLifecycle.disconnect
            recipient = File.join(root,"recipient")
            # This helper takes the original application lock itself, so perform
            # the same native steps inside the already-held application lease.
            observation = StarforgeRubyRuntime::Application.verify_working(original,working_capture: working)
            files = StarforgeRubyRuntime.inventory(original,exclude: [".ruby.lock"])
            saved_copy = {"files"=>files,"workingCapture"=>working,"observation"=>observation}
            save(root,"snapshot-selection.json",saved_copy)
            StarforgeRubyRuntime.copy_tree(original,recipient,files: files,exclude: [".ruby.lock"])
            received = StarforgeRubyRuntime::Application.verify_working(recipient,working_capture: working)
            need(received == observation && StarforgeRubyRuntime.inventory(recipient) == files,
              "DATASET_RECORDS_COPIED_WORKING_STATE")
            snapshot = {"schema"=>"stellar-forge.managed-ruby-application-snapshot.v1",
              "profile"=>"captured-working-state","workingCapture"=>working,"observation"=>observation,
              "files"=>files.length,"bytes"=>files.sum { |item| item.fetch("bytes") },
              "filesSha256"=>StarforgeRubyRuntime.identity(files)}
            save(root,"snapshot.json",snapshot)
            expected = {"files"=>files,"workingCapture"=>working,"snapshot"=>snapshot,
              "selection"=>binding,"observed"=>observed}
            receiver = nil
            with_parked(root,original,files) { receiver = child_receive(root,runtime,expected) }
            outputs = StarforgeRubyRuntime.inventory(root,exclude: [".ruby.lock","recipient",RESULT])
            # Recipient descriptors are relative to the result root, so a copied
            # complete result remains independently readable on another host.
            outputs += files.map { |item| item.merge("name"=>"recipient/"+item.fetch("name")) }
            result = {"schema"=>SCHEMA,"state"=>"COMPLETE","selection"=>selected,
              "workingCapture"=>working,"observed"=>observed,"snapshot"=>snapshot,
              "receiver"=>receiver,"files"=>outputs.sort_by { |item| item.fetch("name") }}
            save(root,RESULT,result)
            result
          end
        end
      ensure
        NativeDatasetLifecycle.disconnect if defined?(NativeDatasetLifecycle)
      end

      def main(argv)
        command = argv.shift
        options = {}
        parser = OptionParser.new do |flags|
          flags.banner = "records_example.rb run|reopen --out PRIVATE_DIRECTORY --runtime-source INSTALLED_SUPPORT [--application WORKING_APP --review UUID]"
          flags.on("--application DIRECTORY") { |value| options[:application] = value }
          flags.on("--runtime-source DIRECTORY") { |value| options[:runtime_source] = value }
          flags.on("--out DIRECTORY") { |value| options[:directory] = value }
          flags.on("--review UUID") { |value| options[:review_id] = value }
        end
        parser.parse!(argv)
        need(argv.empty? && %w[run reopen _receive].include?(command) && options[:directory] &&
          options[:runtime_source],"DATASET_RECORDS_ARGUMENTS")
        if command == "run"
          need(options[:application],"DATASET_RECORDS_APPLICATION_REQUIRED")
          run(**options)
        else
          runtime = load_runtime(options.fetch(:runtime_source))
          root = Files.directory(File.expand_path(options.fetch(:directory)))
          if command == "_receive"
            receive(root,runtime,Store.read(File.join(root,"receiving.json")))
          else
            Files.lock(root) { restore(root); reopen(root,runtime) }
          end
        end
      end
    end
  end
end

if File.expand_path($PROGRAM_NAME) == File.expand_path(__FILE__)
  saved_umask = File.umask(0077)
  begin
    puts JSON.generate(Starforge::DatasetOperator::RecordsExample.main(ARGV.dup))
  rescue Exception => error
    warn JSON.generate({"error"=>{"code"=>error.respond_to?(:code) ? error.code : error.class.name,
      "message"=>error.message.to_s[0,4000]}})
    exit 1
  ensure
    File.umask(saved_umask)
  end
end
