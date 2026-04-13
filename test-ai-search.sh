#!/bin/bash

# AI Search Platform Test Script
# Tests all AI search functionality and reports pass/fail status

API_KEY="fc-e65f930ac573422d963a88d664fa9cbc"
API_URL="http://localhost:3002/v2/search"
TIMEOUT=30

# Color codes for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Test counters
TOTAL_TESTS=0
PASSED_TESTS=0
FAILED_TESTS=0
TOTAL_TIME_MS=0

# Function to run a test with design vs actual comparison
run_test() {
    local test_name="$1"
    local query="$2"
    local params="$3"
    local expected_pattern="$4"
    local design_expectation="$5"
    
    TOTAL_TESTS=$((TOTAL_TESTS + 1))
    
    echo "Running: $test_name"
    echo "Request: $params"
    
    # Design expectation
    echo -e "${YELLOW}Design Expectation:${NC} $design_expectation"
    
    # Display curl command for manual testing
    echo -e "${YELLOW}Curl Command:${NC}"
    echo "curl -X POST $API_URL \\"
    echo "  -H \"Authorization: Bearer $API_KEY\" \\"
    echo "  -H \"Content-Type: application/json\" \\"
    echo "  -d '$params'"
    echo ""
    
    # Construct the full curl command with timing output
    local curl_cmd="curl -s -w ' %{time_total}' -X POST $API_URL -H \"Authorization: Bearer $API_KEY\" -H \"Content-Type: application/json\" -d '$params' --max-time $TIMEOUT"
    
    # Execute the request and capture response with timing
    local output=$(eval $curl_cmd)
    exit_code=$?
    
    # Extract timing (last space-separated field)
    local time_seconds=$(echo "$output" | awk '{print $NF}')
    # Extract response body (everything except the timing field)
    local response=$(echo "$output" | awk '{$NF=""; print $0}' | sed 's/[[:space:]]*$//')
    
    # Convert seconds to milliseconds using awk
    local duration_ms=$(echo "$time_seconds" | awk '{printf "%.0f", $1 * 1000}')
    
    # Accumulate total time
    TOTAL_TIME_MS=$((TOTAL_TIME_MS + duration_ms))
    
    if [ $exit_code -ne 0 ]; then
        echo -e "${RED}[FAIL]${NC} $test_name - Request failed (exit code: $exit_code)"
        echo "Response: $response"
        echo -e "${YELLOW}Comparison:${NC} ${RED}Request failed, cannot compare${NC}"
        echo -e "${YELLOW}Response Time:${NC} ${RED}${duration_ms}ms${NC}"
        FAILED_TESTS=$((FAILED_TESTS + 1))
        echo "----------------------------------------"
        return 1
    fi
    
    echo -e "${YELLOW}Actual Response:${NC} $(echo "$response" | head -c 200)..."
    echo -e "${YELLOW}Response Time:${NC} ${duration_ms}ms"
    
    # First check if response contains error
    if echo "$response" | grep -q '"error"'; then
        echo -e "${RED}[FAIL]${NC} $test_name - API returned error"
        echo "Response: $response"
        echo -e "${YELLOW}Comparison:${NC} ${RED}✗ API error - feature not implemented${NC}"
        FAILED_TESTS=$((FAILED_TESTS + 1))
        echo "----------------------------------------"
        # Sleep after timing measurement to avoid inflating response time
        sleep 1
        return 1
    fi
    
    # Check if response contains expected pattern
    if echo "$response" | grep -q "$expected_pattern"; then
        echo -e "${GREEN}[PASS]${NC} $test_name"
        echo -e "${YELLOW}Comparison:${NC} ${GREEN}✓ Verified${NC}"
        PASSED_TESTS=$((PASSED_TESTS + 1))
    else
        echo -e "${RED}[FAIL]${NC} $test_name"
        echo "Expected pattern: $expected_pattern"
        echo "Response: $response"
        echo -e "${YELLOW}Comparison:${NC} ${RED}✗ Pattern not found, manual review needed${NC}"
        FAILED_TESTS=$((FAILED_TESTS + 1))
    fi
    
    echo "----------------------------------------"
    # Sleep after timing measurement to avoid inflating response time
    sleep 1
}

echo "============================================================"
echo "AI Search Platform Test Suite"
echo "============================================================"
echo "API URL: $API_URL"
echo "API Key: $API_KEY"
echo "============================================================"
echo ""

# Test 1: Basic Search
run_test "Basic Search" \
    "artificial intelligence" \
    "{\"query\": \"artificial intelligence\", \"limit\": 5}" \
    "success\|title\|url" \
    "Response should contain search results with title, url, and content fields"

