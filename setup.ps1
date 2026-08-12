# Windows installer: links this repo's CLAUDE.md, agents/ and skills/ into %USERPROFILE%\.claude
# so Claude Code picks them up. Safe to re-run. Never overwrites files it doesn't own.
#
# Directories are linked as junctions (no special rights needed). Files are linked as
# symlinks, which require Developer Mode (Settings > System > For developers) OR an
# elevated PowerShell. Run:  powershell -ExecutionPolicy Bypass -File setup.ps1

$ErrorActionPreference = 'Stop'
$RepoDir   = Split-Path -Parent $MyInvocation.MyCommand.Path
$ClaudeDir = if ($env:CLAUDE_DIR) { $env:CLAUDE_DIR } else { Join-Path $env:USERPROFILE '.claude' }
$script:Failed = $false

function Link-Item {
    param([string]$Src, [string]$Dst)

    if (Test-Path -LiteralPath $Dst) {
        $item = Get-Item -LiteralPath $Dst -Force
        if ($item.LinkType) {
            $target = [string]($item.Target | Select-Object -First 1)
            if ($target -eq $Src) { Write-Host "  ok      $Dst"; return }
            if ($item.PSIsContainer) { cmd /c rmdir "$Dst" | Out-Null }
            else { Remove-Item -LiteralPath $Dst -Force }
            Write-Host "  relink  $Dst (was: $target)"
        } else {
            Write-Host "  SKIP    $Dst exists and is not a myoffice link - resolve manually"
            return
        }
    }

    try {
        if (Test-Path -LiteralPath $Src -PathType Container) {
            New-Item -ItemType Junction -Path $Dst -Target $Src | Out-Null
        } else {
            New-Item -ItemType SymbolicLink -Path $Dst -Target $Src | Out-Null
        }
        Write-Host "  link    $Dst -> $Src"
    } catch {
        Write-Host "  FAIL    $Dst : $($_.Exception.Message)"
        Write-Host "          File symlinks need Developer Mode (Settings > System > For developers) or an elevated PowerShell."
        $script:Failed = $true
    }
}

Write-Host "Installing claude-myoffice into $ClaudeDir"
New-Item -ItemType Directory -Force -Path (Join-Path $ClaudeDir 'agents'), (Join-Path $ClaudeDir 'skills') | Out-Null

Write-Host "agents:"
Get-ChildItem (Join-Path $RepoDir 'agents') -Filter *.md | ForEach-Object {
    Link-Item $_.FullName (Join-Path $ClaudeDir "agents\$($_.Name)")
}

Write-Host "skills:"
Get-ChildItem (Join-Path $RepoDir 'skills') -Directory | ForEach-Object {
    Link-Item $_.FullName (Join-Path $ClaudeDir "skills\$($_.Name)")
}

Write-Host "global memory:"
Link-Item (Join-Path $RepoDir 'CLAUDE.md') (Join-Path $ClaudeDir 'CLAUDE.md')

Write-Host "office-viz hooks:"
if (Get-Command node -ErrorAction SilentlyContinue) {
    $installHooks = Join-Path $RepoDir 'office-viz\install-hooks.js'
    & node $installHooks | ForEach-Object { Write-Host "  $_" }
} else {
    Write-Host "  SKIP    node not found - install Node.js and re-run to enable office-viz hooks"
}

if ($script:Failed) {
    Write-Host "Some links FAILED - fix the cause above and re-run. Already-created links are fine."
    exit 1
}
Write-Host "Done. Open any repo with Claude Code and run: /brief `"<idea>`" or /delegate `"<task>`""
