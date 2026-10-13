package net.tjlabs.workflows;

import at.conapi.oss.jms.adapter.AbstractConnection;
import at.conapi.oss.jms.adapter.AbstractConnectionFactory;
import at.conapi.oss.jms.adapter.AbstractDestination;
import at.conapi.oss.jms.adapter.AbstractMessage;
import at.conapi.oss.jms.adapter.AbstractProducer;
import at.conapi.oss.jms.adapter.AbstractSession;
import at.conapi.oss.jms.adapter.JmsFactory;
import com.fasterxml.jackson.core.JsonParser;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;

import java.net.URI;
import java.net.URL;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Hashtable;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import javax.naming.Context;

/**
 * Publish one retained native result with real JMSCorrelationID/JMSReplyTo.
 *
 * The stdin object is the already-rendered original connectionFactoryConfig.
 * Credentials never become command-line arguments or result fields. Provider
 * URLs, DIRECT/JNDI properties and classloader choice match plugin-jms 1.4.11.
 */
public final class NativeHeaderProducer {
    private static final ObjectMapper JSON = new ObjectMapper()
        .enable(JsonParser.Feature.STRICT_DUPLICATE_DETECTION);

    private NativeHeaderProducer() {}

    public static void main(String[] args) {
        try {
            Map<String, String> options = arguments(args);
            JsonNode config = JSON.readTree(System.in);
            JsonNode message = read(options.get("--message"));
            JsonNode prepared = read(options.get("--prepared"));
            ObjectNode receipt = publish(config, message, prepared);
            System.out.println(JSON.writeValueAsString(receipt));
        } catch (Exception error) {
            // Broker exceptions may embed authentication material. The original
            // delivery attempt stays available for recovery in workflow_engine.
            ObjectNode failure = JSON.createObjectNode();
            failure.put("code", "JMS_PUBLICATION_FAILED");
            failure.put("type", error.getClass().getSimpleName());
            System.err.println(failure);
            System.exit(1);
        }
    }

    private static Map<String, String> arguments(String[] args) {
        if (args.length != 4) {
            throw new IllegalArgumentException("Expected --message FILE --prepared FILE");
        }
        Map<String, String> values = new LinkedHashMap<>();
        for (int index = 0; index < args.length; index += 2) {
            String key = args[index];
            if ((!key.equals("--message") && !key.equals("--prepared"))
                || values.put(key, args[index + 1]) != null) {
                throw new IllegalArgumentException("Unexpected or repeated argument");
            }
        }
        if (!values.containsKey("--message") || !values.containsKey("--prepared")) {
            throw new IllegalArgumentException("Missing input argument");
        }
        return values;
    }

    private static JsonNode read(String name) throws Exception {
        try (var input = Files.newInputStream(Path.of(name))) {
            JsonNode result = JSON.readTree(input);
            if (result == null || !result.isObject()) {
                throw new IllegalArgumentException("Expected a complete JSON object");
            }
            return result;
        }
    }

    private static String text(JsonNode value, String key) {
        JsonNode item = value.get(key);
        if (item == null || !item.isTextual() || item.textValue().isEmpty()) {
            throw new IllegalArgumentException("Missing string " + key);
        }
        return item.textValue();
    }

    private static String optional(JsonNode value, String key) {
        JsonNode item = value.get(key);
        if (item == null || item.isNull()) {
            return null;
        }
        if (!item.isTextual()) {
            throw new IllegalArgumentException("Expected a string " + key);
        }
        return item.textValue();
    }

    private static Map<String, String> properties(JsonNode config) {
        Map<String, String> properties = new LinkedHashMap<>();
        JsonNode supplied = config.get("connectionProperties");
        if (supplied == null || supplied.isNull()) {
            return properties;
        }
        if (!supplied.isObject()) {
            throw new IllegalArgumentException("connectionProperties must be an object");
        }
        supplied.fields().forEachRemaining(entry -> {
            if (!entry.getValue().isTextual()) {
                throw new IllegalArgumentException("Connection property must be a string");
            }
            properties.put(entry.getKey(), entry.getValue().textValue());
        });
        return properties;
    }

    private static AbstractConnectionFactory connectionFactory(JsonNode config) throws Exception {
        if (config == null || !config.isObject()) {
            throw new IllegalArgumentException("Expected resolved connectionFactoryConfig on stdin");
        }
        List<URL> urls = new ArrayList<>();
        JsonNode jars = config.get("providerJarPaths");
        if (jars == null || jars.isNull()) {
            throw new IllegalArgumentException("Select the original provider JAR URLs explicitly");
        }
        if (jars.isTextual()) {
            urls.add(URI.create(jars.textValue()).toURL());
        } else if (jars.isArray()) {
            for (JsonNode jar : jars) {
                if (!jar.isTextual()) {
                    throw new IllegalArgumentException("Provider JAR URL must be a string");
                }
                urls.add(URI.create(jar.textValue()).toURL());
            }
        } else {
            throw new IllegalArgumentException("Expected original provider JAR URL list");
        }
        if (urls.isEmpty()) {
            throw new IllegalArgumentException("Select at least one original provider JAR URL");
        }
        JsonNode filtered = config.path("useFilteredClassLoader");
        if (!filtered.isMissingNode() && !filtered.isBoolean()
            && !(filtered.isTextual() && List.of("true", "false").contains(filtered.textValue()))) {
            throw new IllegalArgumentException("Invalid classloader selection");
        }
        JmsFactory factory = new JmsFactory(urls.toArray(new URL[0]),
            NativeHeaderProducer.class.getClassLoader(), filtered.asBoolean(false));
        Map<String, String> properties = properties(config);
        return switch (text(config, "type")) {
            case "DIRECT" -> factory.createConnectionFactory(
                text(config, "connectionFactoryClass"), properties);
            case "JNDI" -> {
                Hashtable<String, String> environment = new Hashtable<>();
                environment.put(Context.INITIAL_CONTEXT_FACTORY,
                    text(config, "jndiInitialContextFactory"));
                environment.put(Context.PROVIDER_URL, text(config, "jndiProviderUrl"));
                String principal = optional(config, "jndiPrincipal");
                String credentials = optional(config, "jndiCredentials");
                if (principal != null) {
                    environment.put(Context.SECURITY_PRINCIPAL, principal);
                }
                if (credentials != null) {
                    environment.put(Context.SECURITY_CREDENTIALS, credentials);
                }
                // The original native plugin applies connectionProperties last.
                environment.putAll(properties);
                yield factory.lookupConnectionFactory(environment,
                    text(config, "jndiConnectionFactoryName"));
            }
            default -> throw new IllegalArgumentException("Select DIRECT or JNDI");
        };
    }

