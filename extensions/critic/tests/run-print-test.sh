#!/bin/bash
# Non-interactive test runner for critic extension (print mode)
# Useful for automated testing and CI
#
# Usage:
#   ./run-print-test.sh <test-name> [main-model] [critic-model] [timeout]

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
EXTENSION_DIR="$(dirname "$SCRIPT_DIR")"

TEST_NAME="${1:-buggy-code}"
MAIN_MODEL="${2:-claude-sonnet-4-5}"
CRITIC_MODEL="${3:-claude-haiku-3-5}"
TEST_TIMEOUT="${4:-120}"

TEST_DIR="$SCRIPT_DIR/$TEST_NAME"
WORKSPACE="$TEST_DIR/workspace"
LOG_DIR="$TEST_DIR/logs"
LOG_FILE="$LOG_DIR/print-test-$(date +%Y%m%d-%H%M%S).log"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
DIM='\033[2m'
BOLD='\033[1m'
NC='\033[0m'

mkdir -p "$LOG_DIR"

log() {
    local level="$1"
    shift
    local timestamp=$(date '+%H:%M:%S')
    echo -e "${DIM}[$timestamp]${NC} [$level] $*" | tee -a "$LOG_FILE"
}

echo -e "${BOLD}${BLUE}══════════════════════════════════════════════════════════${NC}"
echo -e "${BOLD}${BLUE}  Critic Print Mode Test: ${YELLOW}$TEST_NAME${NC}"
echo -e "${BOLD}${BLUE}══════════════════════════════════════════════════════════${NC}"
echo ""

log INFO "Main: $MAIN_MODEL | Critic: $CRITIC_MODEL | Timeout: ${TEST_TIMEOUT}s"

if [ ! -d "$TEST_DIR" ]; then
    log ERROR "Test not found: $TEST_DIR"
    exit 1
fi

# Setup workspace
if [ -d "$TEST_DIR/setup" ]; then
    rm -rf "$WORKSPACE"
    cp -r "$TEST_DIR/setup" "$WORKSPACE"
    log INFO "Workspace ready"
fi

TASK=$(cat "$TEST_DIR/task.md")

cd "${WORKSPACE:-$TEST_DIR}"

echo ""
echo -e "${CYAN}─── Task ───${NC}"
echo -e "${DIM}$TASK${NC}"
echo ""

# Run in print mode with timeout
START_TIME=$(date +%s)

echo -e "${CYAN}─── Agent Output ───${NC}"

# Note: In print mode we can't use /critic-model command, so we need to rely on
# the critic using default model or pre-configured one
# For full test with specific critic model, use run-test.sh (interactive)

if command -v timeout &> /dev/null; then
    TIMEOUT_CMD="timeout ${TEST_TIMEOUT}s"
elif command -v gtimeout &> /dev/null; then
    TIMEOUT_CMD="gtimeout ${TEST_TIMEOUT}s"
else
    TIMEOUT_CMD=""
fi

set +e
$TIMEOUT_CMD pi \
    --model "$MAIN_MODEL" \
    --critic \
    --critic-debug \
    --no-session \
    -p \
    -e "$EXTENSION_DIR/index.ts" \
    "$TASK" 2>&1 | tee -a "$LOG_FILE"

EXIT_CODE=${PIPESTATUS[0]}
set -e

END_TIME=$(date +%s)
DURATION=$((END_TIME - START_TIME))

echo ""
echo -e "${CYAN}─── Results ───${NC}"

if [ $EXIT_CODE -eq 124 ]; then
    echo -e "${RED}✗ TIMEOUT${NC} after ${TEST_TIMEOUT}s"
elif [ $EXIT_CODE -ne 0 ]; then
    echo -e "${YELLOW}⚠ EXIT CODE${NC}: $EXIT_CODE"
else
    echo -e "${GREEN}✓ COMPLETED${NC} in ${DURATION}s"
fi

# Show file changes
if [ -d "$WORKSPACE" ] && [ -d "$TEST_DIR/setup" ]; then
    echo ""
    echo -e "${CYAN}─── File Changes ───${NC}"
    
    for file in "$WORKSPACE"/*; do
        if [ -f "$file" ]; then
            filename=$(basename "$file")
            original="$TEST_DIR/setup/$filename"
            if [ -f "$original" ]; then
                if ! diff -q "$original" "$file" > /dev/null 2>&1; then
                    echo -e "${GREEN}Modified:${NC} $filename"
                    diff --color=always "$original" "$file" 2>/dev/null | head -30 || true
                fi
            else
                echo -e "${GREEN}Created:${NC} $filename"
            fi
        fi
    done
fi

echo ""
echo -e "${DIM}Log: $LOG_FILE${NC}"
