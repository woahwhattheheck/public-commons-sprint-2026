/*
 * MIT. Sequential adapter for the actual com.k-int.proteus:proteus-core:3.0.0.
 * The engine evaluates every specification. The runner only binds configuration,
 * checks saved spec bytes and transports the original ObjectMapper result.
 */
import com.fasterxml.jackson.core.JsonParser;
import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.k_int.proteus.Accumulators;
import com.k_int.proteus.ComponentSpec;
import com.k_int.proteus.Config;
import com.k_int.proteus.Context;
import com.k_int.proteus.Input;
import com.k_int.proteus.serialization.ProteusMapper;
import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.io.PrintWriter;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.util.Base64;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Set;

public class ProteusBatch {
  private static final ObjectMapper JSON = new ProteusMapper()
      .enable(JsonParser.Feature.STRICT_DUPLICATE_DETECTION)
      .enable(DeserializationFeature.USE_BIG_INTEGER_FOR_INTS)
      .enable(DeserializationFeature.USE_BIG_DECIMAL_FOR_FLOATS);
  private static final int MAX_LINE_CHARS = 64 * 1024 * 1024;
  private static final Set<String> CONFIG_KEYS = Set.of(
      "path_not_found_to_null", "path_parse_exception_to_null",
      "unbox_singletons", "empty_reads_to_null", "http_client",
      "enable_file_read", "enable_file_write", "enable_file_delete");
  private static final Map<String, String> ORIGINAL_CLASSES = Map.of(
      "componentSpec", "com.k_int.proteus.ComponentSpec",
      "context", "com.k_int.proteus.Context",
      "input", "com.k_int.proteus.Input",
      "config", "com.k_int.proteus.Config");

