# =============================================================
#  LPT Log Fetcher & Processor (Windows PowerShell)
#  Fetches cosmos order bus/access logs from remote server,
#  applies column replacements, and saves locally.
#  Requirements: Windows 10/11 with OpenSSH client enabled
# =============================================================

# ─────────────────────────────────────────────
#  CONFIGURATION — edit these before first use
# ─────────────────────────────────────────────
$REMOTE_HOST    = 'abc.edf@ad.com$cll1$plutosutil03.rze.de.id.com'
$SSH_KEY        = "$HOME\.ssh\id_rsa"
$REMOTE_LOG_DIR = "/var/applications/plutos/appsrv/logs_jar"
$LOCAL_OUTPUT   = "$HOME\lpt_logs"
# ─────────────────────────────────────────────

function Write-Banner {
    Write-Host ""
    Write-Host "╔══════════════════════════════════════════╗" -ForegroundColor Cyan
    Write-Host "║       LPT Log Fetcher & Processor        ║" -ForegroundColor Cyan
    Write-Host "╚══════════════════════════════════════════╝" -ForegroundColor Cyan
    Write-Host ""
}

function Write-Info  { param($msg) Write-Host "[INFO]  $msg" -ForegroundColor Green }
function Write-Warn  { param($msg) Write-Host "[WARN]  $msg" -ForegroundColor Yellow }
function Write-Err   { param($msg) Write-Host "[ERROR] $msg" -ForegroundColor Red }

# ─────────────────────────────────────────────
#  Prompt for date and time range
# ─────────────────────────────────────────────
function Get-UserInputs {
    $today = (Get-Date).ToString("yyyy-MM-dd")

    Write-Host ""
    $script:LOG_DATE = Read-Host "Enter log date (YYYY-MM-DD) [default: $today]"
    if ([string]::IsNullOrWhiteSpace($script:LOG_DATE)) { $script:LOG_DATE = $today }

    # Validate date
    try { [datetime]::ParseExact($script:LOG_DATE, "yyyy-MM-dd", $null) | Out-Null }
    catch { Write-Err "Invalid date format: $($script:LOG_DATE). Use YYYY-MM-DD."; exit 1 }

    $script:START_HITS = Read-Host "Enter START time (HH:MM:SS) [default: 12:00:00]"
    if ([string]::IsNullOrWhiteSpace($script:START_HITS)) { $script:START_HITS = "12:00:00" }

    $script:END_HITS = Read-Host "Enter END time   (HH:MM:SS) [default: 13:01:00]"
    if ([string]::IsNullOrWhiteSpace($script:END_HITS)) { $script:END_HITS = "13:01:00" }

    Write-Host ""
    Write-Info "Date      : $($script:LOG_DATE)"
    Write-Info "Time range: $($script:START_HITS)  ->  $($script:END_HITS)"
    Write-Host ""
}

# ─────────────────────────────────────────────
#  Create local output directory
# ─────────────────────────────────────────────
function New-OutputDir {
    if (-not (Test-Path $LOCAL_OUTPUT)) {
        New-Item -ItemType Directory -Path $LOCAL_OUTPUT | Out-Null
    }
    Write-Info "Local output directory: $LOCAL_OUTPUT"
}

