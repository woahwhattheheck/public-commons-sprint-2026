#requires -Version 5.1
<#
.SYNOPSIS
Native Power BI Report Server job runner using the current Windows identity.
.DESCRIPTION
Register an existing PBIX/RDL, inspect/capture a target, publish its exact bytes,
reconcile an interrupted attempt, restore the same target, and capture RDL CSV.
State and report content stay in a private, durable local operation directory.
No cloud Power BI API, password prompt, token, installation, or PBIP conversion.
#>
[CmdletBinding()]
param(
    [ValidateSet('Register','Inspect','Capture','Publish','Reconcile','Rollback','Export','Package','Run')]
    [string]$Action = 'Inspect',
    [string]$JobFile,
    [string]$NativeFile,
    [string]$StateDirectory,
    [string]$OutputFile,
    [string]$DesktopBuild = '',
    [string]$ReportServerBuild = '',
    [ValidateSet('auto','before','published','rolled_back')]
    [string]$Stage = 'auto',
    [string[]]$ManualCsvFile = @(),
    [switch]$AllowOverwrite,
    [switch]$KeepPublished,
    [ValidateRange(1,1440)]
    [int]$TimeoutMinutes = 60
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Net.Http
Add-Type -AssemblyName System.IO.Compression
$script:Utf8 = [System.Text.UTF8Encoding]::new($false)
$script:State = $null
$script:Root = $null
$script:Lock = $null
$script:Client = $null
$script:Job = $null
$script:JobHash = $null
$script:JobPath = $null
$script:NetworkWrite = $null
$script:ResultZip = $null
$script:RunnerVersion = '1.0.0'

function Utc-Now { return [DateTime]::UtcNow.ToString('o') }

function To-Map($Value) {
    if ($null -eq $Value) { return $null }
    if ($Value -is [System.Collections.IDictionary]) {
        $m = [ordered]@{}
        foreach ($k in $Value.Keys) { $m[[string]$k] = To-Map $Value[$k] }
        return $m
    }
    if ($Value -is [pscustomobject]) {
        $m = [ordered]@{}
        foreach ($p in $Value.PSObject.Properties) { $m[$p.Name] = To-Map $p.Value }
        return $m
    }
    if ($Value -is [Array]) {
        $a = @()
        foreach ($v in $Value) { $a += ,(To-Map $v) }
        return ,$a
    }
    return $Value
}

function Field($Object, [string]$Name, $Default = $null) {
    if ($null -ne $Object -and $Object -is [System.Collections.IDictionary] -and $Object.Contains($Name)) {
        return $Object[$Name]
    }
    return $Default
}

function Read-Json([string]$Path) {
    return To-Map ([IO.File]::ReadAllText($Path, $script:Utf8) | ConvertFrom-Json)
}

function Write-Json([string]$Path, $Value) {
    $parent = [IO.Path]::GetDirectoryName($Path)
    if (-not [IO.Directory]::Exists($parent)) { [void][IO.Directory]::CreateDirectory($parent) }
    $tmp = $Path + '.' + [Guid]::NewGuid().ToString('N') + '.partial'
    $stream = $null
    try {
        $bytes = $script:Utf8.GetBytes(($Value | ConvertTo-Json -Depth 64) + [Environment]::NewLine)
        $stream = [IO.File]::Open($tmp, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
        $stream.Write($bytes, 0, $bytes.Length)
        $stream.Flush($true)
        $stream.Dispose(); $stream = $null
        if ([IO.File]::Exists($Path)) { [IO.File]::Replace($tmp, $Path, $null) }
        else { [IO.File]::Move($tmp, $Path) }
    } finally {
        if ($null -ne $stream) { $stream.Dispose() }
        if ([IO.File]::Exists($tmp)) { [IO.File]::Delete($tmp) }
    }
}

function File-Digest([string]$Path) {
    $s = [IO.File]::Open($Path, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Read)
    $h = [Security.Cryptography.SHA256]::Create()
    try {
        $digest = [BitConverter]::ToString($h.ComputeHash($s)).Replace('-','').ToLowerInvariant()
        return [ordered]@{ bytes = $s.Length; sha256 = $digest }
    } finally { $h.Dispose(); $s.Dispose() }
}

function Check-Basename([string]$Name) {
    if ([string]::IsNullOrWhiteSpace($Name) -or $Name -in @('.','..') -or
        $Name -match '[<>:"/\\|?*\x00-\x1f]' -or $Name.EndsWith('.') -or $Name.EndsWith(' ') -or
        $Name -match '^(?i:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)') {
        throw 'A portable file basename is required.'
    }
    return $Name
}

function Check-ReportPath([string]$Path) {
    if ([string]::IsNullOrWhiteSpace($Path) -or -not $Path.StartsWith('/') -or
        $Path -eq '/' -or $Path.EndsWith('/') -or $Path -match '[\x00-\x1f\\]' -or
        @($Path.Split('/') | Where-Object { $_ -in @('.','..') }).Count -gt 0) {
        throw 'target.report_path must name one report using an absolute catalog path.'
    }
    return $Path
}

function Check-Endpoint([string]$Value, [bool]$Api) {
    $u = $null
    if (-not [Uri]::TryCreate($Value, [UriKind]::Absolute, [ref]$u) -or
        $u.Scheme -notin @('http','https') -or $u.UserInfo -or $u.Query -or $u.Fragment) {
        throw 'Report Server endpoints must be explicit HTTP(S) URLs without credentials, query, or fragment.'
    }
    $v = $u.AbsoluteUri.TrimEnd('/')
    if ($Api -and -not $v.EndsWith('/api/v2.0', [StringComparison]::OrdinalIgnoreCase)) {
        throw 'target.api_base must be the configured portal REST endpoint ending in /api/v2.0.'
    }
    return $v
}

function Check-Parameters($Value) {
    if ($null -eq $Value) { return [ordered]@{} }
    if ($Value -isnot [System.Collections.IDictionary]) { throw 'Report parameters must be a JSON object.' }
    foreach ($k in $Value.Keys) {
        if ([string]::IsNullOrWhiteSpace([string]$k) -or [string]$k -match '[:\x00-\x1f]') {
            throw 'Report parameter names must be nonempty and must not contain URL-access prefixes.'
        }
        foreach ($v in @($Value[$k])) {
            if ($null -ne $v -and ($v -is [System.Collections.IDictionary] -or $v -is [Array])) {
                throw 'Report parameter values must be scalars, null, or a flat array of scalars.'
            }
        }
    }
    return $Value
}

function Validate-Job($J) {
    if ((Field $J 'schema') -ne 'commons-bi-report-server-job/1') { throw 'Unsupported Report Server job schema.' }
    if ([string](Field $J 'job_id') -notmatch '^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$') { throw 'Invalid job_id.' }
    $n = Field $J 'native'
    if ($null -eq $n) { throw 'The job must retain its native file manifest.' }
    $n.file = Check-Basename ([string](Field $n 'file'))
    if ((Field $n 'kind') -notin @('PowerBIReport','Report')) { throw 'native.kind must be PowerBIReport or Report.' }
    $extension = if ($n.kind -eq 'PowerBIReport') { '.pbix' } else { '.rdl' }
    if ([IO.Path]::GetExtension($n.file).ToLowerInvariant() -ne $extension) { throw 'The native file extension does not match its declared report kind.' }
    if ([string](Field $n 'sha256') -notmatch '^[a-fA-F0-9]{64}$') { throw 'A complete native SHA256 is required.' }
    $n.sha256 = ([string]$n.sha256).ToLowerInvariant()
    $length = [decimal](Field $n 'bytes' -1)
    if ($length -le 0 -or $length -gt [long]::MaxValue -or $length -ne [decimal]::Truncate($length)) {
        throw 'native.bytes must be an exact positive byte count.'
    }
    $n.bytes = [long]$length
    if (-not $n.Contains('embedded')) { $n.embedded = $true }
    if ($n.embedded -isnot [bool]) { throw 'native.embedded must be a Boolean.' }
    $target = Field $J 'target'
    if ($null -eq $target) { throw 'The configured target is missing.' }
    $target.api_base = Check-Endpoint ([string](Field $target 'api_base')) $true
    $renderUrl = [string](Field $target 'report_server_url' '')
    $target.report_server_url = if ([string]::IsNullOrWhiteSpace($renderUrl)) { '' } else { Check-Endpoint $renderUrl $false }
    $target.report_path = Check-ReportPath ([string](Field $target 'report_path'))
    $J.parameters = Check-Parameters (Field $J 'parameters')
    $J.report_server_build = [string](Field $J 'report_server_build' '')
    $J.desktop_build = [string](Field $J 'desktop_build' '')
    $exports = @()
    foreach ($e in @(Field $J 'paginated_exports' @())) {
        if ($null -eq $e) { continue }
        $e.report_path = Check-ReportPath ([string](Field $e 'report_path'))
        $e.file = Check-Basename ([string](Field $e 'file'))
        if ([IO.Path]::GetExtension($e.file).ToLowerInvariant() -ne '.csv') { throw 'Paginated capture files must use .csv.' }
        $e.parameters = Check-Parameters (Field $e 'parameters')
        $exports += ,$e
    }
    $J.paginated_exports = $exports
    return $J
}

function Private-Directory([string]$Path) {
    $existed = [IO.Directory]::Exists($Path)
    [void][IO.Directory]::CreateDirectory($Path)
    $item = Get-Item -LiteralPath $Path
    if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'The operation directory must not be a reparse point.' }
    if (-not $existed) {
        $sid = [Security.Principal.WindowsIdentity]::GetCurrent().User
        $acl = [Security.AccessControl.DirectorySecurity]::new()
        $acl.SetAccessRuleProtection($true, $false)
        $inherit = [Security.AccessControl.InheritanceFlags]'ContainerInherit,ObjectInherit'
        $prop = [Security.AccessControl.PropagationFlags]::None
        $allow = [Security.AccessControl.AccessControlType]::Allow
        $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($sid,[Security.AccessControl.FileSystemRights]::FullControl,$inherit,$prop,$allow))
        $system = [Security.Principal.SecurityIdentifier]::new('S-1-5-18')
        $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($system,[Security.AccessControl.FileSystemRights]::FullControl,$inherit,$prop,$allow))
        Set-Acl -LiteralPath $Path -AclObject $acl
    }
}

