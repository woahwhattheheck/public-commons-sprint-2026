package io.starforge.buyer;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.ByteBuffer;
import java.nio.channels.FileChannel;
import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.nio.file.attribute.PosixFilePermission;
import java.nio.file.attribute.PosixFilePermissions;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.FutureTask;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;

/** Invokes the maintained source bridge. It never implements a payment or a retry. */
final class NativeCall {
    static final String SCHEMA = "stellar-forge.go-buyer-call.v1";
    static final int MAX_REQUEST = 32 * 1024 * 1024;
    static final Set<PosixFilePermission> PRIVATE_DIRECTORY = PosixFilePermissions.fromString("rwx------");
    static final Set<PosixFilePermission> PRIVATE_FILE = PosixFilePermissions.fromString("rw-------");

    @FunctionalInterface interface Consumer { void read(InputStream source) throws IOException; }

    static Path absolute(Path path) {
        if (path == null || !path.isAbsolute()) throw new IllegalArgumentException("Absolute path required");
        return path.normalize();
    }
    static void privateDirectory(Path path) throws IOException {
        Files.createDirectories(path, PosixFilePermissions.asFileAttribute(PRIVATE_DIRECTORY));
        if (!Files.isDirectory(path, LinkOption.NOFOLLOW_LINKS) || Files.isSymbolicLink(path))
            throw new IOException("Private directory required: " + path);
        privateMode(path);
    }
    static void privateMode(Path path) throws IOException {
        Set<PosixFilePermission> mode = Files.getPosixFilePermissions(path, LinkOption.NOFOLLOW_LINKS);
        for (PosixFilePermission permission : mode)
            if (permission.name().startsWith("GROUP_") || permission.name().startsWith("OTHERS_"))
                throw new IOException("Private POSIX permissions required: " + path);
    }
    static void writePrivate(Path path, byte[] bytes) throws IOException {
        try (FileChannel file = FileChannel.open(path, Set.of(StandardOpenOption.CREATE_NEW,
                StandardOpenOption.WRITE, LinkOption.NOFOLLOW_LINKS),
                PosixFilePermissions.asFileAttribute(PRIVATE_FILE))) {
            ByteBuffer buffer = ByteBuffer.wrap(bytes);
            while (buffer.hasRemaining()) file.write(buffer);
            file.force(true);
        }
    }
    static byte[] readPrivate(Path path, int limit) throws IOException {
        if (!Files.isRegularFile(path, LinkOption.NOFOLLOW_LINKS)) throw new IOException("Regular file required");
        privateMode(path);
        try (FileChannel channel = FileChannel.open(path, StandardOpenOption.READ, LinkOption.NOFOLLOW_LINKS);
             InputStream source = java.nio.channels.Channels.newInputStream(channel)) {
            if (channel.size() > limit) throw new IOException("Response exceeds selected limit");
            byte[] bytes = source.readNBytes(limit + 1);
            if (bytes.length > limit) throw new IOException("Response exceeds selected limit");
            return bytes;
        }
    }
    private static void clean(Path directory) throws IOException {
        // This directory was created by this call, contains only its four IPC files,
        // and is never the original buyer's intent, evidence or acquisition directory.
        try (var files = Files.list(directory)) {
            for (Path file : files.toList()) Files.delete(file);
        }
        Files.delete(directory);
    }
    private static Map<String, Object> options(Object value) throws IOException {
        return value == null ? Map.of() : Json.object(value);
    }

    // Resolve an absent selection through its nearest existing ancestor without
    // creating it. A restore must see the original absent state as absent.
    private static Path selectedPath(String value) throws IOException {
        Path selected = absolute(Path.of(value));
        Path existing = selected;
        while (!Files.exists(existing, LinkOption.NOFOLLOW_LINKS)) {
            existing = existing.getParent();
            if (existing == null) throw new IOException("Existing source ancestor required");
        }
        return existing.toRealPath().resolve(existing.relativize(selected)).normalize();
    }

    private static Path workflowCalls(Buyer.Settings settings, Map<String, Object> arguments) throws IOException {
        Map<String, Object> args = arguments == null ? Map.of() : arguments;
        Map<String, Object> method = options(args.get("options"));
        Map<String, Object> workspace = options(args.get("workspace"));
        Path parent = settings.callsDirectory;
        if (parent == null && method.get("stateRoot") instanceof String root)
            parent = absolute(Path.of(root)).getParent();
        if (parent == null) parent = absolute(Path.of(System.getProperty("java.io.tmpdir")));
        Path actualParent = parent.toRealPath();
        if (!actualParent.equals(parent) || !Files.isDirectory(actualParent))
            throw new IOException("Canonical existing calls directory required");
        List<String> selections = new ArrayList<>();
        selections.add(settings.state.toString());
        for (String key : List.of("directory", "configsDirectory", "operatorSettings"))
            if (workspace.get(key) instanceof String path) selections.add(path);
        for (String key : List.of("directory", "stateRoot"))
            if (method.get(key) instanceof String path) selections.add(path);
        for (String key : List.of("inboxes", "include"))
            if (method.get(key) instanceof List<?> paths)
                for (Object path : paths) if (path instanceof String text) selections.add(text);
        for (String selection : selections)
            if (actualParent.startsWith(selectedPath(selection)))
                throw new IOException("Calls directory must be outside selected source: " + selection);
        return actualParent;
    }

