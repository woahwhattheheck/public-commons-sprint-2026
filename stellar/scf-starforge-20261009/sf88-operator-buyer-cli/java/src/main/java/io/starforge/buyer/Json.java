package io.starforge.buyer;

import java.io.IOException;
import java.math.BigDecimal;
import java.math.BigInteger;
import java.nio.ByteBuffer;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** Small strict JSON codec. Numbers remain decimal values, including large atomic amounts. */
public final class Json {
    private Json() {}
    public static Object parse(byte[] bytes) throws IOException {
        try {
            return parse(StandardCharsets.UTF_8.newDecoder()
                .onMalformedInput(CodingErrorAction.REPORT)
                .onUnmappableCharacter(CodingErrorAction.REPORT).decode(ByteBuffer.wrap(bytes)).toString());
        } catch (IllegalArgumentException e) { throw new IOException("Invalid JSON", e); }
    }
    public static Object parse(String text) throws IOException {
        Parser parser = new Parser(text);
        Object value = parser.value(0);
        parser.space();
        if (parser.at != text.length()) throw parser.error("Trailing data");
        return value;
    }
    public static String stringify(Object value) {
        StringBuilder out = new StringBuilder();
        encode(value, out, 0);
        return out.toString();
    }
    public static byte[] bytes(Object value) { return stringify(value).getBytes(StandardCharsets.UTF_8); }
    @SuppressWarnings("unchecked")
    public static Map<String, Object> object(Object value) throws IOException {
        if (!(value instanceof Map<?, ?> map)) throw new IOException("JSON object required");
        for (Object key : map.keySet()) if (!(key instanceof String)) throw new IOException("String keys required");
        return (Map<String, Object>) map;
    }
    @SuppressWarnings("unchecked")
    public static List<Object> array(Object value) throws IOException {
        if (!(value instanceof List<?>)) throw new IOException("JSON array required");
        return (List<Object>) value;
    }
    public static String string(Map<String, Object> value, String key) throws IOException {
        Object item = value.get(key);
        if (!(item instanceof String)) throw new IOException("String field required: " + key);
        return (String) item;
    }
    public static long integer(Map<String, Object> value, String key) throws IOException {
        try {
            Object item = value.get(key);
            if (!(item instanceof Number)) throw new ArithmeticException();
            return new BigDecimal(item.toString()).longValueExact();
        } catch (ArithmeticException | NumberFormatException e) {
            throw new IOException("Integer field required: " + key, e);
        }
    }
    /** Creates an insertion-ordered object; null values are retained. */
    public static Map<String, Object> map(Object... pairs) {
        if (pairs.length % 2 != 0) throw new IllegalArgumentException("Key/value pairs required");
        Map<String, Object> out = new LinkedHashMap<>();
        for (int i = 0; i < pairs.length; i += 2) {
            if (!(pairs[i] instanceof String)) throw new IllegalArgumentException("String key required");
            String key = (String) pairs[i];
            if (out.containsKey(key)) throw new IllegalArgumentException("Duplicate key: " + key);
            out.put(key, pairs[i + 1]);
        }
        return out;
    }
    private static void encode(Object value, StringBuilder out, int depth) {
        if (depth > 128) throw new IllegalArgumentException("JSON nesting limit");
        if (value == null) { out.append("null"); return; }
        if (value instanceof String text) { quote(text, out); return; }
        if (value instanceof Boolean) { out.append(value); return; }
        if (value instanceof Number number) {
            if (!(number instanceof Byte || number instanceof Short || number instanceof Integer ||
                number instanceof Long || number instanceof BigInteger || number instanceof BigDecimal ||
                number instanceof Float || number instanceof Double))
                throw new IllegalArgumentException("Unsupported number");
            String text = number.toString();
            try { new BigDecimal(text); } catch (NumberFormatException e) {
                throw new IllegalArgumentException("Finite JSON number required", e);
            }
            out.append(text); return;
        }
        if (value instanceof Map<?, ?> map) {
            out.append('{'); boolean comma = false;
            for (Map.Entry<?, ?> entry : map.entrySet()) {
                if (!(entry.getKey() instanceof String)) throw new IllegalArgumentException("String key required");
                if (comma) out.append(','); comma = true;
                quote((String) entry.getKey(), out); out.append(':'); encode(entry.getValue(), out, depth + 1);
            }
            out.append('}'); return;
        }
        if (value instanceof Iterable<?> values) {
            out.append('['); boolean comma = false;
            for (Object item : values) {
                if (comma) out.append(','); comma = true; encode(item, out, depth + 1);
            }
            out.append(']'); return;
        }
        throw new IllegalArgumentException("Unsupported JSON type: " + value.getClass().getName());
    }
    private static void quote(String text, StringBuilder out) {
        out.append('"');
        for (int i = 0; i < text.length(); i++) {
            char c = text.charAt(i);
            switch (c) {
                case '"' -> out.append("\\\"");
                case '\\' -> out.append("\\\\");
                case '\b' -> out.append("\\b");
                case '\f' -> out.append("\\f");
                case '\n' -> out.append("\\n");
                case '\r' -> out.append("\\r");
                case '\t' -> out.append("\\t");
                default -> {
                    if (c < 0x20) {
                        String hex = Integer.toHexString(c);
                        out.append("\\u").append("0".repeat(4 - hex.length())).append(hex);
                    } else if (Character.isHighSurrogate(c)) {
                        if (i + 1 >= text.length() || !Character.isLowSurrogate(text.charAt(i + 1)))
                            throw new IllegalArgumentException("Unpaired Unicode surrogate");
                        out.append(c).append(text.charAt(++i));
                    } else if (Character.isLowSurrogate(c)) {
                        throw new IllegalArgumentException("Unpaired Unicode surrogate");
                    } else out.append(c);
                }
            }
        }
        out.append('"');
    }
    private static final class Parser {
        final String text; int at;
        Parser(String text) { this.text = text; }
        IOException error(String reason) { return new IOException(reason + " at JSON offset " + at); }
        void space() { while (at < text.length() && " \t\r\n".indexOf(text.charAt(at)) >= 0) at++; }
        Object value(int depth) throws IOException {
            if (depth > 128) throw error("JSON nesting limit");
            space(); if (at == text.length()) throw error("Value required");
            char c = text.charAt(at);
            if (c == '"') return string();
            if (c == '{') {
                at++; space(); Map<String, Object> out = new LinkedHashMap<>();
                if (take('}')) return out;
                do {
                    space(); if (at >= text.length() || text.charAt(at) != '"') throw error("Object key required");
                    String key = string(); space(); if (!take(':')) throw error("Colon required");
                    if (out.containsKey(key)) throw error("Duplicate object key");
                    out.put(key, value(depth + 1)); space();
                    if (take('}')) return out;
                    if (!take(',')) throw error("Comma required");
                } while (true);
            }
            if (c == '[') {
                at++; space(); List<Object> out = new ArrayList<>();
                if (take(']')) return out;
                do {
                    out.add(value(depth + 1)); space();
                    if (take(']')) return out;
                    if (!take(',')) throw error("Comma required");
                } while (true);
            }
            if (text.startsWith("true", at)) { at += 4; return true; }
            if (text.startsWith("false", at)) { at += 5; return false; }
            if (text.startsWith("null", at)) { at += 4; return null; }
            int start = at;
            take('-');
            if (take('0')) {
                if (at < text.length() && Character.isDigit(text.charAt(at))) throw error("Leading zero");
            } else digits();
            if (take('.')) digits();
            if (take('e') || take('E')) { if (!take('+')) take('-'); digits(); }
            try { return new BigDecimal(text.substring(start, at)); }
            catch (NumberFormatException e) { throw error("Invalid number"); }
        }
        void digits() throws IOException {
            int start = at;
            while (at < text.length() && text.charAt(at) >= '0' && text.charAt(at) <= '9') at++;
            if (start == at) throw error("Digit required");
        }
        boolean take(char c) { if (at < text.length() && text.charAt(at) == c) { at++; return true; } return false; }
        char hex() throws IOException {
            if (at + 4 > text.length()) throw error("Incomplete Unicode escape");
            int value = 0;
            for (int n = 0; n < 4; n++) {
                int digit = Character.digit(text.charAt(at++), 16);
                if (digit < 0) throw error("Invalid Unicode escape");
                value = (value << 4) | digit;
            }
            return (char) value;
        }
        String string() throws IOException {
            at++; StringBuilder out = new StringBuilder();
            while (at < text.length()) {
                char c = text.charAt(at++);
                if (c == '"') {
                    String result = out.toString();
                    for (int i = 0; i < result.length(); i++) {
                        char unit = result.charAt(i);
                        if (Character.isHighSurrogate(unit)) {
                            if (++i >= result.length() || !Character.isLowSurrogate(result.charAt(i)))
                                throw error("Unpaired Unicode surrogate");
                        } else if (Character.isLowSurrogate(unit)) throw error("Unpaired Unicode surrogate");
                    }
                    return result;
                }
                if (c < 0x20) throw error("Unescaped control character");
                if (c != '\\') { out.append(c); continue; }
                if (at == text.length()) throw error("Incomplete escape");
                char escape = text.charAt(at++);
                switch (escape) {
                    case '"', '\\', '/' -> out.append(escape);
                    case 'b' -> out.append('\b');
                    case 'f' -> out.append('\f');
                    case 'n' -> out.append('\n');
                    case 'r' -> out.append('\r');
                    case 't' -> out.append('\t');
                    case 'u' -> out.append(hex());
                    default -> throw error("Invalid escape");
                }
            }
            throw error("Unterminated string");
        }
    }
}
