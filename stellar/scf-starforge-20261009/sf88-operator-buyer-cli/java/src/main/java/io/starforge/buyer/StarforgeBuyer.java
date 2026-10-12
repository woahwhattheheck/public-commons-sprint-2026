package io.starforge.buyer;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Set;

/** Command-line entry for the same native buyer methods exposed by the Java SDK. */
public final class StarforgeBuyer {
    private StarforgeBuyer() {}
    public static void main(String[] argv) {
        try { run(argv); }
        catch (BuyerException e) {
            System.err.println(Json.stringify(Json.map("error", e.code(), "action", e.action(),
                "id", e.operationId(), "invocationDirectory",
                e.invocationDirectory() == null ? null : e.invocationDirectory().toString(),
                "nativeError", e.nativeError(), "result", e.result())));
            System.exit(2);
        } catch (IOException | IllegalArgumentException e) {
            System.err.println(Json.stringify(Json.map("error", "JAVA_BUYER_COMMAND_FAILED", "message", e.getMessage())));
            System.exit(2);
        }
    }
    static void run(String[] argv) throws IOException {
        Arguments a = Arguments.parse(argv);
        if (a.command == null || a.flag("help") || "help".equals(a.command)) { System.out.print(HELP); return; }
        Buyer.Builder builder = Buyer.builder(a.path("runtime"), a.path("state"));
        String node = a.take("node"); if (node != null) builder.node(node);
        Path profile = a.optionalPath("profile"); if (profile != null) builder.operatorProfile(profile);
        Path bridge = a.optionalPath("bridge"); if (bridge != null) builder.bridge(bridge);
        String timeout = a.take("timeout-ms"); if (timeout != null) builder.nativeTimeout(Duration.ofMillis(Long.parseLong(timeout)));
        String callTimeout = a.take("call-timeout-ms");
        if (callTimeout != null) builder.callTimeout(Duration.ofMillis(Long.parseLong(callTimeout)));
        builder.approvalInput(a.flag("approval-input"));
        Path savedResult = a.optionalPath("save-result");
        String command = a.command;
        String action, id = null;
        Map<String, Object> args = new LinkedHashMap<>();
        switch (command) {
            case "ready" -> action = "buyer.ready";
            case "list" -> action = "buyer.list";
            case "create" -> {
                action = "buyer.create"; args.put("configFile", a.path("config").toString());
                args.put("options", creationOptions(a));
            }
            case "request" -> {
                action = "buyer.request"; args.put("request", readObject(a.path("request")));
                args.put("options", creationOptions(a));
            }
            case "prepare" -> { action = "buyer.prepare"; args.putAll(a.object("options")); }
            case "discover" -> {
                action = "buyer.discover"; args.put("catalog", readObject(a.path("catalog")));
                destination(a, args);
            }
            case "import" -> {
                action = "buyer.import"; args.put("file", a.path("file").toString());
                Map<String, Object> options = a.optionalObject("options");
                int accept = a.integer("accept", -1);
                if (accept < 0) throw new IllegalArgumentException("--accept is required");
                options.put("accept", accept); args.put("options", options);
            }
            case "handoff" -> {
                action = "buyer.inspect-handoff"; args.put("file", a.path("file").toString());
                int accept = a.integer("accept", -1);
                if (accept >= 0) args.put("options", Json.map("accept", accept));
            }
            case "review", "inspect", "recover", "execute" -> {
                action = "operation." + command; id = a.required("id");
                if (command.equals("execute")) args.put("review", readObject(a.path("review")));
            }
            case "inbox-init" -> {
                action = "buyer.create-inbox"; args.put("directory", a.path("inbox").toString());
            }
            case "inbox-list", "inbox-show", "inbox-enqueue", "inbox-enqueue-config", "inbox-review",
                 "inbox-execute", "inbox-cancel", "inbox-recover", "inbox-finalize", "inbox-report",
                 "inbox-response" -> {
                action = "inbox." + command.substring(6);
                args.put("directory", a.path("inbox").toString());
                if (!Set.of("inbox-list", "inbox-enqueue-config", "inbox-report").contains(command)) id = a.required("id");
                if (command.equals("inbox-enqueue-config")) args.put("configFile", a.path("config").toString());
                if (command.equals("inbox-execute")) {
                    Map<String, Object> options = Json.map("review", readObject(a.path("review")));
                    Path workspace = a.optionalPath("workspace");
                    if (workspace != null) options.put("workspaceDirectory", workspace.toString());
                    args.put("options", options);
                }
                if (command.equals("inbox-finalize")) args.put("options", a.object("options"));
                if (command.equals("inbox-report")) {
                    args.put("destination", a.path("out").toString());
                    Path workspace = a.optionalPath("workspace");
                    if (workspace != null) args.put("options", Json.map("workspaceDirectory", workspace.toString()));
                }
            }
            case "object-list", "dataset-list" -> action = command.replace('-', '.');
            case "object-create", "dataset-create" -> {
                action = command.replace('-', '.'); args.putAll(a.object("options"));
            }
            case "object-attach", "dataset-attach" -> {
                action = command.replace('-', '.');
                args.put("id", a.required("id")); args.put("directory", a.path("session").toString());
                args.put("accountingOnly", a.flag("accounting-only"));
            }
            case "object-initialize", "object-inspect", "object-run", "object-recover",
                 "object-download", "object-assemble", "object-delivery", "object-report",
                 "object-accounting", "object-finalize", "object-recover-accounting",
                 "dataset-initialize", "dataset-inspect", "dataset-run", "dataset-recover",
                 "dataset-deliver", "dataset-manifest", "dataset-accounting",
                 "dataset-finalize", "dataset-recover-accounting" -> {
                int hyphen = command.indexOf('-');
                action = command.substring(0, hyphen) + "." + command.substring(hyphen + 1);
                id = a.required("id"); args.put("options", a.optionalObject("options"));
                if (Set.of("object-download", "object-assemble", "object-delivery", "object-report",
                        "dataset-deliver", "dataset-manifest").contains(command)) destination(a, args);
                if (command.equals("object-report")) args.put("format", a.takeOr("format", "html"));
            }
            case "file-verify", "file-copy", "file-read", "file-json", "file-records" -> {
                Buyer buyer = builder.build();
                NativeFile file = selectedFile(buyer, a);
                Path out = command.equals("file-copy") ? a.path("out") : null;
                int limit = command.equals("file-json") ? a.integer("limit", 8388608) : 0;
                NativeFile.Format format = command.equals("file-records") ? NativeFile.Format.from(a.required("format")) : null;
                Map<String, Object> options = command.equals("file-records") ? a.optionalObject("options") : Map.of();
                if (command.equals("file-records") && a.flag("partial")) options.put("allowPartial", true);
                if ((command.equals("file-read") || command.equals("file-records")) && savedResult != null)
                    throw new IllegalArgumentException("Stream metadata is written to stderr; use the native copy command to save bytes");
                a.finished();
                switch (command) {
                    case "file-verify" -> emit(file.verify().original(), savedResult);
                    case "file-copy" -> emit(file.saveAs(out).original(), savedResult);
                    case "file-json" -> emit(file.json(limit), savedResult);
                    case "file-read" -> {
                        NativeFile.Transfer transfer = file.writeTo(System.out);
                        System.out.flush();
                        if (System.out.checkError()) throw new IOException("Output closed");
                        System.err.println(Json.stringify(transfer.original()));
                    }
                    case "file-records" -> {
                        NativeFile.Transfer transfer = file.records(format, options,
                            record -> { System.out.println(Json.stringify(record)); if (System.out.checkError()) throw new IOException("Output closed"); });
                        System.err.println(Json.stringify(transfer.original()));
                    }
                    default -> throw new AssertionError();
                }
                return;
            }
            default -> throw new IllegalArgumentException("Unknown command: " + command);
        }
        a.finished();
        Object result = builder.build().invoke(action, id, args);
        emit(result, savedResult);
    }
    private static void emit(Object value, Path savedResult) throws IOException {
        byte[] bytes = (Json.stringify(value) + "\n").getBytes(java.nio.charset.StandardCharsets.UTF_8);
        System.out.write(bytes); System.out.flush();
        if (System.out.checkError()) throw new IOException("Result output closed; reopen the original operation");
        if (savedResult != null) NativeCall.writePrivate(savedResult, bytes);
    }
    private static Map<String, Object> creationOptions(Arguments a) throws IOException {
        Map<String, Object> options = a.optionalObject("options");
        Path body = a.optionalPath("body");
        if (body != null) {
            if (options.containsKey("bodyBase64")) throw new IllegalArgumentException("Body supplied twice");
            byte[] bytes = readBytes(body, 20 * 1024 * 1024);
            options.put("bodyBase64", java.util.Base64.getEncoder().encodeToString(bytes));
        }
        return options;
    }
    private static void destination(Arguments a, Map<String, Object> args) {
        Path destination = a.optionalPath("out");
        if (destination != null) args.put("destination", destination.toString());
    }
    private static NativeFile selectedFile(Buyer buyer, Arguments a) throws IOException {
        return switch (a.takeOr("kind", "operation")) {
            case "operation" -> buyer.operation(a.required("id")).file();
            case "inbox" -> buyer.inbox(a.path("inbox")).file(a.required("id"));
            case "object" -> buyer.object(a.required("id")).file(a.optionalPath("delivery"));
            case "dataset" -> buyer.dataset(a.required("id")).file(a.optionalPath("delivery"), a.required("file"));
            case "response" -> buyer.response(readObject(a.path("record")), readObject(a.path("response-config")));
            default -> throw new IllegalArgumentException("File kind must be operation, inbox, object, dataset or response");
        };
    }
    static byte[] readBytes(Path path, int limit) throws IOException {
        if (!Files.isRegularFile(path) || Files.size(path) > limit) throw new IOException("Input file exceeds selected limit");
        try (var input = Files.newInputStream(path)) {
            byte[] bytes = input.readNBytes(limit + 1);
            if (bytes.length > limit) throw new IOException("Input file exceeds selected limit");
            return bytes;
        }
    }
    private static Map<String, Object> readObject(Path path) throws IOException {
        return Json.object(Json.parse(readBytes(path, NativeCall.MAX_REQUEST)));
    }
    private static final class Arguments {
        String command;
        final Map<String, String> values = new LinkedHashMap<>();
        static Arguments parse(String[] argv) {
            Arguments out = new Arguments();
            Set<String> flags = Set.of("help", "approval-input", "accounting-only", "partial");
            for (int i = 0; i < argv.length; i++) {
                String arg = argv[i];
                if (!arg.startsWith("--")) {
                    if (out.command != null) throw new IllegalArgumentException("Unexpected argument: " + arg);
                    out.command = arg; continue;
                }
                String key = arg.substring(2);
                if (key.isBlank() || out.values.containsKey(key)) throw new IllegalArgumentException("Duplicate or empty option");
                if (flags.contains(key)) out.values.put(key, "true");
                else {
                    if (++i >= argv.length || argv[i].startsWith("--")) throw new IllegalArgumentException("Value required: --" + key);
                    out.values.put(key, argv[i]);
                }
            }
            return out;
        }
        String take(String key) { return values.remove(key); }
        String required(String key) {
            String value = take(key);
            if (value == null || value.isBlank()) throw new IllegalArgumentException("--" + key + " is required");
            return value;
        }
        String takeOr(String key, String fallback) { String value = take(key); return value == null ? fallback : value; }
        boolean flag(String key) { return "true".equals(take(key)); }
        Path path(String key) { return NativeCall.absolute(Path.of(required(key))); }
        Path optionalPath(String key) { String value = take(key); return value == null ? null : NativeCall.absolute(Path.of(value)); }
        int integer(String key, int fallback) { String value = take(key); return value == null ? fallback : Integer.parseInt(value); }
        Map<String, Object> object(String key) throws IOException { return readObject(path(key)); }
        Map<String, Object> optionalObject(String key) throws IOException {
            Path path = optionalPath(key); return path == null ? new LinkedHashMap<>() : readObject(path);
        }
        void finished() {
            if (!values.isEmpty()) throw new IllegalArgumentException("Unused options: " + String.join(", ", values.keySet()));
        }
    }
    private static final String HELP = """
        Starforge Java buyer — original native SF88 workflows

        java -jar starforge-buyer.jar --runtime ABS_SF88 --state ABS_PRIVATE_STATE [OPTIONS] COMMAND

        Runtime options:
          --node EXECUTABLE        Selected Node binary (default: node)
          --bridge ABS_FILE        Original go/bridge.mjs (default: runtime/go/bridge.mjs)
          --profile ABS_FILE       Original operator profile
          --approval-input         Inherit real stdin for the original native terminal
          --timeout-ms N           Original native command deadline (default: 360000)
          --call-timeout-ms N      Whole Java invocation deadline; 0 means no Java deadline
          --save-result ABS_NEW    Also write the exact JSON result to a new private file

        Buyer:
          ready | list
          create --config ABS [--body ABS] [--options ABS]
          request --request ABS [--body ABS] [--options ABS]
          discover --catalog ABS [--out ABS]
          prepare --options ABS
          handoff --file ABS [--accept N]
          import --file ABS --accept N [--options ABS]
          review | inspect | recover --id ID
          execute --id ID --review ABS

        Native inbox:
          inbox-init | inbox-list --inbox ABS
          inbox-show | inbox-enqueue | inbox-review | inbox-cancel | inbox-recover | inbox-response --inbox ABS --id ID
          inbox-enqueue-config --inbox ABS --config ABS
          inbox-execute --inbox ABS --id ID --review ABS [--workspace ABS]
          inbox-finalize --inbox ABS --id ID --options ABS
          inbox-report --inbox ABS --out ABS [--workspace ABS]

        Acquisitions:
          object-list | dataset-list
          object-create | dataset-create --options ABS
          object-attach | dataset-attach --id ID --session ABS [--accounting-only]
          object-initialize | object-inspect | object-run | object-recover --id ID [--options ABS]
          object-download | object-assemble | object-delivery --id ID [--out ABS] [--options ABS]
          object-report --id ID --out ABS [--format html|json] [--options ABS]
          dataset-initialize | dataset-inspect | dataset-run | dataset-recover --id ID
          dataset-deliver | dataset-manifest --id ID [--out ABS]
          object-accounting | object-finalize | object-recover-accounting --id ID --options ABS
          dataset-accounting | dataset-finalize | dataset-recover-accounting --id ID --options ABS

        Verified files:
          file-verify | file-read | file-json [--limit N]
          file-copy --out ABS_NEW
          file-records --format ndjson|sse|csv|dataset [--partial] [--options ABS]
          File selection:
            --kind operation --id ID                         (default kind)
            --kind inbox --inbox ABS --id ID
            --kind object --id ID [--delivery ABS_FILE]
            --kind dataset --id ID --file NAME [--delivery ABS_DIRECTORY]
            --kind response --record ABS --response-config ABS

        JSON results use stdout; stream metadata and errors use stderr.
        Original state, reviewed request, native approval and acquisition accounting are retained.
        """;
}
