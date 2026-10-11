<?php
declare(strict_types=1);

// MIT. PHP customer operations through the original Stellar Forge runbook.
namespace StellarForge\Buyer;

use JsonSerializable;
use RuntimeException;
use stdClass;
use Throwable;

final class AcquisitionException extends RuntimeException
{
    public function __construct(
        public readonly string $errorCode,
        public readonly ?AcquisitionResult $result = null
    ) {
        parent::__construct($errorCode);
    }
}

/** Native completion and the caller's process outcome remain separate. */
final class AcquisitionResult implements JsonSerializable
{
    public readonly bool $ok;

    public function __construct(
        public readonly string $command,
        public readonly string $commandId,
        public readonly bool $completionReported,
        public readonly mixed $native,
        public readonly array $process
    ) {
        $this->ok = $completionReported && $process['exitCode'] === 0
            && $process['exitSignal'] === null && $process['errorCode'] === null
            && $process['nativeErrorCode'] === null && $process['cleanupErrorCode'] === null
            && !$process['interrupted'];
    }

    public function jsonSerialize(): array
    {
        return ['command' => $this->command, 'commandId' => $this->commandId,
            'completionReported' => $this->completionReported, 'native' => $this->native,
            'process' => $this->process, 'ok' => $this->ok];
    }
}

/** Construction selects paths only; it never creates a workspace or ledger. */
final class AcquisitionWorkspace
{
    public const SCHEMA = 'stellar-forge.buyer-acquisitions-command.v1';
    public const COMMANDS = [
        'state' => [], 'attach' => ['run'], 'request' => ['id'],
        'receive' => ['file', 'filename'],
        'paid-file' => ['id'], 'receive-paid-file' => ['file', 'filename'],
        'review-paid-file' => ['id', 'expectedRevision', 'totalAtomic', 'dailyAtomic', 'filename', 'claimEnv'],
        'prepare-paid-file' => ['id', 'reviewSha256'], 'export-paid-file' => ['id', 'destination'],
        'retrieve-paid-file' => ['id', 'only', 'configSha256', 'handoffSha256'],
        'reset-paid-file' => ['id', 'only', 'configSha256', 'handoffSha256'],
        'download-paid-file' => ['id', 'operationId', 'destination'],
        'review-request' => ['id', 'acceptIndex', 'totalAtomic', 'dailyAtomic'],
        'prepare-request' => ['id', 'reviewSha256'],
        'draft' => ['id', 'revision'], 'save' => ['id', 'expectedRevision', 'manifest'],
        'initialize' => ['id', 'expectedRevision', 'reviewSha256'], 'inspect' => ['id'],
        'execute' => ['id', 'only', 'expectedPlanSha256'], 'recover' => ['id'],
        'unlock' => ['id', 'ownerPid'], 'finalize' => ['id', 'only'],
        'bind-accounting' => ['id', 'only', 'workspace'],
        'preview' => ['id', 'operationId'], 'download' => ['id', 'operationId', 'destination'],
        'export' => ['id', 'format', 'destination'],
        'export-request' => ['id', 'kind', 'destination'],
        'backup-review' => ['stateRoot'],
        'backup' => ['stateRoot', 'output', 'expectedReviewSha256', 'quiesced', 'passEnv'],
        'verify' => ['bundle', 'expected', 'passEnv', 'python'],
        'restore' => ['bundle', 'expected', 'passEnv', 'python'],
    ];

    public readonly string $runtimeDirectory;
    public readonly string $node;
    public readonly ?string $directory;
    public readonly ?string $configsDirectory;
    public readonly ?string $operatorSettings;
    public readonly ?array $paidFileClaimEnvs;
    public readonly ?string $temporaryDirectory;
    public readonly int $resultLimit;
    public readonly int $timeoutMs;
    public readonly int $cleanupGraceMs;
    public readonly int $outputLimit;
    private readonly ?array $environment;

