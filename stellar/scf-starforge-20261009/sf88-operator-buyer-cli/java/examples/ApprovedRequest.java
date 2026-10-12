import io.starforge.buyer.Buyer;
import io.starforge.buyer.BuyerException;
import io.starforge.buyer.Json;
import io.starforge.buyer.Operation;
import java.nio.file.Path;

/** Run with the SDK JAR on the classpath; uses the original native approval. */
public final class ApprovedRequest {
    public static void main(String[] args) throws Exception {
        if (args.length != 4) {
            throw new IllegalArgumentException(
                "ApprovedRequest ABS_RUNTIME ABS_STATE ABS_OPERATOR_PROFILE ABS_ORIGINAL_CONFIG");
        }
        Buyer buyer = Buyer.builder(Path.of(args[0]), Path.of(args[1]))
            .operatorProfile(Path.of(args[2])).approvalInput(true).build();
        buyer.ready();
        Operation operation = buyer.create(Path.of(args[3]), new Buyer.CreateOptions());
        System.err.println("Original intent: " + operation.intentId());
        try {
            var review = operation.review();
            System.err.println(Json.stringify(review));
            var result = operation.execute(review);
            System.err.println(Json.stringify(result.original()));
            if (result.ok()) {
                System.out.println(Json.stringify(operation.file().json(8 * 1024 * 1024)));
            }
        } catch (BuyerException error) {
            System.err.println(error.getMessage());
            System.err.println("Retained intent: " + operation.intentId());
            throw error;
        }
    }
}
