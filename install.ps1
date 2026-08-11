<#
.SYNOPSIS
Install outmute on Windows.

.DESCRIPTION
Downloads the release binary for this machine, verifies it against
SHASUMS256.txt, installs it to %LOCALAPPDATA%\Programs\outmute, and puts that
directory on your user PATH. Re-run to update; the existing binary is
overwritten.

Every option can also be given as an environment variable, which is how you
configure the one-liner install:

  OUTMUTE_INSTALL_DIR     where to put outmute.exe
  OUTMUTE_VERSION         pin a version, e.g. 2.1.2 (default: latest release)
  OUTMUTE_NO_MODIFY_PATH  set to 1 to leave your PATH alone
  OUTMUTE_DOWNLOAD_URL    override the asset base URL (testing only)

.EXAMPLE
irm https://zetlen.github.io/outmute/install.ps1 | iex

.EXAMPLE
$env:OUTMUTE_VERSION = '2.1.2'; irm https://zetlen.github.io/outmute/install.ps1 | iex

.EXAMPLE
.\install.ps1 -InstallDir C:\tools\outmute
#>
[CmdletBinding()]
param(
  # Where to put outmute.exe (default: %LOCALAPPDATA%\Programs\outmute).
  [string] $InstallDir = $env:OUTMUTE_INSTALL_DIR,
  # Pin a version, e.g. 2.1.2 (default: latest release).
  [string] $Version = $env:OUTMUTE_VERSION,
  # Skip the user PATH update.
  [switch] $NoModifyPath = ($env:OUTMUTE_NO_MODIFY_PATH -and $env:OUTMUTE_NO_MODIFY_PATH -ne '0'),
  # Override the asset base URL (testing only).
  [string] $DownloadUrl = $env:OUTMUTE_DOWNLOAD_URL
)

$Repo = 'zetlen/outmute'
$ReleasesPage = "https://github.com/$Repo/releases"

function Write-Say([string] $Message) {
  Write-Host "outmute: $Message"
}

function Write-Warn([string] $Message) {
  Write-Warning "outmute: $Message"
}

# Errors carry the prefix so the top-level handler can print them bare.
function Stop-Install([string] $Message) {
  throw "outmute: $Message"
}

# Return the release-asset platform slug for this machine, or fail.
function Get-Target {
  if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) {
    Stop-Install 'install.ps1 is the Windows installer. On macOS or Linux run: curl -fsSL https://zetlen.github.io/outmute/install.sh | sh'
  }

  # A 32-bit PowerShell on 64-bit Windows reports x86 and stashes the real
  # architecture in PROCESSOR_ARCHITEW6432.
  $arch = if ($env:PROCESSOR_ARCHITEW6432) { $env:PROCESSOR_ARCHITEW6432 } else { $env:PROCESSOR_ARCHITECTURE }
  switch ($arch) {
    'AMD64' { 'windows-x64' }
    'ARM64' {
      # There is no arm64 build; Windows on ARM runs the x64 one emulated.
      Write-Say 'Windows on ARM detected; installing the x64 build, which runs under emulation'
      'windows-x64'
    }
    default {
      Stop-Install "unsupported architecture: $arch. The only prebuilt Windows binary is windows-x64. See $ReleasesPage"
    }
  }
}

# Return the base URL that release assets live under.
function Get-AssetBaseUrl([string] $Version, [string] $DownloadUrl) {
  if ($DownloadUrl) { return $DownloadUrl.TrimEnd('/') }
  if ($Version) { return "$ReleasesPage/download/v$($Version -replace '^v', '')" }
  return "$ReleasesPage/latest/download"
}

function Save-Asset([string] $Url, [string] $Destination) {
  Invoke-WebRequest -Uri $Url -OutFile $Destination -UseBasicParsing -ErrorAction Stop
}

# The name at the end of a SHASUMS256.txt line, minus sha256sum's binary-mode
# asterisk.
function Get-ShasumName([string] $Line) {
  $fields = $Line.Trim() -split '\s+'
  if ($fields.Count -lt 2) { return '' }
  return $fields[-1].TrimStart('*')
}

# The archive name for this target. Asset names carry the version, so
# SHASUMS256.txt (whose name does not) is what tells us which version "latest"
# resolved to.
function Get-AssetName([string] $Target, [string] $ShasumsPath) {
  $suffix = "-$Target.zip"
  foreach ($line in Get-Content -LiteralPath $ShasumsPath) {
    $name = Get-ShasumName $line
    if ($name.EndsWith($suffix)) { return $name }
  }
  Stop-Install "no $Target asset listed in SHASUMS256.txt"
}

