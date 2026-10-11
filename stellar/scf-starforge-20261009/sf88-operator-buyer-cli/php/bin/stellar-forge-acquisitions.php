#!/usr/bin/env php
<?php
declare(strict_types=1);

// MIT. Direct invocation and Composer's generated bin proxy share this entry.
require_once dirname(__DIR__) . '/src/Console.php';
exit(\StellarForge\Buyer\Cli\main(array_slice($argv, 1)));