    private static Map<String, Object> retainedResponse(Path directory, Buyer.Settings settings,
            String action, String id, String callId) {
        try {
            Map<String, Object> value = Json.object(Json.parse(
                readPrivate(directory.resolve("response.json"), settings.resultLimit)));
            boolean sameId = id == null ? value.get("id") == null : id.equals(value.get("id"));
            if (SCHEMA.equals(value.get("schema")) && callId.equals(value.get("callId")) &&
                    action.equals(value.get("action")) && sameId && value.get("ok") instanceof Boolean)
                return value;
        } catch (IOException | RuntimeException ignored) { /* Original IPC remains available for inspection. */ }
        return null;
    }

    private static void stop(Process process, long graceMillis) {
        List<ProcessHandle> descendants = process.descendants().toList();
        process.destroy(); // SIGTERM reaches the original bridge's AbortController.
        boolean interrupted = Thread.interrupted();
        try {
            if (!process.waitFor(graceMillis + 5000, TimeUnit.MILLISECONDS)) {
                for (ProcessHandle child : descendants) if (child.isAlive()) child.destroyForcibly();
                process.destroyForcibly();
                process.waitFor(5000, TimeUnit.MILLISECONDS);
            }
        } catch (InterruptedException e) {
            interrupted = true;
            for (ProcessHandle child : descendants) if (child.isAlive()) child.destroyForcibly();
            process.destroyForcibly();
        } finally { if (interrupted) Thread.currentThread().interrupt(); }
    }