    public function __construct(array $settings)
    {
        self::need(PHP_OS_FAMILY !== 'Windows' && PHP_INT_SIZE >= 8, 'ACQUISITION_POSIX_64BIT_REQUIRED');
        self::need(array_diff(array_keys($settings), ['runtimeDirectory', 'node', 'directory',
            'configsDirectory', 'operatorSettings', 'paidFileClaimEnvs', 'temporaryDirectory', 'resultLimit',
            'timeoutMs', 'cleanupGraceMs', 'outputLimit', 'environment']) === [],
            'ACQUISITION_SETTINGS_FIELDS_INVALID');
        $this->runtimeDirectory = self::canonical($settings['runtimeDirectory'] ?? null);
        $this->node = self::canonical($settings['node'] ?? null);
        foreach (['directory', 'configsDirectory', 'operatorSettings', 'temporaryDirectory'] as $name) {
            $this->$name = isset($settings[$name]) ? self::canonical($settings[$name]) : null;
        }
        $claimEnvs = $settings['paidFileClaimEnvs'] ?? null;
        self::need($claimEnvs === null || is_array($claimEnvs) && array_is_list($claimEnvs)
            && count($claimEnvs) > 0 && count($claimEnvs) <= 32,
            'PAID_FILE_CLAIM_ENVS_INVALID');
        foreach ($claimEnvs ?? [] as $name) {
            self::need(is_string($name) && preg_match('/^[A-Z][A-Z0-9_]{1,64}$/D', $name) === 1,
                'PAID_FILE_CLAIM_ENVS_INVALID');
        }
        self::need($claimEnvs === null || count(array_unique($claimEnvs)) === count($claimEnvs),
            'PAID_FILE_CLAIM_ENVS_INVALID');
        $this->paidFileClaimEnvs = $claimEnvs;
        foreach (['timeoutMs' => 360000, 'cleanupGraceMs' => 15000, 'outputLimit' => 1048576,
            'resultLimit' => 33554432] as $name => $default) {
            $value = $settings[$name] ?? $default;
            self::need(is_int($value) && $value > 0 && $value <= 2147483647, 'ACQUISITION_RUNTIME_LIMIT_INVALID');
            $this->$name = $value;
        }
        self::need($this->resultLimit >= 1048576 && $this->resultLimit <= 268435456,
            'ACQUISITION_RESULT_LIMIT_INVALID');
        $environment = $settings['environment'] ?? null;
        if ($environment instanceof stdClass) $environment = (array)$environment;
        self::need($environment === null || is_array($environment), 'ACQUISITION_ENVIRONMENT_INVALID');
        foreach ($environment ?? [] as $name => $value) {
            self::need(is_string($name) && preg_match('/^[A-Za-z_][A-Za-z0-9_]*$/D', $name) === 1
                && is_string($value) && !str_contains($value, "\0"), 'ACQUISITION_ENVIRONMENT_INVALID');
        }
        $this->environment = $environment;
    }

    private static function need(bool $condition, string $code): void
    {
        if (!$condition) throw new AcquisitionException($code);
    }

    private static function canonical(mixed $path): string
    {
        self::need(is_string($path) && str_starts_with($path, '/') && $path !== '/'
            && !str_contains($path, "\0"), 'ACQUISITION_CANONICAL_PATH_REQUIRED');
        $parts = explode('/', substr($path, 1));
        self::need(!array_intersect($parts, ['', '.', '..']), 'ACQUISITION_CANONICAL_PATH_REQUIRED');
        return $path;
    }

    private static function within(string $root, string $path): bool
    {
        return $root === $path || str_starts_with($path, $root . '/');
    }

    private static function safeCode(mixed $value, ?string $fallback): ?string
    {
        return is_string($value) && preg_match('/^[A-Z0-9_]{1,120}$/D', $value) === 1 ? $value : $fallback;
    }

    private static function uuid(): string
    {
        $bytes = random_bytes(16);
        $bytes[6] = chr((ord($bytes[6]) & 0x0f) | 0x40);
        $bytes[8] = chr((ord($bytes[8]) & 0x3f) | 0x80);
        $hex = bin2hex($bytes);
        return substr($hex, 0, 8) . '-' . substr($hex, 8, 4) . '-' . substr($hex, 12, 4)
            . '-' . substr($hex, 16, 4) . '-' . substr($hex, 20);
    }

    /** Objects and quoted atomic amounts retain their types; oversized integers become exact strings. */
    public static function readJson(string $path, int $limit = 1048576): stdClass
    {
        $raw = self::readBytes(self::canonical($path), $limit);
        try { $value = json_decode($raw, false, 512, JSON_THROW_ON_ERROR | JSON_BIGINT_AS_STRING); }
        catch (Throwable) { throw new AcquisitionException('ACQUISITION_JSON_INVALID'); }
        self::need($value instanceof stdClass, 'ACQUISITION_JSON_OBJECT_REQUIRED');
        return $value;
    }

