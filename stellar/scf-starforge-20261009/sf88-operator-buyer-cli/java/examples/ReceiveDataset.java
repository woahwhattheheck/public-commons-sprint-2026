import io.starforge.buyer.Buyer;
import io.starforge.buyer.Json;
import io.starforge.buyer.NativeFile;
import java.nio.file.Path;
import java.util.Map;

/** Receives a registered dataset, then reopens its verified CSV export. */
public final class ReceiveDataset {
    public static void main(String[] args) throws Exception {
        if (args.length != 4) {
            throw new IllegalArgumentException("ReceiveDataset ABS_RUNTIME ABS_STATE DATASET_ID ABS_DELIVERY_DIRECTORY");
        }
        Buyer buyer = Buyer.builder(Path.of(args[0]), Path.of(args[1])).build();
        var dataset = buyer.dataset(args[2]);
        Path directory = Path.of(args[3]);
        System.err.println(Json.stringify(dataset.deliver(directory).original()));
        var rows = dataset.file(directory, "dataset.jsonl").records(
            NativeFile.Format.DATASET, Map.of(),
            row -> {
                System.out.println(Json.stringify(row));
                if (System.out.checkError()) throw new java.io.IOException("Output closed");
            });
        System.err.println(Json.stringify(rows.original()));
        Buyer reopened = Buyer.builder(Path.of(args[0]), Path.of(args[1])).build();
        var csv = reopened.dataset(args[2]).file(directory, "dataset.csv").verify();
        System.err.println(Json.stringify(csv.original()));
    }
}
