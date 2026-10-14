# Root opening: use only the supplied bootstrap, then the maintained receiver.
$ErrorActionPreference = 'Stop'
$WorkbenchArguments = @($args)
$Root = $PSScriptRoot

function Bundle-Member([string]$Base, [string]$Relative) {
    if ([string]::IsNullOrWhiteSpace($Relative) -or $Relative.Contains('\') -or
        $Relative.Contains(':') -or $Relative.StartsWith('/') -or
        @($Relative.Split('/') | Where-Object { $_ -eq '.' -or $_ -eq '..' -or $_ -eq '' }).Count) {
        throw "Invalid supplied runtime member: $Relative"
    }
    $Current = $Base
    foreach ($Part in $Relative.Split('/')) {
        $Current = Join-Path $Current $Part
        $Item = Get-Item -LiteralPath $Current -Force
        if ($Item.Attributes -band [IO.FileAttributes]::ReparsePoint) {
            throw "The supplied runtime member is an alias: $Current"
        }
    }
    return $Current
}
function Native-Argument([string]$Value) {
    # Windows CRT argument quoting, including empty strings and trailing slashes.
    return '"' + (($Value -replace '(\\*)"', '$1$1\"') -replace '(\\+)$', '$1$1') + '"'
}
try {
    $Machine = $env:PROCESSOR_ARCHITEW6432
    if (-not $Machine) { $Machine = $env:PROCESSOR_ARCHITECTURE }
    if ($Machine -ne 'AMD64') { throw "No native runtime supplied for Windows $Machine." }
    $Manifest = Get-Content -LiteralPath (Join-Path $Root 'NATIVE_RUNTIME.json') -Raw -Encoding UTF8 | ConvertFrom-Json
    $Descriptor = $Manifest.platforms.'windows-x86_64'
    if (-not $Descriptor) { throw 'Keep the matching Windows runtime manifest in this collection.' }
    $Python = $env:ECOSYSTEMS_PYTHON
    if (-not $Python) {
        $Bootstrap = $Descriptor.bootstrap
        if (-not $Bootstrap -or -not $Bootstrap.files) { throw 'Keep the complete supplied Windows bootstrap in this collection.' }
        $Directory = Bundle-Member $Root $Bootstrap.directory
        $Python = Bundle-Member $Directory $Bootstrap.python
        $Seen = New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)
        foreach ($Row in $Bootstrap.files) {
            $File = Bundle-Member $Directory $Row.path
            if (-not $Seen.Add([string]$Row.path)) { throw "Duplicate bootstrap member: $($Row.path)" }
            $Item = Get-Item -LiteralPath $File -Force
            if ($Item.PSIsContainer -or $Item.Length -ne $Row.bytes) { throw "Incomplete bootstrap file: $($Row.path)" }
            if ((Get-FileHash -LiteralPath $File -Algorithm SHA256).Hash.ToLowerInvariant() -cne $Row.sha256) {
                throw "Different bootstrap file: $($Row.path)"
            }
        }
        if (-not $Seen.Contains([string]$Bootstrap.python)) { throw 'The bootstrap interpreter is absent from its file inventory.' }
    }
    if (-not [IO.Path]::IsPathRooted($Python) -or -not (Test-Path -LiteralPath $Python -PathType Leaf)) {
        throw 'Select the full path of the supplied Python executable.'
    }
    Remove-Item Env:PYTHONHOME -ErrorAction SilentlyContinue
    Remove-Item Env:PYTHONPATH -ErrorAction SilentlyContinue
    $env:PYTHONNOUSERSITE = '1'
    $Start = New-Object Diagnostics.ProcessStartInfo
    $Start.FileName = $Python
    $Start.UseShellExecute = $false
    $Values = @('-I', '-B', (Join-Path $Root 'open_native_collection.py')) + $WorkbenchArguments
    $Start.Arguments = ($Values | ForEach-Object { Native-Argument ([string]$_) }) -join ' '
    $Process = [Diagnostics.Process]::Start($Start)
    $Process.WaitForExit()
    exit $Process.ExitCode
} catch {
    [Console]::Error.WriteLine($_.Exception.Message)
    exit 2
}