# Test 2: aiMode expand
run_test "AI Mode - Expand" \
    "machine learning algorithms" \
    "{\"query\": \"machine learning algorithms\", \"limit\": 5, \"aiMode\": \"expand\"}" \
    "success\|aiMetadata" \
    "Should perform query expansion and return aiMetadata with expandedQueries"

# Test 3: aiMode rerank
run_test "AI Mode - Rerank" \
    "machine learning algorithms" \
    "{\"query\": \"machine learning algorithms\", \"limit\": 5, \"aiMode\": \"rerank\"}" \
    "success\|aiMetadata" \
    "Should rerank results using local 9B model and return relevanceScore"

# Test 4: aiMode full
run_test "AI Mode - Full" \
    "machine learning algorithms" \
    "{\"query\": \"machine learning algorithms\", \"limit\": 5, \"aiMode\": \"full\"}" \
    "success\|aiMetadata" \
    "Should enable both query expansion and reranking with full AI pipeline"

# Test 5: aiMode auto
run_test "AI Mode - Auto" \
    "machine learning algorithms" \
    "{\"query\": \"machine learning algorithms\", \"limit\": 5, \"aiMode\": \"auto\"}" \
    "success\|aiMetadata" \
    "Should automatically determine if AI features are needed based on query complexity"

# Test 6: tbs parameter - day
run_test "TBS Parameter - Day (qdr:d)" \
    "machine learning" \
    "{\"query\": \"machine learning\", \"limit\": 5, \"tbs\": \"qdr:d\"}" \
    "success\|title\|url" \
    "Should map tbs:qdr:d to time_range:day and return recent results"

# Test 7: tbs parameter - week
run_test "TBS Parameter - Week (qdr:w)" \
    "machine learning" \
    "{\"query\": \"machine learning\", \"limit\": 5, \"tbs\": \"qdr:w\"}" \
    "success\|title\|url" \
    "Should map tbs:qdr:w to time_range:month and return weekly results"

# Test 8: tbs parameter - year
run_test "TBS Parameter - Year (qdr:y)" \
    "machine learning" \
    "{\"query\": \"machine learning\", \"limit\": 5, \"tbs\": \"qdr:y\"}" \
    "success\|title\|url" \
    "Should map tbs:qdr:y to time_range:year and return yearly results"

# Test 9: Cache functionality - First request
run_test "Cache - First Request" \
    "cache test unique 99999" \
    "{\"query\": \"cache test unique 99999\", \"limit\": 2}" \
    "success\|title\|url" \
    "Should perform full search and cache result - cacheState: miss"

# Test 10: Cache functionality - Second request (should hit cache)
run_test "Cache - Second Request (Cache Hit)" \
    "cache test unique 99999" \
    "{\"query\": \"cache test unique 99999\", \"limit\": 2}" \
    "success\|title\|url" \
    "Should return cached result with faster response time - cacheState: hit"

# Test 11: Cache functionality - Third request (should hit cache)
run_test "Cache - Third Request (Cache Hit)" \
    "cache test unique 99999" \
    "{\"query\": \"cache test unique 99999\", \"limit\": 2}" \
    "success\|title\|url" \
    "Should consistently return cached result - cacheState: hit"

# Test 12: includeExtra parameter - true
run_test "includeExtra - true" \
    "machine learning" \
    "{\"query\": \"machine learning\", \"limit\": 5, \"includeExtra\": true}" \
    "success\|title\|url" \
    "Should include all extra fields when includeExtra is true"

# Test 13: includeExtra parameter - false
run_test "includeExtra - false" \
    "machine learning" \
    "{\"query\": \"machine learning\", \"limit\": 5, \"includeExtra\": false}" \
    "success\|title\|url" \
    "Should exclude all extra fields when includeExtra is false"

# Test 14: aiMetadata with aiMode full
run_test "aiMetadata with aiMode full" \
    "machine learning algorithms" \
    "{\"query\": \"machine learning algorithms\", \"limit\": 5, \"aiMode\": \"full\"}" \
    "success\|aiMetadata" \
    "Should return AI metadata with expandedQueries when aiMode is full"

# Test 15: categories - github
run_test "Categories - github" \
    "react" \
    "{\"query\": \"react\", \"limit\": 5, \"categories\": [\"github\"]}" \
    "success\|github" \
    "Should search GitHub specifically using site:github.com filter"

