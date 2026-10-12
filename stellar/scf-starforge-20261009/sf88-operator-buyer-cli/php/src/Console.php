<?php
declare(strict_types=1);

// MIT. One explicit command on the original buyer-runbook customer bridge.
namespace StellarForge\Buyer\Cli;

use StellarForge\Buyer\AcquisitionException;
use StellarForge\Buyer\AcquisitionWorkspace;

const INPUT_LIMIT = 1048576;
const COMMANDS = [
    'state' => ['List the original workspace, requests, acquisitions and recovery history.', '{}'],
    'attach' => ['Attach an existing original run at its canonical path.', '{"run":"/absolute/original/run"}'],
    'request' => ['Inspect one retained merchant request.', '{"id":"request-id"}'],
    'receive' => ['Import the exact merchant handoff file.', '{"file":"/absolute/request.handoff.json","filename":"optional-display-name.json"}'],
    'paid-file' => ['Inspect one retained merchant paid-file order and its review.', '{"id":"returned-file-id"}'],
    'receive-paid-file' => ['Import the exact original merchant paid-file handoff.', '{"file":"/absolute/merchant-file.handoff.json","filename":"optional-display-name.json"}'],
    'review-paid-file' => ['Review a paid-file order, local budget, filename and declared claim environment.', '{"id":"returned-file-id","expectedRevision":0,"totalAtomic":"30000","dailyAtomic":"20000","filename":"order.pdf","claimEnv":"SF101_CLAIM_TOKEN"}'],
    'prepare-paid-file' => ['Prepare the original operator for the exact selected paid-file review.', '{"id":"returned-file-id","reviewSha256":"exact-paid-file-review-sha256"}'],
    'retrieve-paid-file' => ['Retrieve the selected original acquisition file with its current config and handoff digests.', '{"id":"acquisition-id","only":"operation-id","configSha256":"exact-config-sha256","handoffSha256":"exact-handoff-sha256"}'],
    'reset-paid-file' => ['Explicitly reset the selected original file-transfer state with the same identity guards.', '{"id":"acquisition-id","only":"operation-id","configSha256":"exact-config-sha256","handoffSha256":"exact-handoff-sha256"}'],
    'download-paid-file' => ['Publish the fully retrieved and verified paid file to a new private destination.', '{"id":"acquisition-id","operationId":"operation-id","destination":"/absolute/private/export/order.pdf"}'],
    'export-paid-file' => ['Publish the exact retained merchant paid-file handoff to a new file.', '{"id":"returned-file-id","destination":"/absolute/private/export/merchant-file.handoff.json"}'],
    'review-request' => ['Review an advertised offer and the customer-selected local budget.', '{"id":"request-id","acceptIndex":0,"totalAtomic":"30000","dailyAtomic":"20000"}'],
    'prepare-request' => ['Prepare the original operator for the exact reviewed request.', '{"id":"request-id","reviewSha256":"exact-request-review-sha256"}'],
    'draft' => ['Read a saved acquisition draft; omit revision to select the current draft.', '{"id":"acquisition-id","revision":1}'],
    'save' => ['Save the original manifest; include id and expectedRevision when editing.', '{"expectedRevision":0,"manifest":{"schema":"stellar-forge.buyer-runbook.v1","id":"acquisition-id","title":"Customer acquisition","operations":[{"id":"order","label":"Merchant order","config":"returned-config-name.json","saveAs":"order.json"}]}}'],
    'initialize' => ['Initialize the exact immutable draft revision and review.', '{"id":"acquisition-id","expectedRevision":1,"reviewSha256":"exact-draft-review-sha256"}'],
    'inspect' => ['Inspect an acquisition and its actual plan digest.', '{"id":"acquisition-id"}'],
    'execute' => ['Run the exact inspected acquisition through the original terminal approval.', '{"id":"acquisition-id","expectedPlanSha256":"exact-inspected-plan-sha256","only":"optional-operation-id"}'],
    'recover' => ['Run the original interrupted-acquisition recovery.', '{"id":"acquisition-id"}'],
    'unlock' => ['Apply the original lease rules to the exact observed stopped owner.', '{"id":"acquisition-id","ownerPid":12345}'],
    'finalize' => ['Observe original reservations and accounting; no new purchase is submitted.', '{"id":"acquisition-id","only":"optional-operation-id"}'],
    'bind-accounting' => ['Bind an imported run to its matching original operator workspace.', '{"id":"acquisition-id","only":"operation-id","workspace":"/absolute/operator/workspace"}'],
    'preview' => ['Read the original bounded preview of a saved resource.', '{"id":"acquisition-id","operationId":"operation-id"}'],
    'download' => ['Publish the complete verified saved resource to a new file.', '{"id":"acquisition-id","operationId":"operation-id","destination":"/absolute/private/export/resource.json"}'],
    'export' => ['Publish a new native JSON, HTML or CSV acquisition report.', '{"id":"acquisition-id","format":"json","destination":"/absolute/private/export/report.json"}'],
    'export-request' => ['Publish the retained request body or handoff to a new file.', '{"id":"request-id","kind":"handoff","destination":"/absolute/private/export/request.handoff.json"}'],
    'backup-review' => ['Review the complete canonical acquisition state root before capture.', '{"stateRoot":"/absolute/customer/state"}'],
    'backup' => ['Capture the reviewed quiesced source with the original encrypted recovery engine.', '{"stateRoot":"/absolute/customer/state","output":"/absolute/private/backups/acquisition","expectedReviewSha256":"exact-backup-review-sha256","quiesced":true,"passEnv":"SF88_BACKUP_PASSPHRASE"}'],
    'verify' => ['Verify an original recovery bundle without opening the source workspace.', '{"bundle":"/absolute/private/backups/acquisition","expected":"exact-record-sha256","passEnv":"SF88_BACKUP_PASSPHRASE","python":"/absolute/python3"}'],
    'restore' => ['Restore the original canonical state root when that target is absent.', '{"bundle":"/absolute/private/backups/acquisition","expected":"exact-record-sha256","passEnv":"SF88_BACKUP_PASSPHRASE","python":"/absolute/python3"}'],
];