    private static function readBytes(string $path, int $limit): string
    {
        clearstatcache(true, $path);
        $before = @lstat($path);
        self::need($before !== false && ($before['mode'] & 0170000) === 0100000
            && $before['size'] <= $limit && realpath($path) === $path, 'ACQUISITION_FILE_LIMIT_OR_TYPE');
        $file = @fopen($path, 'rb');
        self::need(is_resource($file), 'ACQUISITION_FILE_READ_FAILED');
        try {
            $opened = fstat($file);
            self::need($opened !== false && $opened['dev'] === $before['dev']
                && $opened['ino'] === $before['ino'], 'ACQUISITION_FILE_IDENTITY_CHANGED');
            $raw = stream_get_contents($file, $limit + 1);
            $after = fstat($file);
            self::need(is_string($raw) && strlen($raw) <= $limit && $after !== false
                && strlen($raw) === $after['size'] && $after['size'] === $opened['size']
                && $after['mtime'] === $opened['mtime'] && $after['ctime'] === $opened['ctime'],
                'ACQUISITION_FILE_CHANGED_OR_LIMIT');
            return $raw;
        } finally { fclose($file); }
    }

    private static function privateFile(string $path)
    {
        $mask = umask(0077);
        try { $file = @fopen($path, 'x+b'); }
        finally { umask($mask); }
        self::need(is_resource($file), 'ACQUISITION_PRIVATE_FILE_CREATE_FAILED');
        return $file;
    }

    private static function writeAll($file, string $bytes): void
    {
        $offset = 0;
        while ($offset < strlen($bytes)) {
            $written = @fwrite($file, substr($bytes, $offset));
            self::need(is_int($written) && $written > 0, 'ACQUISITION_PRIVATE_FILE_WRITE_FAILED');
            $offset += $written;
        }
        self::need(@fflush($file) && @fsync($file), 'ACQUISITION_PRIVATE_FILE_SYNC_FAILED');
    }

    private function scratch(array $parameters): string
    {
        $requested = isset($parameters['stateRoot']) ? dirname(self::canonical($parameters['stateRoot']))
            : ($this->temporaryDirectory ?? sys_get_temp_dir());
        $parent = realpath($requested);
        self::need(is_string($parent) && is_dir($parent), 'ACQUISITION_TEMPORARY_PARENT_REQUIRED');
        if ($this->temporaryDirectory !== null || isset($parameters['stateRoot'])) {
            self::need($parent === $requested, 'ACQUISITION_CANONICAL_PATH_REQUIRED');
        }
        foreach ([$this->directory, $this->configsDirectory, $parameters['stateRoot'] ?? null] as $selected) {
            if ($selected === null) continue;
            $selected = self::canonical($selected);
            self::need(!self::within($selected, $parent)
                && !self::within(realpath($selected) ?: $selected, $parent),
                'ACQUISITION_TEMPORARY_DIRECTORY_INSIDE_SOURCE');
        }
        $path = $parent . '/.sf88-acquisitions-' . bin2hex(random_bytes(16));
        self::need(@mkdir($path, 0700), 'ACQUISITION_TEMPORARY_DIRECTORY_CREATE_FAILED');
        return $path;
    }

    private static function cleanup(string $directory): ?string
    {
        // Only our unique process directory; never follow a child symlink.
        $items = @scandir($directory);
        if (!is_array($items)) return 'ACQUISITION_TEMPORARY_CLEANUP_FAILED';
        $ok = true;
        foreach ($items as $name) {
            if ($name === '.' || $name === '..') continue;
            $path = $directory . '/' . $name;
            $info = @lstat($path);
            if ($info === false) continue;
            if (($info['mode'] & 0170000) === 0040000) {
                $ok = self::cleanup($path) === null && $ok;
            } else { $ok = @unlink($path) && $ok; }
        }
        return @rmdir($directory) && $ok ? null : 'ACQUISITION_TEMPORARY_CLEANUP_FAILED';
    }

