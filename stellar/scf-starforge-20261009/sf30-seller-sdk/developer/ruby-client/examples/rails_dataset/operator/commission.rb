#!/usr/bin/env ruby
# frozen_string_literal: true
# MIT. Commission the original received Baserow dataset through a real Rails app.
require "cgi"
require "uri"
require "rack/mock"
require "nokogiri"
require_relative "../../native_dataset_lifecycle"
require_relative "install"

module Starforge
  module DatasetOperator
    module Commission
      SCHEMA = "stellar-forge.baserow-rails-operator-application.v1"
      RESULT = "operator-result.json"
      ACTOR = "commissioning-operator"
      module_function

      # The compound Baserow class lives in the delivered customer's original
      # provider subtree, and is required by its lifecycle before this entry.
      def customer(directory,sha)
        Files.need(defined?(Starforge::BaserowCustomerDelivery),
          "DATASET_OPERATOR_BASEROW_CUSTOMER_REQUIRED")
        BaserowCustomerDelivery.open(directory: directory,expected_manifest_sha256: sha)
      end

      def descriptor(root,path)
        value = NativeDatasetLifecycle.file_descriptor(path)
        value.delete("path")
        value.merge("name"=>path.delete_prefix(root + File::SEPARATOR))
      end

      def configuration(root)
        value = Store.read(File.join(root,"application.json"))
        Files.need(value["schema"] == SCHEMA && value["tenant_key"] == NativeDatasetLifecycle::TENANT &&
          HASH.match?(value["manifest_sha256"].to_s) && value["source_key"].is_a?(String) &&
          !value["source_key"].empty? && value["record_id_column"].is_a?(String),
          "DATASET_OPERATOR_APPLICATION")
        value
      end

      def open_workspace(directory)
        root = Files.directory(directory)
        config = configuration(root)
        package = customer(File.join(root,"customer"),config.fetch("manifest_sha256"))
        mapping = Store.read(File.join(root,"mapping.json"))
        Files.need(mapping == NativeDatasetLifecycle.mapping_for(package.dataset,[config.fetch("record_id_column")]),
          "DATASET_OPERATOR_MAPPING_CHANGED")
        NativeDatasetLifecycle.connect(File.join(root,"application.sqlite3"))
        streams = DatasetExample::DatasetStream.where(tenant_key: config.fetch("tenant_key"))
        stream = streams.find_by!(name: config.fetch("source_key"))
        Workspace.new(directory: File.join(root,"operator"),tenant_key: config.fetch("tenant_key"),
          streams: streams,target_scope: lambda { |_stream|
            NativeDatasetLifecycle::SourceRow.where(tenant_key: config.fetch("tenant_key"))
          },models: DatasetExample::MODELS,
          catalog: lambda {
            [{"id"=>"received-baserow","title"=>"Baserow customer delivery","stream_id"=>stream.id,
              "directory"=>File.join(root,"customer"),"format"=>"baserow",
              "manifest_sha256"=>config.fetch("manifest_sha256"),"mapping"=>mapping}]
          },formats: {"baserow"=>lambda { |folder,sha| customer(folder,sha) }})
      end

      def open_application(directory)
        root = Files.directory(directory)
        workspace = open_workspace(root)
        access_key = Files.read(File.join(root,"access-key"),1024).strip
        Installation.open(directory: root,workspace: workspace,access_key: access_key)
      end

      class Response
        attr_reader :status,:headers
        def initialize(status,headers,body)
          @status,@headers = status,headers.transform_keys { |key| key.to_s.downcase }
          @file = Tempfile.new(["dataset-operator-http-",".response"])
          @file.binmode
          @file.unlink
          body.each { |bytes| @file.write(bytes) }
          @file.flush
          @file.rewind
        rescue Exception
          @file&.close
          raise
        ensure
          body.close if body.respond_to?(:close)
        end
        def body
          Files.need(@file.size <= 64 * 1024 * 1024,"DATASET_OPERATOR_HTML_TOO_LARGE")
          @file.rewind
          @file.read.force_encoding(Encoding::UTF_8)
        end
        def save(path)
          # An interrupted commission may have retained the first signed HTML.
          # Keep that exact first response; final descriptors verify it on reopen.
          return if Store.present?(path)
          @file.rewind
          Store.write(path) { |out| IO.copy_stream(@file,out) }
        end
        def matches?(expected)
          @file.rewind
          digest,count = Digest::SHA256.new,0
          while (bytes = @file.read(1_048_576))
            digest.update(bytes)
            count += bytes.bytesize
          end
          count == expected.fetch("bytes") && digest.hexdigest == expected.fetch("sha256")
        end
        def close
          @file.close unless @file.closed?
        end
      end

      # Exercise the real middleware, authentication, CSRF, signed selections,
      # rendered views and streamed responses, using the actual received rows.
      class Session
        def initialize(application,access_key)
          @application,@access_key,@cookies = application,access_key,{}
        end
        def request(method,path,params: {},status: 200)
          input = method == "GET" ? "" : URI.encode_www_form(params)
          path += (path.include?("?") ? "&" : "?") + URI.encode_www_form(params) if method == "GET" && !params.empty?
          env = Rack::MockRequest.env_for("http://localhost" + path,
            method: method,input: input,"CONTENT_TYPE"=>"application/x-www-form-urlencoded",
            "HTTP_HOST"=>"localhost","HTTP_ORIGIN"=>"http://localhost",
            "HTTP_AUTHORIZATION"=>"Basic " + ["operator:" + @access_key].pack("m0"),
            "HTTP_COOKIE"=>@cookies.map { |name,value| name + "=" + value }.join("; "))
          native_status,headers,body = @application.call(env)
          response = Response.new(native_status,headers,body)
          Array(response.headers["set-cookie"]).flat_map { |value| value.split("\n") }.each do |line|
            name,value = line.split(";",2).first.split("=",2)
            @cookies[name] = value if name && value
          end
          RailsDataset.need(response.status == status,"DATASET_OPERATOR_HTTP_STATUS",
            method: method,path: path,expected: status,actual: response.status)
          if block_given?
            begin
              yield response
            ensure
              response.close
            end
          else
            response
          end
        rescue Exception
          response&.close
          raise
        end
      end

      def form(html,action)
        document = Nokogiri::HTML.fragment(html)
        chosen = document.css("form").find { |node| URI.parse(node["action"].to_s).path == action }
        Files.need(chosen,"DATASET_OPERATOR_RENDERED_FORM")
        values = chosen.css("input[name]").each_with_object({}) do |input,out|
          out[input["name"]] = input["value"].to_s
        end
        Files.need(values["authenticity_token"] && !values["authenticity_token"].empty?,
          "DATASET_OPERATOR_CSRF_FORM")
        values.reject { |key,_| %w[commit utf8].include?(key) }
      end

      def original_selection(root,values,purpose,filename)
        verifier = Rails.application.message_verifier("starforge-dataset-operator")
        selected = verifier.verified(values.fetch("selection"),purpose: purpose)
        Files.need(selected.is_a?(Hash) && selected["actor"] == ACTOR &&
          selected["tenant"] == NativeDatasetLifecycle::TENANT,"DATASET_OPERATOR_RENDERED_SELECTION")
        file = File.join(root,filename)
        if Store.present?(file)
          selected = Store.read(file)
          Files.need(selected["actor"] == ACTOR && selected["tenant"] == NativeDatasetLifecycle::TENANT &&
            selected["payload"].is_a?(Hash),"DATASET_OPERATOR_ORIGINAL_SELECTION")
        else
          Files.once(file,Files.json(selected))
        end
        # Reissue the same selected operation if its original 24-hour form expired.
        # The original payload is saved before the first HTTP mutation.
        values["selection"] = verifier.generate(selected,purpose: purpose,expires_in: 24.hours)
        [values,selected.fetch("payload")]
      end

      def show(session,id,save: nil)
        text = nil
        session.request("GET","/dataset_imports/" + id) do |response|
          response.save(save) if save
          text = response.body
        end
        text
      end

      def file_set(root)
        out = []
        visit = lambda do |directory|
          Dir.children(directory).sort.each do |name|
            next if name.start_with?(".") || (directory == root && name == RESULT)
            path = File.join(directory,name)
            stat = File.lstat(path)
            Files.need(!stat.symlink? && stat.uid == Process.uid && (stat.mode & 0077).zero?,
              "DATASET_OPERATOR_PRIVATE_APPLICATION")
            if stat.directory?
              visit.call(Files.directory(path))
            else
              Files.need(stat.file?,"DATASET_OPERATOR_APPLICATION_FILE")
              out << descriptor(root,path)
            end
          end
        end
        visit.call(root)
        out
      end

      def journey(root,workspace,session)
        screens = Files.directory(File.join(root,"screens"),create: true)
        downloads = Files.directory(File.join(root,"downloads"),create: true)
        values = nil
        session.request("GET","/dataset_imports") do |response|
          response.save(File.join(screens,"inbox.html"))
          values = form(response.body,"/dataset_imports")
        end
        values,selected = original_selection(root,values,"create","create-selection.json")
        id = selected.fetch("review_id")
        chosen_path = File.join(workspace.path(id,create: true),"selection.json")
        unless Store.present?(chosen_path)
          session.request("POST","/dataset_imports",params: values,status: 303) {}
        end
        # A lost initial job response resumes the same selected review.
        unless Store.present?(File.join(workspace.path(id),"review.json"))
          html = show(session,id)
          resume_values = form(html,"/dataset_imports/" + id + "/prepare")
          session.request("POST","/dataset_imports/" + id + "/prepare",params: resume_values,status: 303) {}
        end
        ready = workspace.review(id)
        review_html = show(session,id,save: File.join(screens,"review.html"))
        GROUPS.each do |group|
          count = ready.fetch("groups").fetch(group).fetch("count")
          pages = [1,(count + PAGE_SIZE - 1) / PAGE_SIZE].max
          pages.times do |page|
            session.request("GET","/dataset_imports/" + id + "/changes",params: {group: group,page: page}) do |response|
              response.save(File.join(screens,format("changes-%s-%06d.html",group,page)))
            end
          end
        end
        ready.fetch("files").each do |file|
          session.request("GET","/dataset_imports/" + id + "/download",params: {name: file.fetch("name")}) do |response|
            Files.need(response.matches?(file),"DATASET_OPERATOR_HTTP_EXPORT_CHANGED")
            response.save(File.join(downloads,file.fetch("name")))
          end
        end
        unless Store.present?(File.join(workspace.path(id),"committed.json"))
          commit_values = form(review_html,"/dataset_imports/" + id + "/commit")
          session.request("POST","/dataset_imports/" + id + "/commit",params: commit_values,status: 303) {}
        end
        detail = workspace.detail(id)
        Files.need(detail["committed"],"DATASET_OPERATOR_IMPORT_INCOMPLETE")
        committed = detail.fetch("committed")
        session.request("GET","/dataset_imports/" + id + "/download",params: {name: "receipt.json"}) do |response|
          Files.need(response.matches?(committed.fetch("file")),"DATASET_OPERATOR_HTTP_RECEIPT_CHANGED")
          response.save(File.join(downloads,"receipt.json"))
        end
        show(session,id,save: File.join(screens,"committed.html"))
        editions,before = 0,nil
        loop do
          params = before ? {before: before} : {}
          session.request("GET","/dataset_imports/" + id + "/history",params: params) do |response|
            response.save(File.join(screens,format("history-%06d.html",editions)))
          end
          history = workspace.history(id,before: before)
          history.fetch("items").each do |edition|
            native = workspace.historical_receipt(id,edition.fetch("id"))
            begin
              expected = {"bytes"=>native.bytes,"sha256"=>native.sha256}
              session.request("GET","/dataset_imports/" + id + "/receipt",params: {edition_id: edition.fetch("id")}) do |response|
                Files.need(response.matches?(expected),"DATASET_OPERATOR_HTTP_EDITION_CHANGED")
                response.save(File.join(downloads,"edition-" + edition.fetch("id") + ".json"))
              end
            ensure
              native.close
            end
            editions += 1
          end
          before = history["next_before"]
          break unless before
        end
        attachment_files,attachment_links,offset = 0,0,0
        loop do
          page = workspace.attachments(id,offset: offset)
          session.request("GET","/dataset_imports/" + id + "/attachments",params: {offset: offset}) do |response|
            response.save(File.join(screens,format("attachments-%06d.html",offset)))
          end
          page.fetch("files").each do |file|
            file.fetch("references").each do |reference|
              parameters = {file: file.fetch("file"),record_id: reference.fetch("record_id"),
                column: reference.fetch("column")}
              session.request("GET","/dataset_imports/" + id + "/attachment",params: parameters) do |response|
                Files.need(response.matches?(file),"DATASET_OPERATOR_HTTP_ATTACHMENT_CHANGED")
              end
              attachment_links += 1
            end
            attachment_files += 1
          end
          offset = page["next_offset"]
          break unless offset
        end
        session.request("GET","/dataset_imports/" + id + "/handoff") do |response|
          response.save(File.join(downloads,"review-handoff.tar"))
        end
        # Refresh from the review's own received source after the database commit.
        html = show(session,id)
        values = form(html,"/dataset_imports/" + id + "/refresh")
        values,refresh = original_selection(root,values,"refresh","refresh-selection.json")
        refreshed_id = refresh.fetch("review_id")
        unless Store.present?(File.join(workspace.path(refreshed_id,create: true),"selection.json"))
          session.request("POST","/dataset_imports/" + id + "/refresh",params: values,status: 303) {}
        end
        unless Store.present?(File.join(workspace.path(refreshed_id),"review.json"))
          html = show(session,refreshed_id)
          resume_values = form(html,"/dataset_imports/" + refreshed_id + "/prepare")
          session.request("POST","/dataset_imports/" + refreshed_id + "/prepare",params: resume_values,status: 303) {}
        end
        refreshed = workspace.review(refreshed_id)
        show(session,refreshed_id,save: File.join(screens,"saved-source-review.html"))
        package = workspace.selected_delivery(id)
        current = NativeDatasetLifecycle.verify_current_targets(workspace.importer(id),package.dataset)
        Files.need(refreshed.fetch("summary").fetch("counts") == current.fetch("counts") &&
          refreshed.fetch("summary").fetch("row_count") == package.dataset.row_count,
          "DATASET_OPERATOR_REFRESH_CHANGED")
        {"review_id"=>id,"refreshed_review_id"=>refreshed_id,"row_count"=>package.dataset.row_count,
          "preview"=>ready.fetch("summary"),"committed"=>committed,"current"=>current,
          "history_editions"=>editions,"attachment_files"=>attachment_files,"attachment_links"=>attachment_links}
      end

      def run(customer_directory:,manifest_sha256:,directory:,source_key:,record_id_column:)
        old_umask = File.umask(0077)
        root = Files.directory(File.expand_path(directory),create: true)
        Files.lock(root) do
          selected = {"schema"=>SCHEMA,"tenant_key"=>NativeDatasetLifecycle::TENANT,
            "manifest_sha256"=>manifest_sha256,"source_key"=>source_key,"record_id_column"=>record_id_column}
          Files.need(HASH.match?(manifest_sha256.to_s) && source_key.is_a?(String) &&
            !source_key.empty? && source_key.bytesize <= 128 && record_id_column.is_a?(String),
            "DATASET_OPERATOR_APPLICATION_SELECTION")
          Files.once(File.join(root,"application.json"),Files.json(selected))
          return reopen_locked(root) if Store.present?(File.join(root,RESULT))
          receiver = File.join(root,"customer")
          unless Store.present?(File.join(receiver,"baserow-delivery.json"))
            customer(Files.directory(customer_directory),manifest_sha256).copy_to(receiver)
          end
          package = customer(receiver,manifest_sha256)
          Files.need(package.dataset.fields.include?(record_id_column),"DATASET_OPERATOR_RECORD_ID_COLUMN")
          mapping = NativeDatasetLifecycle.mapping_for(package.dataset,[record_id_column])
          Files.once(File.join(root,"mapping.json"),Files.json(mapping))
          key_file = File.join(root,"access-key")
          Files.once(key_file,SecureRandom.hex(32) + "\n") unless Store.present?(key_file)
          database = File.join(root,"application.sqlite3")
          Files.once(database,"") unless Store.present?(database)
          NativeDatasetLifecycle.initialize_database(database,package.dataset,mapping)
          DatasetExample::DatasetStream.find_or_create_by!(
            tenant_key: NativeDatasetLifecycle::TENANT,name: source_key)
          workspace = open_workspace(root)
          application = Installation.open(directory: root,workspace: workspace,
            access_key: Files.read(key_file,1024).strip)
          session = Session.new(application,Files.read(key_file,1024).strip)
          observed = journey(root,workspace,session)
          NativeDatasetLifecycle.disconnect
          result = selected.merge("state"=>"COMPLETE","observed"=>observed,"files"=>file_set(root))
          Files.once(File.join(root,RESULT),Files.json(result))
          reopen_locked(root)
        end
      ensure
        NativeDatasetLifecycle.disconnect
        File.umask(old_umask) if old_umask
      end

      def reopen_locked(root)
        result = Store.read(File.join(root,RESULT))
        Files.need(result["schema"] == SCHEMA && result["state"] == "COMPLETE" &&
          result.slice("schema","tenant_key","manifest_sha256","source_key","record_id_column") == configuration(root),
          "DATASET_OPERATOR_APPLICATION_RESULT")
        Files.need(result.fetch("files") == file_set(root),"DATASET_OPERATOR_APPLICATION_CHANGED")
        workspace = open_workspace(root)
        observed = result.fetch("observed")
        id = observed.fetch("review_id")
        detail = workspace.detail(id)
        Files.need(detail.fetch("committed") == observed.fetch("committed") &&
          detail.fetch("review").fetch("summary") == observed.fetch("preview"),
          "DATASET_OPERATOR_EDITION_CHANGED")
        selected = workspace.selection(id)
        NativeDatasetLifecycle.verify_complete_receipt(workspace.importer(id),selected.fetch("operation_key"),
          observed.fetch("committed").fetch("file"))
        package = workspace.selected_delivery(id)
        current = NativeDatasetLifecycle.verify_current_targets(workspace.importer(id),package.dataset)
        Files.need(current == observed.fetch("current"),"DATASET_OPERATOR_CURRENT_ROWS_CHANGED")
        refreshed = workspace.review(observed.fetch("refreshed_review_id"))
        Files.need(refreshed.fetch("summary").fetch("counts") == current.fetch("counts"),
          "DATASET_OPERATOR_REFRESH_CHANGED")
        application = Installation.open(directory: root,workspace: workspace,
          access_key: Files.read(File.join(root,"access-key"),1024).strip)
        session = Session.new(application,Files.read(File.join(root,"access-key"),1024).strip)
        %w[/dataset_imports /dataset_imports/stylesheet].each do |path|
          session.request("GET",path) {}
        end
        %W[/dataset_imports/#{id} /dataset_imports/#{id}/changes /dataset_imports/#{id}/history
          /dataset_imports/#{id}/attachments /dataset_imports/#{observed.fetch("refreshed_review_id")}].each do |path|
          session.request("GET",path) {}
        end
        session.request("GET","/dataset_imports/" + id + "/download",params: {name: "receipt.json"}) do |response|
          Files.need(response.matches?(observed.fetch("committed").fetch("file")),
            "DATASET_OPERATOR_REOPEN_RECEIPT_CHANGED")
        end
        NativeDatasetLifecycle.disconnect
        Files.need(result.fetch("files") == file_set(root),"DATASET_OPERATOR_APPLICATION_CHANGED")
        result
      ensure
        NativeDatasetLifecycle.disconnect
      end

      def reopen(directory:)
        root = Files.directory(directory)
        Files.lock(root) { reopen_locked(root) }
      end
    end
  end
end