    static Object invoke(Buyer.Settings settings, String action, String id,
                         Map<String, Object> arguments, Consumer consume) throws IOException {
        if (Thread.currentThread().isInterrupted())
            throw new BuyerException("JAVA_CALL_INTERRUPTED_BEFORE_START", action, id, null, null, null, null);
        boolean workflow = action.startsWith("acquisitions.") || action.startsWith("workspace-recovery.");
        Path calls;
        if (workflow) calls = workflowCalls(settings, arguments);
        else {
            privateDirectory(settings.state);
            calls = settings.callsDirectory == null ? settings.state.resolve(".java-calls") : settings.callsDirectory;
            privateDirectory(calls);
        }
        Path directory = Files.createTempDirectory(calls, "java-", PosixFilePermissions.asFileAttribute(PRIVATE_DIRECTORY));
        String callId = directory.getFileName().toString();
        Map<String, Object> client = Json.map("runtimeDirectory", settings.runtime.toString(),
            "stateDirectory", settings.state.toString(), "timeoutMs", settings.nativeTimeout,
            "cleanupGraceMs", settings.cleanupGrace, "outputLimit", settings.outputLimit);
        if (settings.profile != null) client.put("operatorProfile", settings.profile.toString());
        Map<String, Object> request = Json.map("schema", SCHEMA, "callId", callId,
            "action", action, "client", client, "arguments", arguments == null ? Map.of() : arguments);
        if (id != null) request.put("id", id);
        Process process = null;
        FutureTask<Void> reading = null;
        Thread shutdown = null;
        boolean succeeded = false;
        Object result = null;
        Map<String, Object> nativeError = null;
        try {
            byte[] bytes = Json.bytes(request);
            if (bytes.length > MAX_REQUEST) throw new IOException("Invocation exceeds 32 MiB");
            Path input = directory.resolve("request.json");
            writePrivate(input, bytes);
            Path log = directory.resolve("bridge.stderr.log");
            writePrivate(log, new byte[0]);
            ProcessBuilder builder = new ProcessBuilder(settings.node, settings.bridge.toString(), input.toString())
                .directory(settings.runtime.toFile()).redirectError(log.toFile());
            if (settings.environment != null) {
                builder.environment().clear();
                builder.environment().putAll(settings.environment);
            }
            if (settings.approvalInput) builder.redirectInput(ProcessBuilder.Redirect.INHERIT);
            process = builder.start();
            if (!settings.approvalInput) process.getOutputStream().close();
            final Process running = process;
            shutdown = new Thread(() -> stop(running, settings.cleanupGrace), "starforge-stop-" + callId);
            Runtime.getRuntime().addShutdownHook(shutdown);
            reading = new FutureTask<>(() -> {
                try (InputStream source = running.getInputStream()) {
                    if (consume == null) {
                        byte[] block = new byte[8192];
                        boolean unexpected = false;
                        int n;
                        while ((n = source.read(block)) != -1) if (n != 0) unexpected = true;
                        if (unexpected) throw new IOException("Unexpected bridge stdout");
                    } else consume.read(source);
                    return null;
                } catch (IOException | RuntimeException | Error error) {
                    running.destroy();
                    throw error;
                }
            });
            Thread reader = new Thread(reading, "starforge-output-" + callId);
            reader.setDaemon(true);
            reader.start();
            boolean complete;
            if (settings.callTimeout == 0) { process.waitFor(); complete = true; }
            else complete = process.waitFor(settings.callTimeout, TimeUnit.MILLISECONDS);
            if (!complete) stop(process, settings.cleanupGrace);
            Throwable consumerFailure = null;
            try { reading.get(settings.cleanupGrace + 5000, TimeUnit.MILLISECONDS); }
            catch (ExecutionException e) { consumerFailure = e.getCause(); }
            catch (TimeoutException e) { consumerFailure = e; }
            Map<String, Object> response;
            try { response = Json.object(Json.parse(readPrivate(directory.resolve("response.json"), settings.resultLimit))); }
            catch (IOException e) {
                throw new BuyerException(complete ? "JAVA_BRIDGE_RESULT_UNAVAILABLE" : "JAVA_CALL_TIMEOUT",
                    action, id, directory, null, null, consumerFailure == null ? e : consumerFailure);
            }
            boolean sameId = id == null ? response.get("id") == null : id.equals(response.get("id"));
            if (!SCHEMA.equals(response.get("schema")) || !callId.equals(response.get("callId")) ||
                !action.equals(response.get("action")) || !sameId || !(response.get("ok") instanceof Boolean))
                throw new BuyerException("JAVA_BRIDGE_RESPONSE_MISMATCH", action, id, directory, null, null, null);
            result = response.get("result");
            if (response.get("error") instanceof Map<?, ?>) nativeError = Json.object(response.get("error"));
            if (result == null && nativeError != null) result = nativeError.get("result");
            if (!complete)
                throw new BuyerException("JAVA_CALL_TIMEOUT", action, id, directory, result, nativeError, null);
            if (consumerFailure != null)
                throw new BuyerException("JAVA_OUTPUT_CONSUMER_FAILED", action, id, directory, result, nativeError, consumerFailure);
            if (!Boolean.TRUE.equals(response.get("ok"))) {
                String code = nativeError != null && nativeError.get("code") instanceof String
                    ? (String) nativeError.get("code") : "JAVA_NATIVE_OPERATION_FAILED";
                throw new BuyerException(code, action, id, directory, result, nativeError, null);
            }
            if (process.exitValue() != 0)
                throw new BuyerException("JAVA_BRIDGE_PROCESS_FAILED", action, id, directory, result, nativeError, null);
            clean(directory);
            succeeded = true;
            return result;
        } catch (InterruptedException e) {
            if (process != null) stop(process, settings.cleanupGrace);
            // Abort can finish a native publication before the bridge closes.
            // Read that exact sidecar before restoring the thread interruption.
            Thread.interrupted(); // Clear a second signal while reading the already-published sidecar.
            Map<String, Object> retained = retainedResponse(directory, settings, action, id, callId);
            if (retained != null) {
                result = retained.get("result");
                if (retained.get("error") instanceof Map<?, ?>) nativeError = Json.object(retained.get("error"));
                if (result == null && nativeError != null) result = nativeError.get("result");
            }
            Thread.currentThread().interrupt();
            throw new BuyerException("JAVA_CALL_INTERRUPTED", action, id, directory, result, nativeError, e);
        } catch (BuyerException e) { throw e; }
        catch (IOException | IllegalArgumentException e) {
            throw new BuyerException("JAVA_CALL_FAILED", action, id, directory, result, nativeError, e);
        } finally {
            if (process != null && process.isAlive()) stop(process, settings.cleanupGrace);
            if (shutdown != null) {
                try { Runtime.getRuntime().removeShutdownHook(shutdown); }
                catch (IllegalStateException ignored) { /* JVM shutdown owns the registered cleanup. */ }
            }
            if (reading != null && !reading.isDone()) reading.cancel(true);
            if (process != null && !succeeded) {
                try { process.getInputStream().close(); } catch (IOException ignored) {}
                try { process.getOutputStream().close(); } catch (IOException ignored) {}
            }
        }
    }
}