    /** One argv-array native child. It owns its original cancellation and approval. */
    private function run(string $scratch, ?callable $isCancelled): array
    {
        foreach (['proc_open', 'proc_get_status', 'proc_terminate', 'proc_close', 'fsync'] as $function) {
            self::need(function_exists($function), 'ACQUISITION_PROCESS_FUNCTIONS_REQUIRED');
        }
        $bridge = dirname($this->runtimeDirectory) . '/buyer-runbook/customer-bridge.mjs';
        self::need(is_file($bridge) && !is_link($bridge), 'ACQUISITION_NATIVE_BRIDGE_REQUIRED');
        self::need(is_file($this->node) && is_executable($this->node), 'ACQUISITION_NODE_EXECUTABLE_REQUIRED');
        $stdout = $stderr = $child = null;
        $started = false; $exitCode = $exitSignal = $error = null;
        $cancelled = false; $status = null; $stopAt = null; $killed = false;
        try {
            $stdout = self::privateFile($scratch . '/stdout.json');
            $stderr = self::privateFile($scratch . '/stderr.log');
            if ($isCancelled && $isCancelled()) {
                $cancelled = true; throw new AcquisitionException('OPERATION_ABORTED_BEFORE_START');
            }
            $descriptors = [0 => defined('STDIN') ? STDIN : ['file', '/dev/null', 'r'], 1 => $stdout, 2 => $stderr];
            $child = @proc_open([$this->node, $bridge, $scratch . '/input.json', $scratch . '/result.json'],
                $descriptors, $pipes, $this->runtimeDirectory, $this->environment, ['bypass_shell' => true]);
            self::need(is_resource($child), 'NATIVE_START_FAILED');
            $started = true;
            $began = hrtime(true);
            while (true) {
                $status = @proc_get_status($child);
                self::need(is_array($status), 'NATIVE_PROCESS_STATUS_FAILED');
                if (!$status['running']) {
                    $exitCode = $status['exitcode'] >= 0 ? $status['exitcode'] : null;
                    $exitSignal = $status['signaled'] ? $status['termsig'] : null;
                    break;
                }
                $now = hrtime(true);
                if ($isCancelled && $isCancelled()) { $cancelled = true; $error ??= 'OPERATION_ABORTED'; }
                if (($now - $began) / 1000000 >= $this->timeoutMs) $error ??= 'NATIVE_TIMEOUT';
                foreach ([$stdout, $stderr] as $file) {
                    $info = @fstat($file);
                    if ($info === false) $error ??= 'NATIVE_LOG_IO_FAILED';
                    elseif ($info['size'] > $this->outputLimit) $error ??= 'NATIVE_OUTPUT_LIMIT';
                }
                if ($error !== null && $stopAt === null) {
                    @proc_terminate($child, 15); $stopAt = $now;
                } elseif ($stopAt !== null && !$killed && ($now - $stopAt) / 1000000 >= $this->cleanupGraceMs) {
                    $error = 'NATIVE_CLEANUP_DEADLINE_EXCEEDED';
                    @proc_terminate($child, 9); $killed = true;
                }
                usleep(50000);
            }
        } catch (Throwable $problem) {
            $error ??= self::safeCode($problem instanceof AcquisitionException ? $problem->errorCode : null,
                'ACQUISITION_NATIVE_COMMAND_FAILED');
        } finally {
            // An application callback failure must also close this same child.
            if (is_resource($child)) {
                if ($status === null || ($status['running'] ?? false)) {
                    @proc_terminate($child, 15);
                    $deadline = hrtime(true) + $this->cleanupGraceMs * 1000000;
                    do {
                        $status = @proc_get_status($child);
                        if (!is_array($status) || !$status['running']) break;
                        usleep(50000);
                    } while (hrtime(true) < $deadline);
                    if ($status['running'] ?? false) {
                        @proc_terminate($child, 9); $error = 'NATIVE_CLEANUP_DEADLINE_EXCEEDED';
                    } elseif (is_array($status)) {
                        $exitCode ??= $status['exitcode'] >= 0 ? $status['exitcode'] : null;
                        $exitSignal ??= $status['signaled'] ? $status['termsig'] : null;
                    }
                }
                $closed = @proc_close($child);
                if ($exitCode === null && is_int($closed) && $closed >= 0) $exitCode = $closed;
            }
            foreach ([$stdout, $stderr] as $file) {
                if (!is_resource($file)) continue;
                $info = @fstat($file);
                if ($info === false) $error ??= 'NATIVE_LOG_IO_FAILED';
                elseif ($info['size'] > $this->outputLimit) {
                    $error ??= 'NATIVE_OUTPUT_LIMIT'; @ftruncate($file, $this->outputLimit);
                }
                if (!@fflush($file) || !@fsync($file)) $error ??= 'NATIVE_LOG_IO_FAILED';
                @fclose($file);
            }
        }
        // Only a structured native error code can leave the private log.
        try {
            $lines = explode("\n", trim(self::readBytes($scratch . '/stderr.log', $this->outputLimit)));
            $last = json_decode(end($lines), false, 16, JSON_THROW_ON_ERROR);
            $error ??= self::safeCode($last->error ?? null, null);
        } catch (Throwable) { }
        return compact('started', 'exitCode', 'exitSignal', 'error', 'cancelled');
    }

