package io.starforge.buyer;

import java.io.IOException;
import java.nio.file.Path;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Objects;

/**
 * Complete customer acquisitions on the original native runbook.
 *
 * <p>Obtain this client from {@link Buyer#acquisitions(Map)}. Selection keys are
 * {@code directory}, {@code configsDirectory}, {@code operatorSettings},
 * {@code paidFileClaimEnvs}, {@code temporaryDirectory} and {@code resultLimit},
 * with the same meanings as the original Node AcquisitionWorkspace. Path values
 * in that map are strings; typed method paths are normalized by the buyer.
 * Construction does not create state, open a wallet or require a live workspace.
 *
 * <p>Every method invokes the original Node acquisition command through the shared
 * bridge. Original review hashes, plan hashes, claim environment names, terminal
 * approval, accounting and archive rules remain in that command. Atomic budget
 * amounts are decimal strings. A thread interruption cancels through the buyer's
 * native call handling; a {@link BuyerException} can retain the original
 * {@link BuyerException#result()} for inspection with {@link AcquisitionResult#from(Object)}.
 */
public final class AcquisitionWorkspace {
    private final Buyer buyer;
    private final Map<String, Object> workspaceOptions;

    AcquisitionWorkspace(Buyer buyer, Map<String, Object> workspaceOptions) {
        this.buyer = Objects.requireNonNull(buyer, "Buyer required");
        this.workspaceOptions = AcquisitionResult.snapshot(
            workspaceOptions == null ? Map.of() : workspaceOptions);
    }

    /** Immutable original workspace selection, including host-selected claim environment names. */
    public Map<String, Object> workspaceOptions() { return workspaceOptions; }

    /** Reads original drafts, acquisitions, requests, paid-file orders and configurations. */
    public AcquisitionResult state() throws IOException {
        return call("state", null, Map.of());
    }

    /** Attaches an existing original run directory to the selected workspace. */
    public AcquisitionResult attachRun(Path run) throws IOException {
        return call("attach", null, Json.map("run", path(run)));
    }

    /** Reads an original received request, including its review and prepared configuration. */
    public AcquisitionResult request(String id) throws IOException {
        return call("request", id(id), Map.of());
    }

    /** Receives an original request handoff using the native filename selection. */
    public AcquisitionResult receiveRequest(Path file) throws IOException {
        return receiveRequest(file, null);
    }

    /** Receives an original request handoff; null omits the optional filename. */
    public AcquisitionResult receiveRequest(Path file, String filename) throws IOException {
        Map<String, Object> options = Json.map("file", path(file));
        optional(options, "filename", filename);
        return call("receive", null, options);
    }

    /** Reviews the selected offer with exact decimal-string total and daily atomic budgets. */
    public AcquisitionResult reviewRequest(String id, int acceptIndex,
            String totalAtomic, String dailyAtomic) throws IOException {
        return call("review-request", id(id), Json.map("acceptIndex", acceptIndex,
            "totalAtomic", totalAtomic, "dailyAtomic", dailyAtomic));
    }

    /** Prepares the original request only against the supplied original review hash. */
    public AcquisitionResult prepareRequest(String id, String reviewSha256) throws IOException {
        return call("prepare-request", id(id), Json.map("reviewSha256", reviewSha256));
    }

    /** Reads an original paid-file order and the availability of receiver-selected claim names. */
    public AcquisitionResult paidFile(String id) throws IOException {
        return call("paid-file", id(id), Map.of());
    }

    /** Receives an original paid-file handoff using the native filename selection. */
    public AcquisitionResult receivePaidFile(Path file) throws IOException {
        return receivePaidFile(file, null);
    }

    /** Receives an original paid-file handoff; null omits the optional filename. */
    public AcquisitionResult receivePaidFile(Path file, String filename) throws IOException {
        Map<String, Object> options = Json.map("file", path(file));
        optional(options, "filename", filename);
        return call("receive-paid-file", null, options);
    }

    /**
     * Reviews an original paid-file order at the exact revision with decimal-string
     * budgets and a claim environment variable name. The claim value stays in the runtime environment.
     */
    public AcquisitionResult reviewPaidFile(String id, long expectedRevision,
            String totalAtomic, String dailyAtomic, String filename, String claimEnv) throws IOException {
        return call("review-paid-file", id(id), Json.map("expectedRevision", expectedRevision,
            "totalAtomic", totalAtomic, "dailyAtomic", dailyAtomic,
            "filename", filename, "claimEnv", claimEnv));
    }

    /** Prepares a paid-file order against its exact original review hash. */
    public AcquisitionResult preparePaidFile(String id, String reviewSha256) throws IOException {
        return call("prepare-paid-file", id(id), Json.map("reviewSha256", reviewSha256));
    }