final class InputException extends \RuntimeException {}

/** Decode only the outer JSON object to an array; nested {} and [] stay distinct. */
function readObjectFile(string $path): array
{
    if ($path === '' || str_contains($path, "\0") || !is_file($path)) {
        throw new InputException('ACQUISITION_CLI_INPUT_FILE_REQUIRED');
    }
    $file = @fopen($path, 'rb');
    if ($file === false) {
        throw new InputException('ACQUISITION_CLI_INPUT_UNREADABLE');
    }
    try {
        $info = @fstat($file);
        if ($info === false || ($info['mode'] & 0170000) !== 0100000 || $info['size'] > INPUT_LIMIT) {
            throw new InputException('ACQUISITION_CLI_INPUT_LIMIT_OR_TYPE');
        }
        $bytes = @stream_get_contents($file, INPUT_LIMIT + 1);
        if ($bytes === false || strlen($bytes) > INPUT_LIMIT) {
            throw new InputException('ACQUISITION_CLI_INPUT_LIMIT_OR_TYPE');
        }
    } finally {
        @fclose($file);
    }
    try {
        $value = json_decode($bytes, false, 512, JSON_THROW_ON_ERROR | JSON_BIGINT_AS_STRING);
    } catch (\JsonException) {
        throw new InputException('ACQUISITION_CLI_JSON_INVALID');
    }
    if (!$value instanceof \stdClass) {
        throw new InputException('ACQUISITION_CLI_JSON_OBJECT_REQUIRED');
    }
    return get_object_vars($value);
}

/** Install cooperative process cancellation and retain the caller's exact signal. */
function cancellation(): array
{
    $exit = null;
    $restore = static function (): void {};
    if (function_exists('pcntl_signal') && function_exists('pcntl_async_signals')) {
        $async = pcntl_async_signals();
        $interrupt = pcntl_signal_get_handler(SIGINT);
        $terminate = pcntl_signal_get_handler(SIGTERM);
        pcntl_async_signals(true);
        pcntl_signal(SIGINT, static function () use (&$exit): void { $exit ??= 130; });
        pcntl_signal(SIGTERM, static function () use (&$exit): void { $exit ??= 143; });
        $restore = static function () use ($async, $interrupt, $terminate): void {
            pcntl_signal(SIGINT, $interrupt);
            pcntl_signal(SIGTERM, $terminate);
            pcntl_async_signals($async);
        };
    }
    return [
        'check' => static function () use (&$exit): bool { return $exit !== null; },
        'exitCode' => static function () use (&$exit): ?int { return $exit; },
        'restore' => $restore,
    ];
}

/** Stdout contains one JSON document; raw process logs and exceptions are never printed. */
function writeJson(mixed $value, bool $pretty = false): bool
{
    try {
        $bytes = json_encode($value, JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES |
            JSON_PRESERVE_ZERO_FRACTION | ($pretty ? JSON_PRETTY_PRINT : 0)) . "\n";
    } catch (\Throwable) {
        @fwrite(STDERR, "ACQUISITION_CLI_OUTPUT_ENCODING_FAILED\n");
        return false;
    }
    for ($offset = 0, $length = strlen($bytes); $offset < $length;) {
        $written = @fwrite(STDOUT, substr($bytes, $offset));
        if ($written === false || $written === 0) {
            return false;
        }
        $offset += $written;
    }
    return true;
}