    /** Exact native command/parameter names; no retry, new intent, or follow-up action. */
    public function command(string $command, array $parameters = [], ?callable $isCancelled = null): AcquisitionResult
    {
        self::need(array_key_exists($command, self::COMMANDS), 'ACQUISITION_COMMAND_REQUIRED');
        self::need(array_diff(array_keys($parameters), self::COMMANDS[$command]) === [],
            'ACQUISITION_ARGUMENT_FIELDS_INVALID');
        self::need(in_array($command, ['verify', 'restore'], true) || $this->directory !== null,
            'ACQUISITION_WORKSPACE_REQUIRED');
        if ($command === 'backup') self::need(($parameters['quiesced'] ?? null) === true,
            'WORKSPACE_RECOVERY_QUIESCED_SOURCE_REQUIRED');
        $commandId = self::uuid();
        $input = ['schema' => self::SCHEMA, 'command' => $command, 'commandId' => $commandId,
            'parameters' => (object)$parameters, 'resultLimit' => $this->resultLimit];
        if ($this->directory !== null) {
            $input['workspace'] = array_filter(['directory' => $this->directory,
                'configsDirectory' => $this->configsDirectory, 'operatorSettings' => $this->operatorSettings,
                'paidFileClaimEnvs' => $this->paidFileClaimEnvs],
                static fn($value) => $value !== null);
        }
        $scratch = null; $record = null; $raw = null; $problem = $cleanup = null; $callerCancelled = false;
        $run = ['started' => false, 'exitCode' => null, 'exitSignal' => null, 'error' => null, 'cancelled' => false];
        try {
            if ($isCancelled && $isCancelled()) {
                $callerCancelled = true; throw new AcquisitionException('OPERATION_ABORTED_BEFORE_START');
            }
            $bytes = json_encode($input, JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE) . "\n";
            self::need(strlen($bytes) <= 1048576, 'ACQUISITION_INPUT_LIMIT_OR_TYPE');
            $scratch = $this->scratch($parameters);
            $file = self::privateFile($scratch . '/input.json');
            try { self::writeAll($file, $bytes); } finally { fclose($file); }
            $run = $this->run($scratch, $isCancelled);
        } catch (Throwable $error) {
            $problem = self::safeCode($error instanceof AcquisitionException ? $error->errorCode : null,
                'ACQUISITION_NATIVE_COMMAND_FAILED');
        } finally {
            // Read the independent, fsynced result even after exit/cancel/log failure.
            if ($scratch !== null) {
                try {
                    $raw = self::readBytes($scratch . '/result.json', $this->resultLimit);
                    $record = json_decode($raw, false, 512, JSON_THROW_ON_ERROR | JSON_BIGINT_AS_STRING);
                } catch (Throwable) { }
                try {
                    $summary = self::readJson($scratch . '/stdout.json', $this->outputLimit);
                    if (($summary->schema ?? null) !== self::SCHEMA || ($summary->command ?? null) !== $command
                        || ($summary->commandId ?? null) !== $commandId || !is_string($raw)
                        || ($summary->resultBytes ?? null) !== strlen($raw)
                        || ($summary->resultSha256 ?? null) !== hash('sha256', $raw)) {
                        $problem ??= 'ACQUISITION_RESULT_SUMMARY_MISMATCH';
                    }
                } catch (Throwable) { /* A lost stdout summary does not discard the native result. */ }
                $cleanup = self::cleanup($scratch);
            }
        }
        $valid = $record instanceof stdClass && ($record->schema ?? null) === self::SCHEMA
            && ($record->command ?? null) === $command && ($record->commandId ?? null) === $commandId
            && isset($record->completed) && is_bool($record->completed);
        if (!$valid) $problem ??= 'ACQUISITION_NATIVE_RESULT_INVALID';
        if ($valid) {
            foreach (['error', 'cleanupError'] as $field) {
                if (!property_exists($record, $field) || $record->$field !== null
                    && self::safeCode($record->$field, null) === null) {
                    $problem ??= 'ACQUISITION_NATIVE_RESULT_INVALID';
                }
            }
            if (!property_exists($record, 'native') || !property_exists($record, 'interrupted')
                || !is_bool($record->interrupted)) $problem ??= 'ACQUISITION_NATIVE_RESULT_INVALID';
        }
        // Signals can arrive after the child exits, while its durable result is
        // being read. Retain that native completion and the final caller state.
        if ($isCancelled) {
            try {
                if ($isCancelled()) {
                    $callerCancelled = true; $run['error'] ??= 'OPERATION_ABORTED';
                }
            } catch (Throwable) { $problem ??= 'ACQUISITION_CANCELLATION_CALLBACK_FAILED'; }
        }
        $callerCancelled = $callerCancelled || $run['cancelled'];
        $nativeCleanup = $valid ? self::safeCode($record->cleanupError ?? null, null) : null;
        $process = ['exitCode' => $run['exitCode'], 'exitSignal' => $run['exitSignal'],
            'started' => $run['started'], 'errorCode' => $problem ?? $run['error'],
            'nativeErrorCode' => $valid ? self::safeCode($record->error ?? null, null) : null,
            'cleanupErrorCode' => $cleanup ?? $nativeCleanup,
            'nativeCleanupErrorCode' => $nativeCleanup, 'temporaryCleanupErrorCode' => $cleanup,
            'callerCancelled' => $callerCancelled,
            'interrupted' => $callerCancelled || $run['exitSignal'] !== null
                || ($valid && ($record->interrupted ?? false) === true)
                || in_array($problem ?? $run['error'], ['NATIVE_TIMEOUT', 'NATIVE_CLEANUP_DEADLINE_EXCEEDED',
                    'OPERATION_ABORTED', 'OPERATION_ABORTED_BEFORE_START'], true)];
        $result = new AcquisitionResult($command, $commandId, $valid && $record->completed,
            $valid ? ($record->native ?? null) : null, $process);
        if (!$result->ok) throw new AcquisitionException($process['errorCode'] ?? $process['nativeErrorCode']
            ?? $process['cleanupErrorCode'] ?? 'ACQUISITION_NATIVE_COMMAND_FAILED', $result);
        return $result;
    }

