package io.starforge.buyer;

import java.io.IOException;
import java.nio.file.Path;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Optional;

/** The maintained native inbox, using its existing directory and intent identities. */
public final class Inbox {
    private final Buyer buyer;
    private final Path directory;
    Inbox(Buyer buyer, Path directory) { this.buyer = buyer; this.directory = directory; }
    public Path directory() { return directory; }
    private Object call(String action, String id, Map<String, Object> arguments) throws IOException {
        Map<String, Object> args = arguments == null ? new LinkedHashMap<>() : new LinkedHashMap<>(arguments);
        args.put("directory", directory.toString());
        return buyer.invoke(action, id, args);
    }
    public Object list() throws IOException { return call("inbox.list", null, null); }
    public Object show(String id) throws IOException { return call("inbox.show", id, null); }
    public Object enqueue(Operation operation) throws IOException {
        if (operation.buyer != buyer) throw new IllegalArgumentException("Operation belongs to another buyer");
        return call("inbox.enqueue", operation.intentId(), null);
    }
    public Object enqueueConfig(Path config) throws IOException {
        return call("inbox.enqueue-config", null, Json.map("configFile", NativeCall.absolute(config).toString()));
    }
    public Map<String, Object> review(String id) throws IOException { return Json.object(call("inbox.review", id, null)); }
    public Object execute(String id, Map<String, Object> review, Path workspace) throws IOException {
        Map<String, Object> options = Json.map("review", review);
        if (workspace != null) options.put("workspaceDirectory", NativeCall.absolute(workspace).toString());
        return call("inbox.execute", id, Json.map("options", options));
    }
    public Object cancel(String id) throws IOException { return call("inbox.cancel", id, null); }
    public Object recover(String id) throws IOException { return call("inbox.recover", id, null); }
    public Object finalizeAccounting(String id, Map<String, Object> options) throws IOException {
        return call("inbox.finalize", id, Json.map("options", options));
    }
    public Object exportReport(Path destination, Path workspace) throws IOException {
        Map<String, Object> args = Json.map("destination", NativeCall.absolute(destination).toString());
        if (workspace != null) args.put("options", Json.map("workspaceDirectory", NativeCall.absolute(workspace).toString()));
        return call("inbox.report", null, args);
    }
    public Optional<Map<String, Object>> response(String id) throws IOException {
        Object value = call("inbox.response", id, null);
        return value == null ? Optional.empty() : Optional.of(Json.object(value));
    }
    public NativeFile file(String id) {
        return new NativeFile(buyer, Json.map("kind", "inbox", "directory", directory.toString(), "id", id));
    }
}
