#!/usr/bin/env bash
set -euo pipefail
MPP_SOURCE_ROOT=${1:?Supply the absolute checkout root for the pinned customer workbench source}
MPP_RUN_ROOT=${2:?Supply a new absolute private run directory}
case "$MPP_SOURCE_ROOT" in /*) ;; *) exit 2 ;; esac
case "$MPP_RUN_ROOT" in /*) ;; *) exit 2 ;; esac
umask 077
mkdir "$MPP_RUN_ROOT"
node "$MPP_SOURCE_ROOT/stellar/scf-starforge-20261009/mpp-charge/cli.mjs" runtime-template "$MPP_RUN_ROOT/runtime"
npm --prefix "$MPP_RUN_ROOT/runtime" ci --ignore-scripts --omit=dev --no-audit --no-fund --cache "$MPP_RUN_ROOT/npm-cache" >"$MPP_RUN_ROOT/runtime-install.log" 2>&1
openssl req -x509 -newkey rsa:2048 -nodes -keyout "$MPP_RUN_ROOT/tls.key" -out "$MPP_RUN_ROOT/tls.crt" -days 1 -subj /CN=merchant.example.com -addext subjectAltName=DNS:merchant.example.com >"$MPP_RUN_ROOT/tls-setup.log" 2>&1
NODE_EXTRA_CA_CERTS="$MPP_RUN_ROOT/tls.crt" node --experimental-vm-modules "$MPP_SOURCE_ROOT/operations/scf-mpp-workbench-native-20261011/execute.mjs" "$MPP_SOURCE_ROOT" "$MPP_RUN_ROOT"
