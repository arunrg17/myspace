#!/bin/bash
# =============================================================
#  LPT Log Fetcher & Processor
#  Fetches cosmos order bus/access logs from remote server,
#  applies column replacements, and saves locally.
# =============================================================

set -euo pipefail

# ─────────────────────────────────────────────
#  CONFIGURATION — edit these before first use
# ─────────────────────────────────────────────
REMOTE_HOST='abc.edf@ad.com$cll1$plutosutil03.rze.de.id.com'
SSH_KEY="$HOME/.ssh/id_rsa"            # path to your SSH private key
REMOTE_LOG_DIR="/var/applications/plutos/appsrv/logs_jar"
LOCAL_OUTPUT_DIR="$HOME/lpt_logs"
# ─────────────────────────────────────────────

GREEN='\033[0;32m'
CYAN='\033[0;36m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

banner() {
  echo -e "${CYAN}"
  echo "╔══════════════════════════════════════════╗"
  echo "║       LPT Log Fetcher & Processor        ║"
  echo "╚══════════════════════════════════════════╝"
  echo -e "${NC}"
}

log_info()  { echo -e "${GREEN}[INFO]${NC}  $*"; }
log_warn()  { echo -e "${YELLOW}[WARN]${NC}  $*"; }
log_error() { echo -e "${RED}[ERROR]${NC} $*"; }

# ─────────────────────────────────────────────
#  Prompt for date and time range
# ─────────────────────────────────────────────
prompt_inputs() {
  echo ""
  read -rp "Enter log date (YYYY-MM-DD) [default: today $(date +%Y-%m-%d)]: " LOG_DATE
  LOG_DATE="${LOG_DATE:-$(date +%Y-%m-%d)}"

  if ! date -d "$LOG_DATE" &>/dev/null 2>&1; then
    log_error "Invalid date format: $LOG_DATE. Please use YYYY-MM-DD."
    exit 1
  fi

  read -rp "Enter START time (HH:MM:SS) [default: 12:00:00]: " START_HITS
  START_HITS="${START_HITS:-12:00:00}"

  read -rp "Enter END time   (HH:MM:SS) [default: 13:01:00]: " END_HITS
  END_HITS="${END_HITS:-13:01:00}"

  echo ""
  log_info "Date      : $LOG_DATE"
  log_info "Time range: $START_HITS  →  $END_HITS"
  echo ""
}

# ─────────────────────────────────────────────
#  Create local output directory
# ─────────────────────────────────────────────
prepare_output_dir() {
  mkdir -p "$LOCAL_OUTPUT_DIR"
  log_info "Local output directory: $LOCAL_OUTPUT_DIR"
}

# ─────────────────────────────────────────────
#  Run remote commands over SSH and fetch logs
# ─────────────────────────────────────────────
fetch_logs() {
  local date="$1"
  local start="$2"
  local end="$3"

  log_info "Connecting to $REMOTE_HOST ..."

  ssh -i "$SSH_KEY" -o StrictHostKeyChecking=no "$REMOTE_HOST" bash -s -- "$date" "$start" "$end" <<'ENDSSH'
DATE="$1"
START_HITS="$2"
END_HITS="$3"

mkdir -p /tmp/test-logs
cd /var/applications/plutos/appsrv/logs_jar

echo "[REMOTE] Extracting bus log..."
unzip -c "*cosmos*${DATE}*" "*order*bus*?*" \
  | awk -v START_HITS="$START_HITS" -v END_HITS="$END_HITS" \
    '{ time_part = substr($2, 1, 8); if (time_part >= START_HITS && time_part <= END_HITS) { print } }' \
  | grep received \
  > /tmp/test-logs/oer_bus.log

echo "[REMOTE] Extracting access log..."
unzip -c "*cosmos*${DATE}*" "*order*access*?*" \
  | awk -v START_HITS="$START_HITS" -v END_HITS="$END_HITS" \
    '{ time_part = substr($2, 1, 8); if (time_part >= START_HITS && time_part <= END_HITS) { print } }' \
  | grep OrderEntryRequestprocessed \
  > /tmp/test-logs/oer_access.log

echo "[REMOTE] Done."
ENDSSH

  log_info "Remote extraction complete."
}

# ─────────────────────────────────────────────
#  Copy log files from remote to local
# ─────────────────────────────────────────────
copy_logs_locally() {
  local date="$1"
  local timestamp
  timestamp=$(date +%Y%m%d_%H%M%S)

  BUS_LOCAL="$LOCAL_OUTPUT_DIR/oer_bus_${date}_${timestamp}.log"
  ACCESS_LOCAL="$LOCAL_OUTPUT_DIR/oer_access_${date}_${timestamp}.log"

  log_info "Copying bus.log to local..."
  scp -i "$SSH_KEY" -o StrictHostKeyChecking=no \
    "${REMOTE_HOST}:/tmp/test-logs/oer_bus.log" "$BUS_LOCAL"

  log_info "Copying access.log to local..."
  scp -i "$SSH_KEY" -o StrictHostKeyChecking=no \
    "${REMOTE_HOST}:/tmp/test-logs/oer_access.log" "$ACCESS_LOCAL"

  log_info "Files saved:"
  log_info "  BUS    → $BUS_LOCAL"
  log_info "  ACCESS → $ACCESS_LOCAL"
}

# ─────────────────────────────────────────────
#  Apply column replacements to bus.log
# ─────────────────────────────────────────────
apply_replacements() {
  log_info "Applying replacements to bus.log..."

  # "received time="  →  "received in "
  # "received in:"    →  "received in "
  sed -i \
    -e 's/received time=/received in /g' \
    -e 's/received in:/received in /g' \
    "$BUS_LOCAL"

  log_info "Replacements applied successfully."
}

# ─────────────────────────────────────────────
#  Summary
# ─────────────────────────────────────────────
show_summary() {
  echo ""
  echo -e "${CYAN}─────────────── SUMMARY ───────────────${NC}"
  echo -e "  Bus log entries    : $(wc -l < "$BUS_LOCAL")"
  echo -e "  Access log entries : $(wc -l < "$ACCESS_LOCAL")"
  echo -e "${CYAN}───────────────────────────────────────${NC}"
  echo ""
  log_info "All done! Logs saved to: $LOCAL_OUTPUT_DIR"
}

# ─────────────────────────────────────────────
#  MAIN
# ─────────────────────────────────────────────
main() {
  banner
  prompt_inputs
  prepare_output_dir
  fetch_logs        "$LOG_DATE" "$START_HITS" "$END_HITS"
  copy_logs_locally "$LOG_DATE"
  apply_replacements
  show_summary
}

main "$@"
