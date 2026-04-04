Add-Type -Assembly 'System.IO.Compression.FileSystem'

$root     = $PSScriptRoot
$addonName = 'Ankipapers'
$outFile  = Join-Path $root "$addonName.ankiaddon"
$tempZip  = Join-Path $root "${addonName}_temp.zip"

if (Test-Path $outFile) { Remove-Item $outFile -Force }
if (Test-Path $tempZip) { Remove-Item $tempZip -Force }

$zip = [System.IO.Compression.ZipFile]::Open($tempZip, 'Create')

function Add-Entry($filePath, $entryName) {
    [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile(
        $zip, $filePath, $entryName, 'Optimal') | Out-Null
    Write-Host "  + $entryName"
}

foreach ($f in @('__init__.py', 'manifest.json', 'config.json', 'config.md')) {
    $full = Join-Path $root $f
    if (Test-Path $full) { Add-Entry $full $f }
}

foreach ($dir in @('core', 'gui')) {
    Get-ChildItem (Join-Path $root $dir) -Recurse -File |
        Where-Object { $_.FullName -notmatch '__pycache__' } |
        ForEach-Object {
            $rel = $_.FullName.Substring($root.Length + 1)
            Add-Entry $_.FullName $rel
        }
}

Get-ChildItem (Join-Path $root 'web') -Recurse -File |
    ForEach-Object {
        $rel = $_.FullName.Substring($root.Length + 1)
        Add-Entry $_.FullName $rel
    }

$zip.Dispose()

Move-Item $tempZip $outFile -Force
Write-Host ""
Write-Host "Created: $outFile"