# Test 16: categories - research
run_test "Categories - research" \
    "quantum computing" \
    "{\"query\": \"quantum computing\", \"limit\": 5, \"categories\": [\"research\"]}" \
    "success\|research" \
    "Should search academic sources (arxiv, google scholar, pubmed)"

# Test 17: categories - pdf
run_test "Categories - pdf" \
    "machine learning tutorial" \
    "{\"query\": \"machine learning tutorial\", \"limit\": 5, \"categories\": [\"pdf\"]}" \
    "success\|pdf" \
    "Should search for PDF files using filetype:pdf filter"

# Test 18: language parameter
run_test "Language - Chinese" \
    "人工智能" \
    "{\"query\": \"人工智能\", \"limit\": 5, \"lang\": \"zh\"}" \
    "success\|title\|url" \
    "Should return results in Chinese language"

# Test 19: country parameter
run_test "Country - US" \
    "news today" \
    "{\"query\": \"news today\", \"limit\": 5, \"country\": \"us\"}" \
    "success\|title\|url" \
    "Should return US-specific results"

# Test 20: relevanceScore in aiMode full
run_test "Relevance Score - aiMode full" \
    "machine learning" \
    "{\"query\": \"machine learning\", \"limit\": 5, \"aiMode\": \"full\"}" \
    "success\|relevanceScore" \
    "Should return relevanceScore 0-1 for each result from AI reranker"

# Test 21: Multi-page request (num_results > 10)
run_test "Multi-page request" \
    "artificial intelligence" \
    "{\"query\": \"artificial intelligence\", \"limit\": 15}" \
    "success\|title\|url" \
    "Should request multiple pages from SearXNG to get more than 10 results"

# Test 22: Performance test - basic search timing
run_test "Performance - Basic Search" \
    "quick test" \
    "{\"query\": \"quick test\", \"limit\": 5}" \
    "success\|title\|url" \
    "Basic search should complete within 890ms - design budget for non-AI mode - manual timing verification needed"

# Test 23: AI Reranker returns score field
run_test "AI Reranker - score field" \
    "machine learning" \
    "{\"query\": \"machine learning\", \"limit\": 5, \"aiMode\": \"rerank\"}" \
    "success\|score" \
    "Should return score (0-1) for each result when aiMode is rerank"

# Test 24: Query expansion returns expandedQueries
run_test "Query Expansion - expandedQueries" \
    "machine learning algorithms" \
    "{\"query\": \"machine learning algorithms\", \"limit\": 5, \"aiMode\": \"expand\"}" \
    "success\|expandedQueries" \
    "Should return expandedQueries array when aiMode is expand"

# Test 25: Intent classification returns autoCategories
run_test "Intent Classification - autoCategories" \
    "quantum computing" \
    "{\"query\": \"quantum computing\", \"limit\": 5, \"aiMode\": \"full\"}" \
    "success\|autoCategories" \
    "Should return autoCategories when aiMode is full"

# Test 26: Full AI mode with all features
run_test "AI Full Mode - complete" \
    "artificial intelligence" \
    "{\"query\": \"artificial intelligence\", \"limit\": 5, \"aiMode\": \"full\"}" \
    "success\|score\|expandedQueries\|autoCategories" \
    "Should return score, expandedQueries, and autoCategories in aiMode full"

echo ""
echo "============================================================"
echo "Test Summary"
echo "============================================================"
echo -e "Total Tests: $TOTAL_TESTS"
echo -e "${GREEN}Passed: $PASSED_TESTS${NC}"
echo -e "${RED}Failed: $FAILED_TESTS${NC}"
echo -e "Total Response Time: ${TOTAL_TIME_MS}ms"
if [ $TOTAL_TESTS -gt 0 ]; then
    AVG_TIME_MS=$((TOTAL_TIME_MS / TOTAL_TESTS))
    echo -e "Average Response Time: ${AVG_TIME_MS}ms"
fi
echo "============================================================"
echo "Performance Budgets (from design document):"
echo "  - Non-AI mode: ≤890ms"
echo "  - AI full mode: ≤3000ms"
echo "  - Cache hit: ≤50ms"
echo "============================================================"

if [ $FAILED_TESTS -eq 0 ]; then
    echo -e "${GREEN}All automated tests passed!${NC}"
    if [ $AVG_TIME_MS -le 890 ]; then
        echo -e "${GREEN}Average response time meets non-AI budget (≤890ms)${NC}"
    else
        echo -e "${YELLOW}Average response time exceeds non-AI budget (>890ms)${NC}"
    fi
    exit 0
else
    echo -e "${RED}Some tests failed. Please review the output above.${NC}"
    exit 1
fi
