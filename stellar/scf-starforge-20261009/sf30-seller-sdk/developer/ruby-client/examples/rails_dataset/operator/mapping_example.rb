#!/usr/bin/env ruby
# frozen_string_literal: true
# MIT. Complete original-source mapping, import and independent application receiving.
require "optparse"
require "rbconfig"
require "json"
require "stringio"
require_relative "records_example"
require_relative "source_cli"

module Starforge
  module DatasetOperator
    module MappingExample
      SCHEMA = "stellar-forge.dataset-operator-mapping-journey.v1"
      RESULT = "mapping-result.json"
      module_function

      def need(value,code)
        Files.need(value,code)
      end
      def save(root,name,value)
        RecordsExample.save(root,name,value)
      end
      def descriptor(root,path)
        RecordsExample.descriptor(root,path)
      end
      def verify_files(root,files)
        RecordsExample.verify_files(root,files)
      end
      def retain_file(root,name,download)
        StarforgeRubyRuntime.directories(root,File.dirname(File.join(root,name)))
        RecordsExample.retain_file(root,name,download)
      end
      def load_runtime(path)
        runtime = RecordsExample.load_runtime(path)
        need(Workspace.instance_methods.include?(:prepare_source) &&
          Workspace.instance_methods.include?(:mapping_context) &&
          defined?(RailsDataset::TargetContext),"DATASET_MAPPING_EDITION_REQUIRED")
        runtime
      end
      def source_files(runtime)
        # Use this complete exported client, including its actual importer, native
        # readers and views; an older environment must not substitute its classes.
        root = File.expand_path("../../..",__dir__)
        client = Dir.glob(File.join(root,"**","*")).select { |path| File.file?(path) }.sort.map do |path|
          descriptor(root,path).merge("name"=>"client/"+Pathname.new(path).relative_path_from(Pathname.new(root)).to_s)
        end
        runtime_files = %w[engine.rb application.rb editions/native.rb].map do |name|
          descriptor(runtime,File.join(runtime,name)).merge("name"=>"runtime/"+name)
        end
        provider = File.expand_path("../../baserow/customer",root)
        provider_files = Dir.glob(File.join(provider,"*.rb")).sort.map do |path|
          descriptor(provider,path).merge("name"=>"baserow/"+File.basename(path))
        end
        client + provider_files + runtime_files
      end
      def package(workspace,id)
        result = workspace.selected_delivery(id)
        [result,result.respond_to?(:dataset) ? result.dataset : result]
      end
      def form(html,action,purpose: nil,candidate: nil)
        document = Nokogiri::HTML.fragment(html)
        forms = document.css("form").select { |node| URI.parse(node["action"].to_s).path == action }
        chosen = forms.find do |node|
          next true unless candidate
          token = node.at_css('input[name="selection"]')&.[]("value")
          signed = Rails.application.message_verifier("starforge-dataset-operator").
            verified(token,purpose: purpose)
          signed.is_a?(Hash) && signed.dig("payload","candidate_id") == candidate.fetch("id") &&
            signed.dig("payload","selection_sha256") == candidate.fetch("selection_sha256")
        end
        need(chosen,"DATASET_MAPPING_RENDERED_FORM")
        values = {}
        chosen.css("input[name],select[name],textarea[name]").each do |input|
          next if input.key?("disabled") || input.ancestors("fieldset").any? { |ancestor| ancestor.key?("disabled") }
          name,type = input["name"],input["type"].to_s.downcase
          next if %w[submit button reset file image].include?(type)
          next if %w[checkbox radio].include?(type) && !input.key?("checked")
          value = if input.name == "select"
            choices = input.css("option").reject { |item| item.key?("disabled") ||
              item.ancestors("optgroup").any? { |ancestor| ancestor.key?("disabled") } }
            selected = choices.select { |item| item.key?("selected") }
            selected = choices.first(1) if selected.empty? && !input.key?("multiple")
            selected.map { |item| item.key?("value") ? item["value"] : item.text }
          elsif input.name == "textarea"
            [input.text]
          else
            [input.key?("value") ? input["value"] : (%w[checkbox radio].include?(type) ? "on" : "")]
          end
          next if value.empty?
          if name.end_with?("[]")
            values[name] = Array(values[name]) + value
          else
            need(value.length == 1,"DATASET_MAPPING_SINGLE_FORM_VALUE")
            values[name] = value.first
          end
        end
        need(values["authenticity_token"].is_a?(String) && !values["authenticity_token"].empty?,
          "DATASET_MAPPING_CSRF_FORM")
        values.reject { |key,_| %w[commit utf8].include?(key) }
      end
      def signed(root,values,purpose,name)
        Commission.original_selection(root,values,purpose,name)
      end
      def screen(session,route,root,name,params: {})
        text = nil
        session.request("GET",route,params: params) do |response|
          target = File.join(root,"screens",name)
          Files.directory(File.dirname(target),create: true)
          response.save(target)
          text = response.body
        end
        text
      end
      def matches_http(session,route,descriptor,params: {})
        session.request("GET",route,params: params) do |response|
          need(response.matches?(descriptor),"DATASET_MAPPING_HTTP_FILE_CHANGED")
        end
      end

      # The actual CLI parser and output implementation run against the same
      # application-installed tenant resolver. Each request is retained before
      # invocation. A complete output published before a lost reply is adopted
      # from its private atomic file, without repeating its mutation.
      def cli(root,workspace,name,argv)
        need(/\A[a-z0-9][a-z0-9._-]{0,159}\z/.match?(name),"DATASET_MAPPING_CLI_NAME")
        directory = StarforgeRubyRuntime.directories(root,File.join(root,"cli",name))
        output = File.join(directory,"output")
        request = {"schema"=>"stellar-forge.dataset-source-cli-selection.v1",
          "name"=>name,"tenant_key"=>workspace.tenant_key,"argv"=>argv}
        Files.once(File.join(directory,"request.json"),Files.json(request))
        saved = File.join(directory,"completed.json")
        if Store.present?(saved)
          result = Store.read(saved)
          need(result["request_sha256"] == RailsDataset.fingerprint(request),"DATASET_MAPPING_CLI_SELECTION")
          verify_files(root,[result.fetch("file")])
          return result.fetch("file")
        end
        unless Store.present?(output)
          DatasetOperator.workspace_resolver = lambda do |tenant|
            need(tenant == workspace.tenant_key,"DATASET_MAPPING_CLI_TENANT")
            workspace
          end
          stdout = $stdout
          captured = StringIO.new
          begin
            $stdout = captured
            StarforgeDatasetSourceCLI.main(argv + ["--tenant",workspace.tenant_key,"--out",output])
          ensure
            $stdout = stdout
          end
          save(root,"cli/"+name+"/console.json",{"stdout"=>captured.string})
        end
        result = {"schema"=>"stellar-forge.dataset-source-cli-result.v1",
          "request_sha256"=>RailsDataset.fingerprint(request),"file"=>descriptor(root,output)}
        save(root,"cli/"+name+"/completed.json",result)
        result.fetch("file")
      end
      def cli_json(root,workspace,name,argv,expected = nil)
        result = cli(root,workspace,name,argv)
        value = Store.read(File.join(root,result.fetch("name")))
        need(value == expected,"DATASET_MAPPING_CLI_RESULT") unless expected.nil?
        [value,result]
      end

      def handoff_manifest(root,item,id,tenant)
        value,files = nil,[]
        Store.snapshot(File.join(root,item.fetch("name")),item) do |input|
          Gem::Package::TarReader.new(input) do |archive|
            archive.each do |entry|
              need(entry.file?,"DATASET_MAPPING_HANDOFF_MEMBER")
              name = StarforgeRubyRuntime.member(entry.full_name)
              if value.nil?
                need(name == "handoff.json" && entry.header.size <= 64*1024*1024,
                  "DATASET_MAPPING_HANDOFF_MANIFEST")
                value = Files.parse(entry.read)
                need(value["schema"] == "stellar-forge.dataset-operator-handoff.v1" &&
                  value["review_id"] == id && value["tenant_key"] == tenant &&
                  value["files"].is_a?(Array),"DATASET_MAPPING_HANDOFF_MANIFEST")
              else
                need(name.start_with?("review/"),"DATASET_MAPPING_HANDOFF_MEMBER")
                name = StarforgeRubyRuntime.member(name.delete_prefix("review/"))
                count,digest = 0,Digest::SHA256.new
                while (bytes = entry.read(1_048_576)) && !bytes.empty?
                  count += bytes.bytesize
                  digest.update(bytes)
                end
                need(count == entry.header.size,"DATASET_MAPPING_HANDOFF_MEMBER")
                files << {"name"=>name,"bytes"=>count,"sha256"=>digest.hexdigest}
              end
            end
          end
        end
        need(value && files == value.fetch("files") &&
          files.map { |file| file.fetch("name") }.uniq.length == files.length,
          "DATASET_MAPPING_HANDOFF_COMPLETE")
        value
      end
      def handoff_observation(root,workspace,session,id,name)
        original = cli(root,workspace,name,["handoff","--review",id])
        relative = "downloads/"+name+".tar"
        session.request("GET","/dataset_imports/"+id+"/handoff") do |response|
          response.save(File.join(root,relative))
        end
        received = descriptor(root,File.join(root,relative))
        manifest = handoff_manifest(root,original,id,workspace.tenant_key)
        need(handoff_manifest(root,received,id,workspace.tenant_key) == manifest,
          "DATASET_MAPPING_HTTP_HANDOFF_CHANGED")
        # Both complete archive files are retained. Native archive timestamps may
        # differ between calls; every original member and its manifest must match.
        {"cli_file"=>original,"http_file"=>received,"manifest"=>manifest}
      end

      def source_observation(workspace,session,root,id,with_cli: false)
        summary = workspace.source_summary(id)
        selected, dataset = package(workspace,id)
        need(summary.dig("source","delivery_manifest_sha256") == selected.manifest_sha256 &&
          summary.dig("source","manifest_sha256") == dataset.manifest_sha256 &&
          summary.dig("source","row_count") == dataset.row_count &&
          summary.dig("source","fields") == dataset.fields,"DATASET_MAPPING_SOURCE_CHANGED")
        original = dataset.each_record
        digest, count = Digest::SHA256.new,0
        summary.fetch("pages").times do |number|
          page = workspace.source_rows(id,page: number)
          need(page.fetch("total") == dataset.row_count && page.fetch("fields") == dataset.fields &&
            page.fetch("summary_sha256") == summary.fetch("summary_sha256"),"DATASET_MAPPING_SOURCE_PAGE")
          screen(session,"/dataset_imports/"+id+"/source_rows",root,
            format("source-%06d.html",number),params: {page: number+1})
          page.fetch("rows").each do |row|
            native = original.next
            expected = {"ordinal"=>native.fetch("ordinal"),"raw_json"=>native.fetch("raw_json"),
              "sha256"=>native.fetch("sha256"),"values_json"=>RailsDataset.exact_json(native.fetch("values"))}
            need(row == expected && row.fetch("ordinal") == count,"DATASET_MAPPING_NATIVE_SOURCE_ROW")
            digest.update(RailsDataset.json(row)+"\n")
            count += 1
          end
          cli_json(root,workspace,format("source-page-%06d",number),
            ["rows","--review",id,"--page",number.to_s],page) if with_cli
        end
        begin
          original.next
          raise Error,"DATASET_MAPPING_SOURCE_PREFIX"
        rescue StopIteration
        end
        need(count == dataset.row_count,"DATASET_MAPPING_SOURCE_COMPLETE")
        exports = %w[jsonl csv].map do |format|
          native = dataset.descriptor("dataset."+format)
          downloaded = retain_file(root,"downloads/source."+format,
            workspace.source_export(id,format: format))
          need(downloaded.slice("bytes","sha256") == native.slice("bytes","sha256"),
            "DATASET_MAPPING_ORIGINAL_FILE_CHANGED")
          matches_http(session,"/dataset_imports/"+id+"/source_export",downloaded,params: {format: format})
          if with_cli
            command_file = cli(root,workspace,"source-export-"+format,
              ["source-export","--review",id,"--format",format])
            need(command_file.slice("bytes","sha256") == native.slice("bytes","sha256"),
              "DATASET_MAPPING_CLI_SOURCE_FILE")
          end
          downloaded
        end
        {"review_id"=>id,"summary"=>summary,"rows"=>count,"row_order_sha256"=>digest.hexdigest,
          "files"=>exports}
      end

      def retained_form(root,html,action,purpose,filename,candidate: nil)
        path = File.join(root,filename)
        if Store.present?(path)
          original = Store.read(path)
          need(original["actor"] == Commission::ACTOR &&
            original["tenant"] == NativeDatasetLifecycle::TENANT &&
            original["payload"].is_a?(Hash),"DATASET_MAPPING_ORIGINAL_FORM")
          document = Nokogiri::HTML.fragment(html)
          target = document.css("form").find { |node| URI.parse(node["action"].to_s).path == action }
          # A retained operation may already be complete and have no submit form.
          # When it still exists, use that exact action's per-form CSRF token.
          token = (target || document).at_css('input[name="authenticity_token"]')&.[]("value")
          need(token.is_a?(String) && !token.empty?,"DATASET_MAPPING_CSRF_FORM")
          values = {"authenticity_token"=>token,"selection"=>
            Rails.application.message_verifier("starforge-dataset-operator").
              generate(original,purpose: purpose,expires_in: 24.hours)}
          [values,original.fetch("payload")]
        else
          values = form(html,action,purpose: purpose,candidate: candidate)
          signed(root,values,purpose,filename)
        end
      end

      def verify_preview(ready,rows)
        counts = ready.fetch("summary").fetch("counts")
        need(ready.dig("summary","row_count") == rows && counts.fetch("unchanged") == rows &&
          %w[inserted updated removed adopted restored source_changed].all? { |key| counts.fetch(key) == 0 },
          "DATASET_MAPPING_CURRENT_TARGETS_CHANGED")
      end

      def preview_observation(workspace,session,root,id,with_cli: false)
        ready = workspace.review(id)
        route = "/dataset_imports/"+id
        screen(session,route,root,"mapping-review.html")
        count, digest = 0,Digest::SHA256.new
        first = workspace.changes(id,group: "all",page: 0)
        first.fetch("pages").times do |number|
          page = number.zero? ? first : workspace.changes(id,group: "all",page: number)
          screen(session,route+"/changes",root,format("changes-%06d.html",number),
            params: {group: "all",page: number})
          page.fetch("rows").each do |row|
            need(row.fetch("action") == "unchanged","DATASET_MAPPING_PREVIEW_ACTION")
            count += 1
            digest.update(RailsDataset.json(row)+"\n")
          end
          cli_json(root,workspace,format("changes-%06d",number),
            ["changes","--review",id,"--group","all","--page",number.to_s],page) if with_cli
        end
        need(count == first.fetch("total") && count == ready.dig("summary","row_count"),
          "DATASET_MAPPING_PREVIEW_COMPLETE")
        files = ready.fetch("files").map do |item|
          selected = retain_file(root,"downloads/preview-"+item.fetch("name"),workspace.export(id,item.fetch("name")))
          need(selected.slice("bytes","sha256") == item.slice("bytes","sha256"),"DATASET_MAPPING_PREVIEW_FILE")
          matches_http(session,route+"/download",selected,params: {name: item.fetch("name")})
          if with_cli
            output = cli(root,workspace,"preview-"+item.fetch("name"),
              ["export","--review",id,"--name",item.fetch("name")])
            need(output.slice("bytes","sha256") == selected.slice("bytes","sha256"),
              "DATASET_MAPPING_CLI_PREVIEW_FILE")
          end
          selected
        end
        mapped = retain_file(root,"downloads/selected-mapping.json",workspace.mapping_export(id))
        matches_http(session,route+"/mapping_export",mapped)
        {"review_id"=>id,"preview_sha256"=>ready.dig("summary","preview_sha256"),
          "summary"=>ready.fetch("summary"),"rows"=>count,"row_order_sha256"=>digest.hexdigest,
          "files"=>files,"mapping"=>mapped}
      end

      def history_observation(workspace,session,root,id,with_cli: false)
        history,before,number = [],nil,0
        loop do
          page = workspace.history(id,before: before,limit: 50)
          params = before ? {before: before} : {}
          screen(session,"/dataset_imports/"+id+"/history",root,format("history-%06d.html",number),params: params)
          if with_cli
            args = ["history","--review",id,"--limit","50"]
            args += ["--before",before] if before
            cli_json(root,workspace,format("history-%06d",number),args,page)
          end
          page.fetch("items").each do |edition|
            name = "downloads/edition-"+edition.fetch("id")+".json"
            output = retain_file(root,name,workspace.historical_receipt(id,edition.fetch("id")))
            matches_http(session,"/dataset_imports/"+id+"/receipt",output,
              params: {edition_id: edition.fetch("id")})
            if with_cli
              original = cli(root,workspace,"edition-"+edition.fetch("id"),
                ["receipt","--review",id,"--edition",edition.fetch("id")])
              need(original.slice("bytes","sha256") == output.slice("bytes","sha256"),
                "DATASET_MAPPING_CLI_HISTORY")
            end
            history << edition.merge("file"=>output)
          end
          before = page["next_before"]
          break unless before
          number += 1
        end
        {"editions"=>history,"count"=>history.length}
      end

      def workflow(root,application,selected)
        path = File.join(root,"workflow-complete.json")
        if Store.present?(path)
          value = Store.read(path)
          need(value["selection_sha256"] == RailsDataset.fingerprint(selected),
            "DATASET_MAPPING_WORKFLOW_SELECTION")
          return value
        end
        workspace = StarforgeRubyRuntime::Application.open_workspace(application)
        native = RecordsExample.session(application,workspace)
        RecordsExample.screens(root)
        candidate = selected.fetch("candidate")
        html = screen(native,"/dataset_imports",root,"sources.html")
        values,payload = retained_form(root,html,"/dataset_imports/create_source","create_source",
          "source-form-selection.json",candidate: candidate)
        source_id = payload.fetch("review_id")
        need(payload["candidate_id"] == candidate["id"] &&
          payload["selection_sha256"] == candidate["selection_sha256"],"DATASET_MAPPING_CANDIDATE_CHANGED")
        unless Store.present?(File.join(workspace.path(source_id,create: true),"source-summary.json"))
          native.request("POST","/dataset_imports/create_source",params: values,status: 303) {}
        end
        chosen = workspace.selection(source_id)
        need(chosen.fetch("candidate") == candidate,"DATASET_MAPPING_SOURCE_SELECTION")
        cli_json(root,workspace,"source-select",["select","--review",source_id,"--candidate",candidate.fetch("id"),
          "--selection-sha256",candidate.fetch("selection_sha256"),"--actor",Commission::ACTOR],chosen)
        prepared,_ = cli_json(root,workspace,"prepare-source",["prepare-source","--review",source_id])
        need(prepared == workspace.source_summary(source_id),"DATASET_MAPPING_PREPARED_SOURCE")
        cli_json(root,workspace,"source-summary",["summary","--review",source_id],prepared)
        source = source_observation(workspace,native,root,source_id,with_cli: true)
        source_handoff = handoff_observation(root,workspace,native,source_id,"source-only-handoff")

        mapping_html = screen(native,"/dataset_imports/"+source_id+"/mapping",root,"mapping.html")
        context_file = File.join(root,"mapping-context-observed.json")
        context = if Store.present?(context_file)
          Store.read(context_file)
        else
          value = workspace.mapping_context(source_id)
          save(root,"mapping-context-observed.json",value)
          value
        end
        # The context and its original key mapping are retained before the
        # signed form creates the revised review.
        cli_json(root,workspace,"mapping-context",["context","--review",source_id],context)
        cli_json(root,workspace,"mapping-target",["target","--review",source_id],context.fetch("target"))
        form_file = File.join(root,"mapping-form.json")
        if Store.present?(form_file)
          selected_form = Store.read(form_file)
        else
          rendered = form(mapping_html,"/dataset_imports/"+source_id+"/save_mapping")
          wrapped = Rails.application.message_verifier("starforge-dataset-operator").
            verified(rendered.fetch("selection"),purpose: "mapping_save")
          need(wrapped.is_a?(Hash) && wrapped["actor"] == Commission::ACTOR &&
            wrapped["tenant"] == workspace.tenant_key,"DATASET_MAPPING_ORIGINAL_FORM")
          mapping_payload = wrapped.fetch("payload")
          need(mapping_payload["original_review_id"] == source_id &&
            mapping_payload["context_sha256"] == context.fetch("context_sha256"),
            "DATASET_MAPPING_CONTEXT_SELECTION")
          raw_fields = rendered.select { |key,_| key.start_with?("mapping[") }
          input = Rack::Utils.parse_nested_query(URI.encode_www_form(raw_fields)).fetch("mapping")
          need(input.is_a?(Hash),"DATASET_MAPPING_FORM_INPUT")
          selected_form = {"review_id"=>mapping_payload.fetch("review_id"),
            "context_sha256"=>context.fetch("context_sha256"),"signed_selection"=>wrapped,
            "fields"=>raw_fields,"input"=>input,"mapping"=>workspace.mapping_from_form(context,input)}
          # The full form and original signed operation are one atomic admission.
          save(root,"mapping-form.json",selected_form)
        end
        wrapped = selected_form.fetch("signed_selection")
        mapping_payload = wrapped.fetch("payload")
        review_id = selected_form.fetch("review_id")
        need(wrapped["actor"] == Commission::ACTOR && wrapped["tenant"] == workspace.tenant_key &&
          mapping_payload["review_id"] == review_id && mapping_payload["original_review_id"] == source_id &&
          mapping_payload["context_sha256"] == selected_form.fetch("context_sha256") &&
          selected_form["context_sha256"] == context.fetch("context_sha256"),
          "DATASET_MAPPING_FORM_CHANGED")
        token = Nokogiri::HTML.fragment(mapping_html).at_css('input[name="authenticity_token"]')&.[]("value")
        need(token.is_a?(String) && !token.empty?,"DATASET_MAPPING_CSRF_FORM")
        mapping_values = selected_form.fetch("fields").merge("authenticity_token"=>token,
          "selection"=>Rails.application.message_verifier("starforge-dataset-operator").
            generate(wrapped,purpose: "mapping_save",expires_in: 24.hours))
        unless Store.present?(File.join(workspace.path(review_id,create: true),"review.json"))
          native.request("POST","/dataset_imports/"+source_id+"/save_mapping",
            params: mapping_values,status: 303) {}
        end
        revised = workspace.selection(review_id)
        need(revised["original_review_id"] == source_id &&
          revised.dig("candidate","manifest_sha256") == candidate.fetch("manifest_sha256") &&
          revised.dig("candidate","mapping") == selected_form.fetch("mapping"),
          "DATASET_MAPPING_REVISED_SOURCE")
        save(root,"mapping-input.json",selected_form.fetch("input"))
        # The exact saved form is replayed through the actual source CLI. Its
        # admission returns before reading a subsequently advanced target schema.
        cli_json(root,workspace,"mapping-remap-replay",
          ["remap-form","--review",source_id,"--id",review_id,"--actor",Commission::ACTOR,
           "--context-sha256",context.fetch("context_sha256"),"--input",File.join(root,"mapping-input.json")],revised)
        ready,_ = cli_json(root,workspace,"prepare-import",["prepare-import","--review",review_id])
        verify_preview(ready,source.fetch("rows"))
        cli_json(root,workspace,"preview",["preview","--review",review_id],ready)
        preview = preview_observation(workspace,native,root,review_id,with_cli: true)

        review_html = screen(native,"/dataset_imports/"+review_id,root,"review-before-commit.html")
        commit_values,commit_payload = retained_form(root,review_html,
          "/dataset_imports/"+review_id+"/commit","commit","commit-form-selection.json")
        need(commit_payload["review_id"] == review_id &&
          commit_payload["preview_sha256"] == preview.fetch("preview_sha256"),"DATASET_MAPPING_APPROVED_PREVIEW")
        unless Store.present?(File.join(workspace.path(review_id),"committed.json"))
          native.request("POST","/dataset_imports/"+review_id+"/commit",params: commit_values,status: 303) {}
        end
        committed = workspace.detail(review_id).fetch("committed")
        need(committed && committed.fetch("id") == review_id,"DATASET_MAPPING_IMPORT_INCOMPLETE")
        cli_json(root,workspace,"approve-replay",["approve","--review",review_id,
          "--preview-sha256",preview.fetch("preview_sha256"),"--actor",Commission::ACTOR])
        replay,_ = cli_json(root,workspace,"commit-replay",["commit","--review",review_id],committed)
        need(replay == committed,"DATASET_MAPPING_ORIGINAL_COMMIT")
        original_receipt = cli(root,workspace,"complete-receipt",
          ["export","--review",review_id,"--name","receipt.json"])
        need(original_receipt.slice("bytes","sha256") == committed.fetch("file").slice("bytes","sha256"),
          "DATASET_MAPPING_RECEIPT_FILE")
        matches_http(native,"/dataset_imports/"+review_id+"/download",original_receipt,params: {name: "receipt.json"})
        screen(native,"/dataset_imports/"+review_id,root,"committed.html")
        history = history_observation(workspace,native,root,review_id,with_cli: true)

        capture_html = screen(native,"/dataset_imports/"+review_id+"/records",root,"capture.html")
        capture_values,capture_payload = retained_form(root,capture_html,
          "/dataset_imports/"+review_id+"/capture_data","data_capture","capture-form-selection.json")
        need(capture_payload["review_id"] == review_id,"DATASET_MAPPING_CAPTURE_REVIEW")
        capture_id = capture_payload.fetch("capture_id")
        native.request("POST","/dataset_imports/"+review_id+"/capture_data",
          params: capture_values,status: 303) {}
        capture = workspace.data_capture(review_id,capture_id)
        binding = {"review_id"=>review_id,"capture_id"=>capture_id,
          "capture_sha256"=>capture.fetch("sha256")}
        records_root = Files.directory(File.join(root,"working-records"),create: true)
        RecordsExample.screens(records_root)
        records = RecordsExample.observe(workspace,native,records_root,binding,create_query: true)
        binding["query_id"] = records.fetch("query_id")
        need(records.fetch("rows") == source.fetch("rows"),"DATASET_MAPPING_WORKING_ROWS")
        working = {"reviewId"=>review_id,"captureId"=>capture_id,
          "expectedCaptureSha256"=>capture.fetch("sha256")}
        full_handoff = handoff_observation(root,workspace,native,review_id,"completed-review-handoff")
        target = workspace.mapping_target(review_id)
        need(target.dig("stream","revision") == committed.dig("receipt","revision") &&
          (!context.dig("target","key_mapping") ||
            target.fetch("key_mapping") == context.dig("target","key_mapping")),
          "DATASET_MAPPING_COMMITTED_KEY_BINDING")
        value = {"schema"=>SCHEMA,"selection_sha256"=>RailsDataset.fingerprint(selected),
          "source_review_id"=>source_id,"review_id"=>review_id,"source"=>source,
          "mapping"=>selected_form,"preview"=>preview,"committed"=>committed,"history"=>history,
          "target"=>target,"capture"=>capture,"workingCapture"=>working,"record_selection"=>binding,
          "records"=>records,"source_handoff"=>source_handoff,"handoff"=>full_handoff}
        save(root,"workflow-complete.json",value)
        value
      ensure
        NativeDatasetLifecycle.disconnect
      end

      def receiver(root,runtime,expected)
        phase = Files.directory(File.join(root,"receiver-phase"),create: true)
        Files.lock(phase) do
          recipient = Files.directory(File.join(root,"recipient"))
          Files.lock(recipient) do
            need(StarforgeRubyRuntime.inventory(recipient,exclude: [".ruby.lock"]) == expected.fetch("files"),
              "DATASET_MAPPING_RECIPIENT_CHANGED")
            verify_files(recipient,expected.fetch("files"))
            working = expected.fetch("workflow").fetch("workingCapture")
            observation = StarforgeRubyRuntime::Application.verify_working(recipient,working_capture: working)
            need(observation == expected.fetch("snapshot").fetch("observation"),
              "DATASET_MAPPING_RECEIVED_APPLICATION")
            workspace = StarforgeRubyRuntime::Application.open_workspace(recipient)
            native = RecordsExample.session(recipient,workspace)
            folder = Files.directory(File.join(root,"receiver-review"),create: true)
            RecordsExample.screens(folder)
            original = expected.fetch("workflow")
            source_id,id = original.values_at("source_review_id","review_id")
            source = source_observation(workspace,native,folder,source_id)
            need(source == original.fetch("source"),"DATASET_MAPPING_RECEIVED_SOURCE")
            need(workspace.selection(id).dig("candidate","mapping") == original.dig("mapping","mapping") &&
              workspace.selection(id)["original_review_id"] == source_id,
              "DATASET_MAPPING_RECEIVED_SELECTION")
            preview = preview_observation(workspace,native,folder,id)
            need(preview == original.fetch("preview"),"DATASET_MAPPING_RECEIVED_PREVIEW")
            committed = workspace.detail(id).fetch("committed")
            need(committed == original.fetch("committed"),"DATASET_MAPPING_RECEIVED_RECEIPT")
            history = history_observation(workspace,native,folder,id)
            need(history == original.fetch("history"),"DATASET_MAPPING_RECEIVED_HISTORY")
            screen(native,"/dataset_imports/"+source_id+"/mapping",folder,"mapping-received.html")
            need(workspace.mapping_target(id) == original.fetch("target"),"DATASET_MAPPING_RECEIVED_TARGET")
            records_root = Files.directory(File.join(folder,"working-records"),create: true)
            RecordsExample.screens(records_root)
            records = RecordsExample.observe(workspace,native,records_root,original.fetch("record_selection"))
            need(records == original.fetch("records").merge("filtered_query"=>nil),
              "DATASET_MAPPING_RECEIVED_RECORDS")
            # Source/receipt/query identity is checked against live target values
            # above, then every closed application byte is checked again.
            NativeDatasetLifecycle.disconnect
            need(StarforgeRubyRuntime.inventory(recipient,exclude: [".ruby.lock"]) == expected.fetch("files"),
              "DATASET_MAPPING_RECIPIENT_CHANGED")
            {"schema"=>SCHEMA,"state"=>"COMPLETE","application"=>observation,"source"=>source,
              "preview"=>preview,"committed"=>committed,"history"=>history,
              "target"=>original.fetch("target"),"records"=>records}
          end
        end
      ensure
        NativeDatasetLifecycle.disconnect
      end

      def child_receiver(root,runtime,expected)
        save(root,"receiving.json",expected)
        cancellation = Cancellation.new
        old_int = Signal.trap("INT") { cancellation.cancel }
        old_term = Signal.trap("TERM") { cancellation.cancel }
        process = Runner.new(node:RbConfig.ruby,environment:ENV.to_h).run(__FILE__,
          ["_receive","--out",root,"--runtime-source",runtime],timeout:7200,
          limit:64*1024*1024,cancel:cancellation,process_group:true)
        unless !process[:error] && process[:status]&.success?
          Store.replace(File.join(root,"receiver-error.json"),
            {"exit_code"=>process[:status]&.exitstatus,"signal"=>process[:status]&.termsig,
              "error"=>process[:error],"stdout"=>process.fetch(:stdout),"stderr"=>process.fetch(:stderr)})
          raise Error,"DATASET_MAPPING_RECEIVER_FAILED"
        end
        value = Files.parse(process.fetch(:stdout))
        need(value["schema"] == SCHEMA && value["state"] == "COMPLETE","DATASET_MAPPING_RECEIVER_RESULT")
        save(root,"receiver-result.json",value)
        value
      ensure
        Signal.trap("INT",old_int) if old_int
        Signal.trap("TERM",old_term) if old_term
      end

      def select_source(application,candidate_id)
        workspace = StarforgeRubyRuntime::Application.open_workspace(application)
        actual,source_key,actual_mapping = StarforgeRubyRuntime::Application.open_package(application)
        candidates = workspace.candidates
        candidates = candidates.select { |value| value["id"] == candidate_id } if candidate_id
        candidates = candidates.select { |value| value["manifest_sha256"] == actual.manifest_sha256 }
        # The same complete source may appear under a retained edition and its
        # initial catalogue entry. Prefer its exact current mapping, then a
        # stable catalogue ID; always retain the chosen full declaration.
        candidates.sort_by! { |value| [value["mapping"] == actual_mapping ? 0 : 1,value.fetch("id")] }
        candidate = candidates.first
        need(candidate && workspace.stream(candidate.fetch("stream_id")).name == source_key,
          "DATASET_MAPPING_CURRENT_SOURCE_REQUIRED")
        {"candidate"=>candidate,"source_key"=>source_key,
          "dataset_manifest_sha256"=>actual.dataset.manifest_sha256,
          "source_sha256"=>actual.dataset.source_sha256,"row_count"=>actual.dataset.row_count}
      ensure
        NativeDatasetLifecycle.disconnect
      end

      def complete_copy(root,application,selected)
        produced_path = File.join(root,"produced.json")
        if Store.present?(produced_path)
          result = Store.read(produced_path)
          need(result["selection_sha256"] == RailsDataset.fingerprint(selected),
            "DATASET_MAPPING_PRODUCED_SELECTION")
          need(StarforgeRubyRuntime.inventory(File.join(root,"recipient"),exclude:[".ruby.lock"]) ==
            result.fetch("files"),"DATASET_MAPPING_COPIED_APPLICATION")
          return result
        end
        Files.lock(application) do
          need(RecordsExample.application_record(application) == selected.fetch("application_record"),
            "DATASET_MAPPING_APPLICATION_CHANGED")
          value = workflow(root,application,selected)
          observation = StarforgeRubyRuntime::Application.verify_working(application,
            working_capture:value.fetch("workingCapture"))
          files = StarforgeRubyRuntime.inventory(application,exclude:[".ruby.lock"])
          selection = {"files"=>files,"workingCapture"=>value.fetch("workingCapture"),"observation"=>observation}
          save(root,"snapshot-selection.json",selection)
          recipient = File.join(root,"recipient")
          StarforgeRubyRuntime.copy_tree(application,recipient,files:files,exclude:[".ruby.lock"])
          received = StarforgeRubyRuntime::Application.verify_working(recipient,
            working_capture:value.fetch("workingCapture"))
          need(received == observation &&
            StarforgeRubyRuntime.inventory(application,exclude:[".ruby.lock"]) == files &&
            StarforgeRubyRuntime.inventory(recipient,exclude:[".ruby.lock"]) == files,
            "DATASET_MAPPING_COPIED_APPLICATION")
          snapshot = {"schema"=>"stellar-forge.managed-ruby-application-snapshot.v1",
            "profile"=>"captured-working-state","workingCapture"=>value.fetch("workingCapture"),
            "observation"=>observation,"files"=>files.length,
            "bytes"=>files.sum { |item| item.fetch("bytes") },
            "filesSha256"=>StarforgeRubyRuntime.identity(files)}
          result = {"selection_sha256"=>RailsDataset.fingerprint(selected),
            "files"=>files,"snapshot"=>snapshot,"workflow"=>value}
          save(root,"produced.json",result)
          result
        end
      ensure
        NativeDatasetLifecycle.disconnect
      end

      def reopen(directory:,runtime_source:)
        root = Files.directory(File.expand_path(directory))
        runtime = load_runtime(runtime_source)
        Files.lock(root) do
          RecordsExample.restore(root)
          result = Store.read(File.join(root,RESULT))
          selected = Store.read(File.join(root,"selection.json"))
          need(result["schema"] == SCHEMA && result["state"] == "COMPLETE" &&
            result["selection"] == selected && source_files(runtime) == selected.fetch("runtime_files"),
            "DATASET_MAPPING_RESULT_CHANGED")
          verify_files(root,result.fetch("files"))
          received = child_receiver(root,runtime,Store.read(File.join(root,"receiving.json")))
          need(received == result.fetch("receiver"),"DATASET_MAPPING_REOPEN_CHANGED")
          result
        end
      end

      def run(application:,runtime_source:,directory:,candidate_id:nil)
        root = Files.directory(File.expand_path(directory),create:true)
        runtime = load_runtime(runtime_source)
        original = File.expand_path(application)
        client = File.expand_path("../../..",__dir__)
        [original,client,runtime].each do |source|
          need(root != source && !root.start_with?(source+"/") && !source.start_with?(root+"/"),
            "DATASET_MAPPING_OUTPUT_DIRECTORY")
        end
        # Finished receiving is independent of the producing application path.
        if Store.present?(File.join(root,RESULT))
          selected = Store.read(File.join(root,"selection.json"))
          need(selected["application"] == original && (!candidate_id || selected.dig("candidate","id") == candidate_id),
            "DATASET_MAPPING_SELECTION_CHANGED")
          return reopen(directory:root,runtime_source:runtime)
        end
        Files.lock(root) do
          RecordsExample.restore(root)
          selected_path = File.join(root,"selection.json")
          if Store.present?(selected_path)
            selected = Store.read(selected_path)
            need(selected["schema"] == SCHEMA && selected["application"] == original &&
              selected["runtime_source"] == runtime &&
              (!candidate_id || selected.dig("candidate","id") == candidate_id) &&
              source_files(runtime) == selected.fetch("runtime_files"),"DATASET_MAPPING_SELECTION_CHANGED")
          else
            original = Files.directory(original)
            Files.lock(original) do
              selection = select_source(original,candidate_id)
              selected = {"schema"=>SCHEMA,"id"=>SecureRandom.uuid,"application"=>original,
                "runtime_source"=>runtime,"runtime_files"=>source_files(runtime),
                "application_record"=>RecordsExample.application_record(original),"ruby"=>RUBY_DESCRIPTION}.merge(selection)
              save(root,"selection.json",selected)
            end
          end
          produced = complete_copy(root,original,selected)
          expected = produced.slice("files","snapshot","workflow")
          received = nil
          # The receiving child has only the copied root as application input.
          # Physically park the original while its full source/DB/HTTP journey runs.
          Files.lock(original) do
            RecordsExample.with_parked(root,original,produced.fetch("files")) do
              received = child_receiver(root,runtime,expected)
            end
          end
          outputs = StarforgeRubyRuntime.inventory(root,
            exclude:[".ruby.lock","recipient",RESULT,"receiver-error.json"])
          outputs += produced.fetch("files").map { |item| item.merge("name"=>"recipient/"+item.fetch("name")) }
          result = {"schema"=>SCHEMA,"state"=>"COMPLETE","selection"=>selected,
            "workflow"=>produced.fetch("workflow"),"snapshot"=>produced.fetch("snapshot"),
            "receiver"=>received,"files"=>outputs.sort_by { |item| item.fetch("name") }}
          save(root,RESULT,result)
          result
        end
      ensure
        NativeDatasetLifecycle.disconnect if defined?(NativeDatasetLifecycle)
      end

      def main(argv)
        command = argv.first && !argv.first.start_with?("-") ? argv.shift : nil
        options = {}
        parser = OptionParser.new do |flags|
          flags.banner = "mapping_example.rb run|reopen --out PRIVATE_DIRECTORY --runtime-source CURRENT_RUNTIME [--application ORIGINAL_APP --candidate ORIGINAL_ID]"
          flags.on("--application DIRECTORY") { |value| options[:application] = value }
          flags.on("--runtime-source DIRECTORY") { |value| options[:runtime_source] = value }
          flags.on("--out DIRECTORY") { |value| options[:directory] = value }
          flags.on("--candidate ID") { |value| options[:candidate_id] = value }
          flags.on("--help") { options[:help] = true }
        end
        parser.parse!(argv)
        if options.delete(:help) || !command || command == "help"
          puts parser
          puts <<~GUIDE

            run     Use the original installed application and its complete current source.
                    Retain actual Rails forms, full source/preview/CLI files, one import,
                    working records and an independently received application.
            reopen  Reopen the complete saved output and received application offline.

            Keep --out fixed for the original operation. Select the complete current
            Ruby client and its paired --runtime-source. The original application
            must be stopped while its closed database is copied. --candidate is
            optional; when omitted the current source and mapping are selected.
          GUIDE
          return nil
        end
        need(argv.empty? && %w[run reopen _receive].include?(command) &&
          options[:directory] && options[:runtime_source],"DATASET_MAPPING_ARGUMENTS")
        if command == "run"
          need(options[:application],"DATASET_MAPPING_APPLICATION_REQUIRED")
          run(**options)
        elsif command == "reopen"
          need(!options[:application] && !options[:candidate_id],"DATASET_MAPPING_REOPEN_ARGUMENTS")
          reopen(**options)
        else
          need(!options[:application] && !options[:candidate_id],"DATASET_MAPPING_RECEIVING_ARGUMENTS")
          runtime = load_runtime(options.fetch(:runtime_source))
          root = Files.directory(File.expand_path(options.fetch(:directory)))
          selected = Store.read(File.join(root,"selection.json"))
          need(source_files(runtime) == selected.fetch("runtime_files"),"DATASET_MAPPING_SOURCE_CHANGED")
          receiver(root,runtime,Store.read(File.join(root,"receiving.json")))
        end
      end
    end
  end
end

if File.expand_path($PROGRAM_NAME) == File.expand_path(__FILE__)
  saved_umask = File.umask(0077)
  begin
    result = Starforge::DatasetOperator::MappingExample.main(ARGV.dup)
    puts JSON.generate(result) unless result.nil?
  rescue Exception => error
    warn JSON.generate({"error"=>{"code"=>error.respond_to?(:code) ? error.code : error.class.name,
      "message"=>error.message.to_s[0,4000]}})
    exit 1
  ensure
    File.umask(saved_umask)
  end
end
