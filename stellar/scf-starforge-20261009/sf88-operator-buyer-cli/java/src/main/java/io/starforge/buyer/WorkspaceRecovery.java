package io.starforge.buyer;

import java.io.IOException;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;

/**
 * Complete workspace backup and restore through the original maintained Node API.
 * Opening a handle does not create buyer state. The authenticated archive selects
 * its original restore root; callers supply the name of a private environment variable.
 */
public final class WorkspaceRecovery {
    private final Buyer buyer;
    WorkspaceRecovery(Buyer buyer) { this.buyer = Objects.requireNonNull(buyer); }

    public record Selection(Path directory, Path stateRoot, List<Path> inboxes, List<Path> include) {
        public Selection {
            directory = canonical(directory); stateRoot = canonical(stateRoot);
            inboxes = paths(inboxes); include = paths(include);
        }
        public Selection(Path directory, Path stateRoot) { this(directory, stateRoot, List.of(), List.of()); }
        public Map<String, Object> toJson() {
            return Json.map("directory", directory.toString(), "stateRoot", stateRoot.toString(),
                "inboxes", strings(inboxes), "include", strings(include));
        }
    }
    public record Archive(Path bundle, String expectedRecordSha256, String passphraseEnv, Path python) {
        public Archive {
            bundle = canonical(bundle);
            if (expectedRecordSha256 != null && !expectedRecordSha256.matches("[a-f0-9]{64}"))
                throw new IllegalArgumentException("Expected archive record SHA-256 required");
            if (passphraseEnv != null) passphraseName(passphraseEnv);
            if (python != null) python = canonical(python);
        }
        public Archive(Path bundle, String expectedRecordSha256) {
            this(bundle, expectedRecordSha256, null, null);
        }
        public Map<String, Object> toJson() {
            Map<String, Object> result = Json.map("bundle", bundle.toString());
            if (expectedRecordSha256 != null) result.put("expectedRecordSha256", expectedRecordSha256);
            if (passphraseEnv != null) result.put("passphraseEnv", passphraseEnv);
            if (python != null) result.put("python", python.toString());
            return result;
        }
    }
    /** Adds the original Buyer.stateDirectory to the native include selection. */
    public WorkspaceRecoveryResult inspect(Selection selection) throws IOException {
        return inspect(selection.toJson());
    }
    public WorkspaceRecoveryResult inspect(Map<String, Object> options) throws IOException {
        return command("inspect", options);
    }
    public WorkspaceRecoveryResult snapshot(Selection selection, Path output, boolean quiesced,
                                             String passphraseEnv) throws IOException {
        Map<String, Object> options = selection.toJson();
        options.put("output", canonical(output).toString()); options.put("quiesced", quiesced);
        if (passphraseEnv != null) options.put("passphraseEnv", passphraseName(passphraseEnv));
        return snapshot(options);
    }
    /** Native snapshotting requires the caller's existing source writers to be quiescent. */
    public WorkspaceRecoveryResult snapshot(Map<String, Object> options) throws IOException {
        return command("snapshot", options);
    }
    /** Verifies the original authenticated archive with no live buyer state required. */
    public WorkspaceRecoveryResult verify(Archive archive) throws IOException { return verify(archive.toJson()); }
    public WorkspaceRecoveryResult verify(Map<String, Object> options) throws IOException {
        return command("verify", options);
    }
    /** Restores to the original authenticated root. Inspect a reported completion before recovery after errors. */
    public WorkspaceRecoveryResult restore(Archive archive) throws IOException { return restore(archive.toJson()); }
    public WorkspaceRecoveryResult restore(Map<String, Object> options) throws IOException {
        return command("restore", options);
    }
    private WorkspaceRecoveryResult command(String operation, Map<String, Object> options) throws IOException {
        return WorkspaceRecoveryResult.from(buyer.invoke("workspace-recovery." + operation, null,
            Json.map("options", new LinkedHashMap<>(Objects.requireNonNull(options)))));
    }
    private static Path canonical(Path value) {
        Path path = NativeCall.absolute(value);
        if (path.getParent() == null) throw new IllegalArgumentException("A non-root canonical path is required");
        return path;
    }
    private static List<Path> paths(List<Path> values) {
        if (values == null) return List.of();
        if (values.size() > 64) throw new IllegalArgumentException("At most 64 native roots per selection");
        List<Path> paths = new ArrayList<>();
        for (Path path : values) paths.add(canonical(path));
        return List.copyOf(paths);
    }
    private static List<String> strings(List<Path> paths) { return paths.stream().map(Path::toString).toList(); }
    private static String passphraseName(String value) {
        if (!value.matches("[A-Z][A-Z0-9_]{4,63}"))
            throw new IllegalArgumentException("Passphrase environment variable name required");
        return value;
    }
}