    /**
     * Retrieves or resumes the selected original paid-file operation, pinned to both
     * configuration and handoff hashes. Interruption preserves the original transfer continuation.
     */
    public AcquisitionResult retrievePaidFile(String id, String only,
            String configSha256, String handoffSha256) throws IOException {
        return call("retrieve-paid-file", id(id), transfer(only, configSha256, handoffSha256));
    }

    /** Resets the exact selected original paid-file transfer after native hash and state checks. */
    public AcquisitionResult resetPaidFile(String id, String only,
            String configSha256, String handoffSha256) throws IOException {
        return call("reset-paid-file", id(id), transfer(only, configSha256, handoffSha256));
    }

    /** Publishes the original completed paid-file operation to the requested destination. */
    public AcquisitionResult downloadPaidFile(String id, String operationId,
            Path destination) throws IOException {
        return call("download-paid-file", id(id), Json.map("operationId", operationId,
            "destination", path(destination)));
    }

    /** Exports the original paid-file order to the requested destination. */
    public AcquisitionResult exportPaidFile(String id, Path destination) throws IOException {
        return call("export-paid-file", id(id), Json.map("destination", path(destination)));
    }

    /** Reads the original current draft without selecting a historical revision. */
    public AcquisitionResult draft(String id) throws IOException {
        return draft(id, null);
    }

    /** Reads the explicitly selected original draft revision, including revision zero. */
    public AcquisitionResult draft(String id, long revision) throws IOException {
        return draft(id, Long.valueOf(revision));
    }

    /** Reads an original draft; null omits revision, while zero is sent as zero. */
    public AcquisitionResult draft(String id, Long revision) throws IOException {
        Map<String, Object> options = new LinkedHashMap<>();
        optional(options, "revision", revision);
        return call("draft", id(id), options);
    }

    /** Saves an original manifest with the original native default expected revision of zero. */
    public AcquisitionResult save(Map<String, Object> manifest) throws IOException {
        return save(null, null, manifest);
    }

    /** Saves an original manifest against an explicit expected revision, including zero. */
    public AcquisitionResult save(String id, long expectedRevision,
            Map<String, Object> manifest) throws IOException {
        return save(id, Long.valueOf(expectedRevision), manifest);
    }

    /**
     * Saves an original manifest. Null id omits the separate workspace ID; null
     * expectedRevision uses the native default, while an explicit zero is retained.
     * The original manifest, including its own id and operation configuration paths,
     * is passed unchanged.
     */
    public AcquisitionResult save(String id, Long expectedRevision,
            Map<String, Object> manifest) throws IOException {
        Map<String, Object> options = Json.map("manifest",
            Objects.requireNonNull(manifest, "Manifest required"));
        optional(options, "expectedRevision", expectedRevision);
        return call("save", id == null ? null : id(id), options);
    }

    /** Initializes an original acquisition only from the exact reviewed draft revision and hash. */
    public AcquisitionResult initialize(String id, long expectedRevision,
            String reviewSha256) throws IOException {
        return call("initialize", id(id), Json.map("expectedRevision", expectedRevision,
            "reviewSha256", reviewSha256));
    }

    /** Inspects the original run, operations, execution lock and accounting state. */
    public AcquisitionResult inspect(String id) throws IOException {
        return call("inspect", id(id), Map.of());
    }

    /** Executes the exact reviewed original plan, retaining the native controlling-terminal approval. */
    public AcquisitionResult execute(String id, String expectedPlanSha256) throws IOException {
        return execute(id, expectedPlanSha256, null);
    }

    /**
     * Executes the exact reviewed original plan, optionally selecting one original operation.
     * Null only is omitted. Native terminal approval remains part of execution.
     */
    public AcquisitionResult execute(String id, String expectedPlanSha256,
            String only) throws IOException {
        Map<String, Object> options = Json.map("expectedPlanSha256", expectedPlanSha256);
        optional(options, "only", only);
        return call("execute", id(id), options);
    }

    /** Continues original recovery for the selected acquisition. */
    public AcquisitionResult recover(String id) throws IOException {
        return call("recover", id(id), Map.of());
    }

    /** Requests native execution-lock recovery against the exact recorded owner process ID. */
    public AcquisitionResult unlock(String id, long ownerPid) throws IOException {
        return call("unlock", id(id), Json.map("ownerPid", ownerPid));
    }

    /** Finalizes the original acquisition using its existing accounting state. */
    public AcquisitionResult finalize(String id) throws IOException {
        return finalize(id, null);
    }

    /** Finalizes original accounting, optionally selecting one operation; null omits the selection. */
    public AcquisitionResult finalize(String id, String only) throws IOException {
        Map<String, Object> options = new LinkedHashMap<>();
        optional(options, "only", only);
        return call("finalize", id(id), options);
    }

