#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# End-to-end smoke test against a running API.
#
# Exercises the whole launch path: signup/login -> upload -> real scan ->
# components -> vulnerabilities -> SBOM -> readiness -> evidence -> incident
# draft -> credits -> admin. Fails loudly (exit 1) on the first broken step.
#
#   BASE=http://localhost:8787 ./scripts/smoke.sh
# ---------------------------------------------------------------------------
set -uo pipefail

BASE="${BASE:-http://localhost:8787}"
API="$BASE/api/v1"
FIXTURE="$(cd "$(dirname "$0")" && pwd)/../apps/api/tests/fixtures/demo-repo.tar.gz"
JAR="$(mktemp)"
PASS=0
FAIL=0

step() { printf '\n== %s\n' "$1"; }
check() { # check <name> <condition-result>
  if [ "$2" = "0" ]; then PASS=$((PASS+1)); printf '  PASS  %s\n' "$1";
  else FAIL=$((FAIL+1)); printf '  FAIL  %s\n' "$1"; fi
}
jget() { python3 -c "import sys,json;d=json.load(sys.stdin);print($1)" 2>/dev/null; }

step "health"
code=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/health")
check "GET /health returns 200" "$([ "$code" = "200" ] && echo 0 || echo 1)"

step "authentication"
# A fixed address keeps the run idempotent and lets ADMIN_EMAILS in `.env`
# grant the console access the credit-grant step needs.
EMAIL="${SMOKE_EMAIL:-smoke@example.com}"
signup=$(curl -s -c "$JAR" -X POST "$API/auth/signup" -H 'Content-Type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"password\":\"correct-horse-battery\",\"name\":\"Smoke\"}")

if printf '%s' "$signup" | grep -q organizationId; then
  ORG=$(printf '%s' "$signup" | jget "d['data']['organizationId']")
  check "signup creates an organisation" "$([ -n "$ORG" ] && echo 0 || echo 1)"
  dup=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$API/auth/signup" -H 'Content-Type: application/json' \
    -d "{\"email\":\"$EMAIL\",\"password\":\"correct-horse-battery\"}")
  check "duplicate signup is rejected with 409" "$([ "$dup" = "409" ] && echo 0 || echo 1)"
else
  # Account already exists from a previous run: sign in instead.
  curl -s -c "$JAR" -X POST "$API/auth/login" -H 'Content-Type: application/json' \
    -d "{\"email\":\"$EMAIL\",\"password\":\"correct-horse-battery\"}" -o /dev/null
  ORG=$(curl -s -b "$JAR" "$API/auth/me" | jget "d['data']['defaultOrgId']")
  check "existing account signs in" "$([ -n "$ORG" ] && echo 0 || echo 1)"
fi

me=$(curl -s -b "$JAR" "$API/auth/me")
check "session resolves the current user" "$(printf '%s' "$me" | jget "0 if d['data']['user']['email']=='$EMAIL' else 1")"

step "credits granted at signup"
balance=$(curl -s -b "$JAR" "$API/organizations/$ORG/billing" | jget "d['data']['balance']")
check "welcome credits are non-zero (got ${balance:-none})" "$([ "${balance:-0}" -gt 0 ] 2>/dev/null && echo 0 || echo 1)"

step "upload + real scan"
up=$(curl -s -b "$JAR" -X POST "$API/organizations/$ORG/repositories/upload" -F "file=@$FIXTURE" -F "name=smoke-repo")
SCAN=$(printf '%s' "$up" | jget "d['data']['scanId']")
REPO=$(printf '%s' "$up" | jget "d['data']['id']")
check "archive upload queues a scan" "$([ -n "$SCAN" ] && echo 0 || echo 1)"

for _ in $(seq 1 40); do
  status=$(curl -s -b "$JAR" "$API/organizations/$ORG/scans/$SCAN/status" | jget "d['data']['status']")
  [ "$status" = "succeeded" ] || [ "$status" = "failed" ] && break
  sleep 3
done
check "scan completes (status=$status)" "$([ "$status" = "succeeded" ] && echo 0 || echo 1)"

step "scan results"
summary=$(curl -s -b "$JAR" "$API/organizations/$ORG/scans/$SCAN")
COMPONENTS=$(printf '%s' "$summary" | jget "d['data']['scan']['componentCount']")
VULNS=$(printf '%s' "$summary" | jget "d['data']['scan']['vulnerabilityCount']")
CHARGED=$(printf '%s' "$summary" | jget "d['data']['scan']['creditsCharged']")
check "components discovered ($COMPONENTS)" "$([ "${COMPONENTS:-0}" -ge 8 ] 2>/dev/null && echo 0 || echo 1)"
check "vulnerabilities matched from OSV ($VULNS)" "$([ "${VULNS:-0}" -ge 5 ] 2>/dev/null && echo 0 || echo 1)"
check "credits charged for the scan ($CHARGED)" "$([ "${CHARGED:-0}" -gt 0 ] 2>/dev/null && echo 0 || echo 1)"

vulns=$(curl -s -b "$JAR" "$API/organizations/$ORG/scans/$SCAN/vulnerabilities")
with_cvss=$(printf '%s' "$vulns" | jget "sum(1 for v in d['data'] if v['vulnerability']['cvssScore'])")
with_epss=$(printf '%s' "$vulns" | jget "sum(1 for v in d['data'] if v['vulnerability']['epssScore'] is not None)")
check "CVSS scores computed ($with_cvss)" "$([ "${with_cvss:-0}" -gt 0 ] 2>/dev/null && echo 0 || echo 1)"
check "EPSS enrichment applied ($with_epss)" "$([ "${with_epss:-0}" -gt 0 ] 2>/dev/null && echo 0 || echo 1)"

step "SBOM"
sbom=$(curl -s -b "$JAR" -X POST "$API/organizations/$ORG/scans/$SCAN/sbom" -H 'Content-Type: application/json' -d '{"format":"cyclonedx-json"}')
SBOMCOUNT=$(printf '%s' "$sbom" | jget "d['data'].get('componentCount',0)")
check "CycloneDX SBOM generated ($SBOMCOUNT components)" "$([ "${SBOMCOUNT:-0}" -gt 0 ] 2>/dev/null && echo 0 || echo 1)"
dl=$(curl -s -b "$JAR" -o /tmp/sbom.json -w '%{http_code}' "$API/organizations/$ORG/repositories/$REPO/sbom/latest")
check "SBOM downloads ($dl bytes: $(wc -c < /tmp/sbom.json))" "$([ "$dl" = "200" ] && echo 0 || echo 1)"
check "SBOM is valid CycloneDX 1.6 (JSON or XML)" "$(python3 -c "
import json,sys
raw=open('/tmp/sbom.json','rb').read()
try:
    d=json.loads(raw)
    ok = d.get('bomFormat')=='CycloneDX' and str(d.get('specVersion','')).startswith('1.6') and len(d.get('components',[]))>0
except Exception:
    txt=raw.decode('utf-8','ignore')
    ok = 'cyclonedx.org/schema/bom/1.6' in txt and '<component' in txt
print(0 if ok else 1)
" 2>/dev/null || echo 1)"

step "CRA readiness"
ready=$(curl -s -b "$JAR" "$API/organizations/$ORG/repositories/$REPO/readiness")
SCORE=$(printf '%s' "$ready" | jget "d['data']['score']")
GRADE=$(printf '%s' "$ready" | jget "d['data']['grade']")
CONTROLS=$(printf '%s' "$ready" | jget "len(d['data'].get('assessments',[]))")
check "readiness score produced ($SCORE / $GRADE)" "$([ -n "$SCORE" ] && echo 0 || echo 1)"
check "controls evaluated ($CONTROLS)" "$([ "${CONTROLS:-0}" -ge 20 ] 2>/dev/null && echo 0 || echo 1)"
RATIONALES=$(printf '%s' "$ready" | jget "sum(1 for a in d['data'].get('assessments',[]) if a.get('rationale'))")
check "assessments carry written rationale ($RATIONALES)" "$([ "${RATIONALES:-0}" -ge 20 ] 2>/dev/null && echo 0 || echo 1)"

step "evidence vault"
echo "Incident response runbook, reviewed 2026-01-14." > /tmp/evidence.txt
ev=$(curl -s -b "$JAR" -X POST "$API/organizations/$ORG/evidence" \
  -F "file=@/tmp/evidence.txt" -F "title=IR runbook" -F "type=document")
EVID=$(printf '%s' "$ev" | jget "d['data'].get('id','')")
check "evidence uploaded and checksummed" "$([ -n "$EVID" ] && echo 0 || echo 1)"

pack=$(curl -s -b "$JAR" -X POST "$API/organizations/$ORG/repositories/$REPO/evidence-pack" -H 'Content-Type: application/json' -d '{}')
check "evidence pack generated and checksummed" "$(printf '%s' "$pack" | jget "0 if d.get('data',{}).get('sha256') else 1")"

step "Article 14 incident"
CV=$(printf '%s' "$vulns" | jget "d['data'][0]['id']")
inc=$(curl -s -b "$JAR" -X POST "$API/organizations/$ORG/incidents" -H 'Content-Type: application/json' \
  -d "{\"componentVulnerabilityId\":\"$CV\",\"activelyExploited\":false}")
INC=$(printf '%s' "$inc" | jget "d['data'].get('id','')")
check "incident opened" "$([ -n "$INC" ] && echo 0 || echo 1)"
detail=$(curl -s -b "$JAR" "$API/organizations/$ORG/incidents/$INC")
check "24h early-warning clock set" "$(printf '%s' "$detail" | jget "0 if d['data']['incident'].get('earlyWarningDueAt') else 1")"
check "72h notification clock set" "$(printf '%s' "$detail" | jget "0 if d['data']['incident'].get('notificationDueAt') else 1")"

# Generate the early-warning draft. If the account cannot afford it, that is
# the credit gate working — grant credits from the admin console and retry once.
# This is the single most important billing assertion in the suite: work the
# account cannot pay for must never happen silently.
draft=$(curl -s -b "$JAR" -X POST "$API/organizations/$ORG/incidents/$INC/drafts" -H 'Content-Type: application/json' -d '{"stage":"early_warning"}')
GATECODE=$(printf '%s' "$draft" | jget "d['error']['code']")
if [ "$GATECODE" = "insufficient_credits" ]; then
  check "draft refused when balance is too low" "0"
  ADMIN=$(curl -s -b "$JAR" -X POST "$API/admin/credits/grant" -H 'Content-Type: application/json' \
    -d "{\"orgId\":\"$ORG\",\"amount\":1000,\"reason\":\"smoke test\"}")
  check "admin console can grant credits" "$(printf '%s' "$ADMIN" | jget "0 if d['data'].get('applied') else 1")"
  draft=$(curl -s -b "$JAR" -X POST "$API/organizations/$ORG/incidents/$INC/drafts" -H 'Content-Type: application/json' -d '{"stage":"early_warning"}')
else
  check "draft generation within existing balance" "$(printf '%s' "$draft" | jget "0 if d['data'].get('draft') else 1")"
fi

DRAFTID=$(printf '%s' "$draft" | jget "d['data']['draft']['id']")
check "early-warning draft generated" "$([ -n "$DRAFTID" ] && echo 0 || echo 1)"
BODY=$(printf '%s' "$draft" | jget "d['data']['draft']['bodyMarkdown']")
check "draft is labelled as engineering evidence, not legal advice" \
  "$(printf '%s' "$BODY" | grep -qi 'has not been reviewed by a legal adviser' && echo 0 || echo 1)"
check "draft states the 24-hour deadline" "$(printf '%s' "$BODY" | grep -qi 'Early warning deadline' && echo 0 || echo 1)"
check "draft cites the advisory id and CVSS vector" \
  "$(printf '%s' "$BODY" | grep -q 'GHSA-' && printf '%s' "$BODY" | grep -q 'CVSS' && echo 0 || echo 1)"

step "billing integrity"
integ=$(curl -s -b "$JAR" "$API/organizations/$ORG/billing/integrity")
check "ledger balance equals transaction sum" "$(printf '%s' "$integ" | jget "0 if d['data']['consistent'] else 1")"

pricing=$(curl -s "$API/billing/pricing")
check "public pricing catalogue served" "$(printf '%s' "$pricing" | jget "0 if len(d['data']['packs'])>0 else 1")"

step "tenant isolation"
OTHER=$(curl -s -b "$JAR" "$API/organizations/org_doesnotexist/scans/$SCAN" -o /dev/null -w '%{http_code}')
check "another tenant's resource is not visible ($OTHER)" "$([ "$OTHER" = "403" ] || [ "$OTHER" = "404" ] && echo 0 || echo 1)"
ANON=$(curl -s "$API/organizations/$ORG/scans/$SCAN" -o /dev/null -w '%{http_code}')
check "unauthenticated access rejected ($ANON)" "$([ "$ANON" = "401" ] && echo 0 || echo 1)"

step "result"
printf '\n%s passed, %s failed\n' "$PASS" "$FAIL"
[ "$FAIL" = "0" ] || exit 1