    public function state(?callable $cancel = null): AcquisitionResult { return $this->command('state', [], $cancel); }
    public function attachRun(string $run, ?callable $cancel = null): AcquisitionResult { return $this->command('attach', ['run' => self::canonical($run)], $cancel); }
    public function request(string $id, ?callable $cancel = null): AcquisitionResult { return $this->command('request', ['id' => $id], $cancel); }
    public function receiveRequest(string $file, array $options = [], ?callable $cancel = null): AcquisitionResult { return $this->command('receive', ['file' => self::canonical($file)] + $options, $cancel); }
    public function paidFile(string $id, ?callable $cancel = null): AcquisitionResult { return $this->command('paid-file', ['id' => $id], $cancel); }
    public function receivePaidFile(string $file, array $options = [], ?callable $cancel = null): AcquisitionResult { return $this->command('receive-paid-file', ['file' => self::canonical($file)] + $options, $cancel); }
    public function reviewPaidFile(string $id, array $options, ?callable $cancel = null): AcquisitionResult { return $this->command('review-paid-file', ['id' => $id] + $options, $cancel); }
    public function preparePaidFile(string $id, array $options, ?callable $cancel = null): AcquisitionResult { return $this->command('prepare-paid-file', ['id' => $id] + $options, $cancel); }
    public function retrievePaidFile(string $id, array $options, ?callable $cancel = null): AcquisitionResult { return $this->command('retrieve-paid-file', ['id' => $id] + $options, $cancel); }
    public function resetPaidFile(string $id, array $options, ?callable $cancel = null): AcquisitionResult { return $this->command('reset-paid-file', ['id' => $id] + $options, $cancel); }
    public function downloadPaidFile(string $id, string $operationId, string $destination, ?callable $cancel = null): AcquisitionResult { return $this->command('download-paid-file', ['id' => $id, 'operationId' => $operationId, 'destination' => self::canonical($destination)], $cancel); }
    public function exportPaidFile(string $id, array $options, ?callable $cancel = null): AcquisitionResult { return $this->command('export-paid-file', ['id' => $id] + $options, $cancel); }
    public function reviewRequest(string $id, array $options, ?callable $cancel = null): AcquisitionResult { return $this->command('review-request', ['id' => $id] + $options, $cancel); }
    public function prepareRequest(string $id, array $options, ?callable $cancel = null): AcquisitionResult { return $this->command('prepare-request', ['id' => $id] + $options, $cancel); }
    public function draft(string $id, array $options = [], ?callable $cancel = null): AcquisitionResult { return $this->command('draft', ['id' => $id] + $options, $cancel); }
    public function save(array $parameters, ?callable $cancel = null): AcquisitionResult { return $this->command('save', $parameters, $cancel); }
    public function initialize(string $id, array $options, ?callable $cancel = null): AcquisitionResult { return $this->command('initialize', ['id' => $id] + $options, $cancel); }
    public function inspect(string $id, ?callable $cancel = null): AcquisitionResult { return $this->command('inspect', ['id' => $id], $cancel); }
    public function execute(string $id, array $options, ?callable $cancel = null): AcquisitionResult { return $this->command('execute', ['id' => $id] + $options, $cancel); }
    public function recover(string $id, ?callable $cancel = null): AcquisitionResult { return $this->command('recover', ['id' => $id], $cancel); }
    public function unlock(string $id, array $options, ?callable $cancel = null): AcquisitionResult { return $this->command('unlock', ['id' => $id] + $options, $cancel); }
    public function finalize(string $id, array $options = [], ?callable $cancel = null): AcquisitionResult { return $this->command('finalize', ['id' => $id] + $options, $cancel); }
    public function bindAccounting(string $id, array $options, ?callable $cancel = null): AcquisitionResult { return $this->command('bind-accounting', ['id' => $id] + $options, $cancel); }
    public function preview(string $id, string $operationId, ?callable $cancel = null): AcquisitionResult { return $this->command('preview', ['id' => $id, 'operationId' => $operationId], $cancel); }
    public function download(string $id, string $operationId, string $destination, ?callable $cancel = null): AcquisitionResult { return $this->command('download', ['id' => $id, 'operationId' => $operationId, 'destination' => self::canonical($destination)], $cancel); }
    public function export(string $id, array $options, ?callable $cancel = null): AcquisitionResult { return $this->command('export', ['id' => $id] + $options, $cancel); }
    public function exportRequest(string $id, array $options, ?callable $cancel = null): AcquisitionResult { return $this->command('export-request', ['id' => $id] + $options, $cancel); }
    public function backupReview(array $options, ?callable $cancel = null): AcquisitionResult { return $this->command('backup-review', $options, $cancel); }
    public function backup(array $options, ?callable $cancel = null): AcquisitionResult {
        return $this->command('backup', self::aliases($options,
            ['reviewSha256' => 'expectedReviewSha256', 'passphraseEnv' => 'passEnv']), $cancel);
    }
    private static function aliases(array $options, array $aliases): array {
        foreach ($aliases as $alias => $native) {
            if (!array_key_exists($alias, $options)) continue;
            self::need(!array_key_exists($native, $options) || $options[$native] === $options[$alias],
                'ACQUISITION_ARGUMENT_ALIAS_CONFLICT');
            $options[$native] = $options[$alias]; unset($options[$alias]);
        }
        return $options;
    }
    public function verify(array $options, ?callable $cancel = null): AcquisitionResult { return $this->command('verify', self::aliases($options, ['expectedRecordSha256' => 'expected', 'passphraseEnv' => 'passEnv']), $cancel); }
    public function restore(array $options, ?callable $cancel = null): AcquisitionResult { return $this->command('restore', self::aliases($options, ['expectedRecordSha256' => 'expected', 'passphraseEnv' => 'passEnv']), $cancel); }
}