# ─────────────────────────────────────────────
#  Run remote commands over SSH
# ─────────────────────────────────────────────
function Invoke-RemoteExtraction {
    param($Date, $Start, $End)

    Write-Info "Connecting to $REMOTE_HOST ..."

    # Build the remote bash commands as a single string
    $remoteCmd = @"
mkdir -p /tmp/test-logs
cd $REMOTE_LOG_DIR

echo '[REMOTE] Extracting bus log...'
unzip -c '*cosmos*${Date}*' '*order*bus*?*' \
  | awk -v START_HITS='$Start' -v END_HITS='$End' \
    '{ time_part = substr(\$2, 1, 8); if (time_part >= START_HITS && time_part <= END_HITS) { print } }' \
  | grep received \
  > /tmp/test-logs/oer_bus.log

echo '[REMOTE] Extracting access log...'
unzip -c '*cosmos*${Date}*' '*order*access*?*' \
  | awk -v START_HITS='$Start' -v END_HITS='$End' \
    '{ time_part = substr(\$2, 1, 8); if (time_part >= START_HITS && time_part <= END_HITS) { print } }' \
  | grep OrderEntryRequestprocessed \
  > /tmp/test-logs/oer_access.log

echo '[REMOTE] Done.'
"@

    $result = ssh -i $SSH_KEY -o StrictHostKeyChecking=no $REMOTE_HOST $remoteCmd
    if ($LASTEXITCODE -ne 0) {
        Write-Err "SSH command failed. Check your SSH key and hostname."
        exit 1
    }

    Write-Info "Remote extraction complete."
}

# ─────────────────────────────────────────────
#  Copy log files from remote to local (SCP)
# ─────────────────────────────────────────────
function Copy-LogsLocally {
    param($Date)

    $timestamp = (Get-Date).ToString("yyyyMMdd_HHmmss")
    $script:BUS_LOCAL    = "$LOCAL_OUTPUT\oer_bus_${Date}_${timestamp}.log"
    $script:ACCESS_LOCAL = "$LOCAL_OUTPUT\oer_access_${Date}_${timestamp}.log"

    Write-Info "Copying bus.log to local..."
    scp -i $SSH_KEY -o StrictHostKeyChecking=no `
        "${REMOTE_HOST}:/tmp/test-logs/oer_bus.log" $script:BUS_LOCAL

    if ($LASTEXITCODE -ne 0) { Write-Err "SCP failed for bus.log"; exit 1 }

    Write-Info "Copying access.log to local..."
    scp -i $SSH_KEY -o StrictHostKeyChecking=no `
        "${REMOTE_HOST}:/tmp/test-logs/oer_access.log" $script:ACCESS_LOCAL

    if ($LASTEXITCODE -ne 0) { Write-Err "SCP failed for access.log"; exit 1 }

    Write-Info "Files saved:"
    Write-Info "  BUS    -> $($script:BUS_LOCAL)"
    Write-Info "  ACCESS -> $($script:ACCESS_LOCAL)"
}

# ─────────────────────────────────────────────
#  Apply column replacements to bus.log
# ─────────────────────────────────────────────
function Invoke-Replacements {
    Write-Info "Applying replacements to bus.log..."

    $content = Get-Content $script:BUS_LOCAL -Raw
    $content = $content -replace 'received time=', 'received in '
    $content = $content -replace 'received in:',   'received in '
    Set-Content -Path $script:BUS_LOCAL -Value $content -NoNewline

    Write-Info "Replacements applied successfully."
}

# ─────────────────────────────────────────────
#  Summary
# ─────────────────────────────────────────────
function Show-Summary {
    $busLines    = (Get-Content $script:BUS_LOCAL    | Measure-Object -Line).Lines
    $accessLines = (Get-Content $script:ACCESS_LOCAL | Measure-Object -Line).Lines

    Write-Host ""
    Write-Host "─────────────── SUMMARY ───────────────" -ForegroundColor Cyan
    Write-Host "  Bus log entries    : $busLines"
    Write-Host "  Access log entries : $accessLines"
    Write-Host "───────────────────────────────────────" -ForegroundColor Cyan
    Write-Host ""
    Write-Info "All done! Logs saved to: $LOCAL_OUTPUT"
}

# ─────────────────────────────────────────────
#  MAIN
# ─────────────────────────────────────────────
Write-Banner
Get-UserInputs
New-OutputDir
Invoke-RemoteExtraction -Date $LOG_DATE -Start $START_HITS -End $END_HITS
Copy-LogsLocally        -Date $LOG_DATE
Invoke-Replacements
Show-Summary
