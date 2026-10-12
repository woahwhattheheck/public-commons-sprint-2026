# Standard gRPC health protocol and native observation

## Retained protocol

The complete unmodified `health.proto` is the official `grpc.health.v1.Health` definition from [grpc/grpc-proto](https://github.com/grpc/grpc-proto/blob/2eb777aba6593c31e21f7f69a163486bdc793501/grpc/health/v1/health.proto). Original blob: `288ce7c9ec4bef7eb99d169b3ec01573946cfe98`. It contains Check, List and Watch, including the HealthListResponse service map. Its exact 3,673 bytes have SHA256 `164b670058855c6277a0511a14e2a302dd5a8ff899853ca6851b6b201a413d28`. The original Apache 2.0 license is in LICENSE.

The original protocol specifies that Check uses an empty service for whole-server health and returns NOT_FOUND for an unknown service. List is a non-atomic service snapshot. Watch keeps SERVICE_UNKNOWN live and emits later changes. A terminal UNIMPLEMENTED ends Watch; other terminal statuses, including OK, require retry with exponential backoff. [Protocol source](https://github.com/grpc/grpc-proto/blob/2eb777aba6593c31e21f7f69a163486bdc793501/grpc/health/v1/health.proto).

## Native client

`../health.mjs` exports:

- `GRPC_HEALTH_PROTOCOL_SHA256`.
- `normalizeGrpcHealthRequest(request)` and its alias `validateGrpcHealthRequest`.
- `observeGrpcHealth(config, request, {env, signal, onEvent})`.

The same original captureProtoSource, compileProtoSource, createGrpcSource and host-owned connection settings operate the vendored schema. Every observation retains the exact file hash and original complete proto-source identity. Its monotonic lifetime starts before source acquisition; acquisition and compilation consume the selected deadline, and an expired observation opens no native RPC. TLS, mTLS and metadata use the selected source's existing environment references. Channel and stream owners close before the next connection or result.

## Request

Check and Watch take an exact service string, defaulting to the empty service. List rejects a service argument.

| Field | Check / List | Watch |
| --- | --- | --- |
| kind | check or list | watch |
| service | Check only, default empty | Default empty |
| timeoutMs | Native RPC deadline, default 30,000; range 1–300,000 | Same per-connection deadline |
| durationMs | Absent | Whole observation, default 60,000; range 1–3,600,000 |
| maxEvents | Absent | All emitted records, default 1,000; range 1–10,000 |

A Watch connection uses the lesser of its selected native timeout and remaining observation lifetime. Its idle timeout equals that connection lifetime. Quiet periods preserve the last native serving status; expiry renews the connection with a retained terminal/retry record. Retry begins at 250 ms, doubles after consecutive connections without a status, caps at ten seconds, and resets after a received status.

## Ordered events and compact result

The awaited onEvent callback owns the ordered durable history. Its JSON-only events have type opening, status, terminal or retry, and a connection number. Every emitted event counts toward maxEvents, including connection and retry history. Callback errors close the original source and propagate to the caller.

A status event contains service and `status:{name,code}`. List uses `statuses:[{service,status:{name,code}}]` and `atomic:false`. An omitted proto3 zero value becomes UNKNOWN. A future numeric enum remains `name:UNRECOGNIZED` with its exact integer code.

Terminal events retain complete, terminalObserved, native grpcCode/grpcStatus when observed, and a safe error code. They exclude native metadata and raw error details. Retry events retain delayMs and the preceding safe terminal cause.

The final compact result has schema, protocolSha256, protoSourceSha256, reason, optional latest, updates, connections, optional terminal and eventCount. There is no second full event history. Reasons are COMPLETED, NATIVE_ERROR, UNIMPLEMENTED, DURATION_REACHED, EVENT_LIMIT_REACHED or CANCELLED. Check and List retain their native failure result; caller cancellation and selected Watch limits return their explicit reason.

A receiving workspace owns the original operation UUID, saved source and request, created/deadline timestamps and remaining event allowance across an explicit resume. The native client's duration and event limits apply to the current observation call, so resumed callers pass the actual remaining allowance and keep the original operation identity.
