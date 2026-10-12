package io.starforge.buyer;

import java.io.IOException;
import java.math.BigDecimal;
import java.math.BigInteger;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Original acquisition completion and process outcome, including interrupted calls.
 * Native publication may have completed even when {@link #ok()} is false.
 * Unknown native fields and exact JSON numbers remain available in {@link #original()}.
 */
public final class AcquisitionResult {
    private final Map<String, Object> original;
    private final Map<String, Object> nativeResult;
    private final String command;
    private final String commandId;
    private final boolean completionReported;
    private final boolean ok;
    private final Process process;

    private AcquisitionResult(Map<String, Object> value) throws IOException {
        original = value;
        command = Json.string(value, "command");
        commandId = Json.string(value, "commandId");
        if (!value.containsKey("native")) throw new IOException("Native result field required");
        nativeResult = value.get("native") == null ? null : Json.object(value.get("native"));
        completionReported = bool(value, "completionReported");
        ok = bool(value, "ok");
        process = new Process(Json.object(value.get("process")));
    }

    /**
     * Wraps the original Node result, including the result retained by
     * {@link BuyerException#result()} after a failed or interrupted command.
     * This method preserves reported success; it does not infer it from file bytes.
     */
    public static AcquisitionResult from(Object value) throws IOException {
        try {
            return new AcquisitionResult(snapshot(Json.object(value)));
        } catch (IllegalArgumentException e) {
            throw new IOException("Invalid original acquisition result", e);
        }
    }

    /** Original native command name, for example {@code review-paid-file}. */
    public String command() { return command; }

    /** Original native command identity, independent of the Java bridge call identity. */
    public String commandId() { return commandId; }

    /** Complete immutable result, preserving unknown fields and exact numeric values. */
    public Map<String, Object> original() { return original; }

    /** Original native payload; null when no valid original completion record was available. */
    public Map<String, Object> nativeResult() { return nativeResult; }

    /** Original completion flag; false does not mean that no state was published. */
    public boolean completionReported() { return completionReported; }

    /** Original overall result flag, including native, process, cancellation and cleanup outcomes. */
    public boolean ok() { return ok; }

    /** Original process diagnostics, kept separate from the native completion payload. */
    public Process process() { return process; }

    /** A compact description that does not include native payloads or file contents. */
    @Override public String toString() {
        return "AcquisitionResult[command=" + command + ", commandId=" + commandId
            + ", completionReported=" + completionReported + ", ok=" + ok + "]";
    }

    /** Original native process outcome. Nullable values retain their original meaning. */
    public static final class Process {
        private final Map<String, Object> original;
        private final Long exitCode;
        private final String exitSignal;
        private final boolean started;
        private final String errorCode;
        private final String nativeErrorCode;
        private final String cleanupErrorCode;
        private final boolean callerCancelled;
        private final boolean interrupted;

        private Process(Map<String, Object> value) throws IOException {
            original = value;
            if (!value.containsKey("exitCode")) throw new IOException("Process exitCode required");
            exitCode = value.get("exitCode") == null ? null : Json.integer(value, "exitCode");
            exitSignal = nullableString(value, "exitSignal");
            started = bool(value, "started");
            errorCode = nullableString(value, "errorCode");
            nativeErrorCode = nullableString(value, "nativeErrorCode");
            cleanupErrorCode = nullableString(value, "cleanupErrorCode");
            callerCancelled = bool(value, "callerCancelled");
            interrupted = bool(value, "interrupted");
        }

        /** Complete immutable process record, including future native fields. */
        public Map<String, Object> original() { return original; }

        /** Original exit code; null when the process has no reported exit code. */
        public Long exitCode() { return exitCode; }

        /** Original terminating signal, or null. */
        public String exitSignal() { return exitSignal; }

        /** Whether the original native process started. */
        public boolean started() { return started; }

        /** Original process or result-reading failure code, or null. */
        public String errorCode() { return errorCode; }

        /** Original command failure code, or null. */
        public String nativeErrorCode() { return nativeErrorCode; }

        /** Original cleanup failure code, or null. */
        public String cleanupErrorCode() { return cleanupErrorCode; }

        /** Whether the caller cancelled the original command. */
        public boolean callerCancelled() { return callerCancelled; }

        /** Original interruption flag, including cancellation, signal and timeout. */
        public boolean interrupted() { return interrupted; }
    }

    private static boolean bool(Map<String, Object> value, String key) throws IOException {
        Object field = value.get(key);
        if (!(field instanceof Boolean)) throw new IOException("Boolean field required: " + key);
        return (Boolean) field;
    }

    private static String nullableString(Map<String, Object> value, String key) throws IOException {
        if (!value.containsKey(key)) throw new IOException("Process field required: " + key);
        return value.get(key) == null ? null : Json.string(value, key);
    }

    /** Copies JSON data without a text round trip or numeric coercion. */
    static Map<String, Object> snapshot(Map<String, Object> value) {
        @SuppressWarnings("unchecked")
        Map<String, Object> copy = (Map<String, Object>) freeze(value, 0);
        return copy;
    }

    private static Object freeze(Object value, int depth) {
        if (depth > 128) throw new IllegalArgumentException("JSON nesting limit");
        if (value == null || value instanceof String || value instanceof Boolean) return value;
        if (value instanceof Byte || value instanceof Short || value instanceof Integer
            || value instanceof Long || value instanceof BigInteger || value instanceof BigDecimal)
            return value;
        if (value instanceof Float number && Float.isFinite(number)) return value;
        if (value instanceof Double number && Double.isFinite(number)) return value;
        if (value instanceof Map<?, ?> object) {
            Map<String, Object> copy = new LinkedHashMap<>();
            for (Map.Entry<?, ?> entry : object.entrySet()) {
                if (!(entry.getKey() instanceof String key))
                    throw new IllegalArgumentException("String JSON key required");
                copy.put(key, freeze(entry.getValue(), depth + 1));
            }
            return Collections.unmodifiableMap(copy);
        }
        if (value instanceof Iterable<?> array) {
            List<Object> copy = new ArrayList<>();
            for (Object item : array) copy.add(freeze(item, depth + 1));
            return Collections.unmodifiableList(copy);
        }
        throw new IllegalArgumentException("Unsupported JSON value");
    }
}