function Assert-Checksum([string] $Path, [string] $Name, [string] $ShasumsPath) {
  $expected = ''
  foreach ($line in Get-Content -LiteralPath $ShasumsPath) {
    if ((Get-ShasumName $line) -eq $Name) {
      $expected = ($line.Trim() -split '\s+')[0]
      break
    }
  }
  if (-not $expected) { Stop-Install "no checksum for $Name in SHASUMS256.txt" }

  $actual = (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash
  if ($actual -ne $expected) {
    Stop-Install "checksum mismatch for $Name (expected $expected, got $actual)"
  }
}

# Is $Dir one of the entries in a semicolon-separated $Path?
function Test-PathEntry([string] $Dir, [string] $Path) {
  $needle = $Dir.TrimEnd('\')
  foreach ($entry in $Path -split ';') {
    if (-not $entry) { continue }
    if ([Environment]::ExpandEnvironmentVariables($entry).TrimEnd('\') -eq $needle) { return $true }
  }
  return $false
}

# The user PATH as stored, unexpanded: writing back an expanded copy would turn
# someone's %USERPROFILE% entries into literal paths.
function Get-RawUserPath {
  $value = (Get-Item -LiteralPath 'HKCU:\Environment').GetValue(
    'Path', '', [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)
  if ($null -eq $value) { return '' }
  return [string]$value
}

# Windows only picks up an environment change in processes started after it is
# broadcast; without this, a terminal opened from Explorer keeps the stale PATH.
function Publish-EnvironmentChange {
  $signature = @'
[DllImport("user32.dll", SetLastError = true, CharSet = CharSet.Auto)]
public static extern IntPtr SendMessageTimeout(
    IntPtr hWnd, uint Msg, UIntPtr wParam, string lParam,
    uint fuFlags, uint uTimeout, out UIntPtr lpdwResult);
'@
  try {
    if (-not ('Outmute.NativeMethods' -as [type])) {
      Add-Type -MemberDefinition $signature -Name 'NativeMethods' -Namespace 'Outmute' | Out-Null
    }
    $result = [UIntPtr]::Zero
    # HWND_BROADCAST, WM_SETTINGCHANGE, SMTO_ABORTIFHUNG, 5s timeout.
    [Outmute.NativeMethods]::SendMessageTimeout(
      [IntPtr]0xffff, 0x1a, [UIntPtr]::Zero, 'Environment', 0x2, 5000, [ref]$result) | Out-Null
  } catch {
    Write-Warn 'could not broadcast the PATH change; sign out and back in if a new terminal cannot find outmute'
  }
}

function Add-ToUserPath([string] $Dir) {
  $stored = Get-RawUserPath
  if (Test-PathEntry $Dir $stored) {
    Write-Say "$Dir is already on your PATH"
  } else {
    $prefix = $stored.TrimEnd(';')
    $updated = if ($prefix) { "$prefix;$Dir" } else { $Dir }
    Set-ItemProperty -LiteralPath 'HKCU:\Environment' -Name 'Path' -Value $updated -Type ExpandString
    Publish-EnvironmentChange
    Write-Say "added $Dir to your user PATH"
  }
  # The running shell inherited its PATH at startup, so fix it up too.
  if (-not (Test-PathEntry $Dir $env:Path)) { $env:Path = "$env:Path;$Dir" }
}

function Install-Outmute([string] $InstallDir, [string] $Version, [switch] $NoModifyPath, [string] $DownloadUrl) {
  # Set inside the function so the caller's session keeps its own preferences
  # when this script is run through `irm ... | iex`.
  Set-StrictMode -Version 3.0
  $ErrorActionPreference = 'Stop'
  # Invoke-WebRequest is glacial in Windows PowerShell with the progress bar on.
  $ProgressPreference = 'SilentlyContinue'

  # Windows PowerShell on older systems still defaults to TLS 1.0/1.1; GitHub
  # needs 1.2.
  try {
    [Net.ServicePointManager]::SecurityProtocol =
      [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
  } catch {
    Write-Verbose 'could not enable TLS 1.2; continuing with the defaults'
  }

  $target = Get-Target
  $base = Get-AssetBaseUrl $Version $DownloadUrl
  $dir = if ($InstallDir) {
    $InstallDir
  } else {
    Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'Programs\outmute'
  }

  $tmp = Join-Path ([IO.Path]::GetTempPath()) ('outmute-' + [guid]::NewGuid().ToString('N'))
  New-Item -ItemType Directory -Path $tmp -Force | Out-Null
  try {
    Write-Say "fetching checksums from $base"
    $shasums = Join-Path $tmp 'SHASUMS256.txt'
    try {
      Save-Asset "$base/SHASUMS256.txt" $shasums
    } catch {
      Stop-Install "could not download SHASUMS256.txt from $base ($($_.Exception.Message))"
    }

    $asset = Get-AssetName $target $shasums
    $archive = Join-Path $tmp $asset

    Write-Say "downloading $asset"
    try {
      Save-Asset "$base/$asset" $archive
    } catch {
      Stop-Install "could not download $asset from $base ($($_.Exception.Message))"
    }

    Assert-Checksum $archive $asset $shasums

    try {
      Expand-Archive -LiteralPath $archive -DestinationPath $tmp -Force
    } catch {
      Stop-Install "could not extract $asset ($($_.Exception.Message))"
    }

    $unpacked = Join-Path $tmp 'outmute.exe'
    if (-not (Test-Path -LiteralPath $unpacked)) { Stop-Install "$asset did not contain outmute.exe" }

    New-Item -ItemType Directory -Path $dir -Force | Out-Null
    $installed = Join-Path $dir 'outmute.exe'
    try {
      Move-Item -LiteralPath $unpacked -Destination $installed -Force
    } catch {
      Stop-Install ("could not install to $dir. Close any running outmute and try again, " +
        "or set OUTMUTE_INSTALL_DIR to another location. ($($_.Exception.Message))")
    }

    Write-Say "installed $installed"
    if ($NoModifyPath) {
      if (-not (Test-PathEntry $dir $env:Path)) {
        Write-Warn "$dir is not on your PATH; add it, or run outmute by its full path"
      }
    } else {
      Add-ToUserPath $dir
      Write-Say 'open a new terminal and run: outmute'
    }
  } finally {
    Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue
  }
}

# Set OUTMUTE_INSTALL_LIB=1 to define the functions above without installing.
if ($env:OUTMUTE_INSTALL_LIB -ne '1') {
  try {
    Install-Outmute -InstallDir $InstallDir -Version $Version -NoModifyPath:$NoModifyPath -DownloadUrl $DownloadUrl
  } catch {
    $message = $_.Exception.Message
    if (-not $message.StartsWith('outmute:')) { $message = "outmute: $message" }
    [Console]::Error.WriteLine($message)
    exit 1
  }
}