    /** Binds the selected original operation to the original accounting workspace. */
    public AcquisitionResult bindAccounting(String id, String only, Path workspace) throws IOException {
        return call("bind-accounting", id(id), Json.map("only", only, "workspace", path(workspace)));
    }

    /** Reads the original saved-output preview for the selected operation. */
    public AcquisitionResult preview(String id, String operationId) throws IOException {
        return call("preview", id(id), Json.map("operationId", operationId));
    }

    /** Publishes the selected original operation's output to the requested destination. */
    public AcquisitionResult download(String id, String operationId, Path destination) throws IOException {
        return call("download", id(id), Json.map("operationId", operationId,
            "destination", path(destination)));
    }

    /** Exports the original acquisition report in native {@code json}, {@code html} or {@code csv} format. */
    public AcquisitionResult export(String id, String format, Path destination) throws IOException {
        return call("export", id(id), Json.map("format", format, "destination", path(destination)));
    }

    /** Exports the original request {@code body} or {@code handoff}, selected by kind. */
    public AcquisitionResult exportRequest(String id, String kind, Path destination) throws IOException {
        return call("export-request", id(id), Json.map("kind", kind, "destination", path(destination)));
    }

    /** Reviews the exact original acquisition state root before backup. */
    public AcquisitionResult backupReview(Path stateRoot) throws IOException {
        return call("backup-review", null, Json.map("stateRoot", path(stateRoot)));
    }

    /** Backs up the reviewed original state; the caller must explicitly report quiesced=true. */
    public AcquisitionResult backup(Path stateRoot, Path output, String reviewSha256,
            boolean quiesced) throws IOException {
        return backup(stateRoot, output, reviewSha256, quiesced, null);
    }

    /**
     * Backs up the reviewed original state with explicit caller-reported quiescence.
     * The original command enforces quiesced=true and the exact review hash.
     * passphraseEnv is an optional environment variable name, never the passphrase value.
     */
    public AcquisitionResult backup(Path stateRoot, Path output, String reviewSha256,
            boolean quiesced, String passphraseEnv) throws IOException {
        Map<String, Object> options = Json.map("stateRoot", path(stateRoot), "output", path(output),
            "reviewSha256", reviewSha256, "quiesced", quiesced);
        optional(options, "passphraseEnv", passphraseEnv);
        return call("backup", null, options);
    }

    /** Verifies an original archive, including when its live receiving workspace is absent. */
    public AcquisitionResult verify(Path bundle) throws IOException {
        return verify(bundle, null, null, null);
    }

    /**
     * Verifies an original archive, optionally pinned to its record hash and using
     * a named passphrase environment variable or receiver-selected Python interpreter.
     * Null options are omitted. No live receiving workspace is required.
     */
    public AcquisitionResult verify(Path bundle, String expectedRecordSha256,
            String passphraseEnv, Path python) throws IOException {
        return call("verify", null, archive(bundle, expectedRecordSha256, passphraseEnv, python));
    }

    /** Restores the original archive to its recorded canonical state root. */
    public AcquisitionResult restore(Path bundle) throws IOException {
        return restore(bundle, null, null, null);
    }

    /**
     * Restores an original archive to its recorded canonical state root, preserving
     * optional expected record hash, passphrase environment name and Python interpreter.
     * Construction and restoration do not require the original source to remain present.
     */
    public AcquisitionResult restore(Path bundle, String expectedRecordSha256,
            String passphraseEnv, Path python) throws IOException {
        return call("restore", null, archive(bundle, expectedRecordSha256, passphraseEnv, python));
    }

    private AcquisitionResult call(String command, String id,
            Map<String, Object> options) throws IOException {
        return AcquisitionResult.from(buyer.invoke("acquisitions." + command, id,
            Json.map("workspace", workspaceOptions, "options", AcquisitionResult.snapshot(options))));
    }

    private static Map<String, Object> transfer(String only, String configSha256,
            String handoffSha256) {
        return Json.map("only", only, "configSha256", configSha256, "handoffSha256", handoffSha256);
    }

    private static Map<String, Object> archive(Path bundle, String expectedRecordSha256,
            String passphraseEnv, Path python) {
        Map<String, Object> options = Json.map("bundle", path(bundle));
        optional(options, "expectedRecordSha256", expectedRecordSha256);
        optional(options, "passphraseEnv", passphraseEnv);
        if (python != null) options.put("python", path(python));
        return options;
    }

    private static void optional(Map<String, Object> options, String name, Object value) {
        if (value != null) options.put(name, value);
    }

    private static String path(Path value) {
        return NativeCall.absolute(Objects.requireNonNull(value, "Path required")).toString();
    }

    private static String id(String value) {
        if (value == null || value.isBlank()) throw new IllegalArgumentException("Acquisition ID required");
        return value;
    }
}
