#!/usr/bin/env ruby
# frozen_string_literal: true
# MIT. The original DatasetOperator over a complete received native or Baserow application.
require_relative "engine"
require "net/http"
require "uri"
require "base64"
require "openssl"

module StarforgeRubyRuntime
  module Application
    extend StarforgeRubyRuntime
    module_function

    MARKER = "managed-application.json"
    def load_client(environment)
      client = File.join(private_directory(environment),"client")
      require File.join(client,"baserow/customer/baserow_customer_receiving")
      require File.join(client,"developer/ruby-client/examples/rails_dataset/operator/commission")
    end
    # Original NativeDatasetDelivery already provides exact bytes, copy/reopen
    # and source membership. This adapter only presents the existing .dataset
    # shape to the original Rails operator's customer commissioning journey.
    class NativePackage
      attr_reader :dataset
      def self.open(path,sha)
        new(Starforge::DatasetDelivery.open(path,expected_manifest_sha256: sha))
      end
      def initialize(dataset)
        @dataset = dataset
      end
      def manifest_sha256
        @dataset.manifest_sha256
      end
      def copy_to(directory)
        self.class.new(@dataset.copy_to(directory))
      end
    end
    def original(record)
      source = record.fetch("source")
      path = private_directory(source.fetch("originalDirectory"))
      expected = source.fetch("manifest")
      need(file_descriptor(File.join(path,member(expected.fetch("name")))) == expected.slice("bytes","sha256"),
        "RUBY_ORIGINAL_APPLICATION_CHANGED")
      [path,source]
    end
    def open_package(root,marker)
      if marker.fetch("format") == "baserow"
        config = Starforge::DatasetOperator::Commission.configuration(root)
        package = Starforge::BaserowCustomerDelivery.open(directory: File.join(root,"customer"),
          expected_manifest_sha256: config.fetch("manifest_sha256"))
        [package,config.fetch("source_key"),Starforge::DatasetOperator::Store.read(File.join(root,"mapping.json"))]
      else
        packet = Starforge::NativeDatasetLifecycle.read_application(root,
          expected_manifest_sha256: marker.fetch("originalManifestSha256"))
        [NativePackage.new(packet.fetch("delivery")),packet.fetch("selected").fetch("source_key"),packet.fetch("mapping")]
      end
    end
    def open_workspace(root)
      marker = parse(File.join(root,MARKER))
      need(marker["schema"] == "stellar-forge.managed-ruby-application.v1","RUBY_APPLICATION_MARKER_INVALID")
      if marker.fetch("format") == "baserow"
        return Starforge::DatasetOperator::Commission.open_workspace(root)
      end
      package,source_key,mapping = open_package(root,marker)
      original_database = File.join(root,"application.sqlite3")
      working = File.join(root,"operating.sqlite3")
      unless File.exist?(working)
        copy_file(original_database,working,file_descriptor(original_database))
      end
      Starforge::NativeDatasetLifecycle.connect(working)
      streams = Starforge::DatasetExample::DatasetStream.where(tenant_key: Starforge::NativeDatasetLifecycle::TENANT)
      stream = streams.find_by!(name: source_key)
      Starforge::DatasetOperator::Workspace.new(directory: File.join(root,"operator"),
        tenant_key: Starforge::NativeDatasetLifecycle::TENANT,streams: streams,
        target_scope: lambda { |_stream| Starforge::NativeDatasetLifecycle::SourceRow.where(
          tenant_key: Starforge::NativeDatasetLifecycle::TENANT) },
        models: Starforge::DatasetExample::MODELS,
        catalog: lambda {
          [{"id"=>"received-native","title"=>"Received native dataset","stream_id"=>stream.id,
            "directory"=>File.join(root,"dataset"),"format"=>"native",
            "manifest_sha256"=>package.manifest_sha256,"mapping"=>mapping}]
        },formats: {"native"=>lambda { |path,sha| NativePackage.open(path,sha) }})
    end
    def open_app(root,workspace = nil)
      workspace ||= open_workspace(root)
      key = read(File.join(root,"access-key"),1024).strip
      need(HASH.match?(key),"RUBY_APPLICATION_ACCESS_KEY_INVALID")
      Starforge::DatasetOperator::Installation.open(directory: root,workspace: workspace,access_key: key)
    end
    def initialize_copy(record)
      root = record.fetch("directory")
      marker = optional(File.join(root,MARKER))
      unless marker
        source,meta = original(record)
        need(root != source && !root.start_with?(source + "/") && !source.start_with?(root + "/"),"RUBY_APPLICATION_COPY_TARGET")
        if meta.fetch("format") == "native"
          Starforge::NativeDatasetLifecycle.copy_application(source,
            expected_manifest_sha256: meta.fetch("manifest").fetch("sha256"),out: root)
        else
          # Use the actual original completed application and its complete file
          # set, retaining the original result separately from later working state.
          Starforge::DatasetOperator::Commission.reopen(directory: source)
          result = parse(File.join(source,"operator-result.json"))
          private_directory(root,create: true)
          Starforge::Files.lock(source) do
            need(Starforge::DatasetOperator::Commission.file_set(source) == result.fetch("files"),
              "RUBY_ORIGINAL_APPLICATION_CHANGED")
            result.fetch("files").each do |entry|
              path = File.join(root,member(entry.fetch("name")))
              directories(root,File.dirname(path))
              copy_file(File.join(source,entry.fetch("name")),path,entry)
            end
            copy_file(File.join(source,"operator-result.json"),File.join(root,"operator-result.json"),meta.fetch("manifest"))
            need(Starforge::DatasetOperator::Commission.file_set(source) == result.fetch("files"),
              "RUBY_ORIGINAL_APPLICATION_CHANGED")
          end
        end
        marker = {"schema"=>"stellar-forge.managed-ruby-application.v1","format"=>meta.fetch("format"),
          "originalManifestSha256"=>meta.fetch("manifest").fetch("sha256"),
          "originalApplicationSource"=>meta}
        save(File.join(root,MARKER),marker)
      end
      private_directory(root)
      meta = record.fetch("source")
      need(marker["schema"] == "stellar-forge.managed-ruby-application.v1" &&
        marker["format"] == meta.fetch("format") &&
        marker["originalManifestSha256"] == meta.fetch("manifest").fetch("sha256") &&
        marker["originalApplicationSource"] == meta,"RUBY_APPLICATION_MARKER_CHANGED")
      key_path = File.join(root,"access-key")
      unless File.exist?(key_path)
        begin
          write(key_path,SecureRandom.hex(32) + "\n")
        rescue StarforgeRubyRuntime::Error => error
          # Another original initializer may have retained the same app's key.
          raise unless error.code == "RUBY_RETAINED_FILE_CHANGED" && File.exist?(key_path)
        end
      end
      file_descriptor(key_path)
      need(HASH.match?(read(key_path,1024).strip),"RUBY_APPLICATION_ACCESS_KEY_INVALID")
      root
    end
    def verify_working(root,http: true)
      private_directory(root)
      marker = parse(File.join(root,MARKER))
      workspace = open_workspace(root)
      package,source_key,mapping = open_package(root,marker)
      native = package.dataset
      importer = Starforge::NativeDatasetLifecycle.importer(native,source_key,mapping)
      current = Starforge::NativeDatasetLifecycle.verify_current_targets(importer,native)
      connection = ActiveRecord::Base.connection
      need(connection.select_value("PRAGMA quick_check") == "ok","RUBY_APPLICATION_DATABASE_CHANGED")
      stream = Starforge::DatasetExample::DatasetStream.where(
        tenant_key: Starforge::NativeDatasetLifecycle::TENANT,name: source_key).take!
      h,editions = Digest::SHA256.new,0
      Starforge::DatasetExample::DatasetEdition.where(dataset_stream_id: stream.id).order(:id).find_each do |edition|
        value = importer.verified_receipt(edition)
        h.update(Starforge::RailsDataset.json(value))
        h.update("\n")
        editions += 1
      end
      if http
        application = open_app(root,workspace)
        session = Starforge::DatasetOperator::Commission::Session.new(application,read(File.join(root,"access-key"),1024).strip)
        session.request("GET","/dataset_imports") {}
        before = nil
        loop do
          page = workspace.list(before: before,limit: 100)
          page.fetch("items").each do |review|
            selected_id = review.fetch("id")
            session.request("GET","/dataset_imports/" + selected_id) {}
            detail = workspace.detail(selected_id)
            if detail["committed"]
              session.request("GET","/dataset_imports/" + selected_id + "/download",params: {name: "receipt.json"}) do |response|
                need(response.matches?(detail.fetch("committed").fetch("file")),"RUBY_APPLICATION_HTTP_RECEIPT_CHANGED")
              end
            end
          end
          before = page["next_before"]
          break unless before
        end
      end
      {"schema"=>"stellar-forge.managed-ruby-application-observation.v1","format"=>marker.fetch("format"),
        "sourceKey"=>source_key,"datasetManifestSha256"=>native.manifest_sha256,
        "rows"=>native.row_count,"currentTargets"=>current,"editions"=>editions,"historySha256"=>h.hexdigest}
    ensure
      Starforge::NativeDatasetLifecycle.disconnect
    end
    def register(record)
      root = initialize_copy(record)
      Starforge::Files.lock(root) do
        saved = optional(File.join(root,"managed-operating-result.json"))
        unless saved
          workspace = open_workspace(root)
          application = open_app(root,workspace)
          session = Starforge::DatasetOperator::Commission::Session.new(application,read(File.join(root,"access-key"),1024).strip)
          # Exact original Rails forms, CSRF, import job, complete row previews,
          # receipts, history and attachment streams on the retained source.
          observed = Starforge::DatasetOperator::Commission.journey(root,workspace,session)
          Starforge::NativeDatasetLifecycle.disconnect
          save(File.join(root,"managed-operating-result.json"),{"schema"=>"stellar-forge.managed-ruby-application-commission.v1",
            "originalSource"=>record.fetch("source"),"observed"=>observed})
        end
        verify_working(root)
      end
    ensure
      Starforge::NativeDatasetLifecycle.disconnect
    end
    def verify(record)
      root = private_directory(record.fetch("directory"))
      Starforge::Files.lock(root) { verify_working(root) }
    end
    def snapshot(record,out)
      root = private_directory(record.fetch("directory"))
      need(root != out && !out.start_with?(root + "/") && !root.start_with?(out + "/"),"RUBY_APPLICATION_COPY_TARGET")
      Starforge::Files.lock(root) do
        observed = verify_working(root)
        files = inventory(root,exclude: [".ruby.lock"])
        copy_tree(root,out,files: files,exclude: [".ruby.lock"])
        {"schema"=>"stellar-forge.managed-ruby-application-snapshot.v1","observation"=>observed,
          "files"=>files.length,"bytes"=>files.sum { |entry| entry.fetch("bytes") },"filesSha256"=>identity(files)}
      end
    end

    # Keep the original Rails authentication and CSRF policy. The browser's
    # private fragment is exchanged once for a host-only HttpOnly session; the
    # original controller still receives the selected HTTP Basic credential.
    class BrowserSession
      def initialize(application,token,access_key,origin,cookie)
        @application,@token,@access_key,@origin,@cookie = application,token,access_key,origin,cookie
      end
      def same?(value)
        value.is_a?(String) && value.bytesize == @token.bytesize &&
          ActiveSupport::SecurityUtils.secure_compare(value,@token)
      end
      def call(env)
        host = env["HTTP_HOST"].to_s
        return [403,{"content-type"=>"text/plain"},["Local application host required"]] unless "http://" + host == @origin
        if env["PATH_INFO"] == "/managed-ruby/start" && env["REQUEST_METHOD"] == "GET"
          html = <<~'HTML'
            <!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
            <title>Dataset application</title><style>body{font:15px system-ui,sans-serif;margin:3rem;color:#222;background:#fafafa}main{max-width:44rem}h1{font-size:1.4rem}</style>
            <main><h1>Dataset application</h1><p id="status">Opening your private application…</p></main>
            <script>
            (async()=>{const token=new URLSearchParams(location.hash.slice(1)).get('token');history.replaceState(null,'',location.pathname);
            if(!token)throw new Error('Open the current application link from the managed Ruby workspace.');
            const result=await fetch('/managed-ruby/session',{method:'POST',headers:{'X-Ruby-Application':token},credentials:'same-origin'});
            if(!result.ok)throw new Error('The application session could not be opened. Use the current workspace link.');
            location.replace('/dataset_imports');})().catch(error=>{document.getElementById('status').textContent=error.message});
            </script></html>
          HTML
          return [200,{"content-type"=>"text/html; charset=utf-8","cache-control"=>"no-store",
            "referrer-policy"=>"no-referrer","x-frame-options"=>"DENY"},[html]]
        end
        if env["PATH_INFO"] == "/managed-ruby/session"
          valid = env["REQUEST_METHOD"] == "POST" && env["HTTP_ORIGIN"] == @origin && same?(env["HTTP_X_RUBY_APPLICATION"])
          return [403,{"content-type"=>"text/plain","cache-control"=>"no-store"},["Current private application session required"]] unless valid
          return [204,{"set-cookie"=>@cookie + "=" + @token + "; Path=/; HttpOnly; SameSite=Strict",
            "cache-control"=>"no-store"},[]]
        end
        cookie = env["HTTP_COOKIE"].to_s.split(";").map(&:strip).find { |part| part.start_with?(@cookie + "=") }
        if cookie && same?(cookie.split("=",2).last)
          env = env.merge("HTTP_AUTHORIZATION"=>"Basic " + ["operator:" + @access_key].pack("m0"))
        end
        @application.call(env)
      end
    end
    def serve(record,input)
      root = private_directory(record.fetch("directory"))
      port = input.fetch("port")
      need(port.is_a?(Integer) && port.between?(1,65535),"RUBY_PORT_INVALID")
      stop = false
      Signal.trap("TERM") { stop = true }
      Signal.trap("INT") { stop = true }
      server = nil
      Starforge::Files.lock(root) do
        application = open_app(root)
        key = read(File.join(root,"access-key"),1024).strip
        origin = "http://127.0.0.1:" + port.to_s
        token = OpenSSL::HMAC.hexdigest("SHA256",key,"ruby-runtime/" + record.fetch("sha256"))
        cookie = "_starforge_ruby_" + record.fetch("sha256")[0,16]
        wrapped = BrowserSession.new(application,token,key,origin,cookie)
        require "puma"
        server = Puma::Server.new(wrapped,nil,{min_threads: 0,max_threads: 4,workers: 0})
        server.add_tcp_listener("127.0.0.1",port)
        thread = server.run
        uri = URI(origin + "/dataset_imports")
        response = nil
        deadline = Process.clock_gettime(Process::CLOCK_MONOTONIC) + 30
        loop do
          need(thread.alive?,"RUBY_APPLICATION_EXITED")
          raise Cancelled if stop
          begin
            http = Net::HTTP.new(uri.host,uri.port,nil)
            http.open_timeout = 1
            http.read_timeout = 5
            request = Net::HTTP::Get.new(uri.request_uri)
            request.basic_auth("operator",key)
            response = http.request(request)
            break if response.code == "200"
          rescue IOError,SystemCallError,Timeout::Error
          end
          need(Process.clock_gettime(Process::CLOCK_MONOTONIC) < deadline,"RUBY_APPLICATION_START_TIMEOUT")
          sleep 0.2
        end
        startup = {"schema"=>"stellar-forge.ruby-rails-application-startup.v1","status"=>"RUBY_RAILS_APPLICATION_READY",
          "operationId"=>input.fetch("operationId"),"applicationId"=>record.fetch("id"),
          "environmentId"=>record.fetch("environmentId"),"applicationSha256"=>record.fetch("sha256"),
          "environmentSelectionSha256"=>record.fetch("environmentSelectionSha256"),
          "directory"=>root,"url"=>origin + "/managed-ruby/start#token=" + token,
          "http"=>{"status"=>response.code.to_i,"bytes"=>response.body.bytesize,
            "sha256"=>Digest::SHA256.hexdigest(response.body)}}
        save(input.fetch("startupFile"),startup)
        while thread.alive? && !stop
          sleep 0.2
        end
        need(stop,"RUBY_APPLICATION_EXITED")
        server.stop(true)
        {"schema"=>"stellar-forge.managed-ruby-application-stop.v1","state"=>"STOPPED","applicationId"=>record.fetch("id")}
      end
    ensure
      server&.stop(true)
      Starforge::NativeDatasetLifecycle.disconnect
    end
    def run(path)
      input = parse(path)
      need(input["schema"] == "stellar-forge.ruby-application-command.v1","RUBY_APPLICATION_COMMAND_INVALID")
      load_client(input.fetch("environment"))
      record = parse(input.fetch("applicationRecord"))
      need(identity(record.reject { |key,_| key == "sha256" }) == record.fetch("sha256"),"RUBY_APPLICATION_CHANGED")
      case input.fetch("action")
      when "register" then register(record)
      when "verify" then verify(record)
      when "snapshot" then snapshot(record,File.expand_path(input.fetch("out")))
      when "serve" then serve(record,input)
      else raise Error.new("RUBY_APPLICATION_COMMAND_INVALID")
      end
    end
  end
end
if File.expand_path($PROGRAM_NAME) == File.expand_path(__FILE__)
  old_umask = File.umask(0077)
  begin
    StarforgeRubyRuntime.need(ARGV.length == 1,"RUBY_APPLICATION_ARGUMENTS")
    result = StarforgeRubyRuntime::Application.run(ARGV.fetch(0))
    puts JSON.generate(result)
  rescue Exception => error
    warn JSON.generate({"error"=>{"code"=>error.respond_to?(:code) ? error.code : error.class.name,"message"=>error.message.to_s[0,4000]}})
    exit 1
  ensure
    File.umask(old_umask)
  end
end
