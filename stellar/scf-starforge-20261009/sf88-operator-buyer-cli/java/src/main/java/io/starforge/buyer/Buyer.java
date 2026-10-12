package io.starforge.buyer;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.ArrayList;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;

/** Java customer SDK over the selected, maintained Stellar Forge Node buyer. */
public final class Buyer {
    final Settings settings;
    Buyer(Settings settings) { this.settings = settings; }

    public static Builder builder(Path runtimeDirectory, Path stateDirectory) {
        return new Builder(runtimeDirectory, stateDirectory);
    }
    public Path runtimeDirectory() { return settings.runtime; }
    public Path stateDirectory() { return settings.state; }

    static final class Settings {
        final Path runtime, state, bridge, profile;
        final String node;
        final Map<String, String> environment;
        final boolean approvalInput;
        final long nativeTimeout, cleanupGrace, callTimeout;
        final int outputLimit, resultLimit;
        Settings(Builder b) {
            runtime = b.runtime; state = b.state;
            bridge = b.bridge == null ? runtime.resolve("go/bridge.mjs") : b.bridge;
            profile = b.profile; node = b.node;
            environment = b.environment == null ? null : Map.copyOf(b.environment);
            approvalInput = b.approvalInput;
            nativeTimeout = b.nativeTimeout; cleanupGrace = b.cleanupGrace; callTimeout = b.callTimeout;
            outputLimit = b.outputLimit; resultLimit = b.resultLimit;
        }
    }
    public static final class Builder {
        private final Path runtime, state;
        private Path bridge, profile;
        private String node = "node";
        private Map<String, String> environment;
        private boolean approvalInput;
        private long nativeTimeout = 360000, cleanupGrace = 15000, callTimeout;
        private int outputLimit = 1048576, resultLimit = 67108864;

        private Builder(Path runtime, Path state) {
            this.runtime = NativeCall.absolute(runtime); this.state = NativeCall.absolute(state);
        }
        public Builder node(String executable) {
            if (executable == null || executable.isBlank() || executable.indexOf('\0') >= 0)
                throw new IllegalArgumentException("Node executable required");
            node = executable; return this;
        }
        public Builder bridge(Path path) { bridge = NativeCall.absolute(path); return this; }
        public Builder operatorProfile(Path path) { profile = NativeCall.absolute(path); return this; }
        /** An explicit environment replaces inheritance. Values only enter the child environment. */
        public Builder environment(Map<String, String> values) { environment = Map.copyOf(values); return this; }
        /** Inherits the caller's real stdin for the original approval terminal. */
        public Builder approvalInput(boolean inherit) { approvalInput = inherit; return this; }
        public Builder nativeTimeout(Duration timeout) { nativeTimeout = nativeMillis(timeout); return this; }
        public Builder cleanupGrace(Duration timeout) { cleanupGrace = nativeMillis(timeout); return this; }
        /** Zero means no Java call deadline; the original per-command native deadline still applies. */
        public Builder callTimeout(Duration timeout) {
            Objects.requireNonNull(timeout); callTimeout = timeout.toMillis();
            if (callTimeout < 0 || (!timeout.isZero() && callTimeout == 0))
                throw new IllegalArgumentException("Call timeout must be zero or at least one millisecond");
            return this;
        }
        public Builder nativeOutputLimit(int bytes) { outputLimit = limit(bytes); return this; }
        public Builder resultLimit(int bytes) { resultLimit = limit(bytes); return this; }
        private static long nativeMillis(Duration value) {
            long millis = Objects.requireNonNull(value).toMillis();
            if (millis < 1 || millis > Integer.MAX_VALUE) throw new IllegalArgumentException("Native time limit");
            return millis;
        }
        private static int limit(int value) {
            if (value < 1 || value > 268435456) throw new IllegalArgumentException("Limit must be 1 byte to 256 MiB");
            return value;
        }
        public Buyer build() throws IOException {
            Settings selected = new Settings(this);
            for (Path source : List.of(selected.bridge, runtime.resolve("node/index.mjs")))
                if (!Files.isRegularFile(source)) throw new IOException("Original buyer runtime file required: " + source);
            return new Buyer(selected);
        }
    }

    /** Request body null is absent; an empty byte array is an explicit zero-byte body. */
    public static final class CreateOptions {
        private final Map<String, Object> values = new LinkedHashMap<>();
        public CreateOptions body(byte[] bytes) {
            if (bytes == null) values.remove("bodyBase64");
            else values.put("bodyBase64", Base64.getEncoder().encodeToString(bytes));
            return this;
        }
        public CreateOptions responseFile(Map<String, Object> options) {
            values.put("responseFile", new LinkedHashMap<>(options)); return this;
        }
        public CreateOptions operatorProfile(Path path) {
            values.put("operatorProfile", NativeCall.absolute(path).toString()); return this;
        }
        public CreateOptions requestTimeout(Duration timeout) {
            long millis = timeout.toMillis();
            if (millis < 1 || millis > 300000) throw new IllegalArgumentException("Request timeout: 1–300000 ms");
            values.put("requestTimeoutMs", millis); return this;
        }
        public Map<String, Object> toJson() { return new LinkedHashMap<>(values); }
    }
    public record OperationInfo(String intentId, Path directory, Map<String, Object> original) {}
    public record AcquisitionInfo(String id, Path directory, Map<String, Object> original) {}

