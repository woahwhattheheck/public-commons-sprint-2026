package io.starforge.buyer;

import java.io.IOException;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

/** Original workspace completion, including a completed restore reported with a caller error. */
public final class WorkspaceRecoveryResult {
    public record Process(Integer exitCode, String exitSignal, String errorCode,
                          boolean started, String cleanupErrorCode, Map<String, Object> original) {}
    private final String operation;
    private final Map<String, Object> nativeResult, original;
    private final Process process;
    private final boolean completionReported, ok;

    private WorkspaceRecoveryResult(Map<String, Object> source) throws IOException {
        original = Json.object(freeze(source));
        operation = Json.string(original, "operation");
        if (!Set.of("inspect", "snapshot", "verify", "restore").contains(operation))
            throw new IOException("Original workspace recovery operation required");
        Object nativeValue = original.get("native");
        nativeResult = nativeValue == null ? null : Json.object(nativeValue);
        Map<String, Object> outcome = Json.object(original.get("process"));
        process = new Process(integer(outcome, "exitCode"), text(outcome, "exitSignal"),
            text(outcome, "errorCode"), flag(outcome, "started"), text(outcome, "cleanupErrorCode"), outcome);
        completionReported = flag(original, "completionReported");
        ok = flag(original, "ok");
    }
    /** Accepts a returned native result or BuyerException.result(). */
    public static WorkspaceRecoveryResult from(Object value) throws IOException {
        return new WorkspaceRecoveryResult(Json.object(value));
    }
    public String operation() { return operation; }
    public Map<String, Object> nativeResult() { return nativeResult; }
    public Process process() { return process; }
    public boolean completionReported() { return completionReported; }
    public boolean ok() { return ok; }
    public Map<String, Object> original() { return original; }
    private static boolean flag(Map<String, Object> value, String key) throws IOException {
        if (!(value.get(key) instanceof Boolean result)) throw new IOException("Boolean field required: " + key);
        return result;
    }
    private static String text(Map<String, Object> value, String key) throws IOException {
        return value.get(key) == null ? null : Json.string(value, key);
    }
    private static Integer integer(Map<String, Object> value, String key) throws IOException {
        if (value.get(key) == null) return null;
        long result = Json.integer(value, key);
        if (result < Integer.MIN_VALUE || result > Integer.MAX_VALUE) throw new IOException("Process integer range");
        return (int) result;
    }
    private static Object freeze(Object value) throws IOException {
        if (value instanceof Map<?, ?>) {
            Map<String, Object> result = new LinkedHashMap<>();
            for (var entry : Json.object(value).entrySet()) result.put(entry.getKey(), freeze(entry.getValue()));
            return Collections.unmodifiableMap(result);
        }
        if (value instanceof List<?> values) {
            List<Object> result = new ArrayList<>();
            for (Object item : values) result.add(freeze(item));
            return Collections.unmodifiableList(result);
        }
        return value;
    }
}