function In-Root([string]$Relative) {
    if ([string]::IsNullOrWhiteSpace($Relative) -or $Relative -match '(^[\\/]|:|(^|[\\/])\.\.([\\/]|$))') {
        throw 'An artifact path must remain relative to this operation.'
    }
    $full = [IO.Path]::GetFullPath((Join-Path $script:Root $Relative.Replace('/',[IO.Path]::DirectorySeparatorChar)))
    $prefix = $script:Root.TrimEnd('\','/') + [IO.Path]::DirectorySeparatorChar
    if (-not $full.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) { throw 'Artifact path escapes the operation.' }
    $parent = [IO.Path]::GetDirectoryName($full)
    if (-not [IO.Directory]::Exists($parent)) { [void][IO.Directory]::CreateDirectory($parent) }
    $cursor = $parent
    while ($cursor.Length -ge $script:Root.Length) {
        if (((Get-Item -LiteralPath $cursor).Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
            throw 'Artifact directories must not contain reparse points.'
        }
        if ($cursor -eq $script:Root) { break }
        $cursor = [IO.Path]::GetDirectoryName($cursor)
    }
    return $full
}

function Save-State {
    Write-Json (In-Root 'state.json') $script:State
}

function Event([string]$Name, $Details = $null) {
    $script:State.events = @($script:State.events) + @([ordered]@{ at = Utc-Now; name = $Name; details = $Details })
    $script:State.updated_at = Utc-Now
    Save-State
}

function Artifact([string]$Relative, [string]$Role) {
    $p = In-Root $Relative
    if (((Get-Item -LiteralPath $p).Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'Artifacts must be ordinary retained files.' }
    $d = File-Digest $p
    $entry = [ordered]@{ path = $Relative.Replace('\','/'); bytes = $d.bytes; sha256 = $d.sha256; role = $Role; embedded = $true }
    $script:State.files[$entry.path] = $entry
    return $entry
}

function Verify-Artifact([string]$Relative) {
    $entry = Field $script:State.files $Relative
    if ($null -eq $entry) { throw 'The retained artifact is absent from this job manifest.' }
    $d = File-Digest (In-Root $Relative)
    if ($d.sha256 -ne $entry.sha256 -or $d.bytes -ne $entry.bytes) { throw 'A retained operation artifact has changed.' }
    return $entry
}

function Copy-Exact([string]$Source, [string]$Destination) {
    $sourceInput = $null; $output = $null
    $tmp = $Destination + '.' + [Guid]::NewGuid().ToString('N') + '.partial'
    try {
        $sourceInput = [IO.File]::Open($Source,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read)
        $output = [IO.File]::Open($tmp,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
        $sourceInput.CopyTo($output, 1048576)
        $output.Flush($true); $output.Dispose(); $output = $null
        if ([IO.File]::Exists($Destination)) { throw 'An immutable destination already exists.' }
        [IO.File]::Move($tmp,$Destination)
    } finally {
        if ($null -ne $output) { $output.Dispose() }
        if ($null -ne $sourceInput) { $sourceInput.Dispose() }
        if ([IO.File]::Exists($tmp)) { [IO.File]::Delete($tmp) }
    }
}

function Open-Native([string]$Path, [string]$Kind, $Expected = $null) {
    $s = [IO.File]::Open($Path,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read)
    $h = [Security.Cryptography.SHA256]::Create()
    try {
        $d = [ordered]@{ bytes = $s.Length; sha256 = [BitConverter]::ToString($h.ComputeHash($s)).Replace('-','').ToLowerInvariant() }
        if ($d.bytes -le 0) { throw 'The native report file is empty.' }
        if ($null -ne $Expected -and ($d.bytes -ne $Expected.bytes -or $d.sha256 -ne $Expected.sha256)) {
            throw 'Native report bytes do not match the original job manifest.'
        }
        $s.Position = 0
        if ($Kind -eq 'PowerBIReport') {
            $head = [byte[]]::new(4)
            if ($s.Read($head,0,4) -ne 4 -or $head[0] -ne 80 -or $head[1] -ne 75 -or $head[2] -ne 3 -or $head[3] -ne 4) {
                throw 'The .pbix file does not have its native ZIP container signature. A PBIP directory is not a PBIX.'
            }
            $s.Position = 0
            $archive = [IO.Compression.ZipArchive]::new($s,[IO.Compression.ZipArchiveMode]::Read,$true)
            try {
                $names = [System.Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
                $hasReport = $false
                foreach ($entry in $archive.Entries) {
                    if (-not $names.Add($entry.FullName)) { throw 'The PBIX contains duplicate native member names.' }
                    if ($entry.FullName.StartsWith('Report/',[StringComparison]::Ordinal) -and $entry.Length -gt 0) { $hasReport = $true }
                }
                if (-not $hasReport) { throw 'The PBIX container has no original Report member.' }
            } finally { $archive.Dispose() }
        } else {
            $settings = [Xml.XmlReaderSettings]::new()
            $settings.DtdProcessing = [Xml.DtdProcessing]::Prohibit
            $settings.XmlResolver = $null
            $settings.CloseInput = $false
            $reader = [Xml.XmlReader]::Create($s,$settings)
            try {
                [void]$reader.MoveToContent()
                if ($reader.LocalName -ne 'Report' -or $reader.NamespaceURI -notmatch '^https?://schemas\.microsoft\.com/sqlserver/reporting/.+/reportdefinition$') {
                    throw 'The .rdl file must contain a native Reporting Services Report definition.'
                }
                while ($reader.Read()) { }
            } finally { $reader.Dispose() }
        }
        $s.Position = 0
        return [ordered]@{ stream = $s; bytes = $d.bytes; sha256 = $d.sha256 }
    } catch { $s.Dispose(); throw }
    finally { $h.Dispose() }
}

function Initialize-Operation {
    if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) { throw 'Target actions require an existing Windows session with default credentials. Register is portable.' }
    if ([string]::IsNullOrWhiteSpace($JobFile)) { throw '-JobFile is required for this action.' }
    $script:JobPath = [IO.Path]::GetFullPath($JobFile)
    if ((Get-Item -LiteralPath $script:JobPath).Length -gt 2097152) { throw 'The job JSON exceeds 2 MiB; native reports belong in a file, not JSON.' }
    $jobBytes = [IO.File]::ReadAllBytes($script:JobPath)
    $jobHasher = [Security.Cryptography.SHA256]::Create()
    try { $script:JobHash = [BitConverter]::ToString($jobHasher.ComputeHash($jobBytes)).Replace('-','').ToLowerInvariant() }
    finally { $jobHasher.Dispose() }
    $script:Job = Validate-Job (To-Map ($script:Utf8.GetString($jobBytes) | ConvertFrom-Json))
    if ([string]::IsNullOrWhiteSpace($StateDirectory)) {
        if (-not $env:LOCALAPPDATA) { throw 'Set -StateDirectory to a durable private local directory.' }
        $StateDirectory = Join-Path $env:LOCALAPPDATA 'CommonsBI\ReportServer'
    }
    $base = [IO.Path]::GetFullPath($StateDirectory)
    $script:Root = Join-Path $base ($script:Job.job_id + '-' + $script:JobHash.Substring(0,12))
    Private-Directory $script:Root
    $script:Lock = [IO.File]::Open((Join-Path $script:Root 'operation.lock'),[IO.FileMode]::OpenOrCreate,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None)
    $statePath = In-Root 'state.json'
    if ([IO.File]::Exists($statePath)) {
        $script:State = Read-Json $statePath
        if ($script:State.schema -ne 'commons-bi-report-server-local-state/1' -or
            $script:State.job_sha256 -ne $script:JobHash -or $script:State.job_id -ne $script:Job.job_id) {
            throw 'The retained state belongs to a different original job.'
        }
        [void](Verify-Artifact 'job.json')
    } else {
        $script:State = [ordered]@{
            schema = 'commons-bi-report-server-local-state/1'; job_id = $script:Job.job_id
            job_sha256 = $script:JobHash; created_at = Utc-Now; updated_at = Utc-Now
            state = 'created'; runner_version = $script:RunnerVersion
            before = $null; published = $null; system_settings = $null
            publish_attempts = @(); rollback_attempts = @(); export_sets = [ordered]@{}; export_history = @()
            events = @(); files = [ordered]@{}; local_native_path = $null; last_error = $null
        }
        $retainedPath = In-Root 'job.json'
        if (-not [IO.File]::Exists($retainedPath)) {
            $jobStream = [IO.File]::Open($retainedPath,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
            try { $jobStream.Write($jobBytes,0,$jobBytes.Length); $jobStream.Flush($true) } finally { $jobStream.Dispose() }
        }
        $retainedJob = Artifact 'job.json' 'original_job'
        if ($retainedJob.sha256 -ne $script:JobHash) { throw 'The job file changed while being retained.' }
        if (-not [IO.File]::Exists((In-Root 'runner/RUN_REPORT_SERVER.ps1'))) { Copy-Exact $PSCommandPath (In-Root 'runner/RUN_REPORT_SERVER.ps1') }
        [void](Artifact 'runner/RUN_REPORT_SERVER.ps1' 'runner_source')
        $guide = Join-Path $PSScriptRoot 'GUIDE.md'
        if ([IO.File]::Exists($guide)) {
            if (-not [IO.File]::Exists((In-Root 'runner/GUIDE.md'))) { Copy-Exact $guide (In-Root 'runner/GUIDE.md') }
            [void](Artifact 'runner/GUIDE.md' 'runner_guide')
        }
        Event 'operation_created' ([ordered]@{
            report_server_build = $script:Job.report_server_build; desktop_build = $script:Job.desktop_build
            powershell = [string]$PSVersionTable.PSVersion; authentication = 'current_windows_identity'
            target = $script:Job.target; native = $script:Job.native
        })
    }
    if ($Action -ne 'Package') {
        $handler = [Net.Http.HttpClientHandler]::new()
        $handler.UseDefaultCredentials = $true
        $handler.AllowAutoRedirect = $false
        $handler.UseCookies = $false
        $script:Client = [Net.Http.HttpClient]::new($handler)
        $script:Client.Timeout = [TimeSpan]::FromMinutes($TimeoutMinutes)
    }
}

function New-RecordDirectory([string]$Label) {
    return 'observations/' + (Get-Date).ToUniversalTime().ToString('yyyyMMddTHHmmssfffffffZ') + '-' + [Guid]::NewGuid().ToString('N').Substring(0,8) + '-' + $Label
}

function Catalog-Uri([string]$Collection = 'CatalogItems', [string]$Id = '', [string]$ReportPath = '') {
    if ($Id) {
        $g = [Guid]::Empty
        if (-not [Guid]::TryParse($Id,[ref]$g)) { throw 'The server did not return a valid catalog item GUID.' }
        return $script:Job.target.api_base + '/' + $Collection + '(' + $g.ToString() + ')'
    }
    if (-not $ReportPath) { $ReportPath = $script:Job.target.report_path }
    $escaped = (@($ReportPath.Replace("'","''").Split('/') | ForEach-Object { [Uri]::EscapeDataString($_) }) -join '/')
    return $script:Job.target.api_base + '/' + $Collection + "(Path='" + $escaped + "')"
}

function Http-File([string]$Method, [string]$Uri, [string]$Relative, $Content = $null, [switch]$AllowMissing, [string]$Accept = 'application/json') {
    $request = [Net.Http.HttpRequestMessage]::new([Net.Http.HttpMethod]::new($Method),[Uri]$Uri)
    $response = $null; $stream = $null; $output = $null
    $cancel = [Threading.CancellationTokenSource]::new()
    $cancel.CancelAfter([TimeSpan]::FromMinutes($TimeoutMinutes))
    $destination = In-Root $Relative
    $tmp = $destination + '.' + [Guid]::NewGuid().ToString('N') + '.partial'
    try {
        [void]$request.Headers.TryAddWithoutValidation('Accept',$Accept)
        $request.Content = $Content
        $response = $script:Client.SendAsync($request,[Net.Http.HttpCompletionOption]::ResponseHeadersRead,$cancel.Token).GetAwaiter().GetResult()
        $status = [int]$response.StatusCode
        if ($status -eq 404 -and $AllowMissing) { return [ordered]@{ exists = $false; status = 404 } }
        if (-not $response.IsSuccessStatusCode) {
            throw ('Report Server returned HTTP {0} for {1}. No automatic request retry was made.' -f $status,$Method)
        }
        $output = [IO.File]::Open($tmp,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
        if ($null -ne $response.Content) {
            $stream = $response.Content.ReadAsStreamAsync().GetAwaiter().GetResult()
            $stream.CopyToAsync($output,1048576,$cancel.Token).GetAwaiter().GetResult()
        }
        $output.Flush($true); $output.Dispose(); $output = $null
        if ([IO.File]::Exists($destination)) { throw 'An observation file already exists.' }
        [IO.File]::Move($tmp,$destination)
        $etag = if ($null -ne $response.Headers.ETag) { $response.Headers.ETag.ToString() } else { $null }
        $mime = if ($null -ne $response.Content -and $null -ne $response.Content.Headers.ContentType) { $response.Content.Headers.ContentType.MediaType } else { '' }
        return [ordered]@{ exists = $true; status = $status; path = $Relative; etag = $etag; content_type = $mime; server = [string]$response.Headers.Server }
    } finally {
        if ($null -ne $output) { $output.Dispose() }
        if ($null -ne $stream) { $stream.Dispose() }
        if ($null -ne $response) { $response.Dispose() }
        $request.Dispose(); $cancel.Dispose()
        if ([IO.File]::Exists($tmp)) { [IO.File]::Delete($tmp) }
    }
}

function Metadata([string]$Directory, [string]$ReportPath = '', [string]$Kind = '') {
    if (-not $ReportPath) { $ReportPath = $script:Job.target.report_path }
    if (-not $Kind) { $Kind = $script:Job.native.kind }
    $response = Http-File 'GET' (Catalog-Uri 'CatalogItems' '' $ReportPath) ($Directory + '/metadata.json') -AllowMissing
    if (-not $response.exists) { return [ordered]@{ exists = $false } }
    [void](Artifact $response.path 'catalog_metadata')
    $meta = Read-Json (In-Root $response.path)
    $id = [string](Field $meta 'Id')
    $g = [Guid]::Empty
    if (-not [Guid]::TryParse($id,[ref]$g)) { throw 'Catalog metadata has no valid item ID.' }
    $type = [string](Field $meta 'Type')
    if (-not $type) { $type = ([string](Field $meta '@odata.type')).Replace('#Model.','') }
    if ($type -ne $Kind) { throw ('The catalog path is occupied by {0}, not the requested native report kind.' -f $type) }
    return [ordered]@{
        exists = $true; id = $g.ToString(); kind = $type; requested_path = $ReportPath; metadata_file = $response.path
        etag = $response.etag; modified_date = Field $meta 'ModifiedDate'
        path = Field $meta 'Path'; name = Field $meta 'Name'
    }
}

function Same-Metadata($A,$B) {
    if ($A.exists -ne $B.exists) { return $false }
    if (-not $A.exists) { return $true }
    if ($A.id -ne $B.id -or $A.kind -ne $B.kind -or $A.path -ne $B.path) { return $false }
    if ($A.modified_date -and $B.modified_date -and $A.modified_date -ne $B.modified_date) { return $false }
    if ($A.etag -and $B.etag -and $A.etag -ne $B.etag) { return $false }
    return $true
}

function Observation([string]$Label, [string]$ReportPath = '', [string]$Kind = '') {
    $dir = New-RecordDirectory $Label
    $m = Metadata $dir $ReportPath $Kind
    if ($m.exists) {
        $collection = if ($m.kind -eq 'PowerBIReport') { 'PowerBIReports' } else { 'Reports' }
        $extension = if ($m.kind -eq 'PowerBIReport') { '.pbix' } else { '.rdl' }
        $relative = $dir + '/content' + $extension
        [void](Http-File 'GET' ((Catalog-Uri $collection $m.id) + '/Content/$value') $relative -Accept 'application/octet-stream')
        $content = Artifact $relative 'native_content'
        $after = Metadata ($dir + '/after') $ReportPath $Kind
        if (-not (Same-Metadata $m $after)) { throw 'The catalog item changed while its content was being captured; no target write was made.' }
        $m.content_file = $relative; $m.bytes = $content.bytes; $m.sha256 = $content.sha256
        # Keep one exact local copy of identical native bytes, never hard-link private state.
        foreach ($entry in @($script:State.files.Values)) {
            if ($entry.path -ne $relative -and $entry.role -in @('native_content','native_input') -and
                $entry.sha256 -eq $content.sha256 -and $entry.bytes -eq $content.bytes) {
                [void](Verify-Artifact $entry.path)
                [IO.File]::Delete((In-Root $relative))
                $script:State.files.Remove($relative)
                $m.content_file = $entry.path
                break
            }
        }
    }
    $m.captured_at = Utc-Now
    Write-Json (In-Root ($dir + '/observation.json')) $m
    [void](Artifact ($dir + '/observation.json') 'target_observation')
    Save-State
    return $m
}

function Same-Content($A,$B) {
    if ($null -eq $A -or $null -eq $B -or $A.exists -ne $B.exists) { return $false }
    if (-not $A.exists) { return $true }
    return ($A.id -eq $B.id -and $A.kind -eq $B.kind -and $A.bytes -eq $B.bytes -and $A.sha256 -eq $B.sha256)
}

function Desired-Content($Observed) {
    if (-not $Observed.exists -or $Observed.kind -ne $script:Job.native.kind -or
        $Observed.bytes -ne $script:Job.native.bytes -or $Observed.sha256 -ne $script:Job.native.sha256) { return $false }
    if ($null -ne $script:State.before -and $script:State.before.exists -and $Observed.id -ne $script:State.before.id) { return $false }
    if ($null -ne $script:State.published -and $Observed.id -ne $script:State.published.id) { return $false }
    return $true
}

function Inspect-Settings {
    $dir = New-RecordDirectory 'settings'
    try {
        $r = Http-File 'GET' ($script:Job.target.api_base + '/System/Properties?properties=MaxFileSizeMb') ($dir + '/properties.json')
        [void](Artifact $r.path 'server_settings')
        $settings = Read-Json (In-Root $r.path)
        $values = @(Field $settings 'value' @())
        $max = $null
        if ($values.Count -gt 0 -and (Field $values[0] 'Name') -eq 'MaxFileSizeMb') {
            $parsed = 0.0
            if ([double]::TryParse([string](Field $values[0] 'Value'),[Globalization.NumberStyles]::Float,[Globalization.CultureInfo]::InvariantCulture,[ref]$parsed) -and $parsed -gt 0) { $max = $parsed }
        }
        $script:State.system_settings = [ordered]@{ checked_at = Utc-Now; max_file_size_mb = $max; source_file = $r.path; server_header = $r.server }
        Event 'server_settings_observed' $script:State.system_settings
    } catch {
        $script:State.system_settings = [ordered]@{ checked_at = Utc-Now; max_file_size_mb = $null; unavailable = Safe-Error $_ }
        Event 'server_settings_unavailable' $script:State.system_settings
    }
}

function Check-UploadLimit([long]$Bytes) {
    if ($null -eq $script:State.system_settings) { Inspect-Settings }
    $limit = Field $script:State.system_settings 'max_file_size_mb'
    if ($null -ne $limit -and $Bytes -gt ([decimal]$limit * 1048576)) {
        throw 'The exact native byte count exceeds the observed server MaxFileSizeMb setting.'
    }
}

function Capture-Original {
    if ($null -ne $script:State.before) {
        if ($script:State.before.exists) { [void](Verify-Artifact $script:State.before.content_file) }
        return
    }
    Inspect-Settings
    $script:State.before = Observation 'original'
    $script:State.state = 'captured'
    Event 'original_target_captured' $script:State.before
}

function Input-Path {
    $candidate = $NativeFile
    if (-not $candidate) { $candidate = [string](Field $script:State 'local_native_path' '') }
    $relative = 'input/' + $script:Job.native.file
    if ($script:Job.native.embedded) {
        $destination = In-Root $relative
        if ([IO.File]::Exists($destination)) {
            [void](Verify-Artifact $relative)
            return $destination
        }
        if (-not $candidate) { $candidate = Join-Path ([IO.Path]::GetDirectoryName($script:JobPath)) $script:Job.native.file }
        $open = Open-Native ([IO.Path]::GetFullPath($candidate)) $script:Job.native.kind $script:Job.native
        $open.stream.Dispose()
        Copy-Exact ([IO.Path]::GetFullPath($candidate)) $destination
        $a = Artifact $relative 'native_input'
        if ($a.sha256 -ne $script:Job.native.sha256 -or $a.bytes -ne $script:Job.native.bytes) {
            $rejected = 'input/rejected-' + [Guid]::NewGuid().ToString('N') + '-' + $script:Job.native.file
            [IO.File]::Move($destination,(In-Root $rejected))
            $script:State.files.Remove($relative)
            [void](Artifact $rejected 'rejected_native_input')
            Event 'source_changed_during_local_retention' ([ordered]@{ rejected_file = $rejected })
            throw 'The source changed while being retained; its rejected copy is preserved and no target write was made. Supply the exact registered source and invoke Publish again.'
        }
        Save-State
        return $destination
    }
    if (-not $candidate) { throw 'This registered native input is external. Supply its existing exact file with -NativeFile.' }
    $candidate = [IO.Path]::GetFullPath($candidate)
    $open = Open-Native $candidate $script:Job.native.kind $script:Job.native
    $open.stream.Dispose()
    $script:State.local_native_path = $candidate
    Save-State
    return $candidate
}

function Last-Attempt([string]$Kind) {
    $items = @($script:State[$Kind + '_attempts'])
    if ($items.Count -eq 0) { return $null }
    return $items[$items.Count - 1]
}

function Begin-Attempt([string]$Kind, $BeforeWrite) {
    $a = [ordered]@{
        id = [Guid]::NewGuid().ToString('N'); started_at = Utc-Now; status = 'pending'
        before_write = $BeforeWrite; http_status = $null; observed_after = $null; error = $null
    }
    $key = $Kind + '_attempts'
    $script:State[$key] = @($script:State[$key]) + @($a)
    $script:State.state = $Kind + '_pending'
    $script:NetworkWrite = $Kind
    Event ($Kind + '_attempt_started') ([ordered]@{ attempt_id = $a.id })
    return $a
}

function Upload-Native([string]$Path, $Expected, [string]$Label, [string]$ExistingId = '') {
    Check-UploadLimit $Expected.bytes
    $sourceInput = Open-Native $Path $script:Job.native.kind $Expected
    $multipart = $null; $part = $null
    try {
        $collection = if ($script:Job.native.kind -eq 'PowerBIReport') { 'PowerBIReports' } else { 'Reports' }
        $multipart = [Net.Http.MultipartFormDataContent]::new()
        $part = [Net.Http.StreamContent]::new($sourceInput.stream,1048576)
        $part.Headers.ContentType = [Net.Http.Headers.MediaTypeHeaderValue]::new('application/octet-stream')
        $name = $script:Job.target.report_path.Substring($script:Job.target.report_path.LastIndexOf('/') + 1)
        [void]$multipart.Add($part,'File',$name)
        $dir = New-RecordDirectory $Label
        $r = Http-File 'POST' ((Catalog-Uri $collection $ExistingId) + '/Model.Upload') ($dir + '/upload-response.json') $multipart
        [void](Artifact $r.path 'upload_response')
        return $r.status
    } finally {
        if ($null -ne $multipart) { $multipart.Dispose() }
        elseif ($null -ne $part) { $part.Dispose() }
        $sourceInput.stream.Dispose()
    }
}

function Reconcile-Target {
    if ($null -eq $script:State.before) {
        $m = Metadata (New-RecordDirectory 'reconcile-without-write')
        Event 'no_server_write_recorded_for_this_job' $m
        return
    }
    $r = Observation 'reconcile'
    $rollback = Last-Attempt 'rollback'
    $publish = Last-Attempt 'publish'
    if ($null -ne $rollback) {
        if (Same-Content $r $script:State.before) {
            $rollback.status = 'verified'; $rollback.observed_after = $r
            $script:State.state = 'rolled_back_verified'
            Event 'rollback_verified_by_readback' $r
            return
        }
        if (Desired-Content $r) {
            $rollback.status = 'not_applied'; $rollback.observed_after = $r
            $script:State.state = 'rollback_not_applied'
            Event 'rollback_not_applied_by_readback' $r
            return
        }
    } elseif ($null -ne $publish) {
        if (Desired-Content $r) {
            $publish.status = 'verified'; $publish.observed_after = $r; $script:State.published = $r
            $script:State.state = 'published_verified'
            Event 'publish_verified_by_readback' $r
            return
        }
        if (Same-Content $r $script:State.before) {
            $publish.status = 'not_applied'; $publish.observed_after = $r
            $script:State.state = 'publish_not_applied'
            Event 'publish_not_applied_by_readback' $r
            return
        }
    } elseif (Same-Content $r $script:State.before) {
        Event 'original_target_still_present' $r
        return
    }
    $script:State.state = 'target_conflict'
    Event 'target_content_conflict' $r
    throw 'Target readback matches neither this job input nor its captured original. The observed bytes are retained for review.'
}

function Publish-Target {
    Capture-Original
    if ($null -ne (Last-Attempt 'rollback')) { throw 'This job has entered rollback. Reconcile or finish its rollback; use a new job for a later deployment.' }
    $previous = Last-Attempt 'publish'
    if ($null -ne $previous -and $previous.status -eq 'verified') { return }
    if ($null -ne $previous -and $previous.status -ne 'not_applied') {
        Reconcile-Target
        if ((Last-Attempt 'publish').status -eq 'verified') { return }
        throw 'The prior attempt was reconciled without resending. Review that result, then invoke Publish explicitly if it was not applied.'
    }
    if ($script:State.before.exists -and -not $AllowOverwrite) { throw 'The target already exists. Use -AllowOverwrite with the explicit Publish or Run operation to replace its captured content.' }
    $sourceInput = Input-Path
    Check-UploadLimit $script:Job.native.bytes
    $fresh = Observation 'pre-publish'
    if (-not (Same-Content $fresh $script:State.before)) {
        $script:State.state = 'target_conflict'; Event 'pre_publish_target_changed' $fresh
        throw 'The current target differs from the retained original. No upload was sent.'
    }
    $attempt = Begin-Attempt 'publish' $fresh
    try {
        if (Desired-Content $fresh) {
            $attempt.status = 'verified'; $attempt.observed_after = $fresh; $attempt.http_status = $null
            $script:State.published = $fresh; $script:State.state = 'published_verified'
            Event 'input_already_present_no_upload' $fresh
        } else {
            $id = if ($fresh.exists) { $fresh.id } else { '' }
            $attempt.http_status = Upload-Native $sourceInput $script:Job.native 'publish' $id
            Event 'publish_response_received' ([ordered]@{ attempt_id = $attempt.id; http_status = $attempt.http_status })
            Reconcile-Target
            if ($attempt.status -ne 'verified') { throw 'Upload completed without the required exact native-content readback.' }
        }
        $script:NetworkWrite = $null
    } catch {
        if ($attempt.status -eq 'pending') { $attempt.status = 'uncertain'; if ($script:State.state -ne 'target_conflict') { $script:State.state = 'publish_uncertain' } }
        $attempt.error = Safe-Error $_
        Event 'publish_needs_review' ([ordered]@{ attempt_id = $attempt.id; status = $attempt.status; error = $attempt.error })
        $script:NetworkWrite = $null
        throw
    }
}

function Rollback-Target {
    Capture-Original
    $previous = Last-Attempt 'rollback'
    if ($null -ne $previous -and $previous.status -eq 'verified') { return }
    if ($null -ne $previous -and $previous.status -ne 'not_applied') {
        Reconcile-Target
        if ((Last-Attempt 'rollback').status -eq 'verified') { return }
        throw 'The prior rollback was reconciled without resending. Review it, then invoke Rollback explicitly if it was not applied.'
    }
    $publish = Last-Attempt 'publish'
    if ($null -eq $publish) { throw 'This job has no publication to roll back.' }
    if ($publish.status -ne 'verified') {
        Reconcile-Target
        if ((Last-Attempt 'publish').status -ne 'verified') { throw 'Rollback requires a verified publication belonging to this job.' }
    }
    $fresh = Observation 'pre-rollback'
    if (-not (Desired-Content $fresh)) {
        $script:State.state = 'target_conflict'; Event 'pre_rollback_target_changed' $fresh
        throw 'The current target differs from this job publication. No rollback write was sent.'
    }
    if ($script:State.before.exists) { [void](Verify-Artifact $script:State.before.content_file) }
    $attempt = Begin-Attempt 'rollback' $fresh
    try {
        if (Same-Content $fresh $script:State.before) {
            $attempt.status = 'verified'; $attempt.observed_after = $fresh
            $script:State.state = 'rolled_back_verified'
            Event 'original_already_present_no_upload' $fresh
        } elseif ($script:State.before.exists) {
            $expected = [ordered]@{ bytes = $script:State.before.bytes; sha256 = $script:State.before.sha256 }
            $attempt.http_status = Upload-Native (In-Root $script:State.before.content_file) $expected 'rollback' $script:State.before.id
            Event 'rollback_response_received' ([ordered]@{ attempt_id = $attempt.id; http_status = $attempt.http_status })
            Reconcile-Target
        } else {
            $dir = New-RecordDirectory 'remove-created-report'
            $r = Http-File 'DELETE' (Catalog-Uri 'CatalogItems' $fresh.id) ($dir + '/delete-response.bin') -AllowMissing
            if ($r.exists) { [void](Artifact $r.path 'delete_response') }
            $attempt.http_status = $r.status
            Event 'created_target_removal_response' ([ordered]@{ id = $fresh.id; http_status = $r.status })
            Reconcile-Target
        }
        if ($attempt.status -ne 'verified') { throw 'Rollback has not yet matched the original target state.' }
        $script:NetworkWrite = $null
    } catch {
        if ($attempt.status -eq 'pending') { $attempt.status = 'uncertain'; if ($script:State.state -ne 'target_conflict') { $script:State.state = 'rollback_uncertain' } }
        $attempt.error = Safe-Error $_
        Event 'rollback_needs_review' ([ordered]@{ attempt_id = $attempt.id; status = $attempt.status; error = $attempt.error })
        $script:NetworkWrite = $null
        throw
    }
}

function Export-Uri([string]$ReportPath,$Parameters) {
    $path = (@($ReportPath.Split('/') | ForEach-Object { [Uri]::EscapeDataString($_) }) -join '/')
    $parts = [System.Collections.Generic.List[string]]::new()
    $parts.Add('rs:Command=Render'); $parts.Add('rs:Format=CSV')
    foreach ($key in $Parameters.Keys) {
        $encoded = [Uri]::EscapeDataString([string]$key)
        $value = $Parameters[$key]
        if ($null -eq $value) { $parts.Add($encoded + ':isnull=true'); continue }
        foreach ($v in @($value)) {
            if ($null -eq $v) { $parts.Add($encoded + ':isnull=true') }
            else {
                $text = if ($v -is [bool]) { if ($v) { '1' } else { '0' } } else { [Convert]::ToString($v,[Globalization.CultureInfo]::InvariantCulture) }
                $parts.Add($encoded + '=' + [Uri]::EscapeDataString($text))
            }
        }
    }
    return $script:Job.target.report_server_url + '?' + $path + '&' + ($parts -join '&')
}

function Export-Stage([string]$Name) {
    if ($script:State.export_sets.Contains($Name) -and $script:State.export_sets[$Name].status -eq 'complete' -and $ManualCsvFile.Count -eq 0) { return }
    if ($script:State.export_sets.Contains($Name)) {
        $script:State.export_history = @($script:State.export_history) + @($script:State.export_sets[$Name])
    }
    $expected = if ($Name -eq 'published') { $script:State.published } else { $script:State.before }
    if ($null -eq $expected) { throw 'The requested CSV stage has no captured target definition.' }
    if ($Name -eq 'rolled_back' -and ($null -eq (Last-Attempt 'rollback') -or (Last-Attempt 'rollback').status -ne 'verified')) {
        throw 'A rolled_back CSV capture requires verified native-content restoration.'
    }
    $fresh = Observation ('pre-csv-' + $Name)
    if (-not (Same-Content $fresh $expected)) { throw 'The target report definition changed before the requested CSV capture.' }
    $entries = @($script:Job.paginated_exports)
    if ($entries.Count -eq 0 -and $script:Job.native.kind -eq 'Report' -and $expected.exists) {
        $entries = @([ordered]@{ report_path = $script:Job.target.report_path; parameters = $script:Job.parameters; file = 'report.csv' })
    }
    if ($entries.Count -gt 0 -and -not $script:Job.target.report_server_url) {
        throw 'Server-rendered RDL captures require the existing target.report_server_url service address. Native publish and manual Desktop CSV do not.'
    }
    $directory = 'captures/' + $Name + '/' + [Guid]::NewGuid().ToString('N')
    $captures = @()
    $set = [ordered]@{ stage = $Name; status = 'capturing'; started_at = Utc-Now; finished_at = $null; files = @(); native_target = $fresh }
    $script:State.export_sets[$Name] = $set
    Event 'csv_capture_started' ([ordered]@{ stage = $Name; requested_paginated_exports = $entries.Count })
    $index = 0
    foreach ($e in $entries) {
        $index++
        $relative = $directory + '/' + $index.ToString('000') + '-' + $e.file
        $definitionBefore = Observation ('csv-' + $Name + '-' + $index + '-before') $e.report_path 'Report'
        if (-not $definitionBefore.exists) { throw 'The explicitly selected paginated report does not exist. No CSV request was sent for that path.' }
        $response = Http-File 'GET' (Export-Uri $e.report_path $e.parameters) $relative -Accept 'text/csv,application/octet-stream;q=0.9'
        if ($response.content_type -match '(?i)(html|xml|json)') {
            [void](Artifact $relative 'unexpected_render_response')
            throw 'The CSV endpoint returned a document or error page instead of CSV; its body is retained.'
        }
        $probeStream = [IO.File]::OpenRead((In-Root $relative))
        try {
            $probeBytes = [byte[]]::new(1024)
            $probeCount = $probeStream.Read($probeBytes,0,$probeBytes.Length)
            $probeText = $script:Utf8.GetString($probeBytes,0,$probeCount).TrimStart()
        } finally { $probeStream.Dispose() }
        if ($probeText -match '^(?i)(<!doctype\s+html|<html\b)') {
            [void](Artifact $relative 'unexpected_render_response')
            throw 'The requested CSV contains an HTML page; its actual response is retained.'
        }
        $f = Artifact $relative 'unverified_csv_capture'
        $f.report_path = $e.report_path; $f.parameters = $e.parameters; $f.capture_kind = 'paginated_csv'; $f.stage = $Name
        $definitionAfter = Observation ('csv-' + $Name + '-' + $index + '-after') $e.report_path 'Report'
        $f.native_definition = [ordered]@{ before = $definitionBefore; after = $definitionAfter; verified = (Same-Content $definitionBefore $definitionAfter) }
        if (-not $f.native_definition.verified) { throw 'The selected paginated report definition changed during its CSV request. The unverified CSV and both native observations are retained.' }
        $f.role = 'capture'
        if ($e.Contains('null_token')) { $f.null_token = $e.null_token }
        $captures += ,([ordered]@{ file = $f.path; report_path = $e.report_path; parameters = $e.parameters; bytes = $f.bytes; sha256 = $f.sha256; content_type = $response.content_type })
        $set.files = $captures
        Save-State
    }
    foreach ($source in $ManualCsvFile) {
        $index++
        $name = Check-Basename ([IO.Path]::GetFileName($source))
        if ([IO.Path]::GetExtension($name).ToLowerInvariant() -ne '.csv') { throw 'Manual Desktop captures must be existing .csv files.' }
        $relative = $directory + '/' + $index.ToString('000') + '-desktop-' + $name
        Copy-Exact ([IO.Path]::GetFullPath($source)) (In-Root $relative)
        $f = Artifact $relative 'capture'
        $f.report_path = $script:Job.target.report_path; $f.parameters = $script:Job.parameters; $f.capture_kind = 'manual_desktop_csv'; $f.stage = $Name
        $captures += ,([ordered]@{ file = $f.path; source = 'operator_supplied_desktop_csv'; bytes = $f.bytes; sha256 = $f.sha256 })
        $set.files = $captures
        Save-State
    }
    $after = Metadata (New-RecordDirectory ('post-csv-' + $Name))
    if (-not (Same-Metadata $fresh $after)) { throw 'The report definition changed during CSV capture. Review the retained captures before using them.' }
    $set.status = 'complete'; $set.finished_at = Utc-Now
    $set.note = if ($captures.Count -eq 0) { 'No paginated export or manual Desktop CSV was requested; native verification only.' } else { 'CSV captured; business reconciliation is performed by the operator.' }
    Event 'csv_capture_completed' ([ordered]@{ stage = $Name; count = $captures.Count; note = $set.note })
}

function Invoke-RoundTrip {
    $rollback = Last-Attempt 'rollback'
    if ($null -ne $rollback) {
        if ($rollback.status -ne 'verified') {
            Reconcile-Target
            if ((Last-Attempt 'rollback').status -ne 'verified') { throw 'Resume the retained rollback with the explicit Rollback action after reviewing its readback.' }
        }
        Export-Stage 'rolled_back'
        if (-not $script:State.export_sets.Contains('published') -or $script:State.export_sets.published.status -ne 'complete') {
            $script:State.state = 'completed_restored_with_export_error'
            Event 'restoration_complete_capture_remains_incomplete'
            throw 'The original target is restored, but the retained published-stage CSV capture is incomplete. This same job will not republish automatically.'
        }
        $script:State.state = 'completed_restored'
        Event 'round_trip_restoration_complete'
        return
    }
    Capture-Original
    $publish = Last-Attempt 'publish'
    if ($null -eq $publish) { Export-Stage 'before' }
    elseif ($publish.status -eq 'not_applied') { throw 'The previous publication was not applied. Invoke Publish explicitly to attempt it again, then resume Run.' }
    Publish-Target
    $captureError = $null
    try { Export-Stage 'published' }
    catch { $captureError = Safe-Error $_; Event 'published_csv_failed' ([ordered]@{ error = $captureError }) }
    if (-not $KeepPublished) {
        Rollback-Target
        Export-Stage 'rolled_back'
        $script:State.state = 'completed_restored'
    } else { $script:State.state = 'completed_published' }
    if ($null -ne $captureError) {
        $script:State.state = $script:State.state + '_with_export_error'
        Event 'round_trip_capture_error_retained' ([ordered]@{ error = $captureError })
        throw $captureError
    }
    Event 'round_trip_complete' ([ordered]@{ target_restored = (-not [bool]$KeepPublished) })
}

function Safe-Error($Record) {
    $text = [string]$Record.Exception.Message
    if ($null -ne $script:State) {
        $external = [string](Field $script:State 'local_native_path' '')
        if ($external) { $text = $text.Replace($external,'<external native file>') }
    }
    foreach ($supplied in @($NativeFile) + @($ManualCsvFile)) {
        if ($supplied) {
            $text = $text.Replace([string]$supplied,'<operator supplied local file>')
            try { $text = $text.Replace([IO.Path]::GetFullPath($supplied),'<operator supplied local file>') } catch { }
        }
    }
    if ($script:Root) { $text = $text.Replace($script:Root,'<operation directory>') }
    if ($script:JobPath) { $text = $text.Replace($script:JobPath,'<original job file>') }
    if ($text.Length -gt 2000) { $text = $text.Substring(0,2000) }
    return $text
}

function External-Entry($Entry,[string]$Custody) {
    $copy = [ordered]@{}
    foreach ($key in $Entry.Keys) { $copy[$key] = $Entry[$key] }
    $copy.embedded = $false
    $copy.custody = $Custody
    return $copy
}

function Package-Result {
    # Export a portable projection; keep the external path only in local state.json.
    $publicState = [ordered]@{}
    foreach ($key in $script:State.Keys) {
        if ($key -notin @('local_native_path','files')) { $publicState[$key] = $script:State[$key] }
    }
    Write-Json (In-Root 'export/state.json') $publicState
    [void](Artifact 'export/state.json' 'operation_state')
    $files = @(); $retained = @()
    $maxZipBytes = [long]67108864
    $maxExpandedBytes = [long]536870912
    $maxMembers = 2000
    foreach ($entry in @($script:State.files.Values | Sort-Object path)) {
        [void](Verify-Artifact $entry.path)
        $native = $entry.role -in @('native_content','native_input')
        if ($entry.bytes -gt $maxZipBytes -or ($native -and -not $script:Job.native.embedded)) {
            $retained += ,(External-Entry $entry 'retained_exact_file_in_original_private_windows_operation')
        } else { $files += ,$entry }
    }
    if (-not $script:Job.native.embedded) {
        $retained += ,([ordered]@{
            path = 'external-native/' + $script:Job.native.file
            bytes = $script:Job.native.bytes; sha256 = $script:Job.native.sha256
            role = 'native_input'; embedded = $false
            custody = 'original_native_registration; verify_existing_file_before_publish'
        })
    }
    $result = [ordered]@{
        schema = 'commons-bi-report-server-result/1'; job_id = $script:State.job_id; job_sha256 = $script:State.job_sha256
        state = $script:State.state; created_at = Utc-Now; events = $script:State.events; files = @()
        native_input = $script:Job.native; native_input_custody = ''
        before = $script:State.before; published = $script:State.published
        export_sets = $script:State.export_sets; export_history = $script:State.export_history
        report_server_build = $script:Job.report_server_build; desktop_build = $script:Job.desktop_build
        package_limits = [ordered]@{ zip_bytes = $maxZipBytes; expanded_bytes = $maxExpandedBytes; members = $maxMembers }
        last_error = $script:State.last_error
    }
    $mandatory = @('job.json','runner/RUN_REPORT_SERVER.ps1','runner/GUIDE.md','export/state.json')
    $resultBytes = $null
    while ($true) {
        $result.files = @(@($files) + @($retained) | Sort-Object path)
        $hasInputCopy = @($files | Where-Object {
            $_.role -in @('native_content','native_input') -and $_.sha256 -eq $script:Job.native.sha256 -and $_.bytes -eq $script:Job.native.bytes
        }).Count -gt 0
        $result.native_input_custody = if ($hasInputCopy) {
            'exact_native_copy_embedded_and_retained_in_windows_operation'
        } elseif ($script:Job.native.embedded) {
            'original_job_file_and_any_captured_native_copies_remain_in_windows_custody'
        } else { 'registered_existing_native_file_and_any_captured_copies_remain_in_windows_custody' }
        $result.retained_files = $retained
        $resultBytes = $script:Utf8.GetBytes(($result | ConvertTo-Json -Depth 64) + [Environment]::NewLine)
        [long]$expanded = $resultBytes.Length
        [long]$headers = 1048576
        foreach ($entry in $files) {
            $expanded += [long]$entry.bytes
            $headers += 256 + 2 * $script:Utf8.GetByteCount([string]$entry.path)
        }
        # Conservative ZIP header and DEFLATE expansion bound; actual bytes are
        # also checked after the complete streaming archive is closed.
        $bound = $expanded + $headers + [long]([Math]::Ceiling($expanded / 16384.0) * 5)
        if ($files.Count + 1 -le $maxMembers -and $expanded -le $maxExpandedBytes -and
            $resultBytes.Length -le $maxZipBytes -and $bound -le $maxZipBytes) { break }
        # Retain captures before optional native/diagnostic bytes. Omitted files
        # keep exact manifest identities and remain untouched in the same state.
        $ranking = @(@{ Expression = { if ($_.role -in @('native_content','native_input')) { 0 } elseif ($_.role -eq 'capture') { 2 } else { 1 } }; Ascending = $true }, @{ Expression = { $_.bytes }; Descending = $true })
        $candidate = @($files | Where-Object { $_.path -notin $mandatory } | Sort-Object -Property $ranking | Select-Object -First 1)
        if ($candidate.Count -eq 0) { throw 'The required job/history manifest exceeds the receiving package limit. The complete original Windows operation remains retained.' }
        $chosen = $candidate[0]
        $files = @($files | Where-Object { $_.path -ne $chosen.path })
        $retained += ,(External-Entry $chosen 'retained_exact_file_in_original_private_windows_operation; excluded_to_fit_receiving_package')
    }
    $resultPath = In-Root 'export/result.json'
    Write-Json $resultPath $result
    $destination = if ($OutputFile) { [IO.Path]::GetFullPath($OutputFile) } else {
        Join-Path $script:Root ($script:Job.job_id + '-result-' + (Get-Date).ToUniversalTime().ToString('yyyyMMddTHHmmssfffffffZ') + '.zip')
    }
    if ([IO.File]::Exists($destination)) { throw 'The result ZIP already exists; select a new output name to preserve the prior result.' }
    $parent = [IO.Path]::GetDirectoryName($destination)
    if (-not [IO.Directory]::Exists($parent)) { throw 'The result output directory must already exist.' }
    $tmp = $destination + '.' + [Guid]::NewGuid().ToString('N') + '.partial'
    $output = $null; $zip = $null
    try {
        $output = [IO.File]::Open($tmp,[IO.FileMode]::CreateNew,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None)
        $zip = [IO.Compression.ZipArchive]::new($output,[IO.Compression.ZipArchiveMode]::Create,$true)
        foreach ($entry in @($files) + @([ordered]@{ path = 'result.json'; source = $resultPath })) {
            $path = if ($entry.Contains('source')) { $entry.source } else { In-Root $entry.path }
            $z = $zip.CreateEntry($entry.path,[IO.Compression.CompressionLevel]::Optimal)
            $zs = $z.Open()
            $sourceInput = [IO.File]::Open($path,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read)
            try { $sourceInput.CopyTo($zs,1048576) } finally { $sourceInput.Dispose(); $zs.Dispose() }
        }
        $zip.Dispose(); $zip = $null
        $output.Flush($true)
        if ($output.Length -gt $maxZipBytes) { throw 'The completed ZIP exceeds the receiver limit; the original files remain retained for a smaller package.' }
        $output.Dispose(); $output = $null
        [IO.File]::Move($tmp,$destination)
        $script:ResultZip = $destination
        return $destination
    } finally {
        if ($null -ne $zip) { $zip.Dispose() }
        if ($null -ne $output) { $output.Dispose() }
        if ([IO.File]::Exists($tmp)) { [IO.File]::Delete($tmp) }
    }
}

try {
    if ($ManualCsvFile.Count -gt 0 -and ($Action -ne 'Export' -or $Stage -eq 'auto')) {
        throw 'Import manual Desktop CSV using Export with an explicit before, published, or rolled_back stage.'
    }
    if ($Action -eq 'Register') {
        if (-not $NativeFile) { throw 'Register requires an existing native file using -NativeFile.' }
        $full = [IO.Path]::GetFullPath($NativeFile)
        $name = Check-Basename ([IO.Path]::GetFileName($full))
        $kind = switch ([IO.Path]::GetExtension($name).ToLowerInvariant()) {
            '.pbix' { 'PowerBIReport' }
            '.rdl' { 'Report' }
            default { throw 'Register accepts an existing .pbix or .rdl file, not a PBIP directory.' }
        }
        $open = Open-Native $full $kind
        try {
            $manifest = [ordered]@{
                schema = 'commons-bi-report-server-native/1'; file = $name; bytes = $open.bytes; sha256 = $open.sha256
                kind = $kind; embedded = $false; desktop_build = $DesktopBuild; report_server_build = $ReportServerBuild
                registered_at = Utc-Now; format_check = 'native_zip_report_members_or_complete_rdl_xml'
            }
        } finally { $open.stream.Dispose() }
        if ($OutputFile) {
            $path = [IO.Path]::GetFullPath($OutputFile)
            if ([IO.File]::Exists($path)) { throw 'The registration output already exists; retain it and choose a new filename.' }
            Write-Json $path $manifest
        }
        $manifest | ConvertTo-Json -Depth 16
    } else {
        Initialize-Operation
        switch ($Action) {
            'Inspect' {
                Inspect-Settings
                $metadata = Metadata (New-RecordDirectory 'inspect')
                Event 'target_inspected' $metadata
            }
            'Capture' { Capture-Original }
            'Publish' { Publish-Target }
            'Reconcile' { Reconcile-Target }
            'Rollback' { Rollback-Target }
            'Export' {
                $selected = $Stage
                if ($selected -eq 'auto') {
                    $rb = Last-Attempt 'rollback'
                    $pb = Last-Attempt 'publish'
                    $selected = if ($null -ne $rb -and $rb.status -eq 'verified') { 'rolled_back' } elseif ($null -ne $pb -and $pb.status -eq 'verified') { 'published' } else { 'before' }
                }
                Capture-Original
                Export-Stage $selected
            }
            'Run' { Invoke-RoundTrip }
            'Package' {}
        }
        $script:State.last_error = $null
        Save-State
        $package = Package-Result
        [ordered]@{ job_id = $script:State.job_id; state = $script:State.state; result_zip = $package; operation_directory = $script:Root } | ConvertTo-Json -Depth 8
    }
} catch {
    $message = Safe-Error $_
    if ($null -ne $script:State) {
        $script:State.last_error = [ordered]@{ at = Utc-Now; action = $Action; message = $message }
        if ($script:NetworkWrite) {
            $attempt = Last-Attempt $script:NetworkWrite
            if ($null -ne $attempt -and $attempt.status -eq 'pending') {
                $attempt.status = 'uncertain'
                $script:State.state = $script:NetworkWrite + '_uncertain'
            }
        }
        try { Event 'action_failed' $script:State.last_error; [void](Package-Result) }
        catch { Write-Warning ('Result packaging was not completed: ' + (Safe-Error $_)) }
    }
    [ordered]@{ error = $message; state = if ($null -ne $script:State) { $script:State.state } else { 'not_started' }; result_zip = $script:ResultZip; operation_directory = $script:Root } | ConvertTo-Json -Depth 8
    exit 1
} finally {
    if ($null -ne $script:Client) { $script:Client.Dispose() }
    if ($null -ne $script:Lock) { $script:Lock.Dispose() }
}
