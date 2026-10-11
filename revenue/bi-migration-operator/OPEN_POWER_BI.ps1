$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$value = $root.Replace("\", "/").Replace("#", "#(#)").Replace('"', '""')
Get-ChildItem -Path $root -Directory -Filter "*.SemanticModel" | ForEach-Object {
    $path = Join-Path $_.FullName "definition/model.tmdl"
    $original = [System.IO.File]::ReadAllText($path)
    $replacement = 'expression DataRoot = "' + $value + '" meta [IsParameterQuery=true, Type="Text", IsParameterQueryRequired=true]'
    $updated = [regex]::Replace($original, '(?m)^expression DataRoot = .*?$', { param($match) $replacement })
    [System.IO.File]::WriteAllText($path, $updated, [System.Text.UTF8Encoding]::new($false))
}
$project = Get-ChildItem -Path $root -File -Filter "*.pbip" | Select-Object -First 1
if (-not $project) { throw "No Power BI project was found in this folder." }
Start-Process -FilePath $project.FullName