  private static String hash(byte[] body) throws Exception {
    return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(body));
  }

  @SuppressWarnings("unchecked")
  private static Map<String, Object> map(Object value, String name) {
    if (!(value instanceof Map<?, ?> result))
      throw new IllegalArgumentException(name + " must be an object");
    for (Object key : result.keySet())
      if (!(key instanceof String)) throw new IllegalArgumentException(name + " has a non-string key");
    return (Map<String, Object>) result;
  }

  private static String text(Object value, String name) {
    if (!(value instanceof String result) || result.isBlank())
      throw new IllegalArgumentException(name + " must be a non-empty string");
    return result;
  }

  private static boolean bool(Map<String, Object> source, String key, boolean expected) {
    if (!(source.get(key) instanceof Boolean value) || value != expected)
      throw new IllegalArgumentException("The selected native configuration requires " + key + "=" + expected);
    return value;
  }

  private static Config configuration(Map<String, Object> settings) {
    if (!settings.keySet().equals(CONFIG_KEYS))
      throw new IllegalArgumentException("Every original native configuration field must be explicit");
    if (!"disallowed".equals(settings.get("http_client")))
      throw new IllegalArgumentException("This file receiving profile does not make HTTP requests");
    return Config.builder()
        .objectMapper(JSON)
        .accumulator(Accumulators.first())
        .pathNotFoundToNull(bool(settings, "path_not_found_to_null", true))
        .pathParseExceptionToNull(bool(settings, "path_parse_exception_to_null", false))
        .unboxSingletons(bool(settings, "unbox_singletons", false))
        .emptyReadsToNull(bool(settings, "empty_reads_to_null", false))
        .httpClient((request, context) -> {
          throw new UnsupportedOperationException("HTTP access is disabled for this transform");
        })
        .enableFileRead(bool(settings, "enable_file_read", false))
        .enableFileWrite(bool(settings, "enable_file_write", false))
        .enableFileDelete(bool(settings, "enable_file_delete", false))
        .build();
  }

  private static String readLine(BufferedReader source) throws Exception {
    StringBuilder line = new StringBuilder();
    int value;
    while ((value = source.read()) != -1) {
      if (value == '\n') return line.toString();
      if (line.length() == MAX_LINE_CHARS)
        throw new IllegalArgumentException("The native request exceeds 64 Mi characters");
      line.append((char) value);
    }
    return line.length() == 0 ? null : line.toString();
  }

  private static void emit(PrintWriter output, Map<String, Object> message) throws Exception {
    output.println(JSON.writeValueAsString(message));
    output.flush();
    if (output.checkError()) throw new IllegalStateException("The native receiving pipe closed");
  }

  public static void main(String[] args) throws Exception {
    if (args.length != 1) throw new IllegalArgumentException("Supply the base64 runtime binding");
    Map<String, Object> options = map(JSON.readValue(Base64.getDecoder().decode(args[0]), Object.class), "runtime options");
    Map<String, Object> classes = map(options.get("classes"), "classes");
    if (!classes.equals(ORIGINAL_CLASSES))
      throw new IllegalArgumentException("The runner must use the original Proteus 3.0.0 class bindings");
    Map<String, Object> recordedConfiguration = map(options.get("configuration"), "configuration");
    Map<String, Object> settings = map(recordedConfiguration.get("settings"), "configuration.settings");
    if (!"com.k_int.proteus.Config".equals(recordedConfiguration.get("implementation")) ||
        !"com.k_int.proteus.Accumulators.first()".equals(recordedConfiguration.get("accumulator")) ||
        !"strict-duplicates,big-integers,big-decimals".equals(recordedConfiguration.get("json")))
      throw new IllegalArgumentException("The runtime manifest must describe the applied native configuration");
    Config config = configuration(settings);
    Path specDirectory = Path.of(text(options.get("workDirectory"), "workDirectory")).toRealPath();
    if (!Files.isDirectory(specDirectory)) throw new IllegalArgumentException("The original spec directory is missing");
    Map<String, ComponentSpec<Object>> specs = new LinkedHashMap<>();
    PrintWriter output = new PrintWriter(System.out, false, StandardCharsets.UTF_8);
    Map<String, Object> execution = new LinkedHashMap<>();
    execution.put("javaVersion", System.getProperty("java.version"));
    execution.put("javaRuntimeVersion", System.getProperty("java.runtime.version"));
    execution.put("javaVendor", System.getProperty("java.vendor"));
    execution.put("vmName", System.getProperty("java.vm.name"));
    execution.put("javaFeature", Runtime.version().feature());
    execution.put("objectMapperClass", JSON.getClass().getName());
    execution.put("configuration", recordedConfiguration);
    emit(output, Map.of("type", "ready", "runtime", options.get("runtime"), "execution", execution));
    try (BufferedReader source = new BufferedReader(new InputStreamReader(System.in, StandardCharsets.UTF_8))) {
      String line;
      while ((line = readLine(source)) != null) {
        String id = "";
        try {
          Map<String, Object> request = map(JSON.readValue(line, Object.class), "request");
          id = text(request.get("id"), "request.id");
          if (!map(request.get("config"), "request.config").equals(settings))
            throw new IllegalArgumentException("The requested configuration differs from the recorded native settings");
          String specHash = text(request.get("specSha256"), "specSha256");
          if (!specHash.matches("[a-f0-9]{64}"))
            throw new IllegalArgumentException("The original spec SHA-256 is invalid");
          Path specFile = Path.of(text(request.get("specFile"), "specFile")).toRealPath();
          if (!specFile.getParent().equals(specDirectory) ||
              !specFile.getFileName().toString().equals(specHash + ".spec.json"))
            throw new IllegalArgumentException("The native specification must be the saved operation member");
          if (!hash(Files.readAllBytes(specFile)).equals(specHash))
            throw new IllegalArgumentException("The original specification bytes changed");
          ComponentSpec<Object> spec = specs.get(specHash);
          if (spec == null) {
            spec = ComponentSpec.loadFile(specFile.toString());
            if (!hash(Files.readAllBytes(specFile)).equals(specHash))
              throw new IllegalArgumentException("The specification changed during native loading");
            specs.put(specHash, spec);
          }
          Context context = Context.builder().config(config).spec(spec).build();
          Object result = context.inputMapper(new Input(request.get("input"))).getComponent().orElse(null);
          byte[] body = JSON.writeValueAsBytes(result);
          Map<String, Object> message = new LinkedHashMap<>();
          message.put("type", "result");
          message.put("id", id);
          message.put("bodyBase64", Base64.getEncoder().encodeToString(body));
          message.put("bytes", body.length);
          message.put("sha256", hash(body));
          emit(output, message);
        } catch (Exception | LinkageError error) {
          String message = error.getMessage() == null ? error.toString() : error.getMessage();
          if (message.length() > 16000) message = message.substring(0, 16000);
          emit(output, Map.of("type", "error", "id", id, "message", message,
              "errorClass", error.getClass().getName()));
        }
      }
    }
  }
}
