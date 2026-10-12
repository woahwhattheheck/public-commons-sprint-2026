package io.starforge.buyer;

import java.io.IOException;
import java.nio.file.Path;
import java.util.LinkedHashMap;
import java.util.Map;

/** Original whole-object and paged-dataset workflows. All budget amounts are decimal strings. */
public final class Acquisition {
    private Acquisition() {}
    public abstract static class Session {
        final Buyer buyer;
        final String id, kind;
        Session(Buyer buyer, String id, String kind) {
            if (id == null || id.isBlank()) throw new IllegalArgumentException("Acquisition ID required");
            this.buyer = buyer; this.id = id; this.kind = kind;
        }
        public String id() { return id; }
        final Object call(String action, Map<String, Object> arguments) throws IOException {
            return buyer.invoke(kind + "." + action, id, arguments);
        }
        final Object command(String action, Map<String, Object> options) throws IOException {
            return call(action, Json.map("options", options == null ? Map.of() : options));
        }
        public Object initialize() throws IOException { return initialize(Map.of()); }
        public Object initialize(Map<String, Object> options) throws IOException { return command("initialize", options); }
        public Object inspect() throws IOException { return inspect(Map.of()); }
        public Object inspect(Map<String, Object> options) throws IOException { return command("inspect", options); }
        public Object run() throws IOException { return run(Map.of()); }
        public Object run(Map<String, Object> options) throws IOException { return command("run", options); }
        public Object recover() throws IOException { return recover(Map.of()); }
        public Object recover(Map<String, Object> options) throws IOException { return command("recover", options); }
        public Object accounting(Map<String, Object> options) throws IOException { return command("accounting", options); }
        public Object finalizeAccounting(Map<String, Object> options) throws IOException { return command("finalize", options); }
        public Object recoverAccounting(Map<String, Object> options) throws IOException { return command("recover-accounting", options); }
    }
    public record ObjectDelivery(Path path, Object assembly, boolean receiptRecorded,
                                 Object report, Map<String, Object> original) {
        static ObjectDelivery from(Object raw) throws IOException {
            Map<String, Object> value = Json.object(raw);
            return new ObjectDelivery(Path.of(Json.string(value, "path")), value.get("assembly"),
                Boolean.TRUE.equals(value.get("receiptRecorded")), value.get("report"), value);
        }
    }
    public record DatasetDelivery(Object report, Object manifest, Map<String, Object> original) {
        static DatasetDelivery from(Object raw) throws IOException {
            Map<String, Object> value = Json.object(raw);
            return new DatasetDelivery(value.get("report"), value.get("manifest"), value);
        }
    }
    public static final class ObjectFile extends Session {
        ObjectFile(Buyer buyer, String id) { super(buyer, id, "object"); }
        private ObjectDelivery delivery(String action, Path destination, Map<String, Object> options) throws IOException {
            Map<String, Object> args = Json.map("options", options == null ? Map.of() : options);
            if (destination != null) args.put("destination", NativeCall.absolute(destination).toString());
            return ObjectDelivery.from(call(action, args));
        }
        /** Acquires missing original chunks and assembles the complete object. */
        public ObjectDelivery download(Path destination, Map<String, Object> options) throws IOException {
            return delivery("download", destination, options);
        }
        public ObjectDelivery assemble(Path destination, Map<String, Object> options) throws IOException {
            return delivery("assemble", destination, options);
        }
        public ObjectDelivery delivery(Path destination, Map<String, Object> options) throws IOException {
            return delivery("delivery", destination, options);
        }
        public Object exportReport(Path destination, String format, Map<String, Object> options) throws IOException {
            if (!"json".equals(format) && !"html".equals(format)) throw new IllegalArgumentException("Report format json or html required");
            return call("report", Json.map("destination", NativeCall.absolute(destination).toString(),
                "format", format, "options", options == null ? Map.of() : options));
        }
        /** Selects an original assembled file path, or the latest assembly when null. */
        public NativeFile file(Path destination) {
            Map<String, Object> selection = Json.map("kind", "object", "id", id);
            if (destination != null) selection.put("destination", NativeCall.absolute(destination).toString());
            return new NativeFile(buyer, selection);
        }
    }
    public static final class Dataset extends Session {
        Dataset(Buyer buyer, String id) { super(buyer, id, "dataset"); }
        public DatasetDelivery deliver(Path destination) throws IOException {
            Map<String, Object> args = new LinkedHashMap<>();
            if (destination != null) args.put("destination", NativeCall.absolute(destination).toString());
            return DatasetDelivery.from(call("deliver", args));
        }
        public Object exportManifest(Path destination) throws IOException {
            return call("manifest", Json.map("destination", NativeCall.absolute(destination).toString()));
        }
        /** Selects an export in the original delivery directory. */
        public NativeFile file(Path directory, String name) {
            if (name == null || name.isBlank()) throw new IllegalArgumentException("Original dataset export name required");
            Map<String, Object> selection = Json.map("kind", "dataset", "id", id, "name", name);
            if (directory != null) selection.put("destination", NativeCall.absolute(directory).toString());
            return new NativeFile(buyer, selection);
        }
    }
}
