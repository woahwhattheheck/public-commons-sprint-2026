package io.starforge.buyer;

import java.io.BufferedInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.OutputStream;
import java.nio.file.Path;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Objects;

/** Streams bytes and records through the original Node VerifiedFile reader. */
public final class NativeFile {
    private final Buyer buyer;
    private final Map<String, Object> selection;
    NativeFile(Buyer buyer, Map<String, Object> selection) {
        this.buyer = buyer; this.selection = new LinkedHashMap<>(selection);
    }
    public enum Format {
        NDJSON("ndjson"), SSE("sse"), CSV("csv"), DATASET("dataset");
        final String wire;
        Format(String wire) { this.wire = wire; }
        public String wireName() { return wire; }
        public static Format from(String value) {
            for (Format format : values()) if (format.wire.equals(value)) return format;
            throw new IllegalArgumentException("Record format must be ndjson, sse, csv or dataset");
        }
    }
    @FunctionalInterface public interface RecordConsumer {
        /** Throw IOException to stop the original transfer. */
        void accept(Object record) throws IOException;
    }
    public record FileInfo(Path path, long bytes, String sha256, Map<String, Object> original) {
        static FileInfo from(Object raw) throws IOException {
            Map<String, Object> value = Json.object(raw);
            Path path = value.get("path") instanceof String ? Path.of((String) value.get("path")) : null;
            return new FileInfo(path, Json.integer(value, "bytes"), Json.string(value, "sha256"), value);
        }
    }
    public record Transfer(long bytes, long records, String sha256, Map<String, Object> original) {
        static Transfer from(Object raw) throws IOException {
            Map<String, Object> value = Json.object(raw);
            return new Transfer(Json.integer(value, "bytes"),
                value.containsKey("records") ? Json.integer(value, "records") : 0,
                value.get("sha256") instanceof String ? (String) value.get("sha256") : null, value);
        }
    }
    public FileInfo verify() throws IOException {
        return FileInfo.from(buyer.invoke("file.verify", null, Json.map("selection", selection)));
    }
    /** Uses the original synchronized, verified, create-only copy implementation. */
    public FileInfo saveAs(Path destination) throws IOException {
        return FileInfo.from(buyer.invoke("file.copy", null,
            Json.map("selection", selection, "destination", NativeCall.absolute(destination).toString())));
    }
    /** Commit downstream effects after this returns: original full-transfer verification finishes last. */
    public Transfer writeTo(OutputStream destination) throws IOException {
        Objects.requireNonNull(destination);
        long[] count = {0};
        Object raw = buyer.stream("file.stream", Json.map("selection", selection), source -> {
            byte[] buffer = new byte[65536];
            int size;
            while ((size = source.read(buffer)) != -1) {
                if (Thread.currentThread().isInterrupted()) throw new IOException("Stream consumer interrupted");
                destination.write(buffer, 0, size); count[0] += size;
            }
        });
        Transfer transfer = Transfer.from(raw);
        if (transfer.bytes() != count[0]) throw new IOException("Original transfer byte count mismatch");
        return transfer;
    }
    /** Reads a complete verified response, up to the explicit memory limit. Zero accepts an empty file. */
    public byte[] bytes(int limit) throws IOException {
        if (limit < 0 || limit > 268435456) throw new IllegalArgumentException("Limit must be zero to 256 MiB");
        ByteArrayOutputStream output = new ByteArrayOutputStream(Math.min(limit, 65536));
        Object raw = buyer.stream("file.bytes", Json.map("selection", selection, "limit", limit), source -> {
            byte[] buffer = new byte[65536];
            int size;
            while ((size = source.read(buffer)) != -1) {
                if ((long) output.size() + size > limit) throw new IOException("Java response byte limit exceeded");
                output.write(buffer, 0, size);
            }
        });
        if (Transfer.from(raw).bytes() != output.size()) throw new IOException("Original transfer byte count mismatch");
        return output.toByteArray();
    }
    public Object json(int limit) throws IOException { return Json.parse(bytes(limit)); }

    public Transfer records(Format format, Map<String, Object> nativeOptions, RecordConsumer consumer) throws IOException {
        return records(format, nativeOptions, 16 * 1024 * 1024, consumer);
    }
    /** The IPC record limit is separate from the original stream/CSV decoder's selected options. */
    public Transfer records(Format format, Map<String, Object> nativeOptions, int encodedRecordLimit,
                            RecordConsumer consumer) throws IOException {
        Objects.requireNonNull(format); Objects.requireNonNull(consumer);
        if (encodedRecordLimit < 1 || encodedRecordLimit > 268435456)
            throw new IllegalArgumentException("Encoded record limit must be 1 byte to 256 MiB");
        long[] count = {0}, bytes = {0};
        Object raw = buyer.stream("file.records",
            Json.map("selection", selection, "format", format.wire,
                     "options", nativeOptions == null ? Map.of() : nativeOptions), input -> {
                BufferedInputStream source = new BufferedInputStream(input, 65536);
                ByteArrayOutputStream line = new ByteArrayOutputStream();
                int next;
                while ((next = source.read()) != -1) {
                    if (Thread.currentThread().isInterrupted()) throw new IOException("Record consumer interrupted");
                    bytes[0]++;
                    if (next == '\n') {
                        consumer.accept(Json.parse(line.toByteArray())); count[0]++; line.reset();
                    } else {
                        if (line.size() >= encodedRecordLimit) throw new IOException("Encoded record limit exceeded");
                        line.write(next);
                    }
                }
                if (line.size() != 0) throw new IOException("Truncated bridge record");
            });
        Transfer transfer = Transfer.from(raw);
        if (transfer.records() != count[0] || transfer.bytes() != bytes[0])
            throw new IOException("Original record transfer count mismatch");
        return transfer;
    }
}
