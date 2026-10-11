#!/usr/bin/env php
<?php
declare(strict_types=1);

// MIT. Runnable PHP job entry: private SDK settings + one explicit command document.
use StellarForge\Buyer\Cli\InputException;
use function StellarForge\Buyer\Cli\executeCommand;
use function StellarForge\Buyer\Cli\readObjectFile;
use function StellarForge\Buyer\Cli\writeJson;

require_once dirname(__DIR__) . '/src/Console.php';

try {
    if ($argc !== 3) {
        fwrite(STDERR, "Usage: php examples/acquisitions.php /absolute/settings.json /absolute/command.json\n");
        throw new InputException('ACQUISITION_EXAMPLE_TWO_FILES_REQUIRED');
    }
    $settings = readObjectFile($argv[1]);
    $document = readObjectFile($argv[2]);
    if (array_diff(array_keys($document), ['command', 'parameters']) ||
        !isset($document['command']) || !is_string($document['command'])) {
        throw new InputException('ACQUISITION_EXAMPLE_COMMAND_DOCUMENT_INVALID');
    }
    $parameters = array_key_exists('parameters', $document) ? $document['parameters'] : new stdClass();
    if (!$parameters instanceof stdClass) {
        throw new InputException('ACQUISITION_CLI_JSON_OBJECT_REQUIRED');
    }
    // This dispatch constructs AcquisitionWorkspace and calls command once, with
    // the native bridge's exact fields and cooperative cancellation callback.
    // It prints the complete native result, including a retained failed outcome.
    exit(executeCommand($settings, $document['command'], get_object_vars($parameters), true));
} catch (InputException $error) {
    exit(writeJson(['errorCode' => $error->getMessage(), 'result' => null], true) ? 64 : 74);
} catch (Throwable) {
    exit(writeJson(['errorCode' => 'ACQUISITION_EXAMPLE_LOCAL_ERROR', 'result' => null], true) ? 70 : 74);
}
