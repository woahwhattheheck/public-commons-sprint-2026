#!/usr/bin/env node
import { probeMcpEndpoint } from './probe.mjs';

function usage() {
  return `Usage: mcp-http-conformance <endpoint> [options]\n\nOptions:\n  --bearer-env NAME       Read bearer token from NAME (HTTPS endpoints only)\n  --min-version DATE      Minimum acceptable MCP version (default 2025-11-25)\n  --timeout-ms N          Per-request timeout (default 3000)\n  --max-bytes N           Max JSON response bytes (default 262144)\n  --max-rtt-ms N          Optional latency budget for initialize/ping/tools-list\n  --require-session       Fail if the server does not issue MCP-Session-Id\n  --require-tools         Fail unless tools capability has at least one listed tool\n  --no-delete             Do not terminate the probe-created session\n  --help                  Show this help\n\nThe probe never invokes tools/call and never prints bearer credentials.\n`;
}

function parse(argv) {
  const args = [...argv];
  if (args.includes('--help') || args.length === 0) return { help: true };
  const endpoint = args.shift();
  const options = { endpoint };
  while (args.length) {
    const key = args.shift();
    if (key === '--require-session') options.requireSession = true;
    else if (key === '--require-tools') options.requireTools = true;
    else if (key === '--no-delete') options.terminateSession = false;
    else if (['--bearer-env', '--min-version', '--timeout-ms', '--max-bytes', '--max-rtt-ms'].includes(key)) {
      if (!args.length) throw new Error(`${key} requires a value`);
      const value = args.shift();
      if (key === '--bearer-env') options.bearerEnv = value;
      else if (key === '--min-version') options.minimumProtocolVersion = value;
      else if (key === '--timeout-ms') options.timeoutMs = Number(value);
      else if (key === '--max-bytes') options.maxResponseBytes = Number(value);
      else if (key === '--max-rtt-ms') options.maxRttMs = Number(value);
    } else throw new Error(`unknown option: ${key}`);
  }
  return options;
}

try {
  const parsed = parse(process.argv.slice(2));
  if (parsed.help) { process.stdout.write(usage()); process.exitCode = 0; }
  else {
    const { bearerEnv, ...options } = parsed;
    if (bearerEnv) {
      const token = process.env[bearerEnv];
      if (!token) throw new Error(`environment variable ${bearerEnv} is empty or unset`);
      options.authorizationHeader = `Bearer ${token}`;
    }
    const report = await probeMcpEndpoint(options);
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    process.exitCode = report.summary.ok ? 0 : 2;
  }
} catch (error) {
  process.stderr.write(`mcp-http-conformance: ${error?.message ?? error}\n`);
  process.exitCode = 1;
}
