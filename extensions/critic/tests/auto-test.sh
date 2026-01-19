#!/bin/bash
# Automated test for critic extension
# Runs scenarios and validates behavior

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TEST_DIR="/tmp/critic-auto-test-$$"
LOGFILE=$(node -e "console.log(require('os').tmpdir() + '/pi-critic.log')")
RESULTS_FILE="$TEST_DIR/results.md"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

cleanup() {
    rm -rf "$TEST_DIR"
}
trap cleanup EXIT

mkdir -p "$TEST_DIR"

echo "# Critic Extension Test Results" > "$RESULTS_FILE"
echo "" >> "$RESULTS_FILE"
echo "Test run: $(date)" >> "$RESULTS_FILE"
echo "" >> "$RESULTS_FILE"

pass_count=0
fail_count=0

log_test() {
    local name="$1"
    local status="$2"
    local details="$3"
    
    if [ "$status" = "PASS" ]; then
        echo -e "${GREEN}✓${NC} $name"
        echo "- [x] **$name** - PASS" >> "$RESULTS_FILE"
        ((pass_count++))
    else
        echo -e "${RED}✗${NC} $name"
        echo "- [ ] **$name** - FAIL" >> "$RESULTS_FILE"
        ((fail_count++))
    fi
    
    if [ -n "$details" ]; then
        echo "  $details"
        echo "  - $details" >> "$RESULTS_FILE"
    fi
}

clear_log() {
    rm -f "$LOGFILE"
}

echo -e "${YELLOW}=== Critic Extension Automated Tests ===${NC}"
echo ""

# ============================================================
# Test: Full workflow - edit file and verify critic reviews
# ============================================================
echo -e "${YELLOW}Running full workflow test...${NC}"
echo -e "${CYAN}(This may take 30-60 seconds)${NC}"
echo ""

clear_log
cd "$TEST_DIR"

# Create test file
cat > "$TEST_DIR/simple.ts" << 'EOF'
export function add(a: number, b: number) {
  return a + b;
}
EOF

# Run the full workflow
timeout 90 pi --critic --mode json -p "Add return type annotation to add function in simple.ts" > "$TEST_DIR/output.json" 2>&1 || true

# Give a moment for log to be written
sleep 1

echo -e "${YELLOW}Checking test results...${NC}"
echo ""

# ============================================================
# Test 1: Extension loads
# ============================================================
if grep -q "Critic extension loaded" "$LOGFILE" 2>/dev/null; then
    log_test "Extension loads" "PASS"
else
    log_test "Extension loads" "FAIL" "No init message in log"
fi

# ============================================================
# Test 2: Flag --critic enables critic
# ============================================================
if grep -q '"critic": true' "$LOGFILE" 2>/dev/null; then
    log_test "Flag --critic enables critic" "PASS"
else
    log_test "Flag --critic enables critic" "FAIL" "critic flag not true"
fi

# ============================================================
# Test 3: Critic triggers on turn_end
# ============================================================
if grep -q "Triggering critic" "$LOGFILE" 2>/dev/null; then
    log_test "Critic triggers on turn_end" "PASS"
else
    log_test "Critic triggers on turn_end" "FAIL" "No trigger in log"
fi

# ============================================================
# Test 4: Critic subprocess spawns
# ============================================================
if grep -q "Spawning" "$LOGFILE" 2>/dev/null; then
    log_test "Critic subprocess spawns" "PASS"
else
    log_test "Critic subprocess spawns" "FAIL" "No spawn in log"
fi

# ============================================================
# Test 5: Subprocess receives and processes messages
# ============================================================
if grep -q "Received.*assistant" "$LOGFILE" 2>/dev/null; then
    log_test "Subprocess communication" "PASS"
else
    log_test "Subprocess communication" "FAIL" "No assistant message received"
fi

# ============================================================
# Test 6: Verdict parsing (structured block)
# ============================================================
if grep -q "\[verdict\]" "$LOGFILE" 2>/dev/null; then
    if grep -A5 "\[verdict\]" "$LOGFILE" | grep -q '"hasVerdictBlock": true' 2>/dev/null; then
        log_test "Verdict parsing" "PASS" "Structured verdict block parsed"
    else
        log_test "Verdict parsing" "PASS" "Verdict logged (fallback mode)"
    fi
else
    log_test "Verdict parsing" "FAIL" "No verdict in log"
fi

# ============================================================
# Test 7: Decision made
# ============================================================
if grep -q "\[decision\]" "$LOGFILE" 2>/dev/null; then
    log_test "Decision made" "PASS"
else
    log_test "Decision made" "FAIL" "No decision in log"
fi

# ============================================================
# Test 8: Review displayed in output (custom message)
# ============================================================
if grep -q '"customType":"critic-review"' "$TEST_DIR/output.json" 2>/dev/null; then
    log_test "Review displayed in output" "PASS"
else
    log_test "Review displayed in output" "FAIL" "No critic-review in JSON"
fi

# ============================================================
# Test 9: Loop prevention (max reviews enforced)
# ============================================================
review_count=$(grep -c "Triggering critic" "$LOGFILE" 2>/dev/null || echo "0")
if [ "$review_count" -le 3 ]; then
    log_test "Loop prevention" "PASS" "Reviews: $review_count (max 3)"
else
    log_test "Loop prevention" "FAIL" "Too many reviews: $review_count"
fi

# ============================================================
# Test 10: Context includes DIFF for edit operations
# ============================================================
if grep -q "DIFF" "$LOGFILE" 2>/dev/null; then
    log_test "Context includes diff" "PASS"
else
    log_test "Context includes diff" "FAIL" "No DIFF in context"
fi

# ============================================================
# Test 11: Approval flow works (APPROVED status found)
# ============================================================
if grep -q '"status": "APPROVED"' "$LOGFILE" 2>/dev/null || grep -q '"approved": true' "$LOGFILE" 2>/dev/null; then
    log_test "Approval flow" "PASS" "Work was approved"
else
    log_test "Approval flow" "FAIL" "No approval in log"
fi

# ============================================================
# Summary
# ============================================================
echo ""
echo -e "${YELLOW}=== Summary ===${NC}"
echo ""

total=$((pass_count + fail_count))
echo -e "Passed: ${GREEN}$pass_count${NC}/$total"
echo -e "Failed: ${RED}$fail_count${NC}/$total"

echo "" >> "$RESULTS_FILE"
echo "## Summary" >> "$RESULTS_FILE"
echo "- Passed: $pass_count/$total" >> "$RESULTS_FILE"
echo "- Failed: $fail_count/$total" >> "$RESULTS_FILE"

# Show key log excerpts
echo ""
echo -e "${CYAN}=== Key Log Excerpts ===${NC}"
echo ""
echo "Verdicts:"
grep "\[verdict\]" "$LOGFILE" 2>/dev/null | head -3 || echo "(none)"
echo ""
echo "Decisions:"
grep "\[decision\]" "$LOGFILE" 2>/dev/null | head -3 || echo "(none)"

echo ""
echo "Full log: $LOGFILE"
echo "Full output: $TEST_DIR/output.json"

if [ $fail_count -gt 0 ]; then
    exit 1
fi
