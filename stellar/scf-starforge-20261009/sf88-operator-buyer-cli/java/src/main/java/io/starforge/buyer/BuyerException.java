package io.starforge.buyer;

import java.io.IOException;
import java.nio.file.Path;
import java.util.Map;

/** A failed Java invocation with its original native result and private diagnostics. */
public final class BuyerException extends IOException {
    private final String code, action, operationId;
    private final Path invocationDirectory;
    private final Object result;
    private final Map<String, Object> nativeError;

    BuyerException(String code, String action, String operationId, Path directory,
                   Object result, Map<String, Object> nativeError, Throwable cause) {
        super(code + " (action=" + action + ", id=" + operationId + ", invocation=" + directory + ")", cause);
        this.code = code; this.action = action; this.operationId = operationId;
        this.invocationDirectory = directory; this.result = result;
        this.nativeError = nativeError == null ? Map.of() : nativeError;
    }
    public String code() { return code; }
    public String action() { return action; }
    public String operationId() { return operationId; }
    public Path invocationDirectory() { return invocationDirectory; }
    public Object result() { return result; }
    public Map<String, Object> nativeError() { return nativeError; }
}