    Object invoke(String action, String id, Map<String, Object> args) throws IOException {
        return NativeCall.invoke(settings, action, id, args, null);
    }
    Object stream(String action, Map<String, Object> args, NativeCall.Consumer reader) throws IOException {
        return NativeCall.invoke(settings, action, null, args, reader);
    }
    public Map<String, Object> ready() throws IOException { return Json.object(invoke("buyer.ready", null, null)); }
    public List<OperationInfo> list() throws IOException {
        List<OperationInfo> results = new ArrayList<>();
        for (Object entry : Json.array(invoke("buyer.list", null, null))) {
            Map<String, Object> value = Json.object(entry);
            results.add(new OperationInfo(Json.string(value, "intentId"), Path.of(Json.string(value, "directory")), value));
        }
        return List.copyOf(results);
    }
    public Operation operation(String intentId) {
        if (intentId == null || intentId.isBlank()) throw new IllegalArgumentException("Intent ID required");
        return new Operation(this, intentId);
    }
    private Operation created(String action, Map<String, Object> args) throws IOException {
        return operation(Json.string(Json.object(invoke(action, null, args)), "intentId"));
    }
    public Operation create(Map<String, Object> config, CreateOptions options) throws IOException {
        return created("buyer.create", Json.map("config", config, "options", options.toJson()));
    }
    public Operation create(Path config, CreateOptions options) throws IOException {
        return created("buyer.create", Json.map("configFile", NativeCall.absolute(config).toString(), "options", options.toJson()));
    }
    public Operation request(Map<String, Object> request, CreateOptions options) throws IOException {
        return created("buyer.request", Json.map("request", request, "options", options.toJson()));
    }
    public Operation importOperation(Path file, int accept, CreateOptions options) throws IOException {
        if (accept < 0) throw new IllegalArgumentException("Explicit nonnegative payment option required");
        Map<String, Object> selected = options.toJson();
        if (selected.containsKey("bodyBase64")) throw new IllegalArgumentException("Handoff retains its original body");
        selected.put("accept", accept);
        return created("buyer.import", Json.map("file", NativeCall.absolute(file).toString(), "options", selected));
    }
    public Operation prepare(Map<String, Object> options) throws IOException { return created("buyer.prepare", options); }
    public Object discover(Map<String, Object> catalog, Path destination) throws IOException {
        Map<String, Object> args = Json.map("catalog", catalog);
        if (destination != null) args.put("destination", NativeCall.absolute(destination).toString());
        return invoke("buyer.discover", null, args);
    }
    public Object inspectHandoff(Path file, Integer accept) throws IOException {
        Map<String, Object> args = Json.map("file", NativeCall.absolute(file).toString());
        if (accept != null) {
            if (accept < 0) throw new IllegalArgumentException("Nonnegative selection required");
            args.put("options", Json.map("accept", accept));
        }
        return invoke("buyer.inspect-handoff", null, args);
    }
    public Inbox inbox(Path directory) { return new Inbox(this, NativeCall.absolute(directory)); }
    public Inbox createInbox(Path directory) throws IOException {
        Inbox value = inbox(directory);
        invoke("buyer.create-inbox", null, Json.map("directory", value.directory().toString()));
        return value;
    }
    public Acquisition.ObjectFile object(String id) { return new Acquisition.ObjectFile(this, id); }
    public Acquisition.Dataset dataset(String id) { return new Acquisition.Dataset(this, id); }
    public Acquisition.ObjectFile createObject(Map<String, Object> nativeOptions) throws IOException {
        return object(Json.string(Json.object(invoke("object.create", null, nativeOptions)), "id"));
    }
    public Acquisition.Dataset createDataset(Map<String, Object> nativeOptions) throws IOException {
        return dataset(Json.string(Json.object(invoke("dataset.create", null, nativeOptions)), "id"));
    }
    public Acquisition.ObjectFile attachObject(String id, Path session, boolean accountingOnly) throws IOException {
        return object(Json.string(Json.object(invoke("object.attach", null,
            Json.map("id", id, "directory", NativeCall.absolute(session).toString(), "accountingOnly", accountingOnly))), "id"));
    }
    public Acquisition.Dataset attachDataset(String id, Path session, boolean accountingOnly) throws IOException {
        return dataset(Json.string(Json.object(invoke("dataset.attach", null,
            Json.map("id", id, "directory", NativeCall.absolute(session).toString(), "accountingOnly", accountingOnly))), "id"));
    }
    private List<AcquisitionInfo> acquisitions(String action) throws IOException {
        List<AcquisitionInfo> values = new ArrayList<>();
        for (Object entry : Json.array(invoke(action, null, null))) {
            Map<String, Object> value = Json.object(entry);
            values.add(new AcquisitionInfo(Json.string(value, "id"), Path.of(Json.string(value, "directory")), value));
        }
        return List.copyOf(values);
    }
    public List<AcquisitionInfo> objects() throws IOException { return acquisitions("object.list"); }
    public List<AcquisitionInfo> datasets() throws IOException { return acquisitions("dataset.list"); }
    public NativeFile response(Map<String, Object> record, Map<String, Object> responseFile) {
        return new NativeFile(this, Json.map("kind", "response", "record", record, "responseFile", responseFile));
    }
}
