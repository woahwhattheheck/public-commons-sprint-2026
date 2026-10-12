import io.starforge.buyer.AcquisitionResult;
import io.starforge.buyer.AcquisitionWorkspace;
import io.starforge.buyer.Buyer;
import io.starforge.buyer.BuyerException;
import io.starforge.buyer.Json;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.nio.file.attribute.PosixFilePermissions;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * Receives an original merchant request, reviews and initializes its native
 * acquisition, then optionally executes and delivers it through the same SDK.
 * See ../WORKFLOWS.md for the exact invocation and operating requirements.
 */
public final class CompleteRequest {
    public static void main(String[] args) throws Exception {
        if (args.length != 10 || !List.of("--prepare", "--execute").contains(args[9]))
            throw new IllegalArgumentException(
                "RUNTIME STATE CALLS WORKSPACE_JSON REQUEST_JSON ACCEPT_INDEX TOTAL_ATOMIC DAILY_ATOMIC NEW_OUTPUT --prepare|--execute");
        Path output = absolute(args[8]);
        Files.createDirectory(output, PosixFilePermissions.asFileAttribute(
            PosixFilePermissions.fromString("rwx------")));
        try {
            Buyer buyer = Buyer.builder(absolute(args[0]), absolute(args[1]))
                .callsDirectory(absolute(args[2])).approvalInput(args[9].equals("--execute")).build();
            Map<String, Object> selection = Json.object(Json.parse(Files.readAllBytes(absolute(args[3]))));
            AcquisitionWorkspace workspace = buyer.acquisitions(selection);
            Map<String, Object> received = record(output, "01-request", workspace.receiveRequest(absolute(args[4])));
            String requestId = Json.string(received, "id");
            Map<String, Object> reviewed = record(output, "02-review", workspace.reviewRequest(
                requestId, Integer.parseInt(args[5]), args[6], args[7]));
            String reviewHash = Json.string(Json.object(reviewed.get("review")), "reviewSha256");
            Map<String, Object> ready = record(output, "03-prepared",
                workspace.prepareRequest(requestId, reviewHash));
            Map<String, Object> manifest = Json.map(
                "schema", "stellar-forge.buyer-runbook.v1",
                "id", "java-customer-" + UUID.randomUUID(),
                "title", "Java customer request",
                "operations", List.of(Json.map("id", "purchase", "label", "Customer request",
                    "config", Json.string(ready, "configName"), "saveAs", "response.bin")));
            Map<String, Object> draft = record(output, "04-draft", workspace.save(manifest));
            Map<String, Object> initialized = record(output, "05-initialized", workspace.initialize(
                Json.string(draft, "id"), Json.integer(draft, "revision"), Json.string(draft, "reviewSha256")));
            String acquisitionId = Json.string(initialized, "acquisitionId");
            Map<String, Object> plan = record(output, "06-plan", workspace.inspect(acquisitionId));
            if (args[9].equals("--execute")) {
                record(output, "07-executed",
                    workspace.execute(acquisitionId, Json.string(plan, "planSha256")));
                record(output, "08-accounting", workspace.finalize(acquisitionId));
                record(output, "09-preview", workspace.preview(acquisitionId, "purchase"));
                record(output, "10-delivered",
                    workspace.download(acquisitionId, "purchase", output.resolve("response.bin")));
                record(output, "11-report",
                    workspace.export(acquisitionId, "json", output.resolve("acquisition.json")));
            }
            System.out.println(Json.stringify(Json.map("acquisitionId", acquisitionId,
                "outputDirectory", output.toString(), "mode", args[9].substring(2))));
        } catch (BuyerException error) {
            write(output.resolve("caller-error.json"), Json.map("code", error.code(),
                "action", error.action(), "operationId", error.operationId(),
                "invocationDirectory", error.invocationDirectory() == null ? null :
                    error.invocationDirectory().toString(),
                "nativeError", error.nativeError(), "result", error.result()));
            throw error;
        }
    }
    private static Map<String, Object> record(Path output, String name,
            AcquisitionResult result) throws IOException {
        write(output.resolve(name + ".json"), result.original());
        if (!result.ok() || !result.completionReported() || result.nativeResult() == null)
            throw new IOException("Inspect retained native outcome: " + name);
        return result.nativeResult();
    }
    private static Path absolute(String value) {
        Path path = Path.of(value);
        if (!path.isAbsolute()) throw new IllegalArgumentException("Absolute path required");
        return path.normalize();
    }
    private static void write(Path path, Object value) throws IOException {
        Files.createFile(path, PosixFilePermissions.asFileAttribute(
            PosixFilePermissions.fromString("rw-------")));
        Files.write(path, Json.bytes(value), StandardOpenOption.WRITE);
    }
}
