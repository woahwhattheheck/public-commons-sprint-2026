#!/usr/bin/env ruby
# frozen_string_literal: true
# MIT. Native Ruby/Bundler worker; each attempt owns its installation directory.
require "json"
require "digest"
require "fileutils"
require "pathname"
require "securerandom"
require "time"
require "rbconfig"
require "rubygems"
require "rubygems/package"
require "stringio"

module StarforgeRubyRuntime
  MAX_BYTES = 4 * 1024 * 1024 * 1024
  MAX_FILES = 100_000
  HASH = /\A[a-f0-9]{64}\z/
  class Error < StandardError
    attr_reader :code
    def initialize(code,message = code)
      @code = code
      super(message)
    end
  end
  class Cancelled < Error
    def initialize
      super("RUBY_OPERATION_CANCELLED","The selected operation was stopped; its exact source and lock remain available.")
    end
  end
  module_function
  def need(value,code,message = code)
    raise Error.new(code,message) unless value
  end
  def canonical(value)
    case value
    when Hash then value.keys.sort_by { |key| key.encode(Encoding::UTF_16BE).bytes }.to_h { |key| [key,canonical(value.fetch(key))] }
    when Array then value.map { |item| canonical(item) }
    else value
    end
  end
  def encode(value)
    JSON.pretty_generate(value) + "\n"
  end
  def identity(value)
    Digest::SHA256.hexdigest(JSON.generate(canonical(value)))
  end
  def stamp
    Time.now.utc.iso8601(6)
  end
  def private_directory(path,create: false)
    need(path.is_a?(String) && path == File.expand_path(path) && !path.include?("\0"),"RUBY_ABSOLUTE_PATH_REQUIRED")
    if create && !File.exist?(path) && !File.symlink?(path)
      parent = File.dirname(path)
      need(File.realpath(parent) == parent,"RUBY_REAL_PARENT_REQUIRED")
      Dir.mkdir(path,0700)
    end
    stat = File.lstat(path)
    need(stat.directory? && !stat.symlink? && File.realpath(path) == path &&
      stat.uid == Process.uid && (stat.mode & 0077).zero?,"RUBY_PRIVATE_DIRECTORY_REQUIRED")
    sync_parent(path) if create
    path
  end
  def member(name)
    need(name.is_a?(String) && name.valid_encoding? && !name.empty? && name.bytesize <= 4096 &&
      !name.start_with?("/") && !name.include?("\\") && !name.include?("\0") &&
      name.split("/",-1).all? { |part| !part.empty? && part != "." && part != ".." },"RUBY_MEMBER_INVALID")
    name
  end
  def directories(root,path)
    relative = Pathname.new(path).relative_path_from(Pathname.new(root)).to_s
    need(relative == "." || !relative.start_with?("../") && relative != "..","RUBY_OUTPUT_OUTSIDE")
    private_directory(root)
    at = root
    relative.split("/").each do |part|
      next if part == "."
      at = private_directory(File.join(at,part),create: true)
    end
    at
  end
  def read(path,maximum = 67_108_864)
    File.open(path,File::RDONLY | File::NOFOLLOW) do |file|
      first = file.stat
      need(first.file? && first.size <= maximum,"RUBY_FILE_INVALID")
      value = file.read(maximum + 1)
      need(value.bytesize == first.size && value.bytesize <= maximum && same_stat?(first,file.stat),"RUBY_FILE_CHANGED")
      value
    end
  end
  def parse(path)
    JSON.parse(read(path))
  end
  def optional(path)
    parse(path)
  rescue Errno::ENOENT
    nil
  end
  def same_stat?(a,b)
    [a.dev,a.ino,a.size,a.mtime,a.ctime] == [b.dev,b.ino,b.size,b.mtime,b.ctime]
  end
  def sync_parent(path)
    File.open(File.dirname(path),File::RDONLY) { |file| file.fsync }
  end
  def write(path,bytes,replace: false)
    bytes = bytes.b
    if !replace && File.exist?(path)
      need(read(path,[bytes.bytesize,1].max) == bytes,"RUBY_RETAINED_FILE_CHANGED")
      return
    end
    temporary = path + ".pending-" + SecureRandom.uuid
    File.open(temporary,File::WRONLY | File::CREAT | File::EXCL,0600) do |file|
      file.write(bytes)
      file.flush
      file.fsync
    end
    if replace
      File.rename(temporary,path)
    else
      begin
        File.link(temporary,path)
      rescue Errno::EEXIST
        need(read(path,[bytes.bytesize,1].max) == bytes,"RUBY_RETAINED_FILE_CHANGED")
      end
      File.unlink(temporary)
    end
    sync_parent(path)
  ensure
    File.unlink(temporary) if temporary && File.exist?(temporary)
  end
  def save(path,value,replace: false)
    write(path,encode(value),replace: replace)
  end
  def file_descriptor(path,private_only: true)
    File.open(path,File::RDONLY | File::NOFOLLOW) do |file|
      first = file.stat
      need(first.file? && first.size.between?(0,MAX_BYTES),"RUBY_FILE_INVALID")
      need(first.uid == Process.uid && (first.mode & 0077).zero?,"RUBY_PRIVATE_FILE_REQUIRED") if private_only
      h,count = Digest::SHA256.new,0
      while (bytes = file.read(1_048_576))
        h.update(bytes)
        count += bytes.bytesize
      end
      need(first.size == count && same_stat?(first,file.stat),"RUBY_FILE_CHANGED")
      {"bytes"=>count,"sha256"=>h.hexdigest}
    end
  end
  def inventory(root,private_only: true,exclude: [])
    private_directory(root) if private_only
    need(File.realpath(root) == root && File.directory?(root),"RUBY_SOURCE_DIRECTORY_INVALID")
    files,total = [],0
    walk = lambda do |path,prefix|
      Dir.children(path).sort_by { |name| name.encode(Encoding::UTF_16BE).bytes }.each do |name|
        relative = prefix.empty? ? name : prefix + "/" + name
        next if exclude.any? { |ignored| relative == ignored || relative.start_with?(ignored + "/") }
        member(relative)
        target = File.join(root,relative)
        stat = File.lstat(target)
        need(!stat.symlink?,"RUBY_SOURCE_LINK")
        if stat.directory?
          private_directory(target) if private_only
          walk.call(target,relative)
        else
          need(stat.file? && files.length < MAX_FILES,"RUBY_SOURCE_FILE_INVALID")
          descriptor = file_descriptor(target,private_only: private_only)
          total += descriptor.fetch("bytes")
          need(total <= MAX_BYTES,"RUBY_SOURCE_TOO_LARGE")
          files << {"name"=>relative}.merge(descriptor).merge("executable"=>(stat.mode & 0111).positive?)
        end
      end
    end
    walk.call(root,"")
    files
  end
  def copy_file(source,target,expected = nil)
    if File.exist?(target)
      actual = file_descriptor(target)
      need(expected.nil? || actual == expected.slice("bytes","sha256"),"RUBY_RETAINED_FILE_CHANGED")
      need(file_descriptor(source,private_only: false) == actual,"RUBY_SOURCE_CHANGED")
      File.chmod(expected && expected["executable"] ? 0700 : 0600,target)
      return actual
    end
    temporary = target + ".pending-" + SecureRandom.uuid
    descriptor = nil
    File.open(source,File::RDONLY | File::NOFOLLOW) do |input|
      before = input.stat
      need(before.file? && before.size <= MAX_BYTES,"RUBY_FILE_INVALID")
      h,count = Digest::SHA256.new,0
      File.open(temporary,File::WRONLY | File::CREAT | File::EXCL,0600) do |output|
        while (bytes = input.read(1_048_576))
          h.update(bytes)
          count += bytes.bytesize
          need(count <= MAX_BYTES,"RUBY_FILE_TOO_LARGE")
          offset = 0
          while offset < bytes.bytesize
            amount = output.write(bytes.byteslice(offset,bytes.bytesize-offset))
            need(amount.is_a?(Integer) && amount.positive?,"RUBY_WRITE_FAILED")
            offset += amount
          end
        end
        need(count == before.size && same_stat?(before,input.stat),"RUBY_FILE_CHANGED")
        descriptor = {"bytes"=>count,"sha256"=>h.hexdigest}
        need(expected.nil? || expected.slice("bytes","sha256") == descriptor,"RUBY_FILE_CHANGED")
        output.flush
        output.fsync
      end
    end
    begin
      File.link(temporary,target)
    rescue Errno::EEXIST
      need(file_descriptor(target) == descriptor,"RUBY_RETAINED_FILE_CHANGED")
    end
    File.chmod(expected && expected["executable"] ? 0700 : 0600,target)
    sync_parent(target)
    descriptor
  ensure
    File.unlink(temporary) if temporary && File.exist?(temporary)
  end
  def copy_tree(source,target,files: nil,exclude: [],private_only: true)
    selected = files || inventory(source,private_only: private_only,exclude: exclude)
    private_directory(target,create: true)
    selected.each do |entry|
      name = member(entry.fetch("name"))
      path = File.join(target,name)
      directories(target,File.dirname(path))
      # Only unfinished copies of this same selected member are disposable.
      prefix = File.basename(path) + ".pending-"
      Dir.children(File.dirname(path)).each do |candidate|
        next unless candidate.start_with?(prefix) && /\.pending-[a-f0-9-]{36}\z/.match?(candidate)
        item = File.join(File.dirname(path),candidate)
        stat = File.lstat(item)
        need(stat.file? && !stat.symlink? && stat.uid == Process.uid && (stat.mode & 0077).zero?,"RUBY_PENDING_FILE_INVALID")
        File.unlink(item)
      end
      copy_file(File.join(source,name),path,entry)
    end
    need(inventory(source,private_only: private_only,exclude: exclude) == selected,"RUBY_SOURCE_CHANGED")
    need(inventory(target) == selected,"RUBY_COPY_CHANGED")
    selected
  end
  def probe
    {"schema"=>"stellar-forge.ruby-probe.v1","ruby_version"=>RUBY_VERSION,
      "ruby_engine"=>defined?(RUBY_ENGINE) ? RUBY_ENGINE : "ruby",
      "ruby_description"=>RUBY_DESCRIPTION,"ruby_platform"=>RUBY_PLATFORM,
      "ruby_api"=>RbConfig::CONFIG.fetch("ruby_version"),"ruby_executable"=>RbConfig.ruby,
      "gem_platform"=>Gem::Platform.local.to_s,"arch"=>RbConfig::CONFIG.fetch("arch"),
      "rubygems_version"=>Gem::VERSION,
      "bundlers"=>Gem::Specification.find_all_by_name("bundler").sort_by(&:version).reverse.map { |spec|
        {"version"=>spec.version.to_s,"default"=>spec.default_gem?,"path"=>spec.full_gem_path}
      }}
  end
  def runtime_identity(probe)
    probe.slice("ruby_version","ruby_engine","ruby_platform","ruby_api")
  end
  def portable_identity(probe)
    probe.slice("ruby_engine","ruby_platform","ruby_api","gem_platform","arch")
  end

  # The archive has a manifest-first ordinary ustar layout and only complete
  # regular members. Receiving verifies every byte before exposing a payload.
  def write_archive(path,metadata,payload,files)
    names = files.map { |item| member(item.fetch("name")) }
    need(names.uniq == names && files.length <= MAX_FILES,"RUBY_ARCHIVE_MEMBERS_INVALID")
    manifest = metadata.merge("schema"=>"stellar-forge.ruby-runtime-archive.v1","files"=>files)
    bytes = encode(manifest)
    need(bytes.bytesize <= 67_108_864,"RUBY_ARCHIVE_MANIFEST_TOO_LARGE")
    temporary = path + ".pending-" + SecureRandom.uuid
    File.open(temporary,File::RDWR | File::CREAT | File::EXCL,0600) do |file|
      Gem::Package::TarWriter.new(file) do |tar|
        tar.add_file_simple("manifest.json",0600,bytes.bytesize) { |out| out.write(bytes) }
        files.each do |entry|
          name = entry.fetch("name")
          need(name.bytesize <= 255,"RUBY_ARCHIVE_PATH_TOO_LONG",
            "The portable Ruby archive accepts ustar paths up to 255 UTF-8 bytes: " + name)
          File.open(File.join(payload,name),File::RDONLY | File::NOFOLLOW) do |input|
            first = input.stat
            need(first.file? && first.size == entry.fetch("bytes"),"RUBY_ARCHIVE_SOURCE_CHANGED")
            count,h = 0,Digest::SHA256.new
            tar.add_file_simple(name,entry["executable"] ? 0700 : 0600,entry.fetch("bytes")) do |out|
              while (chunk = input.read(1_048_576))
                h.update(chunk)
                count += chunk.bytesize
                need(count <= entry.fetch("bytes"),"RUBY_ARCHIVE_SOURCE_CHANGED")
                out.write(chunk)
              end
            end
            need(count == entry.fetch("bytes") && h.hexdigest == entry.fetch("sha256") && same_stat?(first,input.stat),
              "RUBY_ARCHIVE_SOURCE_CHANGED")
          end
          need(file.pos <= MAX_BYTES,"RUBY_ARCHIVE_TOO_LARGE")
        end
      end
      file.flush
      file.fsync
    end
    descriptor = file_descriptor(temporary)
    if File.exist?(path)
      # Completed callers reuse the original archive, including its tar headers.
      need(file_descriptor(path) == descriptor,"RUBY_ARCHIVE_ALREADY_RETAINED")
    else
      File.link(temporary,path)
      sync_parent(path)
    end
    {"archive"=>descriptor,"manifestSha256"=>Digest::SHA256.hexdigest(bytes),"manifest"=>manifest}
  ensure
    File.unlink(temporary) if temporary && File.exist?(temporary)
  end
  def exact_read(io,size)
    bytes = "".b
    while bytes.bytesize < size
      part = io.read([size-bytes.bytesize,1_048_576].min)
      need(part && !part.empty?,"RUBY_ARCHIVE_TRUNCATED")
      bytes << part
    end
    bytes
  end
  def tar_header(raw)
    need(raw.bytesize == 512,"RUBY_ARCHIVE_TRUNCATED")
    return nil if raw == "\0".b * 512
    checksum_text = raw.byteslice(148,8).delete("\0 ")
    need(/\A[0-7]+\z/.match?(checksum_text),"RUBY_ARCHIVE_HEADER_INVALID")
    sum = raw.bytes.each_with_index.sum { |byte,index| index.between?(148,155) ? 32 : byte }
    need(sum == checksum_text.to_i(8),"RUBY_ARCHIVE_HEADER_CHANGED")
    size_text = raw.byteslice(124,12).delete("\0 ")
    need(/\A[0-7]+\z/.match?(size_text),"RUBY_ARCHIVE_SIZE_INVALID")
    name = raw.byteslice(0,100).split("\0",2).first
    prefix = raw.byteslice(345,155).split("\0",2).first
    name = prefix + "/" + name unless prefix.empty?
    name = name.force_encoding(Encoding::UTF_8)
    member(name)
    need(raw.byteslice(156,1) == "0" && raw.byteslice(157,100).delete("\0").empty?,
      "RUBY_ARCHIVE_REGULAR_MEMBERS_REQUIRED")
    need(raw.byteslice(257,6).start_with?("ustar"),"RUBY_ARCHIVE_FORMAT_INVALID")
    size = size_text.to_i(8)
    need(size <= MAX_BYTES,"RUBY_ARCHIVE_TOO_LARGE")
    {"name"=>name,"bytes"=>size}
  end
  def receive_archive(path,expected_sha256,target)
    selected = file_descriptor(path)
    need(selected.fetch("sha256") == expected_sha256,"RUBY_ARCHIVE_CHANGED")
    private_directory(target,create: true)
    manifest = nil
    File.open(path,File::RDONLY | File::NOFOLLOW) do |file|
      first = file.stat
      header = tar_header(exact_read(file,512))
      need(header && header["name"] == "manifest.json" && header["bytes"] <= 67_108_864,"RUBY_ARCHIVE_MANIFEST_REQUIRED")
      raw = exact_read(file,header.fetch("bytes"))
      pad = (512-header.fetch("bytes")%512)%512
      need(exact_read(file,pad).bytes.all?(&:zero?),"RUBY_ARCHIVE_PADDING_INVALID") if pad.positive?
      manifest = JSON.parse(raw)
      if File.exist?(File.join(target,"manifest.json"))
        need(parse(File.join(target,"manifest.json")) == manifest &&
          inventory(target,exclude: ["manifest.json"]) == manifest.fetch("files"),"RUBY_RECEIVING_CHANGED")
        return manifest
      end
      need(manifest.is_a?(Hash) && manifest["schema"] == "stellar-forge.ruby-runtime-archive.v1" &&
        manifest["files"].is_a?(Array) && manifest["files"].length <= MAX_FILES,"RUBY_ARCHIVE_MANIFEST_INVALID")
      expected = {}
      total = 0
      manifest["files"].each do |entry|
        need(entry.is_a?(Hash) && entry["bytes"].is_a?(Integer) && entry["bytes"].between?(0,MAX_BYTES) &&
          HASH.match?(entry["sha256"].to_s),"RUBY_ARCHIVE_DESCRIPTOR_INVALID")
        name = member(entry.fetch("name"))
        need(name != "manifest.json" && !expected.key?(name),"RUBY_ARCHIVE_MEMBER_DUPLICATE")
        total += entry.fetch("bytes")
        need(total <= MAX_BYTES,"RUBY_ARCHIVE_TOO_LARGE")
        expected[name] = entry
      end
      remaining = expected.dup
      loop do
        header = tar_header(exact_read(file,512))
        unless header
          need(remaining.empty?,"RUBY_ARCHIVE_MEMBER_MISSING")
          # All bytes after the first terminator must be whole zero blocks.
          tail = 0
          while (bytes = file.read(1_048_576))
            tail += bytes.bytesize
            need(bytes.bytes.all?(&:zero?),"RUBY_ARCHIVE_TRAILING_DATA")
          end
          need(tail >= 512 && tail % 512 == 0,"RUBY_ARCHIVE_TERMINATOR_INVALID")
          break
        end
        entry = remaining.delete(header.fetch("name"))
        need(entry && entry.fetch("bytes") == header.fetch("bytes"),"RUBY_ARCHIVE_MEMBER_CHANGED")
        need(entry["executable"] == true || entry["executable"] == false,"RUBY_ARCHIVE_MODE_INVALID")
        destination = File.join(target,member(entry.fetch("name")))
        directories(target,File.dirname(destination))
        prefix = File.basename(destination) + ".pending-"
        Dir.children(File.dirname(destination)).each do |candidate|
          next unless candidate.start_with?(prefix) && /\.pending-[a-f0-9-]{36}\z/.match?(candidate)
          pending = File.join(File.dirname(destination),candidate)
          stat = File.lstat(pending)
          need(stat.file? && !stat.symlink? && stat.uid == Process.uid && (stat.mode & 0077).zero?,"RUBY_PENDING_FILE_INVALID")
          File.unlink(pending)
        end
        temporary = destination + ".pending-" + SecureRandom.uuid
        h,count = Digest::SHA256.new,0
        begin
          File.open(temporary,File::WRONLY | File::CREAT | File::EXCL,0600) do |output|
            while count < entry.fetch("bytes")
              bytes = exact_read(file,[1_048_576,entry.fetch("bytes")-count].min)
              count += bytes.bytesize
              h.update(bytes)
              output.write(bytes)
            end
            need(h.hexdigest == entry.fetch("sha256"),"RUBY_ARCHIVE_MEMBER_CHANGED")
            output.flush
            output.fsync
          end
          if File.exist?(destination)
            need(file_descriptor(destination) == entry.slice("bytes","sha256"),"RUBY_RECEIVING_MEMBER_CHANGED")
          else
            File.link(temporary,destination)
          end
          File.chmod(entry["executable"] ? 0700 : 0600,destination)
          sync_parent(destination)
        ensure
          File.unlink(temporary) if File.exist?(temporary)
        end
        padding = (512-count%512)%512
        need(exact_read(file,padding).bytes.all?(&:zero?),"RUBY_ARCHIVE_PADDING_INVALID") if padding.positive?
      end
      need(same_stat?(first,file.stat),"RUBY_ARCHIVE_CHANGED")
      # The complete original source is checked again after streaming extraction.
      need(file_descriptor(path) == selected,"RUBY_ARCHIVE_CHANGED")
      need(inventory(target) == manifest.fetch("files"),"RUBY_ARCHIVE_COMPLETE_FILES_REQUIRED")
      save(File.join(target,"manifest.json"),manifest)
      manifest
    end
  end
