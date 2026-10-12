package io.starforge.buyer;

import java.io.IOException;
import java.util.Map;
import java.util.Optional;

/** Address of one stable intent in the original Node application's state. */
public final class Operation {
    final Buyer buyer;
    private final String id;
    Operation(Buyer buyer, String id) { this.buyer = buyer; this.id = id; }
    public String intentId() { return id; }
    public Map<String, Object> review() throws IOException {
        return Json.object(buyer.invoke("operation.review", id, null));
    }
    public State inspect() throws IOException {
        Map<String, Object> value = Json.object(buyer.invoke("operation.inspect", id, null));
        return new State(Json.string(value, "intentId"), Json.string(value, "state"),
            Boolean.TRUE.equals(value.get("resultRecoverable")), value);
    }
    public Result execute(Map<String, Object> originalReview) throws IOException {
        return Result.from(buyer.invoke("operation.execute", id, Json.map("review", originalReview)));
    }
    /** Reconciles this original attempt; empty means no complete result is available yet. */
    public Optional<Result> recover() throws IOException {
        Object value = buyer.invoke("operation.recover", id, null);
        return value == null ? Optional.empty() : Optional.of(Result.from(value));
    }
    public NativeFile file() { return new NativeFile(buyer, Json.map("kind", "operation", "id", id)); }

    public record State(String intentId, String state, boolean resultRecoverable,
                        Map<String, Object> original) {}
    public record Result(boolean ok, String status, Object record, Object nativeOutcome,
                         Object delivery, Object stream, Map<String, Object> original) {
        static Result from(Object raw) throws IOException {
            Map<String, Object> value = Json.object(raw);
            return new Result(Boolean.TRUE.equals(value.get("ok")), Json.string(value, "status"),
                value.get("record"), value.get("native"), value.get("delivery"), value.get("stream"), value);
        }
    }
}
