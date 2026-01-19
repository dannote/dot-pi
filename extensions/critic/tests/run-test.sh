#!/bin/bash
# Test runner for critic extension
#
# Usage:
#   ./run-test.sh <test-name> [main-model] [critic-model]
#
# Examples:
#   ./run-test.sh buggy-code opus codex
#   ./run-test.sh simple-task sonnet haiku

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TESTS_DIR="$SCRIPT_DIR"
EXTENSION_DIR="$(dirname "$SCRIPT_DIR")"

TEST_NAME="${1:-buggy-code}"
MAIN_MODEL="${2:-claude-opus-4-5}"
CRITIC_MODEL="${3:-gpt-5.2-codex}"
TEST_TIMEOUT="${4:-300}"

TEST_DIR="$TESTS_DIR/$TEST_NAME"
WORKSPACE="$TEST_DIR/workspace"
LOG_DIR="$TEST_DIR/logs"
LOG_FILE="$LOG_DIR/test-$(date +%Y%m%d-%H%M%S).log"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
DIM='\033[2m'
NC='\033[0m'

log() {
    local level="$1"
    shift
    local timestamp=$(date '+%H:%M:%S')
    local color=""
    case "$level" in
        INFO)  color="$CYAN" ;;
        WARN)  color="$YELLOW" ;;
        ERROR) color="$RED" ;;
        OK)    color="$GREEN" ;;
    esac
    echo -e "${DIM}[$timestamp]${NC} ${color}[$level]${NC} $*" | tee -a "$LOG_FILE"
}

cleanup() {
    local exit_code=$?
    log INFO "Test finished with exit code: $exit_code"
    if [ -d "$WORKSPACE" ]; then
        log INFO "Workspace preserved at: $WORKSPACE"
    fi
    log INFO "Log file: $LOG_FILE"
    exit $exit_code
}

trap cleanup EXIT

# Setup
mkdir -p "$LOG_DIR"

echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}" | tee -a "$LOG_FILE"
echo -e "${BLUE}Critic Extension Test${NC}" | tee -a "$LOG_FILE"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}" | tee -a "$LOG_FILE"
log INFO "Test: $TEST_NAME"
log INFO "Main model: $MAIN_MODEL"
log INFO "Critic model: $CRITIC_MODEL"
log INFO "Timeout: ${TEST_TIMEOUT}s"
log INFO "Extension: $EXTENSION_DIR/index.ts"
echo "" | tee -a "$LOG_FILE"

if [ ! -d "$TEST_DIR" ]; then
    log ERROR "Test '$TEST_NAME' not found at $TEST_DIR"
    echo ""
    echo "Available tests:"
    ls -1 "$TESTS_DIR" | grep -v "\.sh$" | grep -v "README" | grep -v "logs"
    exit 1
fi

# Check for task.md
TASK_FILE="$TEST_DIR/task.md"
if [ ! -f "$TASK_FILE" ]; then
    log ERROR "task.md not found in $TEST_DIR"
    exit 1
fi

# Setup workspace
if [ -d "$TEST_DIR/setup" ]; then
    log INFO "Setting up workspace..."
    rm -rf "$WORKSPACE"
    cp -r "$TEST_DIR/setup" "$WORKSPACE"
    log OK "Workspace created at $WORKSPACE"
    echo "" | tee -a "$LOG_FILE"
    log INFO "Workspace contents:"
    ls -la "$WORKSPACE" | tee -a "$LOG_FILE"
    echo "" | tee -a "$LOG_FILE"
fi

# Read task
TASK=$(cat "$TASK_FILE")

log INFO "Task:"
echo -e "${DIM}$TASK${NC}" | tee -a "$LOG_FILE"
echo "" | tee -a "$LOG_FILE"

# Build the full prompt with critic model instruction
FULL_PROMPT="$TASK

IMPORTANT: First run /critic-model $CRITIC_MODEL to set the critic model."

log INFO "Starting pi with critic extension..."
log INFO "Command: pi --model $MAIN_MODEL --critic --critic-debug --no-session -e $EXTENSION_DIR/index.ts"
echo "" | tee -a "$LOG_FILE"

cd "${WORKSPACE:-$TEST_DIR}"

# Run with timeout
if command -v timeout &> /dev/null; then
    TIMEOUT_CMD="timeout --signal=SIGTERM ${TEST_TIMEOUT}s"
elif command -v gtimeout &> /dev/null; then
    TIMEOUT_CMD="gtimeout --signal=SIGTERM ${TEST_TIMEOUT}s"
else
    TIMEOUT_CMD=""
    log WARN "No timeout command found, running without timeout"
fi

# Interactive mode for observation
$TIMEOUT_CMD pi \
    --model "$MAIN_MODEL" \
    --critic \
    --critic-debug \
    --no-session \
    -e "$EXTENSION_DIR/index.ts" \
    "$FULL_PROMPT" 2>&1 | tee -a "$LOG_FILE"

TEST_EXIT_CODE=${PIPESTATUS[0]}

echo "" | tee -a "$LOG_FILE"
if [ $TEST_EXIT_CODE -eq 124 ]; then
    log ERROR "Test timed out after ${TEST_TIMEOUT}s"
elif [ $TEST_EXIT_CODE -ne 0 ]; then
    log WARN "Test exited with code $TEST_EXIT_CODE"
else
    log OK "Test completed successfully"
fi

# Show workspace diff if applicable
if [ -d "$WORKSPACE" ] && [ -d "$TEST_DIR/setup" ]; then
    echo "" | tee -a "$LOG_FILE"
    log INFO "Changes made:"
    diff -r "$TEST_DIR/setup" "$WORKSPACE" 2>/dev/null | head -50 | tee -a "$LOG_FILE" || true
fi