end


module StarforgeRubyRuntime
  class Engine
    include StarforgeRubyRuntime
    def initialize(root:,operation_id:,attempt:,lease_fd:)
      @root = private_directory(root)
      need(/\A[a-f0-9-]{36}\z/.match?(operation_id) && attempt.positive?,"RUBY_OPERATION_INVALID")
      @operation_id,@attempt = operation_id,attempt
      @operation = private_directory(File.join(@root,"operations",operation_id))
      @attempt_root = private_directory(File.join(@operation,"attempts",attempt.to_s))
      @request = parse(File.join(@operation,"request.json"))
      need(@request["id"] == operation_id && identity(@request.reject { |key,_| key == "sha256" }) == @request["sha256"],
        "RUBY_OPERATION_CHANGED")
      @environment = private_directory(File.join(@root,"environments",@request.fetch("environmentId")))
      @selection = parse(File.join(@environment,"selection.json"))
      need(identity(@selection.reject { |key,_| key == "sha256" }) == @selection["sha256"] &&
        @selection["sha256"] == @request["selectionSha256"],"RUBY_ENVIRONMENT_CHANGED")
      @lease = IO.for_fd(lease_fd)
      @lease.autoclose = false
      expected = File.stat(File.join(@operation,"worker.lock"))
      actual = @lease.stat
      need(actual.file? && actual.dev == expected.dev && actual.ino == expected.ino,"RUBY_ORIGINAL_LEASE_REQUIRED")
      @lease.close_on_exec = false
      @cancelled,@signal_sent = false,false
      Signal.trap("TERM") { @cancelled = true }
      Signal.trap("INT") { @cancelled = true }
      need(runtime_identity(probe) == runtime_identity(@selection.fetch("ruby")),"RUBY_INTERPRETER_CHANGED")
      @ruby = @selection.fetch("ruby").fetch("executable")
    end
    def cancelled?
      stop = optional(File.join(@operation,"stop.json"))
      @cancelled ||= stop && stop["attempt"] == @attempt
      @cancelled
    end
    def check_cancel
      raise Cancelled if cancelled?
    end
    def progress(stage,details = {})
      check_cancel
      value = {"schema"=>"stellar-forge.ruby-operation-progress.v1","operationId"=>@operation_id,
        "attempt"=>@attempt,"stage"=>stage,"updatedAt"=>stamp}.merge(details)
      save(File.join(@attempt_root,"progress.json"),value,replace: true)
      $stdout.puts(JSON.generate(value))
      $stdout.flush
    end
    def command(args,environment: {},directory: @environment,stage:,result_file: nil)
      progress(stage)
      check_cancel
      output = result_file ? File.open(result_file,File::WRONLY | File::CREAT | File::EXCL,0600) : $stdout
      pid = Process.spawn(environment,*args,chdir: directory,in: File::NULL,out: output,err: $stderr,
        close_others: true,3=>@lease)
      began_stop = nil
      loop do
        waited = Process.waitpid2(pid,Process::WNOHANG)
        if waited
          status = waited.last
          output.flush
          output.fsync if result_file
          raise Cancelled if cancelled?
          need(status.success?,"RUBY_COMMAND_FAILED","The native " + stage + " command failed; inspect this operation's complete original log.")
          return status.exitstatus
        end
        if cancelled?
          began_stop ||= Process.clock_gettime(Process::CLOCK_MONOTONIC)
          unless @signal_sent
            @signal_sent = true
            begin
              # The engine and all compiler/server descendants share this new
              # process group; the inherited lease lives until they drain.
              Process.kill("TERM",-Process.getpgrp)
            rescue Errno::ESRCH
            end
          end
          if Process.clock_gettime(Process::CLOCK_MONOTONIC)-began_stop > 8
            Process.kill("KILL",-Process.getpgrp)
          end
        end
        sleep 0.2
      end
    ensure
      output.close if result_file && output && !output.closed?
    end
    def definition
      if @selection.fetch("kind") == "received"
        parse(File.join(@environment,"received.json")).fetch("definition")
      else
        @selection.slice("profile","gemfile","bundlerVersion","project","client").merge(
          "originalSelectionSha256"=>@selection.fetch("sha256"))
      end
    end
    def bundle_environment(build,version,project,cache)
      bootstrap = File.join(build,"bootstrap")
      {
        "GEM_HOME"=>bootstrap,"GEM_PATH"=>bootstrap,"RUBYOPT"=>nil,"RUBYLIB"=>nil,
        "BUNDLE_APP_CONFIG"=>File.join(build,"config"),"BUNDLE_USER_HOME"=>File.join(build,"user"),
        "BUNDLE_USER_CONFIG"=>File.join(build,"user","config"),"BUNDLE_USER_CACHE"=>File.join(build,"user","cache"),
        "BUNDLE_USER_PLUGIN"=>File.join(build,"user","plugin"),"BUNDLE_GEMFILE"=>File.join(project,definition.fetch("gemfile")),
        "BUNDLE_PATH"=>File.join(build,"bundle"),"BUNDLE_DISABLE_SHARED_GEMS"=>"true",
        "BUNDLE_DISABLE_EXEC_LOAD"=>"true","BUNDLE_FROZEN"=>"true","BUNDLE_DEPLOYMENT"=>"false",
        "BUNDLE_AUTO_INSTALL"=>"false","BUNDLE_PLUGINS"=>"false","BUNDLE_VERSION"=>version,
        "BUNDLE_WITH"=>"","BUNDLE_WITHOUT"=>"","BUNDLE_CACHE_ALL"=>"true",
        "BUNDLE_CACHE_ALL_PLATFORMS"=>"false","BUNDLE_CACHE_PATH"=>cache,"BUNDLE_JOBS"=>"2",
        "BUNDLE_RETRY"=>"2","BUNDLE_IGNORE_CONFIG"=>nil,"BUNDLE_DISABLE_CHECKSUM_VALIDATION"=>"false"
      }
    end
    def bundle_args(version,*rest)
      [@ruby,"-rrubygems","-e",'version=ARGV.shift; load Gem.bin_path("bundler","bundle",version)',version,*rest]
    end
    def gem_args(*rest)
      [@ruby,"-rrubygems/gem_runner","-e","Gem::GemRunner.new.run(ARGV)","--",*rest]
    end
    def new_build
      builds = private_directory(File.join(@environment,"builds"),create: true)
      build = private_directory(File.join(builds,@operation_id + "-" + @attempt.to_s),create: true)
      %w[bootstrap config user cache].each { |name| private_directory(File.join(build,name),create: true) }
      build
    end
    def bootstrap(build,version,offline:)
      cached = private_directory(File.join(@environment,"bootstrap-cache"),create: true)
      name = "bundler-" + version + ".gem"
      retained = optional(File.join(cached,"manifest.json"))
      local = retained && File.join(cached,name)
      if retained
        need(retained["version"] == version && retained["file"]["name"] == name &&
          file_descriptor(local) == retained.fetch("file").slice("bytes","sha256"),"RUBY_BUNDLER_ARCHIVE_CHANGED")
      end
      need(!offline || local,"RUBY_OFFLINE_BUNDLER_MISSING","The selected offline runtime must include its original Bundler gem.")
      environment = {"GEM_HOME"=>File.join(build,"bootstrap"),"GEM_PATH"=>File.join(build,"bootstrap"),
        "RUBYOPT"=>nil,"RUBYLIB"=>nil}
      arguments = local ? ["install",local,"--local"] : ["install","bundler","--version",version]
      command(gem_args(*arguments,"--install-dir",File.join(build,"bootstrap"),"--no-document","--no-user-install"),
        environment: environment,stage: "BUNDLER_INSTALL")
      selected = File.join(build,"bootstrap","cache",name)
      descriptor = file_descriptor(selected,private_only: false)
      copy_file(selected,File.join(cached,name),descriptor)
      save(File.join(cached,"manifest.json"),{"version"=>version,"file"=>{"name"=>name}.merge(descriptor)})
      {"version"=>version,"file"=>{"name"=>name}.merge(descriptor)}
    end
    def locked_file
      File.join(@environment,"lock",definition.fetch("gemfile").tr("/","_") + ".lock")
    end
    def prepare_project(build)
      meta = definition
      source = File.join(@environment,"project")
      files = inventory(source)
      need(files == meta.fetch("project").fetch("files"),"RUBY_PROJECT_SOURCE_CHANGED")
      client = inventory(File.join(@environment,"client"))
      need(client == meta.fetch("client").fetch("files"),"RUBY_CLIENT_SOURCE_CHANGED")
      project = File.join(build,"project")
      copy_tree(source,project,files: files)
      project
    end
    def resolve_lock(build,version,project,environment,offline:)
      target = File.join(project,definition.fetch("gemfile") + ".lock")
      retained = optional(File.join(@environment,"lock.json"))
      if retained
        need(file_descriptor(locked_file) == retained.slice("bytes","sha256"),"RUBY_LOCK_CHANGED")
        directories(project,File.dirname(target))
        if File.exist?(target)
          need(file_descriptor(target) == retained.slice("bytes","sha256"),"RUBY_ORIGINAL_LOCK_CHANGED")
        else
          copy_file(locked_file,target,retained)
        end
        return retained
      end
      if File.exist?(target)
        progress("RETAIN_ORIGINAL_LOCK")
      else
        need(!offline,"RUBY_OFFLINE_LOCK_REQUIRED")
        command(bundle_args(version,"lock"),environment: environment.merge("BUNDLE_FROZEN"=>"false"),
          directory: project,stage: "RESOLVE_LOCK")
      end
      descriptor = file_descriptor(target)
      need(descriptor.fetch("bytes").positive?,"RUBY_LOCK_EMPTY")
      # Every later stage installs this retained lock. An interrupted install
      # never repeats online resolution or substitutes a newly resolved edition.
      private_directory(File.join(@environment,"lock"),create: true)
      copy_file(target,locked_file,descriptor)
      receipt = descriptor.merge("gemfile"=>definition.fetch("gemfile"),
        "bundlerVersion"=>version,"resolvedRuby"=>portable_identity(probe))
      save(File.join(@environment,"lock.json"),receipt)
      receipt
    end
    def lock_sources(build,version,project,environment)
      output = File.join(build,"lock-sources.json")
      script = <<~'RUBY'
        require "json"
        require "bundler"
        root = File.realpath(Dir.pwd)
        locked = Bundler::LockfileParser.new(Bundler.read_file(Bundler.default_lockfile))
        sources = locked.sources.map do |source|
          kind = source.class.name
          if source.is_a?(Bundler::Source::Path) && !source.is_a?(Bundler::Source::Git)
            selected = File.expand_path(source.path.to_s,root)
            raise "Managed local gem source leaves the retained project: #{selected}" unless selected == root || selected.start_with?(root + File::SEPARATOR)
          end
          {"type"=>kind}
        end
        puts JSON.generate({"sources"=>sources,"platforms"=>locked.platforms.map(&:to_s),
          "bundler_version"=>locked.bundler_version&.to_s})
      RUBY
      command([@ruby,"-rrubygems","-e",'version=ARGV.shift; gem "bundler", version; ' + script,version],
        environment: environment,directory: project,stage: "LOCK_SOURCE_REVIEW",result_file: output)
      parse(output)
    end
    def make_tree_private(root)
      Dir.children(root).each do |name|
        path = File.join(root,name)
        stat = File.lstat(path)
        need(!stat.symlink?,"RUBY_CACHE_LINK")
        if stat.directory?
          File.chmod(0700,path)
          make_tree_private(path)
        else
          need(stat.file?,"RUBY_CACHE_FILE_INVALID")
          File.chmod((stat.mode & 0111).positive? ? 0700 : 0600,path)
        end
      end
    end
    def dependency_probe(build,version,project,environment)
      output = File.join(build,"dependency-probe-" + SecureRandom.hex(8) + ".json")
      script = <<~'RUBY'
        require "json"
        require "rails"
        require "active_record"
        require "active_job"
        require "action_controller/railtie"
        require "sqlite3"
        require "rack"
        require "rackup"
        require "puma"
        require "nokogiri"
        require "bigdecimal"
        database = SQLite3::Database.new(":memory:")
        database.execute("CREATE TABLE runtime_probe (value INTEGER NOT NULL)")
        database.execute("INSERT INTO runtime_probe VALUES (?)",[20261012])
        raise "SQLite result mismatch" unless database.get_first_value("SELECT value FROM runtime_probe") == 20261012
        database.close
        puts JSON.generate({"schema"=>"stellar-forge.ruby-dependency-probe.v1",
          "ruby_version"=>RUBY_VERSION,"ruby_platform"=>RUBY_PLATFORM,
          "sqlite_version"=>SQLite3::SQLITE_VERSION,
          "gems"=>Gem.loaded_specs.values.sort_by(&:name).map { |spec|
            {"name"=>spec.name,"version"=>spec.version.to_s,"platform"=>spec.platform.to_s}
          }})
      RUBY
      command(bundle_args(version,"exec",@ruby,"-e",script),environment: environment,directory: project,
        stage: "RAILS_SQLITE_PROBE",result_file: output)
      parse(output)
    end
    def installation
      saved = parse(File.join(@environment,"installation.json"))
      need(saved["schema"] == "stellar-forge.ruby-installation.v1" &&
        saved["selectionSha256"] == @selection.fetch("sha256"),"RUBY_INSTALLATION_CHANGED")
      build = private_directory(File.join(@environment,member(saved.fetch("build"))))
      project = private_directory(File.join(build,"project"))
      version = saved.fetch("bundlerVersion")
      environment = bundle_environment(build,version,project,File.join(build,"cache"))
      need(file_descriptor(locked_file) == saved.fetch("lock").slice("bytes","sha256"),"RUBY_LOCK_CHANGED")
      need(file_descriptor(File.join(project,definition.fetch("gemfile") + ".lock")) ==
        saved.fetch("lock").slice("bytes","sha256"),"RUBY_INSTALLED_LOCK_CHANGED")
      [saved,build,project,environment]
    end
    def install(offline: false)
      if File.exist?(File.join(@environment,"installation.json"))
        saved = verify
        return saved.merge("reused"=>true)
      end
      check_cancel
      meta = definition
      version = meta.fetch("bundlerVersion")
      need(/\A[0-9]+\.[0-9]+\.[0-9]+(?:[.-][0-9A-Za-z.-]+)?\z/.match?(version),"RUBY_BUNDLER_VERSION_REQUIRED")
      build = new_build
      bundler = bootstrap(build,version,offline: offline)
      project = prepare_project(build)
      cache = File.join(build,"cache")
      received_cache = File.join(@environment,"received-cache")
      copy_tree(received_cache,cache) if File.directory?(received_cache)
      environment = bundle_environment(build,version,project,cache)
      lock = resolve_lock(build,version,project,environment,offline: offline)
      sources = lock_sources(build,version,project,environment)
      command(bundle_args(version,"install",*(offline ? ["--local"] : [])),
        environment: environment,directory: project,stage: "BUNDLE_INSTALL")
      if offline
        progress("VERIFY_RETAINED_CACHE")
      else
        command(bundle_args(version,"cache","--all","--no-install"),environment: environment,
          directory: project,stage: "RETAIN_GEM_CACHE")
      end
      need(file_descriptor(File.join(project,meta.fetch("gemfile") + ".lock")) == lock.slice("bytes","sha256"),
        "RUBY_LOCK_CHANGED")
      dependencies = dependency_probe(build,version,project,environment)
      need(dependencies["ruby_version"] == @selection.fetch("ruby").fetch("ruby_version") &&
        dependencies["ruby_platform"] == @selection.fetch("ruby").fetch("ruby_platform"),"RUBY_INTERPRETER_CHANGED")
      make_tree_private(cache)
      cache_files = inventory(cache)
      need(cache_files.any? { |file| file["name"].end_with?(".gem") },"RUBY_GEM_CACHE_EMPTY")
      # Retain all source and exact cache descriptors as ordinary download files.
      cache_manifest = {"files"=>cache_files,"sha256"=>identity(cache_files)}
      save(File.join(build,"cache-manifest.json"),cache_manifest)
      receipt = {"schema"=>"stellar-forge.ruby-installation.v1","selectionSha256"=>@selection.fetch("sha256"),
        "originalSelectionSha256"=>meta.fetch("originalSelectionSha256"),
        "environmentId"=>@request.fetch("environmentId"),"installedAt"=>stamp,
        "build"=>Pathname.new(build).relative_path_from(Pathname.new(@environment)).to_s,
        "ruby"=>probe,"bundlerVersion"=>version,"bundler"=>bundler,"lock"=>lock,"lockSha256"=>lock.fetch("sha256"),
        "dependencies"=>dependencies,"sources"=>sources,"cache"=>{"files"=>cache_files.length,
          "bytes"=>cache_files.sum { |entry| entry.fetch("bytes") },"sha256"=>cache_manifest.fetch("sha256")},
        "clientSha256"=>meta.fetch("client").fetch("sha256"),"projectSha256"=>meta.fetch("project").fetch("sha256")}
      progress("RETAIN_INSTALLATION")
      save(File.join(@environment,"installation.json"),receipt)
      receipt
    end
    def verify
      saved,build,project,environment = installation
      progress("VERIFY_SOURCE_AND_LOCK")
      need(inventory(File.join(@environment,"project")) == definition.fetch("project").fetch("files"),"RUBY_PROJECT_SOURCE_CHANGED")
      need(inventory(File.join(@environment,"client")) == definition.fetch("client").fetch("files"),"RUBY_CLIENT_SOURCE_CHANGED")
      cache = parse(File.join(build,"cache-manifest.json"))
      need(inventory(File.join(build,"cache")) == cache.fetch("files") &&
        identity(cache.fetch("files")) == saved.fetch("cache").fetch("sha256"),"RUBY_GEM_CACHE_CHANGED")
      actual = dependency_probe(build,saved.fetch("bundlerVersion"),project,environment)
      need(actual == saved.fetch("dependencies"),"RUBY_INSTALLED_DEPENDENCIES_CHANGED")
      if @request["applicationId"]
        path,record = application_record
        output = File.join(@attempt_root,"application-verification.json")
        application_command("verify",File.join(path,"application.json"),output: output)
        return {"environmentId"=>@request.fetch("environmentId"),"applicationId"=>record.fetch("id"),
          "installation"=>saved,"application"=>parse(output)}
      end
      saved
    end
    def customer_command
      saved,build,project,environment = installation
      selected = @request.fetch("parameters")
      entries = {
        "native-dataset-lifecycle"=>"developer/ruby-client/examples/native_dataset_lifecycle.rb",
        "baserow-customer-lifecycle"=>"baserow/customer/lifecycle.rb"
      }
      relative = entries[selected.fetch("entry")]
      arguments = selected.fetch("argv")
      need(relative && arguments.is_a?(Array) && arguments.length <= 512 &&
        arguments.all? { |item| item.is_a?(String) && !item.include?("\0") && item.length <= 65_536 } &&
        JSON.generate(arguments).bytesize <= 1_048_576,"RUBY_CUSTOMER_ARGUMENTS_INVALID")
      client = File.join(@environment,"client")
      need(inventory(client) == definition.fetch("client").fetch("files"),"RUBY_CLIENT_SOURCE_CHANGED")
      source = File.join(client,relative)
      descriptor = file_descriptor(source)
      output = File.join(@attempt_root,"customer-stdout.txt")
      command(bundle_args(saved.fetch("bundlerVersion"),"exec",@ruby,source,*arguments),
        environment: environment,directory: project,stage: "CUSTOMER_" + selected.fetch("entry").upcase.tr("-","_"),
        result_file: output)
      {"entry"=>selected.fetch("entry"),"argv"=>arguments,"source"=>{"name"=>relative}.merge(descriptor),
        "stdout"=>{"name"=>"customer-stdout.txt"}.merge(file_descriptor(output)),"exitCode"=>0}
    end
    def application_record
      key = @request.fetch("applicationId")
      need(key.is_a?(String) && /\A[A-Za-z0-9][A-Za-z0-9._-]{0,79}\z/.match?(key),"RUBY_APPLICATION_REQUIRED")
      path = private_directory(File.join(@root,"applications",key))
      record = parse(File.join(path,"application.json"))
      need(record["id"] == key && record["environmentId"] == @request.fetch("environmentId") &&
        identity(record.reject { |name,_| name == "sha256" }) == record["sha256"],"RUBY_APPLICATION_CHANGED")
      [path,record]
    end
    def application_command(action,record_path,output: nil,extra: {})
      saved,build,project,environment = installation
      request_file = File.join(@attempt_root,"application-" + action + "-" + SecureRandom.hex(6) + ".json")
      input = {"schema"=>"stellar-forge.ruby-application-command.v1","action"=>action,
        "applicationRecord"=>record_path,"environment"=>@environment,"operationId"=>@operation_id,
        "attempt"=>@attempt,"startupFile"=>File.join(@attempt_root,"startup.json")}.merge(extra)
      save(request_file,input)
      command(bundle_args(saved.fetch("bundlerVersion"),"exec",@ruby,File.join(@environment,"support","application.rb"),request_file),
        environment: environment,directory: project,stage: "APPLICATION_" + action.upcase,
        result_file: output)
    end
    def register_application
      path,record = application_record
      retained = optional(File.join(path,"registered.json"))
      if retained
        need(retained.fetch("applicationSha256") == record.fetch("sha256"),"RUBY_APPLICATION_CHANGED")
        return retained
      end
      output = File.join(@attempt_root,"application-result.json")
      application_command("register",File.join(path,"application.json"),output: output)
      actual = parse(output)
      receipt = {"schema"=>"stellar-forge.ruby-application-registration.v1",
        "applicationSha256"=>record.fetch("sha256"),"operationId"=>@operation_id,"registeredAt"=>stamp,"result"=>actual}
      save(File.join(path,"registered.json"),receipt)
      receipt
    end
    def serve_application
      path,record = application_record
      saved = parse(File.join(path,"registered.json"))
      need(saved["applicationSha256"] == record["sha256"],"RUBY_APPLICATION_CHANGED")
      application_command("serve",File.join(path,"application.json"),extra: {"port"=>@request.fetch("parameters").fetch("port")})
      {"applicationId"=>record.fetch("id"),"state"=>"STOPPED"}
    rescue Cancelled
      {"applicationId"=>record.fetch("id"),"state"=>"STOPPED"}
    end
    def export
      saved,build,project,environment = installation
      payload = private_directory(File.join(@attempt_root,"payload"),create: true)
      meta = definition
      copy_tree(File.join(@environment,"project"),File.join(payload,"project"),files: meta.fetch("project").fetch("files"))
      copy_tree(File.join(@environment,"client"),File.join(payload,"client"),files: meta.fetch("client").fetch("files"))
      copy_tree(File.join(@environment,"bootstrap-cache"),File.join(payload,"bootstrap"))
      cache = parse(File.join(build,"cache-manifest.json"))
      copy_tree(File.join(build,"cache"),File.join(payload,"cache"),files: cache.fetch("files"))
      private_directory(File.join(payload,"lock"),create: true)
      copy_file(locked_file,File.join(payload,"lock","Gemfile.lock"),saved.fetch("lock"))
      private_directory(File.join(payload,"metadata"),create: true)
      save(File.join(payload,"metadata","selection.json"),@selection)
      save(File.join(payload,"metadata","installation.json"),saved)
      app = nil
      if @request["applicationId"]
        path,record = application_record
        output = File.join(@attempt_root,"application-snapshot.json")
        application_command("snapshot",File.join(path,"application.json"),output: output,
          extra: {"out"=>File.join(payload,"application")})
        app = {"record"=>record,"snapshot"=>parse(output)}
      end
      files = inventory(payload)
      progress("WRITE_RUNTIME_ARCHIVE",{"files"=>files.length,"bytes"=>files.sum { |file| file.fetch("bytes") }})
      metadata = {"definition"=>meta,"ruby"=>portable_identity(@selection.fetch("ruby")),
        "bundlerVersion"=>saved.fetch("bundlerVersion"),"lock"=>saved.fetch("lock"),
        "installation"=>saved.slice("originalSelectionSha256","clientSha256","projectSha256","dependencies"),
        "application"=>app}
      result = write_archive(File.join(@attempt_root,"ruby-runtime.tar"),metadata,payload,files)
      {"environmentId"=>@request.fetch("environmentId"),"applicationId"=>@request["applicationId"],
        "archive"=>{"name"=>"ruby-runtime.tar"}.merge(result.fetch("archive")),
        "manifestSha256"=>result.fetch("manifestSha256")}
    end
    def receive
      archive = File.join(@environment,"input.tar")
      input = @selection.fetch("archive")
      need(file_descriptor(archive) == input.slice("bytes","sha256"),"RUBY_ARCHIVE_CHANGED")
      unpacked = private_directory(File.join(@environment,"received-payload"),create: true)
      progress("RECEIVE_COMPLETE_ARCHIVE",{"bytes"=>input.fetch("bytes")})
      manifest = receive_archive(archive,input.fetch("sha256"),unpacked)
      need(manifest.fetch("ruby") == portable_identity(@selection.fetch("ruby")),"RUBY_RECEIVING_PLATFORM_CHANGED",
        "Use the selected Ruby engine, Ruby ABI and platform for this complete offline runtime.")
      original_version = manifest.fetch("bundlerVersion")
      need(@selection["bundlerVersion"].nil? || @selection["bundlerVersion"] == original_version,"RUBY_RECEIVING_BUNDLER_CHANGED")
      meta = manifest.fetch("definition")
      need(meta["bundlerVersion"] == original_version && meta["project"].is_a?(Hash) && meta["client"].is_a?(Hash) &&
        HASH.match?(meta["originalSelectionSha256"].to_s),"RUBY_RECEIVING_DEFINITION_INVALID")
      copy_tree(File.join(unpacked,"project"),File.join(@environment,"project"),files: meta.fetch("project").fetch("files"))
      copy_tree(File.join(unpacked,"client"),File.join(@environment,"client"),files: meta.fetch("client").fetch("files"))
      copy_tree(File.join(unpacked,"bootstrap"),File.join(@environment,"bootstrap-cache"))
      copy_tree(File.join(unpacked,"cache"),File.join(@environment,"received-cache"))
      received = {"schema"=>"stellar-forge.ruby-runtime-receiving.v1","archiveSha256"=>input.fetch("sha256"),
        "bundlerVersion"=>original_version,"definition"=>meta,"originalApplication"=>manifest["application"]}
      save(File.join(@environment,"received.json"),received)
      private_directory(File.join(@environment,"lock"),create: true)
      copy_file(File.join(unpacked,"lock","Gemfile.lock"),locked_file,manifest.fetch("lock"))
      save(File.join(@environment,"lock.json"),manifest.fetch("lock"))
      installed = install(offline: true)
      app_result = nil
      if manifest["application"]
        original = manifest.fetch("application").fetch("record")
        key = @request.fetch("environmentId")[0,64] + "-application"
        target = private_directory(File.join(@root,"applications",key),create: true)
        working = File.join(target,"workspace")
        body = original.reject { |name,_| %w[sha256 id title environmentId directory requestId environmentSelectionSha256].include?(name) }.merge(
          "id"=>key,"title"=>@selection.fetch("title") + " application","environmentId"=>@request.fetch("environmentId"),
          "directory"=>working,"requestId"=>@operation_id,"environmentSelectionSha256"=>@selection.fetch("sha256"),
          "receivedFrom"=>{"archiveSha256"=>input.fetch("sha256"),"applicationSha256"=>original.fetch("sha256")})
        body["title"] = body.fetch("title")[0,160]
        record = body.merge("sha256"=>identity(body))
        retained_record = optional(File.join(target,"application.json"))
        if retained_record
          need(retained_record == record,"RUBY_APPLICATION_CHANGED")
        else
          copy_tree(File.join(unpacked,"application"),working)
          save(File.join(target,"application.json"),record)
        end
        registration = optional(File.join(target,"registered.json"))
        if registration
          need(registration["schema"] == "stellar-forge.ruby-application-registration.v1" &&
            registration["applicationSha256"] == record.fetch("sha256") &&
            registration["operationId"] == @operation_id,"RUBY_APPLICATION_CHANGED")
          app_result = registration.fetch("result")
        else
          output = File.join(@attempt_root,"received-application.json")
          application_command("verify",File.join(target,"application.json"),output: output)
          app_result = parse(output)
          save(File.join(target,"registered.json"),{"schema"=>"stellar-forge.ruby-application-registration.v1",
            "applicationSha256"=>record.fetch("sha256"),"operationId"=>@operation_id,"registeredAt"=>stamp,"result"=>app_result})
        end
        app_result = {"id"=>key,"directory"=>working,"result"=>app_result}
      end
      {"environmentId"=>@request.fetch("environmentId"),"installation"=>installed,"application"=>app_result,
        "archiveSha256"=>input.fetch("sha256")}
    end
    def output(name,source,type = "application/json")
      path = File.join(@attempt_root,name)
      copy_file(source,path)
      {"name"=>name,"path"=>name,"type"=>type}.merge(file_descriptor(path))
    end
    def run
      action = @request.fetch("action")
      result = case action
      when "install" then install(offline: @request.fetch("parameters").fetch("offline"))
      when "verify" then verify
      when "export" then export
      when "receive" then receive
      when "customer-command" then customer_command
      when "application-register" then register_application
      when "application-serve" then serve_application
      else raise Error.new("RUBY_ACTION_INVALID")
      end
      outputs = []
      if action == "export"
        outputs << {"name"=>"ruby-runtime.tar","path"=>"ruby-runtime.tar","type"=>"application/x-tar"}.merge(
          file_descriptor(File.join(@attempt_root,"ruby-runtime.tar")))
      end
      if action == "verify" && @request["applicationId"]
        outputs << {"name"=>"application-verification.json","path"=>"application-verification.json","type"=>"application/json"}.merge(
          file_descriptor(File.join(@attempt_root,"application-verification.json")))
      end
      if action == "customer-command"
        outputs << {"name"=>"customer-stdout.txt","path"=>"customer-stdout.txt","type"=>"text/plain; charset=utf-8"}.merge(
          file_descriptor(File.join(@attempt_root,"customer-stdout.txt")))
      end
      if %w[install verify receive].include?(action)
        outputs << output("installation.json",File.join(@environment,"installation.json"))
        outputs << output("selection.json",File.join(@environment,"selection.json"))
        outputs << output("Gemfile.lock",locked_file,"text/plain; charset=utf-8")
      end
      value = {"schema"=>"stellar-forge.ruby-operation-result.v1","operationId"=>@operation_id,
        "requestSha256"=>@request.fetch("sha256"),"state"=>"COMPLETE","action"=>action,
        "completedAt"=>stamp,"result"=>result,"files"=>outputs}
      # Keep frequently used identities directly available to the browser.
      value.merge!(result.slice("archive","manifestSha256","environmentId","applicationId","application")) if result.is_a?(Hash)
      save(File.join(@attempt_root,"result.json"),value)
      value
    rescue Exception => error
      cancelled = error.is_a?(Cancelled)
      result = {"schema"=>"stellar-forge.ruby-operation-result.v1","operationId"=>@operation_id,
        "requestSha256"=>@request.fetch("sha256"),"state"=>cancelled ? "CANCELLED" : "FAILED",
        "action"=>@request.fetch("action"),"completedAt"=>stamp,
        "error"=>{"code"=>error.respond_to?(:code) ? error.code : error.class.name,
          "message"=>error.message.to_s[0,4000]}}
      save(File.join(@attempt_root,"result.json"),result)
      $stderr.puts(JSON.generate(result))
      raise
    end
  end
end

if File.expand_path($PROGRAM_NAME) == File.expand_path(__FILE__)
  old_umask = File.umask(0077)
  if ARGV == ["probe"]
    puts JSON.generate(StarforgeRubyRuntime.probe)
  else
    begin
      StarforgeRubyRuntime.need(ARGV.shift == "operate" && ARGV.length == 8,"RUBY_ENGINE_ARGUMENTS")
      options = ARGV.each_slice(2).to_h
      StarforgeRubyRuntime.need(options.keys.sort == %w[--attempt --directory --lease-fd --operation-id],"RUBY_ENGINE_ARGUMENTS")
      result = StarforgeRubyRuntime::Engine.new(root: options.fetch("--directory"),
        operation_id: options.fetch("--operation-id"),attempt: Integer(options.fetch("--attempt"),10),
        lease_fd: Integer(options.fetch("--lease-fd"),10)).run
      puts JSON.generate(result)
    rescue Exception => error
      $stderr.puts(JSON.generate({"error"=>{"code"=>error.respond_to?(:code) ? error.code : error.class.name,"message"=>error.message.to_s[0,4000]}}))
      exit 1
    end
  end
  File.umask(old_umask)
end
