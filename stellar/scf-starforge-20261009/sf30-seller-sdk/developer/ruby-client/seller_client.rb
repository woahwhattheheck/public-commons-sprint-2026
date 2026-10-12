# frozen_string_literal: true
# MIT. Ruby and Rails applications over the original seller and Node buyer.
require "json"
require "digest"
require "base64"
require "open3"
require "securerandom"
require "tempfile"
require "fileutils"
require "csv"
require "bigdecimal"
require "thread"

module Starforge
  MAX_INPUT = 64 * 1024 * 1024
  MAX_BODY = 16 * 1024 * 1024
  HASH = /\A[a-f0-9]{64}\z/
  INTENT = /\A[A-Za-z0-9._:-]{1,128}\z/
  CALL_ID = /\A[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}\z/
  ORIGINAL_FILES = %w[seller-client.mjs seller-client.d.mts seller-openapi.json package.json README.md].freeze
  LEGACY_RUBY_FILES = %w[seller_client.rb seller_client.rbs seller-client-bridge.mjs seller-buyer-bridge.mjs seller-contract.json rails_receiving.rb customer.rb RUBY.md].freeze
  LEGACY_DATASET_RUBY_FILES = %w[seller_client.rb seller_client.rbs seller-client-bridge.mjs seller-buyer-bridge.mjs seller-contract.json rails_receiving.rb customer.rb RUBY.md seller-dataset-bridge.mjs dataset_delivery.rb dataset_receiving.rb dataset_customer.rb rails_dataset.rb DATASETS.md examples/dataset_lifecycle.rb examples/rails_dataset/create_dataset_import_tables.rb examples/rails_dataset/models.rb examples/rails_dataset/import_dataset_job.rb examples/rails_dataset/commission.rb examples/rails_dataset/mapping.json examples/rails_dataset/README.md].freeze
  LEGACY_COMPLETE_RUBY_FILES = (LEGACY_DATASET_RUBY_FILES + %w[native_dataset.rb native_dataset_receiving.rb native_dataset_customer.rb NATIVE_DATASETS.md examples/native_dataset_lifecycle.rb]).freeze
  DATASET_OPERATOR_RUBY_FILES = %w[
    examples/rails_dataset/operator/workspace.rb
    examples/rails_dataset/operator/jobs.rb
    examples/rails_dataset/operator/controller.rb
    examples/rails_dataset/operator/commission.rb
    examples/rails_dataset/operator/README.md
    examples/rails_dataset/operator/install.rb
    examples/rails_dataset/operator/operator.css
    examples/rails_dataset/operator/views/layouts/starforge_dataset_operator.html.erb
    examples/rails_dataset/operator/views/starforge_dataset_operator/index.html.erb
    examples/rails_dataset/operator/views/starforge_dataset_operator/show.html.erb
    examples/rails_dataset/operator/views/starforge_dataset_operator/changes.html.erb
    examples/rails_dataset/operator/views/starforge_dataset_operator/history.html.erb
    examples/rails_dataset/operator/views/starforge_dataset_operator/attachments.html.erb
    examples/rails_dataset/operator/views/starforge_dataset_operator/error.html.erb
  ].freeze
  RUBY_FILES = (LEGACY_COMPLETE_RUBY_FILES + DATASET_OPERATOR_RUBY_FILES).freeze

  class Error < StandardError
    attr_reader :code, :call_id, :intent_id
    def initialize(code, call_id: nil, intent_id: nil)
      @code, @call_id, @intent_id = code, call_id, intent_id
      super(code)
    end
  end

  class DuplicateKeyHash < Hash
    def []=(key, value)
      raise Error, "RUBY_DUPLICATE_JSON_KEY" if key?(key)
      super
    end
  end

  module Files
    module_function
    def need(value, code)
      raise Error, code unless value
    end
    def hash(bytes)
      Digest::SHA256.hexdigest(bytes)
    end
    def parse(bytes, decimals: false)
      source = bytes.dup.force_encoding(Encoding::UTF_8)
      need(source.valid_encoding?, "RUBY_UTF8_REQUIRED")
      options = {create_additions: false, allow_nan: false, max_nesting: 100, object_class: DuplicateKeyHash}
      options[:decimal_class] = BigDecimal if decimals
      JSON.parse(source, **options)
    rescue JSON::ParserError, JSON::NestingError
      raise Error, "RUBY_JSON_INVALID"
    end
    def json(value)
      (JSON.generate(value, allow_nan: false, max_nesting: 100) + "\n").b
    rescue JSON::GeneratorError, JSON::NestingError
      raise Error, "RUBY_JSON_INVALID"
    end
    def read(path, limit = MAX_INPUT)
      flags = File::RDONLY | File::NOFOLLOW | File::NONBLOCK
      File.open(path, flags) do |file|
        before = file.stat
        need(before.file? && before.size <= limit, "RUBY_REGULAR_FILE_REQUIRED")
        bytes = file.read(limit + 1) || "".b
        after = file.stat
        need(bytes.bytesize == before.size && bytes.bytesize <= limit &&
          [before.dev,before.ino,before.size,before.mtime,before.ctime] ==
          [after.dev,after.ino,after.size,after.mtime,after.ctime], "RUBY_FILE_CHANGED")
        bytes.b
      end
    end
    def directory(path, create: false, private: true)
      path = File.expand_path(path.to_s)
      if create
        begin
          Dir.mkdir(path, 0700)
          sync(File.dirname(path))
        rescue Errno::EEXIST
          # Reopening keeps the existing directory and all original files.
        end
      end
      stat = File.lstat(path)
      need(stat.directory? && !stat.symlink? && File.realpath(path) == path, "RUBY_DIRECTORY_REQUIRED")
      if private
        need((stat.mode & 0077).zero? && stat.uid == Process.uid, "RUBY_PRIVATE_DIRECTORY_REQUIRED")
      end
      path
    end
    def sync(path)
      File.open(path, File::RDONLY) { |file| file.fsync }
    end
    def once(path, bytes)
      bytes = bytes.b
      tmp = Tempfile.new([".starforge-", ".pending"], File.dirname(path))
      begin
        tmp.binmode
        tmp.write(bytes)
        tmp.flush
        tmp.fsync
        tmp.close
        begin
          File.link(tmp.path, path)
          sync(File.dirname(path))
        rescue Errno::EEXIST
          need(read(path, [MAX_INPUT, bytes.bytesize].max) == bytes, "RUBY_SAVED_FILE_CONFLICT")
        end
      ensure
        tmp.close!
      end
      path
    end
    def lock(directory)
      path = File.join(directory, ".ruby.lock")
      File.open(path, File::RDWR | File::CREAT | File::NOFOLLOW, 0600) do |file|
        stat = file.stat
        need(stat.file? && stat.uid == Process.uid && (stat.mode & 0077).zero? && stat.nlink == 1,
          "RUBY_PRIVATE_LOCK_REQUIRED")
        need(file.flock(File::LOCK_EX | File::LOCK_NB), "RUBY_OPERATION_BUSY")
        begin
          yield
        ensure
          file.flock(File::LOCK_UN)
        end
      end
    end
    def values!(root)
      active, count = {}, 0
      walk = lambda do |item, depth|
        count += 1
        need(depth <= 64 && count <= 200_000, "RUBY_REQUEST_COMPLEXITY_LIMIT")
        case item
        when NilClass, TrueClass, FalseClass, String
          need(!item.is_a?(String) || item.encoding.ascii_compatible? && item.valid_encoding?, "RUBY_JSON_STRING_REQUIRED")
        when Integer
          need(item.abs <= 9_007_199_254_740_991, "RUBY_REQUEST_EXACT_INTEGER_REQUIRED")
        when Float
          need(item.finite?, "RUBY_FINITE_NUMBER_REQUIRED")
        when Hash, Array
          need(!active[item.object_id], "RUBY_ACYCLIC_JSON_REQUIRED")
          active[item.object_id] = true
          if item.is_a?(Hash)
            need(item.keys.all? { |key| key.is_a?(String) }, "RUBY_STRING_KEYS_REQUIRED")
            item.each_value { |child| walk.call(child, depth + 1) }
          else
            item.each { |child| walk.call(child, depth + 1) }
          end
          active.delete(item.object_id)
        else
          raise Error, "RUBY_JSON_VALUES_REQUIRED"
        end
      end
      walk.call(root, 0)
      root
    end
  end

  class Cancellation
    def initialize
      @mutex, @cancelled = Mutex.new, false
    end
    def cancel
      @mutex.synchronize { @cancelled = true }
    end
    def cancelled?
      @mutex.synchronize { @cancelled }
    end
  end

  class Runner
    def initialize(node:, environment: nil)
      Files.need(node.is_a?(String) && !node.empty? && !node.include?("\0"), "RUBY_NODE_REQUIRED")
      @node = node
      @environment = (environment || ENV.to_h).dup
      @environment.delete("NODE_OPTIONS")
      @environment.delete("NODE_PATH")
      Files.need(@environment.all? { |k,v| k.is_a?(String) && v.is_a?(String) && !k.include?("\0") && !v.include?("\0") },
        "RUBY_ENVIRONMENT_INVALID")
    end
    def signal(waiter, name, process_group: false)
      Process.kill(name, process_group ? -waiter.pid : waiter.pid) if process_group || waiter.alive?
    rescue Errno::ESRCH
      # The child completed between the liveness read and the signal.
    end
    def run(script, arguments = [], input: "".b, timeout: 420, limit: MAX_INPUT, cancel: nil, inherit_stdin: false,
      interpreter_arguments: [], process_group: false)
      Files.need(timeout.is_a?(Numeric) && timeout.finite? && timeout > 0 && timeout <= 7200, "RUBY_TIMEOUT_INVALID")
      Files.need(arguments.is_a?(Array) && interpreter_arguments.is_a?(Array) &&
        (arguments + interpreter_arguments).all? { |a| a.is_a?(String) && !a.include?("\0") } &&
        [true,false].include?(process_group), "RUBY_ARGUMENTS_INVALID")
      spawn_options = {unsetenv_others: true}
      spawn_options[:pgroup] = true if process_group
      raise Error, "RUBY_CANCELLED_BEFORE_START" if cancel&.cancelled?
      input = input.b
      stdout, stderr, issue, stop_at = "".b, "".b, nil, nil
      started = Process.clock_gettime(Process::CLOCK_MONOTONIC)
      i = o = e = waiter = out_writer = error_writer = nil
      begin
        if inherit_stdin
          Files.need(input.empty?, "RUBY_NATIVE_STDIN_CONFLICT")
          o,out_writer = IO.pipe
          e,error_writer = IO.pipe
          pid = Process.spawn(@environment,@node,*interpreter_arguments,File.realpath(script),*arguments,
            **spawn_options,in: $stdin,out: out_writer,err: error_writer)
          waiter = Process.detach(pid)
          out_writer.close
          error_writer.close
        else
          i,o,e,waiter = Open3.popen3(@environment,@node,*interpreter_arguments,File.realpath(script),*arguments,**spawn_options)
        end
        [i,o,e].compact.each(&:binmode)
        position, readers = 0, [o,e]
        i.close if i && input.empty?
        until readers.empty? && !waiter.alive?
          now = Process.clock_gettime(Process::CLOCK_MONOTONIC)
          issue ||= "RUBY_NATIVE_CANCELLED" if cancel&.cancelled?
          issue ||= "RUBY_NATIVE_TIMEOUT" if now - started >= timeout
          if issue && stop_at.nil?
            signal(waiter, "TERM",process_group: process_group)
            stop_at = now + 30
            i.close if i && !i.closed?
          end
          if stop_at && now >= stop_at
            signal(waiter, "KILL",process_group: process_group)
            readers.each { |stream| stream.close unless stream.closed? }
            readers.clear
            break
          end
          writable = i.nil? || i.closed? ? [] : [i]
          ready = IO.select(readers, writable, nil, 0.1)
          next unless ready
          ready[1].each do |stream|
            count = stream.write_nonblock(input.byteslice(position, 65_536), exception: false)
            next if count == :wait_writable
            position += count
            stream.close if position == input.bytesize
          rescue Errno::EPIPE
            stream.close
          end
          ready[0].each do |stream|
            chunk = stream.read_nonblock(65_536, exception: false)
            next if chunk == :wait_readable
            if chunk.nil?
              readers.delete(stream)
              stream.close
              next
            end
            target, maximum = stream == o ? [stdout,limit] : [stderr,16_384]
            remaining = [maximum - target.bytesize, 0].max
            target << chunk.byteslice(0, remaining)
            issue ||= "RUBY_NATIVE_OUTPUT_LIMIT" if chunk.bytesize > remaining
          end
        end
        waiter.join
        {status: waiter.value, stdout: stdout, stderr: stderr, error: issue}
      ensure
        if waiter&.alive?
          begin
            signal(waiter, "TERM",process_group: process_group)
            unless waiter.join(30)
              signal(waiter, "KILL",process_group: process_group)
              waiter.join
            end
          rescue Errno::ESRCH
            waiter.join
          end
        end
        # A read-only Python receiver and its original Node scanner share this
        # dedicated group. Retain the ordinary buyer terminal process behavior.
        signal(waiter, "KILL",process_group: true) if process_group && waiter
        [i,o,e,out_writer,error_writer].compact.each { |stream| stream.close unless stream.closed? }
      end
    rescue Errno::ENOENT, Errno::EACCES
      raise Error, "RUBY_NATIVE_PROCESS_UNAVAILABLE"
    end
  end

  class BoundRequest
    attr_reader :body
    def initialize(input, record, body)
      @input, @record, @body = input.dup.freeze, record.dup.freeze, body&.dup&.freeze
      freeze
    end
    def source_sha256
      describe.fetch("sourceSha256")
    end
    def operation_id
      describe.fetch("operationId")
    end
    def intent_id
      describe.fetch("request").fetch("intentId")
    end
    def describe
      Files.parse(@record)
    end
    def input_bytes
      @input.dup
    end
    def record_bytes
      @record.dup
    end
    def save(directory)
      directory = Files.directory(directory, create: true)
      Files.lock(directory) do
        entries = [["request-input.json",@input],["request.json",@record]]
        entries << ["request.body",@body] unless @body.nil?
        entries.each { |name,bytes| Files.once(File.join(directory,name),bytes) }
        manifest = {"schema"=>"stellar-forge.ruby-seller-request-plan.v1", "sourceSha256"=>source_sha256,
          "files"=>entries.map { |name,bytes| {"name"=>name,"bytes"=>bytes.bytesize,"sha256"=>Files.hash(bytes)} }}
        Files.once(File.join(directory,"request-plan.json"), Files.json(manifest))
      end
      directory
    end
  end

  class SellerClient
    attr_reader :directory, :manifest_sha256
    def initialize(directory = __dir__, node: "node", environment: nil, timeout: 60)
      @directory = Files.directory(directory, private: false)
      @runner, @timeout = Runner.new(node: node, environment: environment), timeout
      @manifest_bytes = Files.read(File.join(@directory,"ruby-client.json"),131_072).freeze
      @manifest = Files.parse(@manifest_bytes)
      @manifest_sha256 = Files.hash(@manifest_bytes)
      verify_package!
      @snapshot = Files.parse(Files.read(File.join(@directory,"seller-contract.json")))
      Files.need(@snapshot["sourceSha256"] == @manifest["sourceSha256"], "RUBY_SOURCE_CHANGED")
    end
    def verify_package!
      Files.need(Files.read(File.join(@directory,"ruby-client.json"),131_072) == @manifest_bytes &&
        @manifest["schema"] == "stellar-forge.ruby-seller-client.v1", "RUBY_PACKAGE_CHANGED")
      base_bytes = Files.read(File.join(@directory,"client-export.json"),131_072)
      base = Files.parse(base_bytes)
      Files.need(Files.hash(base_bytes) == @manifest["originalManifestSha256"] &&
        base["sourceSha256"] == @manifest["sourceSha256"], "RUBY_ORIGINAL_EXPORT_CHANGED")
      selected = [LEGACY_RUBY_FILES,LEGACY_DATASET_RUBY_FILES,LEGACY_COMPLETE_RUBY_FILES,RUBY_FILES].find { |files|
        @manifest["files"].is_a?(Array) && @manifest["files"].length == files.length
      }
      Files.need(selected, "RUBY_PACKAGE_INCOMPLETE")
      [[ORIGINAL_FILES,base["files"]],[selected,@manifest["files"]]].each do |names,entries|
        Files.need(entries.is_a?(Array) && entries.map { |item| item["name"] } == names, "RUBY_PACKAGE_INCOMPLETE")
        entries.each do |entry|
          path = File.join(@directory,entry.fetch("name"))
          Files.directory(File.dirname(path),private: false)
          raw = Files.read(path)
          Files.need(entry["bytes"].is_a?(Integer) && raw.bytesize == entry["bytes"] &&
            Files.hash(raw) == entry["sha256"], "RUBY_PACKAGE_FILE_CHANGED")
        end
      end
      true
    end
    def dataset_available?
      verify_package!
      @manifest["files"].any? { |entry| entry["name"] == "seller-dataset-bridge.mjs" }
    end
    def native_dataset_available?
      verify_package!
      @manifest["files"].any? { |entry| entry["name"] == "native_dataset.rb" }
    end
    def source
      Files.parse(Files.json(@snapshot.slice("schema","sourceSha256","mode","title","origin")))
    end
    def operations
      Files.parse(Files.json(@snapshot.fetch("operations")))
    end
    def build_request(operation_id, inputs, intent_id:, max_atomic:, accept_index: nil, payment_flow: nil)
      Files.need(inputs.is_a?(Hash), "RUBY_REQUEST_INPUTS_REQUIRED")
      selected = inputs.dup
      if selected.key?("multipart")
        part = selected["multipart"]
        Files.need(part.is_a?(Hash) && part.keys.sort == %w[body contentType] &&
          part["body"].is_a?(String) && part["body"].bytesize <= MAX_BODY, "RUBY_MULTIPART_BYTES_REQUIRED")
        selected["multipart"] = {"bodyBase64"=>Base64.strict_encode64(part["body"].b), "contentType"=>part["contentType"]}
      end
      auth = {"intentId"=>intent_id,"maxAtomic"=>max_atomic}
      auth["acceptIndex"] = accept_index unless accept_index.nil?
      auth["paymentFlow"] = payment_flow unless payment_flow.nil?
      payload = {"sourceSha256"=>source.fetch("sourceSha256"),"operationId"=>operation_id,"inputs"=>selected,"authorization"=>auth}
      Files.values!(payload)
      build(Files.json(payload))
    end
    def build(payload)
      verify_package!
      Files.need(payload.is_a?(String) && payload.bytesize <= MAX_INPUT, "RUBY_REQUEST_INPUT_LIMIT")
      Files.values!(Files.parse(payload))
      run = @runner.run(File.join(@directory,"seller-client-bridge.mjs"),input: payload,timeout: @timeout)
      raise Error, run[:error] if run[:error]
      unless run[:status].success?
        raise Error, "RUBY_ORIGINAL_REQUEST_REJECTED"
      end
      result, supplied = Files.parse(run[:stdout]), Files.parse(payload)
      Files.need(result["schema"] == "stellar-forge.ruby-seller-request.v1" &&
        result["sourceSha256"] == source["sourceSha256"] && result["operationId"] == supplied["operationId"],
        "RUBY_REQUEST_SOURCE_CHANGED")
      body = nil
      unless result["body"].nil?
        descriptor = result["body"]
        encoded = descriptor.delete("base64")
        begin
          body = Base64.strict_decode64(encoded)
        rescue ArgumentError, TypeError
          raise Error, "RUBY_REQUEST_BODY_CHANGED"
        end
        Files.need(body.bytesize <= MAX_BODY && body.bytesize == descriptor["bytes"] &&
          Files.hash(body) == descriptor["sha256"] && Base64.strict_encode64(body) == encoded, "RUBY_REQUEST_BODY_CHANGED")
      end
      result["inputSha256"] = Files.hash(payload)
      result["originalManifestSha256"] = @manifest.fetch("originalManifestSha256")
      result["rubyManifestSha256"] = @manifest_sha256
      verify_package!
      BoundRequest.new(payload,Files.json(result),body)
    end
    def load_request(directory)
      directory = Files.directory(directory)
      manifest = Files.parse(Files.read(File.join(directory,"request-plan.json"),131_072))
      Files.need(manifest["schema"] == "stellar-forge.ruby-seller-request-plan.v1" &&
        manifest["sourceSha256"] == source["sourceSha256"], "RUBY_REQUEST_PLAN_CHANGED")
      entries = manifest["files"]
      Files.need(entries.is_a?(Array) &&
        [%w[request-input.json request.json],%w[request-input.json request.json request.body]].include?(entries.map { |f| f["name"] }),
        "RUBY_REQUEST_PLAN_INCOMPLETE")
      saved = {}
      entries.each do |entry|
        raw = Files.read(File.join(directory,entry["name"]))
        Files.need(raw.bytesize == entry["bytes"] && Files.hash(raw) == entry["sha256"], "RUBY_REQUEST_PLAN_CHANGED")
        saved[entry["name"]] = raw
      end
      Files.values!(Files.parse(saved.fetch("request-input.json")))
      rebuilt = build(saved.fetch("request-input.json"))
      Files.need(rebuilt.record_bytes == saved["request.json"] && rebuilt.body == saved["request.body"], "RUBY_REQUEST_PLAN_CHANGED")
      rebuilt
    end
    def prepare(buyer, bound, response_file: nil, call_id: nil, cancel: nil)
      Files.need(bound.is_a?(BoundRequest) && buyer.is_a?(Buyer), "RUBY_BOUND_REQUEST_REQUIRED")
      Files.need(buyer.client_manifest_sha256 == @manifest_sha256, "RUBY_BUYER_PACKAGE_CHANGED")
      rebuilt = build(bound.input_bytes)
      Files.need(rebuilt.record_bytes == bound.record_bytes && rebuilt.body == bound.body, "RUBY_BOUND_REQUEST_CHANGED")
      record = bound.describe
      record["bodyBase64"] = Base64.strict_encode64(bound.body) unless bound.body.nil?
      arguments = {"bound"=>record}
      arguments["responseFile"] = response_file unless response_file.nil?
      buyer.invoke("prepare", bound.intent_id, arguments, call_id: call_id, cancel: cancel)
      Operation.new(buyer, bound.intent_id, source.fetch("sourceSha256"))
    end
    def reopen(buyer, intent_id)
      operation = Operation.new(buyer,intent_id,source.fetch("sourceSha256"))
      operation.status
      operation
    end
  end

  class Buyer
    attr_reader :directory, :client_manifest_sha256
    def initialize(client:, runtime_directory:, state_directory:, node: "node", environment: nil,
      operator_profile: nil, workspace_directory: nil, timeout: 420, output_limit: 16_777_216)
      Files.need(client.is_a?(SellerClient), "RUBY_SELLER_CLIENT_REQUIRED")
      Files.need(timeout.is_a?(Numeric) && timeout.finite? && timeout > 35 && timeout <= 7200, "RUBY_TIMEOUT_INVALID")
      Files.need(output_limit.is_a?(Integer) && output_limit.between?(65_536,MAX_INPUT), "RUBY_OUTPUT_LIMIT_INVALID")
      @client, @timeout, @output_limit = client, timeout, output_limit
      @client_manifest_sha256 = client.manifest_sha256.dup.freeze
      @directory = Files.directory(state_directory,create: true)
      @calls = Files.directory(File.join(@directory,"ruby-calls"),create: true)
      @runtime = {"runtimeDirectory"=>File.realpath(runtime_directory.to_s),"stateDirectory"=>@directory,
        "timeoutMs"=>([timeout - 35,1].max * 1000).to_i,"outputLimit"=>output_limit}
      @runtime["operatorProfile"] = File.realpath(operator_profile.to_s) unless operator_profile.nil?
      @runtime["workspaceDirectory"] = File.realpath(workspace_directory.to_s) unless workspace_directory.nil?
      Files.need(operator_profile.nil? || workspace_directory.nil?, "RUBY_SELECT_ONE_OPERATOR_SOURCE")
      @runner = Runner.new(node: node,environment: environment)
      @mutex, @condition, @active, @closing = Mutex.new, ConditionVariable.new, {}, false
    end
    def invoke(action, intent_id = nil, arguments = {}, call_id: nil, cancel: nil)
      call_id ||= SecureRandom.uuid
      Files.need(CALL_ID.match?(call_id) && (intent_id.nil? || INTENT.match?(intent_id)), "RUBY_OPERATION_ID_REQUIRED")
      token = cancel || Cancellation.new
      invocation = Object.new
      @mutex.synchronize do
        raise Error, "RUBY_BUYER_CLOSING" if @closing
        @active[invocation] = token
      end
      begin
        @client.verify_package!
        scope = Files.directory(File.join(@calls,call_id),create: true)
        request = {"schema"=>"stellar-forge.ruby-buyer-call.v1","callId"=>call_id,"action"=>action,
          "id"=>intent_id,"runtime"=>@runtime,"arguments"=>arguments}
        raw = Files.json(Files.values!(request))
        Files.need(raw.bytesize <= MAX_INPUT, "RUBY_CALL_SIZE_LIMIT")
        Files.lock(scope) do
          Files.once(File.join(scope,"request.json"),raw)
          response = File.join(scope,"response.json")
          unless File.exist?(response)
            marker = File.join(scope,"dispatch.json")
            if File.exist?(marker)
              raise Error.new("RUBY_NATIVE_REPLY_UNAVAILABLE_USE_RECOVER",call_id: call_id,intent_id: intent_id)
            end
            dataset_call = action.start_with?("dataset.")
            Files.need(!dataset_call || @client.dataset_available?, "RUBY_DATASET_PACKAGE_REQUIRED")
            bridge = dataset_call ? "seller-dataset-bridge.mjs" : "seller-buyer-bridge.mjs"
            Files.once(marker,Files.json({"requestSha256"=>Files.hash(raw),"callId"=>call_id}))
            run = @runner.run(File.join(@client.directory,bridge),
              [File.join(scope,"request.json")],timeout: @timeout,limit: @output_limit,cancel: token,inherit_stdin: true)
            Files.once(File.join(scope,"process.json"),Files.json({"exitCode"=>run[:status].exitstatus,
              "signal"=>run[:status].termsig,"error"=>run[:error]}))
            unless File.exist?(response)
              raise Error.new(run[:error] || "RUBY_NATIVE_REPLY_UNAVAILABLE_USE_RECOVER",call_id: call_id,intent_id: intent_id)
            end
          end
          value = Files.parse(Files.read(response,MAX_INPUT))
          Files.need(value["schema"] == request["schema"] && value["callId"] == call_id &&
            value["action"] == action && value["id"] == intent_id, "RUBY_NATIVE_REPLY_CHANGED")
          unless value["ok"] == true
            code = value.dig("error","code")
            code = "RUBY_NATIVE_OPERATION_FAILED" unless code.is_a?(String) && /\A[A-Z][A-Z0-9_]{0,119}\z/.match?(code)
            raise Error.new(code,call_id: call_id,intent_id: intent_id)
          end
          value["result"]
        end
      ensure
        @mutex.synchronize { @active.delete(invocation); @condition.broadcast }
      end
    end
    def ready
      invoke("ready")
    end
    def close
      @mutex.synchronize do
        @closing = true
        @active.each_value(&:cancel)
        @condition.wait(@mutex) until @active.empty?
      end
      nil
    end
  end

  class Operation
    attr_reader :buyer, :intent_id, :source_sha256
    def initialize(buyer,intent_id,source_sha256)
      Files.need(INTENT.match?(intent_id) && HASH.match?(source_sha256), "RUBY_OPERATION_SELECTION_REQUIRED")
      @buyer,@intent_id,@source_sha256 = buyer,intent_id.dup.freeze,source_sha256.dup.freeze
    end
    def call(action, arguments = {}, **options)
      @buyer.invoke(action,@intent_id,{"sourceSha256"=>@source_sha256}.merge(arguments),**options)
    end
    def status(**options)
      call("inspect",{},**options)
    end
    def inspect
      "#<Starforge::Operation intent_id=#{@intent_id}>"
    end
    def review(**options)
      call("review",{},**options)
    end
    def execute(review:, **options)
      call("execute",{"review"=>review},**options)
    end
    def recover(**options)
      call("recover",{},**options)
    end
    def receive(directory, **options)
      result = call("receive",{"directory"=>File.expand_path(directory.to_s)},**options)
      Delivery.open(result.fetch("directory"),expected_manifest_sha256: result.fetch("manifestSha256"))
    end
  end

  # Receiving is complete before application code sees any data. Reopening uses
  # the original packet and response hashes and needs no Node process or network.
  class Delivery
    attr_reader :directory, :manifest_sha256
    def self.open(directory, expected_manifest_sha256:)
      new(directory,expected_manifest_sha256: expected_manifest_sha256)
    end
    def initialize(directory, expected_manifest_sha256:)
      @directory = Files.directory(directory)
      Files.need(HASH.match?(expected_manifest_sha256), "RUBY_DELIVERY_MANIFEST_REQUIRED")
      @manifest_sha256 = expected_manifest_sha256
      bytes = Files.read(File.join(@directory,"customer-delivery.json"),131_072)
      Files.need(Files.hash(bytes) == @manifest_sha256, "RUBY_DELIVERY_MANIFEST_CHANGED")
      @manifest = Files.parse(bytes)
      entries = @manifest["files"]
      names = entries.is_a?(Array) ? entries.map { |entry| entry["name"] } : []
      Files.need(@manifest["schema"] == "stellar-forge.ruby-customer-delivery.v1" &&
        INTENT.match?(@manifest["intentId"] || "") && HASH.match?(@manifest["sourceSha256"] || "") &&
        HASH.match?(@manifest["configSha256"] || "") && HASH.match?(@manifest["responseSha256"] || "") &&
        names.uniq == names && names.length.between?(5,6) &&
        %w[source.json request.json review.json result.json response.bin].all? { |name| names.include?(name) } &&
        (names - %w[source.json request.json request.body review.json result.json response.bin]).empty?,
        "RUBY_DELIVERY_MANIFEST_INVALID")
      entries.each do |entry|
        Files.need(entry["bytes"].is_a?(Integer) && entry["bytes"] >= 0 && entry["bytes"] <= 1_073_741_824 &&
          HASH.match?(entry["sha256"] || ""), "RUBY_DELIVERY_FILE_INVALID")
        with_snapshot(entry.fetch("name")) { |_file| }
      end
      Files.need(descriptor("response.bin")["sha256"] == @manifest["responseSha256"], "RUBY_DELIVERY_RESPONSE_CHANGED")
      source = json_file("source.json")
      request = json_file("request.json")
      review = json_file("review.json")
      native = json_file("result.json")
      Files.need(source["sourceSha256"] == @manifest["sourceSha256"] && source["request"] == request &&
        request["intentId"] == @manifest["intentId"] && source["configSha256"] == @manifest["configSha256"] &&
        review["intentId"] == @manifest["intentId"] && review["configSha256"] == @manifest["configSha256"] &&
        native["intentId"] == @manifest["intentId"] && native["configSha256"] == @manifest["configSha256"],
        "RUBY_DELIVERY_SOURCE_CHANGED")
    end
    def manifest
      Files.parse(Files.json(@manifest))
    end
    def descriptor(name)
      entry = @manifest.fetch("files").find { |item| item["name"] == name }
      Files.need(entry, "RUBY_DELIVERY_FILE_UNKNOWN")
      entry.dup
    end
    def with_snapshot(name)
      entry = descriptor(name)
      source = File.open(File.join(@directory,name),File::RDONLY | File::NOFOLLOW | File::NONBLOCK)
      tmp = Tempfile.new([".starforge-receive-",".bin"])
      begin
        tmp.binmode
        tmp.unlink
        before = source.stat
        Files.need(before.file? && before.size == entry["bytes"], "RUBY_DELIVERY_FILE_CHANGED")
        digest, count = Digest::SHA256.new, 0
        while (chunk = source.read(1_048_576))
          count += chunk.bytesize
          Files.need(count <= entry["bytes"], "RUBY_DELIVERY_FILE_CHANGED")
          digest.update(chunk)
          tmp.write(chunk)
        end
        after = source.stat
        Files.need(count == entry["bytes"] && digest.hexdigest == entry["sha256"] &&
          [before.dev,before.ino,before.size,before.mtime,before.ctime] ==
          [after.dev,after.ino,after.size,after.mtime,after.ctime], "RUBY_DELIVERY_FILE_CHANGED")
        tmp.flush
        tmp.rewind
        yield tmp
      ensure
        source.close
        tmp.close!
      end
    end
    def bytes(limit: 8_388_608)
      Files.need(descriptor("response.bin")["bytes"] <= limit, "RUBY_RESPONSE_LIMIT_USE_STREAM")
      with_snapshot("response.bin", &:read)
    end
    def each_chunk(chunk_size: 65_536)
      return enum_for(__method__,chunk_size: chunk_size) unless block_given?
      Files.need(chunk_size.is_a?(Integer) && chunk_size.between?(1,1_048_576), "RUBY_CHUNK_SIZE_INVALID")
      with_snapshot("response.bin") do |file|
        while (chunk = file.read(chunk_size))
          yield chunk
        end
      end
    end
    def json(limit: 67_108_864)
      Files.parse(bytes(limit: limit),decimals: true)
    end
    def json_file(name, limit: MAX_INPUT)
      Files.need(descriptor(name)["bytes"] <= limit, "RUBY_JSON_FILE_LIMIT")
      with_snapshot(name) { |file| Files.parse(file.read,decimals: true) }
    end
    def each_csv(headers: true)
      return enum_for(__method__,headers: headers) unless block_given?
      with_snapshot("response.bin") do |file|
        file.set_encoding(Encoding::UTF_8)
        CSV.new(file,headers: headers).each { |row| yield row }
      end
    end
  end
end
