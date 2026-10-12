import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.util.ArrayList;
import java.util.List;
import java.util.jar.Attributes;
import java.util.jar.JarEntry;
import java.util.jar.JarOutputStream;
import java.util.jar.Manifest;
import javax.tools.ToolProvider;

/** Offline source build: java Build.java /absolute/new-build-directory */
public final class Build {
    public static void main(String[] args) throws IOException {
        if (args.length != 1) throw new IllegalArgumentException("Usage: java Build.java /absolute/new-build-directory");
        Path source = Path.of("src/main/java").toAbsolutePath().normalize();
        Path out = Path.of(args[0]);
        if (!out.isAbsolute() || Files.exists(out)) throw new IllegalArgumentException("New absolute output directory required");
        var compiler = ToolProvider.getSystemJavaCompiler();
        if (compiler == null) throw new IllegalStateException("A Java 17+ JDK with jdk.compiler is required");
        Files.createDirectory(out);
        Path classes = Files.createDirectory(out.resolve("classes"));
        List<String> options = new ArrayList<>(List.of("--release", "17", "-encoding", "UTF-8", "-d", classes.toString()));
        try (var paths = Files.walk(source)) {
            paths.filter(path -> path.toString().endsWith(".java")).sorted().forEach(path -> options.add(path.toString()));
        }
        int status = compiler.run(null, System.out, System.err, options.toArray(String[]::new));
        if (status != 0) throw new IOException("Java compilation failed with status " + status);
        Manifest manifest = new Manifest();
        manifest.getMainAttributes().put(Attributes.Name.MANIFEST_VERSION, "1.0");
        manifest.getMainAttributes().put(Attributes.Name.MAIN_CLASS, "io.starforge.buyer.StarforgeBuyer");
        manifest.getMainAttributes().putValue("Automatic-Module-Name", "io.starforge.buyer");
        Path jarPath = out.resolve("starforge-buyer.jar");
        try (JarOutputStream jar = new JarOutputStream(Files.newOutputStream(jarPath, StandardOpenOption.CREATE_NEW), manifest);
             var paths = Files.walk(classes)) {
            JarEntry license = new JarEntry("META-INF/LICENSE");
            license.setTime(0);
            jar.putNextEntry(license); Files.copy(Path.of("LICENSE"), jar); jar.closeEntry();
            for (Path file : paths.filter(Files::isRegularFile).sorted().toList()) {
                JarEntry entry = new JarEntry(classes.relativize(file).toString().replace('\\', '/'));
                entry.setTime(0);
                jar.putNextEntry(entry); Files.copy(file, jar); jar.closeEntry();
            }
        }
        System.out.println(jarPath);
    }
}
