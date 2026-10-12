import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.security.MessageDigest;
import java.util.*;
import java.util.zip.*;
import org.roda_project.commons_ip.model.*;
import org.roda_project.commons_ip.model.impl.bagit.BagitSIP;

/** Invoke the exact installed Commons-IP parser on a complete real SIP. */
public class ReceiveRodaBag {
  static String quote(String value) {
    StringBuilder out = new StringBuilder("\"");
    for (char c : value.toCharArray()) {
      if (c == '"' || c == '\\') out.append('\\').append(c);
      else if (c < 32) out.append(String.format("\\u%04x", (int)c));
      else out.append(c);
    }
    return out.append('"').toString();
  }
  static String hash(Path path) throws Exception {
    MessageDigest h = MessageDigest.getInstance("SHA-256");
    try (InputStream in = Files.newInputStream(path)) {
      byte[] buffer = new byte[1024 * 1024]; int read;
      while ((read = in.read(buffer)) >= 0) if (read > 0) h.update(buffer, 0, read);
    }
    return HexFormat.of().formatHex(h.digest());
  }
  static void require(boolean condition, String message) {
    if (!condition) throw new IllegalStateException(message);
  }
  public static void main(String[] args) throws Exception {
    require(args.length == 3, "source.zip new-parser-directory receiving-result.json");
    Path source = Path.of(args[0]).toAbsolutePath();
    Path output = Path.of(args[1]).toAbsolutePath();
    Path report = Path.of(args[2]).toAbsolutePath();
    require(!Files.exists(output), "Parser staging directory already exists; retain the original run.");
    require(!Files.exists(report), "Receiving result already exists; reopen the original result.");
    SortedMap<String,String> expected = new TreeMap<>();
    SortedMap<String,Long> expectedLengths = new TreeMap<>();
    try (ZipFile zip = new ZipFile(source.toFile(), StandardCharsets.UTF_8)) {
      int payloadManifests = 0;
      Set<String> basenames = new HashSet<>();
      Enumeration<? extends ZipEntry> entries = zip.entries();
      while (entries.hasMoreElements()) {
        ZipEntry entry = entries.nextElement();
        String name = entry.getName();
        if (name.startsWith("manifest-") && name.endsWith(".txt")) payloadManifests++;
        if (name.startsWith("data/") && !entry.isDirectory()) {
          require(basenames.add(Path.of(name).getFileName().toString()), "Payload basename collision: " + name);
          expectedLengths.put(name, entry.getSize());
        }
      }
      require(payloadManifests == 1, "Exactly one payload manifest is required.");
      ZipEntry manifest = zip.getEntry("manifest-sha256.txt");
      require(manifest != null, "Missing SHA256 payload manifest.");
      try (BufferedReader reader = new BufferedReader(new InputStreamReader(zip.getInputStream(manifest), StandardCharsets.UTF_8))) {
        String line;
        while ((line = reader.readLine()) != null) {
          require(line.length() > 66 && line.substring(0,64).matches("[0-9a-f]{64}") && line.substring(64,66).equals("  "), "Invalid profile manifest line.");
          String name = line.substring(66);
          require(expected.put(name, line.substring(0,64)) == null, "Duplicate manifest path.");
        }
      }
      require(expected.keySet().equals(expectedLengths.keySet()), "Complete ZIP/manifest inventory differs.");
    }
    String sourceSha = hash(source);
    Files.createDirectories(output);
    SIP sip = BagitSIP.parse(source, output);
    require(sip.getRepresentations().size() == 1, "Expected one RODA representation.");
    require(!sip.getDescriptiveMetadata().isEmpty(), "Package metadata was not parsed.");
    SortedMap<String,String> actual = new TreeMap<>();
    SortedMap<String,Long> actualLengths = new TreeMap<>();
    List<String> representations = new ArrayList<>();
    for (IPRepresentation representation : sip.getRepresentations()) {
      representations.add(representation.getRepresentationID());
      for (IPFile file : representation.getData()) {
        List<String> segments = new ArrayList<>();
        segments.add("data");
        segments.addAll(file.getRelativeFolders());
        segments.add(file.getFileName());
        String originalPath = String.join("/", segments);
        require(actual.put(originalPath, hash(file.getPath())) == null, "Duplicate parsed representation file: " + originalPath);
        actualLengths.put(originalPath, Files.size(file.getPath()));
      }
    }
    require(actual.equals(expected), "Actual Commons-IP parser file paths or bytes differ from the submitted SIP.");
    require(actualLengths.equals(expectedLengths), "Actual Commons-IP parser file lengths differ.");
    require(hash(source).equals(sourceSha), "Original submitted SIP changed during parsing.");
    StringBuilder members = new StringBuilder("[");
    boolean first = true;
    for (String name : actual.keySet()) {
      if (!first) members.append(',');
      first = false;
      members.append("{\"path\":").append(quote(name)).append(",\"bytes\":").append(actualLengths.get(name))
        .append(",\"sha256\":").append(quote(actual.get(name))).append('}');
    }
    members.append(']');
    String json = "{\"schema\":\"stellar-forge.roda-upstream-parser-receiving.v1\",\"completed\":true,"
      + "\"parser\":\"org.roda_project.commons_ip.model.impl.bagit.BagitSIP.parse\","
      + "\"commonsIpVersion\":\"2.12.1\",\"commonsIpSourceCommit\":\"a30e410a9148252fa9240900697883dd042abf46\","
      + "\"transferSha256\":" + quote(sourceSha) + ",\"source\":" + quote(source.toString())
      + ",\"representationId\":" + quote(representations.get(0)) + ",\"fileCount\":" + actual.size()
      + ",\"packageMetadataCount\":" + sip.getDescriptiveMetadata().size()
      + ",\"members\":" + members + "}\n";
    Files.writeString(report, json, StandardCharsets.UTF_8, StandardOpenOption.CREATE_NEW);
    System.out.println("Received " + actual.size() + " exact payload files using Commons-IP2.12.1: " + report);
  }
}
