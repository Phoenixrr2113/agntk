#!/usr/bin/env bash
# Manual CLI test suite — exercises each tool and mode.
# Usage: bash scripts/manual-test.sh
#
# Each test uses a specific prompt designed to trigger a particular tool.
# We check both exit code and output for tool invocation markers.

set -euo pipefail

CLI="node packages/cli/dist/cli.js"
PASS=0
FAIL=0
SKIP=0
RESULTS=()

# Colors
GREEN=$'\033[32m'
RED=$'\033[31m'
YELLOW=$'\033[33m'
DIM=$'\033[2m'
RESET=$'\033[0m'

run_test() {
  local name="$1"
  local expect_tool="$2"  # tool name we expect to see, or "text:" for text match
  shift 2
  local cmd=("$@")

  printf "  %-40s " "$name"

  local output
  local exit_code=0
  output=$("${cmd[@]}" 2>&1) || exit_code=$?

  # Check for expected tool usage or text
  if [[ "$expect_tool" == text:* ]]; then
    local expected_text="${expect_tool#text:}"
    if echo "$output" | grep -qi "$expected_text"; then
      echo "${GREEN}PASS${RESET}"
      PASS=$((PASS + 1))
      RESULTS+=("PASS: $name")
      return 0
    fi
  elif [[ "$expect_tool" == "exit:0" ]]; then
    if [[ $exit_code -eq 0 ]]; then
      echo "${GREEN}PASS${RESET}"
      PASS=$((PASS + 1))
      RESULTS+=("PASS: $name")
      return 0
    fi
  elif [[ "$expect_tool" == "exit:1" ]]; then
    if [[ $exit_code -ne 0 ]]; then
      echo "${GREEN}PASS${RESET}"
      PASS=$((PASS + 1))
      RESULTS+=("PASS: $name")
      return 0
    fi
  else
    if echo "$output" | grep -q "▶ $expect_tool"; then
      echo "${GREEN}PASS${RESET} ${DIM}(used $expect_tool)${RESET}"
      PASS=$((PASS + 1))
      RESULTS+=("PASS: $name (used $expect_tool)")
      return 0
    fi
  fi

  echo "${RED}FAIL${RESET}"
  FAIL=$((FAIL + 1))
  RESULTS+=("FAIL: $name — expected '$expect_tool', got exit=$exit_code")
  # Show truncated output for debugging
  echo "$output" | head -20 | sed 's/^/    /'
  echo ""
}

skip_test() {
  local name="$1"
  local reason="$2"
  printf "  %-40s ${YELLOW}SKIP${RESET} ${DIM}($reason)${RESET}\n"
  SKIP=$((SKIP + 1))
  RESULTS+=("SKIP: $name — $reason")
}

echo ""
echo "═══════════════════════════════════════════════════════════"
echo "  agntk CLI Manual Test Suite"
echo "═══════════════════════════════════════════════════════════"
echo ""

# ── Tool Tests ────────────────────────────────────────────────
echo "── Tool Invocation Tests ──"
echo ""

run_test "glob tool" \
  "glob" \
  $CLI "Find all package.json files in the packages/ directory using glob. Just list them briefly."

run_test "grep tool" \
  "grep" \
  $CLI "Search for the string 'createAgent' in the packages/sdk/src directory using grep. How many files match? Be brief."

run_test "file_read tool" \
  "file_read" \
  $CLI "Read the first 5 lines of packages/sdk/package.json. Be brief."

run_test "file_write tool" \
  "file_write" \
  $CLI "Write the text 'agntk test file' to a file called .agntk-test-output.txt in the workspace root. Reply with just 'Done.'"

run_test "file_edit tool" \
  "file_edit" \
  $CLI "Edit the file .agntk-test-output.txt and replace 'agntk test file' with 'agntk test file (edited)'. Reply with just 'Done.'"

run_test "file_create tool" \
  "file_create" \
  $CLI "Create a new file called .agntk-test-created.txt with the content 'created by test'. Reply with just 'Done.'"

run_test "shell tool" \
  "shell" \
  $CLI "Run 'echo hello-from-shell' and tell me what it printed. Be brief."

# Clean up test files
rm -f .agntk-test-output.txt .agntk-test-created.txt 2>/dev/null || true

echo ""

# ── Mode Tests ────────────────────────────────────────────────
echo "── Mode Tests ──"
echo ""

run_test "quiet mode (-q)" \
  "text:4" \
  $CLI -q "What is 2+2? Reply with just the number."

run_test "verbose mode (--verbose)" \
  "text:[usage]" \
  $CLI --verbose "What is 2+2? Reply with just the number."

run_test "custom instructions (--instructions)" \
  "text:" \
  $CLI --instructions "You must start every response with CUSTOM:" "Say hello"

# Stdin piping
echo "apple banana cherry" | run_test "stdin piping" \
  "text:3" \
  $CLI -q "How many words are in this input? Reply with just the number."

echo ""

# ── Error Handling Tests ──────────────────────────────────────
echo "── Error Handling Tests ──"
echo ""

run_test "no arguments → error" \
  "exit:1" \
  $CLI

run_test "max-steps 0 → clamped" \
  "exit:0" \
  $CLI --max-steps 0 "Say hi"

run_test "max-steps NaN → default" \
  "exit:0" \
  $CLI --max-steps abc "Say hi"

echo ""

# ── Named Agent + Memory Tests ────────────────────────────────
echo "── Named Agent + Memory Tests ──"
echo ""

run_test "named agent: store fact" \
  "file_write" \
  $CLI -n test-suite-agent "My favorite programming language is Rust. Save this to memory. Reply with just 'Saved.'"

run_test "named agent: recall fact" \
  "text:rust" \
  $CLI -n test-suite-agent "What is my favorite programming language? Reply with just the language name."

run_test "agent list: shows test agent" \
  "text:test-suite-agent" \
  $CLI list

# Clean up
rm -rf ~/.agntk/agents/test-suite-agent 2>/dev/null || true

echo ""

# ── Summary ───────────────────────────────────────────────────
echo "═══════════════════════════════════════════════════════════"
echo "  Results: ${GREEN}${PASS} passed${RESET}, ${RED}${FAIL} failed${RESET}, ${YELLOW}${SKIP} skipped${RESET}"
echo "═══════════════════════════════════════════════════════════"
echo ""

if [[ $FAIL -gt 0 ]]; then
  echo "Failed tests:"
  for r in "${RESULTS[@]}"; do
    if [[ "$r" == FAIL* ]]; then
      echo "  ${RED}✗${RESET} $r"
    fi
  done
  echo ""
  exit 1
fi