/** The same single dispatch is usable by the executable command-file example. */
function executeCommand(array $settings, string $command, array $parameters, bool $pretty = false): int
{
    if (!array_key_exists($command, COMMANDS)) {
        throw new InputException('ACQUISITION_CLI_COMMAND_REQUIRED');
    }
    $sdk = dirname(__DIR__) . '/src/Acquisitions.php';
    if (!is_file($sdk)) {
        throw new InputException('ACQUISITION_CLI_SDK_SOURCE_REQUIRED');
    }
    require_once $sdk;
    $cancel = cancellation();
    try {
        $workspace = new AcquisitionWorkspace($settings);
        $result = $workspace->command($command, $parameters, $cancel['check']);
        if (!writeJson($result, $pretty)) {
            return 74;
        }
        return $cancel['exitCode']() ?? ($result->ok ? 0 : 2);
    } catch (AcquisitionException $error) {
        if (!writeJson(['errorCode' => $error->errorCode, 'result' => $error->result], $pretty)) {
            return 74;
        }
        return $cancel['exitCode']() ?? 2;
    } finally {
        $cancel['restore']();
    }
}

function help(?string $command = null): string
{
    $usage = "Stellar Forge buyer acquisitions\n\n" .
        "Usage: php bin/stellar-forge-acquisitions.php --settings FILE COMMAND [--parameters FILE] [--pretty]\n" .
        "       php bin/stellar-forge-acquisitions.php [COMMAND] --help\n\n";
    if ($command !== null) {
        if (!array_key_exists($command, COMMANDS)) {
            throw new InputException('ACQUISITION_CLI_COMMAND_REQUIRED');
        }
        return $usage . $command . "\n" . COMMANDS[$command][0] . "\n\n" .
            "Parameter-file shape (use actual retained IDs, paths and review digests):\n" .
            COMMANDS[$command][1] . "\n\n" .
            "Fields marked optional in their example values may be omitted. Native validation remains authoritative.\n" .
            "The CLI passes the original bridge field names unchanged. Each call runs one command.\n";
    }
    $commands = '';
    foreach (COMMANDS as $name => [$description]) {
        $commands .= '  ' . str_pad($name, 18) . $description . "\n";
    }
    return $usage . "Options:\n" .
        "  --settings FILE     JSON object with the PHP SDK's runtime/workspace settings.\n" .
        "  --parameters FILE   JSON object with this native command's fields; defaults to {}.\n" .
        "  --pretty            Indent the single JSON result written to stdout.\n" .
        "  --help, -h          Show this help, or the selected command's parameter shape.\n\n" .
        $commands . "\nUse private canonical native paths. Quote atomic budget amounts as JSON strings.\n" .
        "Original terminal approval controls execute. No payment or follow-up command is automatic.\n" .
        "SIGINT/SIGTERM request native cancellation when PHP's optional PCNTL extension is available.\n" .
        "Exit: 0 success; 2 native/SDK outcome; 64 input; 70 local error; 74 output; 130 SIGINT; 143 SIGTERM.\n";
}

function main(array $arguments): int
{
    $pretty = false;
    try {
        $options = [];
        $command = null;
        $showHelp = false;
        for ($index = 0, $count = count($arguments); $index < $count; $index++) {
            $argument = $arguments[$index];
            if ($argument === '--help' || $argument === '-h') {
                $showHelp = true;
            } elseif ($argument === '--pretty') {
                if ($pretty) throw new InputException('ACQUISITION_CLI_DUPLICATE_OPTION');
                $pretty = true;
            } elseif (preg_match('/^--(settings|parameters)(?:=(.*))?$/D', $argument, $match)) {
                $name = $match[1];
                if (array_key_exists($name, $options)) throw new InputException('ACQUISITION_CLI_DUPLICATE_OPTION');
                $value = array_key_exists(2, $match) ? $match[2] : ($arguments[++$index] ?? null);
                if (!is_string($value) || $value === '' || str_starts_with($value, '--')) {
                    throw new InputException('ACQUISITION_CLI_OPTION_VALUE_REQUIRED');
                }
                $options[$name] = $value;
            } elseif (str_starts_with($argument, '-')) {
                throw new InputException('ACQUISITION_CLI_OPTION_UNKNOWN');
            } elseif ($command === null) {
                $command = $argument;
            } else {
                throw new InputException('ACQUISITION_CLI_ONE_COMMAND_REQUIRED');
            }
        }
        if ($showHelp || !$arguments) {
            fwrite(STDOUT, help($command));
            return 0;
        }
        if ($command === null || !array_key_exists($command, COMMANDS)) {
            throw new InputException('ACQUISITION_CLI_COMMAND_REQUIRED');
        }
        if (!isset($options['settings'])) throw new InputException('ACQUISITION_CLI_SETTINGS_REQUIRED');
        $settings = readObjectFile($options['settings']);
        $parameters = isset($options['parameters']) ? readObjectFile($options['parameters']) : [];
        return executeCommand($settings, $command, $parameters, $pretty);
    } catch (InputException $error) {
        fwrite(STDERR, "Use --help or COMMAND --help for the exact interface.\n");
        return writeJson(['errorCode' => $error->getMessage(), 'result' => null], $pretty) ? 64 : 74;
    } catch (\Throwable) {
        return writeJson(['errorCode' => 'ACQUISITION_CLI_LOCAL_ERROR', 'result' => null], $pretty) ? 70 : 74;
    }
}

