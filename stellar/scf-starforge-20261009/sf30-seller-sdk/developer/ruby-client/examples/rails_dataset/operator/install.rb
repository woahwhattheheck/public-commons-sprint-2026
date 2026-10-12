#!/usr/bin/env ruby
# frozen_string_literal: true
# MIT. A complete local commissioning application; existing applications include Controller.
require "rails"
require "action_controller/railtie"
require "active_job/railtie"
require "logger"
require "base64"
require_relative "controller"

module Starforge
  module DatasetOperator
    class CommissionApplication < Rails::Application
    end

    module Installation
      class << self
        attr_reader :tenant_key, :access_key, :application
        def open(directory:, workspace:, access_key:)
          Files.need(access_key.is_a?(String) && /\A[a-f0-9]{64}\z/.match?(access_key),
            "DATASET_OPERATOR_ACCESS_KEY")
          Files.need(!@application || @access_key == access_key,"DATASET_OPERATOR_APPLICATION_CHANGED")
          @tenant_key, @access_key = workspace.tenant_key, access_key
          DatasetOperator.workspace_resolver = lambda do |selected|
            Files.need(selected == workspace.tenant_key,"DATASET_OPERATOR_TENANT_CHANGED")
            workspace
          end
          unless @application
            application_class = CommissionApplication
            application_class.config.root = Pathname.new(directory)
            application_class.config.eager_load = false
            application_class.config.secret_key_base = Digest::SHA256.hexdigest(access_key + "/rails-session") * 2
            application_class.config.logger = Logger.new(File::NULL)
            application_class.config.hosts = ["localhost","127.0.0.1","::1"]
            application_class.config.consider_all_requests_local = true
            application_class.config.action_dispatch.show_exceptions = :none
            application_class.config.action_controller.allow_forgery_protection = true
            application_class.config.session_store :cookie_store, key: "_starforge_dataset_operator"
            @application = application_class.instance
            @application.initialize!
            @application.routes.draw do
              resources :dataset_imports,controller: "starforge/dataset_operator/commission",only: [:index,:show,:create] do
                collection { get :stylesheet }
                member do
                  post :prepare
                  post :refresh
                  post :commit
                  get :changes
                  get :history
                  get :attachments
                  get :download
                  get :receipt
                  get :attachment
                  get :handoff
                end
              end
              root to: redirect("/dataset_imports")
            end
          end
          Rails.application = @application
          # Commissioning performs the actual jobs in this process. Production
          # installations use their application's configured durable queue.
          PrepareJob.queue_adapter = :inline
          ImportJob.queue_adapter = :inline
          @application
        end
      end
    end

    class CommissionController < ActionController::Base
      include Controller
      private
      def starforge_dataset_authorize!
        authenticate_or_request_with_http_basic("Dataset operator") do |user,password|
          user == "operator" && ActiveSupport::SecurityUtils.secure_compare(
            Digest::SHA256.hexdigest(password.to_s),Digest::SHA256.hexdigest(Installation.access_key))
        end
      end
      def starforge_dataset_tenant_key
        Installation.tenant_key
      end
      def starforge_dataset_actor
        "commissioning-operator"
      end
    end
  end
end

if File.expand_path($PROGRAM_NAME) == File.expand_path(__FILE__)
  require "optparse"
  require_relative "commission"
  options = {port: 9292,bind: "127.0.0.1"}
  parser = OptionParser.new do |o|
    o.banner = "ruby install.rb --directory PRIVATE_APPLICATION [--port 9292] [--bind 127.0.0.1]"
    o.on("--directory PATH") { |value| options[:directory] = value }
    o.on("--port NUMBER",Integer) { |value| options[:port] = value }
    o.on("--bind ADDRESS") { |value| options[:bind] = value }
  end
  parser.parse!(ARGV)
  abort parser.to_s unless options[:directory] && ARGV.empty? &&
    (1..65535).cover?(options[:port]) && %w[127.0.0.1 ::1 localhost].include?(options[:bind])
  application = Starforge::DatasetOperator::Commission.open_application(options.fetch(:directory))
  require "rackup"
  require "puma"
  $stderr.puts("Dataset operator: http://#{options[:bind]}:#{options[:port]}/dataset_imports")
  $stderr.puts("HTTP Basic user: operator. Password: the private application access-key file.")
  Rackup::Handler.get("puma").run(application,Host: options[:bind],Port: options[:port])
end
