param([Parameter(Mandatory=$true)][string]$JobFile,[ValidateSet('Prepare','Apply','Recover')][string]$Phase='Prepare')
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$jobPath=[IO.Path]::GetFullPath($JobFile);$jobRoot=[IO.Path]::GetDirectoryName($jobPath)
$j=Get-Content -LiteralPath $jobPath -Raw -Encoding UTF8 | ConvertFrom-Json
$target=[IO.Path]::GetFullPath($j.target).TrimEnd('\');$stage=Join-Path $jobRoot 'payload';$backup=Join-Path $jobRoot 'backup';$journal=Join-Path $jobRoot 'transaction.json';$lock=Join-Path $target '.daily-ai-updating.json'
function WriteJson($file,$value){$temp=$file+'.tmp';[IO.File]::WriteAllText($temp,($value|ConvertTo-Json -Depth 12),[Text.UTF8Encoding]::new($false));Move-Item -LiteralPath $temp -Destination $file -Force}
function Under($root,$file){return $file.StartsWith($root.TrimEnd('\')+'\',[StringComparison]::OrdinalIgnoreCase)}
function NoLinks($file){$p=$file;while($p){if(Test-Path -LiteralPath $p){if((Get-Item -Force -LiteralPath $p).Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'Linked paths cannot be updated safely'}};$next=[IO.Path]::GetDirectoryName($p);if($next -eq $p){break};$p=$next}}
function Owned($name){if($name -match '\\|(^|/)\.\.?(/|$)|[<>:"|?*\x00-\x1f]' -or $name -match '[. ]($|/)'){return $false};return $name -cmatch '^(Daily AI\.exe|chrome_(100|200)_percent\.pak|d3dcompiler_47\.dll|dxcompiler\.dll|dxil\.dll|ffmpeg\.dll|icudtl\.dat|libEGL\.dll|libGLESv2\.dll|LICENSE\.electron\.txt|LICENSES\.chromium\.html|resources\.pak|snapshot_blob\.bin|v8_context_snapshot\.bin|vk_swiftshader_icd\.json|vk_swiftshader\.dll|vulkan-1\.dll|Start-Remote-DSA-Test\.cmd|TESTING-README\.txt|locales/[A-Za-z0-9-]+\.pak|resources/app\.asar|resources/app\.asar\.unpacked/(assets|node_modules)/.+)$'}
function SafeFile($root,$name){$file=[IO.Path]::GetFullPath((Join-Path $root $name));if(!(Under $root $file)){throw 'Path outside application'};NoLinks $file;return $file}
function Hash($file){$sha=[Security.Cryptography.SHA256]::Create();$stream=[IO.File]::OpenRead($file);try{return [BitConverter]::ToString($sha.ComputeHash($stream)).Replace('-','').ToLowerInvariant()}finally{$stream.Dispose();$sha.Dispose()}}
function ReadManifest($file){$m=Get-Content -LiteralPath $file -Raw -Encoding UTF8|ConvertFrom-Json;if($m.product -ne 'daily-ai' -or $m.schemaVersion -ne 1 -or $m.version -notmatch '^\d+\.\d+\.\d+$' -or @($m.files).Count -gt 20000){throw 'Invalid release manifest'};$seen=@{};foreach($f in $m.files){if(!(Owned $f.path) -or $f.sha256 -notmatch '^[a-f0-9]{64}$' -or $seen.ContainsKey($f.path.ToLowerInvariant())){throw 'Invalid package file'};$seen[$f.path.ToLowerInvariant()]=$true};if(!$seen.ContainsKey('daily ai.exe') -or !$seen.ContainsKey('resources/app.asar')){throw 'Incomplete release'};return $m}
function WaitParent(){for($i=0;$i -lt 300;$i++){if(!(Get-Process -Id $j.parentPid -ErrorAction SilentlyContinue)){return};Start-Sleep -Milliseconds 200};throw 'Application did not exit; update was not applied'}
function LaunchApp($ack){$args=@();if($ack){$args=@('--daily-ai-update-ack='+$j.token)};if($args.Count){return Start-Process -FilePath (Join-Path $target 'Daily AI.exe') -WorkingDirectory $target -ArgumentList $args -PassThru};return Start-Process -FilePath (Join-Path $target 'Daily AI.exe') -WorkingDirectory $target -PassThru}
function Restore(){if(!(Test-Path -LiteralPath $journal)){return};$tx=Get-Content -LiteralPath $journal -Raw -Encoding UTF8|ConvertFrom-Json;if($tx.phase -notin @('applying','awaiting-start','committed')){return};foreach($entry in $tx.files){$dest=SafeFile $target $entry.path;if($entry.existed){[IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($dest))|Out-Null;[IO.File]::Copy((SafeFile $backup $entry.path),$dest,$true)}elseif(Test-Path -LiteralPath $dest){Remove-Item -LiteralPath $dest -Force}};WriteJson $journal @{phase='rolled-back';files=$tx.files}}
function CleanupOwnedJob(){foreach($name in @('backup','payload')){$p=[IO.Path]::GetFullPath((Join-Path $jobRoot $name));if((Under $jobRoot $p) -and (Test-Path -LiteralPath $p)){NoLinks $p;Remove-Item -LiteralPath $p -Recurse -Force}};$zip=Join-Path $jobRoot 'download.zip';if(Test-Path -LiteralPath $zip){Remove-Item -LiteralPath $zip -Force}}
try{
 if($j.product -ne 'daily-ai' -or $j.token -notmatch '^[a-f0-9]{48}$' -or $target.Length -le 3 -or !(Test-Path -LiteralPath (Join-Path $target 'Daily AI.exe'))){throw 'Invalid installation target'}
 NoLinks $target;NoLinks $jobRoot
 if($Phase -eq 'Prepare'){
  $zipFile=Join-Path $jobRoot 'download.zip';if((Hash $zipFile) -ne $j.sha256){throw 'Package checksum mismatch'}
  [IO.Directory]::CreateDirectory($stage)|Out-Null;$zip=[IO.Compression.ZipFile]::OpenRead($zipFile);$total=0;$seen=@{}
  try{foreach($entry in $zip.Entries){$parts=$entry.FullName.Split('/');if($parts[0] -cne ('Daily-AI-'+$j.version) -or $entry.FullName.Contains('\') -or $entry.FullName -match '(^|/)\.\.?(/|$)' -or (($entry.ExternalAttributes -shr 16) -band 61440) -eq 40960){throw 'Unsafe ZIP entry'};$name=($parts|Select-Object -Skip 1)-join '/';if(!$name -or $name.EndsWith('/')){continue};if($name -cne '.daily-ai-release.json' -and !(Owned $name)){throw 'Unexpected ZIP contents'};if($seen.ContainsKey($name.ToLowerInvariant())){throw 'Duplicate ZIP entry'};$seen[$name.ToLowerInvariant()]=$true;$total+=$entry.Length;if($total -gt 2147483648 -or $seen.Count -gt 20001){throw 'Expanded package exceeds limit'};$file=SafeFile $stage $name;[IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($file))|Out-Null;[IO.Compression.ZipFileExtensions]::ExtractToFile($entry,$file,$false)}}finally{$zip.Dispose()}
  $m=ReadManifest (Join-Path $stage '.daily-ai-release.json');if($m.version -ne $j.version -or $seen.Count -ne (@($m.files).Count+1)){throw 'Release version or file list mismatch'}
  foreach($f in $m.files){if((Hash (SafeFile $stage $f.path)) -ne $f.sha256){throw 'Application file checksum mismatch'}}
  WriteJson (Join-Path $jobRoot 'prepared.json') @{version=$j.version;token=$j.token};exit 0
 }
 WriteJson (Join-Path $jobRoot 'armed.json') @{pid=$PID;token=$j.token}
 WaitParent
 if($Phase -eq 'Recover'){
  $tx=Get-Content -LiteralPath $journal -Raw -Encoding UTF8|ConvertFrom-Json
  $ackFile=Join-Path $jobRoot 'ack.json';$confirmed=$false;if(Test-Path -LiteralPath $ackFile){$a=Get-Content -LiteralPath $ackFile -Raw -Encoding UTF8|ConvertFrom-Json;$confirmed=$a.token -eq $j.token -and $a.version -eq $j.version}
  if($tx.phase -eq 'committed' -or $confirmed){CleanupOwnedJob}else{Restore}
  if(Test-Path -LiteralPath $lock){Remove-Item -LiteralPath $lock -Force}
  WriteJson (Join-Path $jobRoot 'result.json') @{status='recovered';version=$j.version};LaunchApp $false|Out-Null;exit 0
 }
 $m=ReadManifest (Join-Path $stage '.daily-ai-release.json');if($m.version -ne $j.version){throw 'Prepared version mismatch'}
 $prepared=Get-Content -LiteralPath (Join-Path $jobRoot 'prepared.json') -Raw -Encoding UTF8|ConvertFrom-Json;if($prepared.token -ne $j.token){throw 'Prepared token mismatch'}
 foreach($f in $m.files){if((Hash (SafeFile $stage $f.path)) -ne $f.sha256){throw 'Staged application file changed'}}
 $owned=@{};$oldManifest=Join-Path $target '.daily-ai-release.json'
 if(Test-Path -LiteralPath $oldManifest){foreach($f in (ReadManifest $oldManifest).files){$owned[$f.path]=$true}}else{Get-ChildItem -LiteralPath $target -File -Recurse|ForEach-Object{$rel=$_.FullName.Substring($target.Length+1).Replace('\','/');if((Owned $rel) -and ($rel -notlike 'resources/app.asar.unpacked/*' -or $rel -in @('resources/app.asar.unpacked/assets/icon.ico','resources/app.asar.unpacked/assets/icon.png') -or $m.files.path -contains $rel)){$owned[$rel]=$true}}}
 $names=@{};foreach($key in $owned.Keys){$names[$key]=$true};foreach($f in $m.files){$dest=SafeFile $target $f.path;if((Test-Path -LiteralPath $dest) -and !$owned.ContainsKey($f.path)){throw 'New application file conflicts with an existing user file'};$names[$f.path]=$true};$names['.daily-ai-release.json']=$true
 $entries=@();foreach($name in $names.Keys){$dest=SafeFile $target $name;foreach($protected in @($j.dataDir,$j.userData)){if($protected -and ((Under ([IO.Path]::GetFullPath($protected)) $dest) -or $dest -eq [IO.Path]::GetFullPath($protected))){throw 'Application update overlaps user data'}};$exists=Test-Path -LiteralPath $dest;$entries+=@{path=$name;existed=$exists};if($exists){$copy=SafeFile $backup $name;[IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($copy))|Out-Null;[IO.File]::Copy($dest,$copy,$false)}}
 WriteJson $journal @{phase='applying';files=$entries}
 WriteJson $lock @{token=$j.token;pid=$PID}
 foreach($f in $m.files){$dest=SafeFile $target $f.path;[IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($dest))|Out-Null;$copied=$false;for($retry=0;$retry -lt 30;$retry++){try{[IO.File]::Copy((SafeFile $stage $f.path),$dest,$true);$copied=$true;break}catch{Start-Sleep -Milliseconds 200}};if(!$copied){throw 'Application file is locked'}}
 $newNames=@{};foreach($f in $m.files){$newNames[$f.path]=$true};foreach($key in $owned.Keys){if(!$newNames.ContainsKey($key)){Remove-Item -LiteralPath (SafeFile $target $key) -Force}}
 [IO.File]::Copy((Join-Path $stage '.daily-ai-release.json'),$oldManifest,$true)
 WriteJson $journal @{phase='awaiting-start';files=$entries}
 $child=LaunchApp $true;$ready=$false
 for($i=0;$i -lt 600;$i++){if(Test-Path -LiteralPath (Join-Path $jobRoot 'ack.json')){$ack=Get-Content -LiteralPath (Join-Path $jobRoot 'ack.json') -Raw -Encoding UTF8|ConvertFrom-Json;if($ack.token -eq $j.token -and $ack.version -eq $j.version){$ready=$true;break}};if($child.HasExited){break};Start-Sleep -Milliseconds 200}
 if(!$ready){if(!$child.HasExited){Stop-Process -Id $child.Id -Force;$child.WaitForExit(10000)|Out-Null};throw 'New version did not start; restoring previous version'}
 $newStarted=$true
 WriteJson $journal @{phase='committed';files=$entries};Remove-Item -LiteralPath $lock -Force
 WriteJson (Join-Path $jobRoot 'result.json') @{status='installed';version=$j.version}
 try{CleanupOwnedJob}catch{WriteJson (Join-Path $jobRoot 'result.json') @{status='installed';version=$j.version;cleanupPending=$true}}
}catch{
 $message=$_.Exception.Message
 if($newStarted){[Console]::Error.WriteLine('Update installed; deferred cleanup: '+$message);exit 0}
 if($Phase -ne 'Prepare'){try{Restore;if(Test-Path -LiteralPath $lock){Remove-Item -LiteralPath $lock -Force};WriteJson (Join-Path $jobRoot 'result.json') @{status='rolled-back';message=$message};try{CleanupOwnedJob}catch{};if(!(Get-Process -Id $j.parentPid -ErrorAction SilentlyContinue)){LaunchApp $false|Out-Null}}catch{$message+='; recovery failed: '+$_.Exception.Message}}
 WriteJson (Join-Path $jobRoot 'error.json') @{message=$message};[Console]::Error.WriteLine($message);exit 1
}