    private static String destinationUrl(JsonNode value, String nameKey, String typeKey) {
        String type = optional(value, typeKey);
        if (type == null) {
            type = "QUEUE";
        }
        if (!List.of("QUEUE", "TOPIC").contains(type)) {
            throw new IllegalArgumentException("Destination type must be QUEUE or TOPIC");
        }
        return type.toLowerCase(java.util.Locale.ROOT) + "://" + text(value, nameKey);
    }

    private static ObjectNode publish(JsonNode config, JsonNode item, JsonNode prepared) throws Exception {
        JsonNode body = item.path("data");
        JsonNode headerNode = item.path("headers");
        if (!body.isObject() || !headerNode.isObject()
            || !"stellar-forge.source-workflow-result.v1".equals(text(body, "schema"))) {
            throw new IllegalArgumentException("Expected the original full result envelope");
        }
        String correlationId = text(item, "correlationId");
        if (!correlationId.equals(text(body, "correlationId"))) {
            throw new IllegalArgumentException("Original native correlation differs from body");
        }
        Map<String, String> mapping = Map.of(
            "businessRequestId", "requestId", "businessCorrelationId", "correlationId",
            "deliveryId", "deliveryId", "resultSha256", "resultSha256");
        for (var pair : mapping.entrySet()) {
            if (!text(headerNode, pair.getKey()).equals(text(body, pair.getValue()))) {
                throw new IllegalArgumentException("Original property differs from body");
            }
        }
        for (String key : List.of("requestId", "deliveryId", "resultSha256")) {
            if (!text(prepared, key).equals(text(body, key))) {
                throw new IllegalArgumentException("Prepared result identity differs");
            }
        }
        if (!item.equals(prepared.path("jms"))) {
            throw new IllegalArgumentException("Prepared JMS item differs from exported original");
        }
        Map<String, Object> headers = new LinkedHashMap<>();
        headerNode.fields().forEachRemaining(entry -> {
            // The workflow's four correlation properties are original strings.
            // Do not silently convert a JSON object into a broker property.
            if (!entry.getValue().isTextual()) {
                throw new IllegalArgumentException("Expected a string JMS property");
            }
            headers.put(entry.getKey(), entry.getValue().textValue());
        });
        JsonNode destination = prepared.path("destination");
        AbstractConnectionFactory factory = connectionFactory(config);
        String username = optional(config, "username");
        ObjectNode receipt = JSON.createObjectNode();
        try (AbstractConnection connection = username == null
                 ? factory.createConnection()
                 : factory.createConnection(username, optional(config, "password"));
             AbstractSession session = connection.createSession()) {
            AbstractDestination target = session.createDestination(
                destinationUrl(destination, "destinationName", "destinationType"));
            try (AbstractProducer producer = session.createProducer(target)) {
                AbstractMessage message = session.createTextMessage(JSON.writeValueAsString(body), headers);
                // These call the actual javax.jms / jakarta.jms setters through
                // conapi's adapter, as required by native API correlation clients.
                message.setJMSCorrelationID(correlationId);
                if (optional(item, "replyTo") != null) {
                    message.setJMSReplyTo(session.createDestination(
                        destinationUrl(item, "replyTo", "replyToType")));
                }
                producer.send(message, 2, 4, 0L);
                receipt.put("schema", "stellar-forge.native-jms-publication.v1");
                receipt.put("publisher", "at.conapi.oss:jms-adapter:1.0.2");
                receipt.put("messagesCount", 1);
                receipt.put("correlationMode", "native-header");
                receipt.put("correlationId", message.getJMSCorrelationID());
                receipt.put("messageId", message.getJMSMessageID());
                for (String key : List.of("requestId", "deliveryId", "resultSha256")) {
                    receipt.put(key, text(body, key));
                }
                receipt.set("destination", destination.deepCopy());
                if (optional(item, "replyTo") != null) {
                    receipt.put("replyTo", text(item, "replyTo"));
                    receipt.put("replyToType", optional(item, "replyToType") == null
                        ? "QUEUE" : text(item, "replyToType"));
                }
            }
        }
        // A send whose completion is lost leaves the same pending application
        // attempt. Recovery republishes its deliveryId and resultSha256.
        return receipt;
    }
}
