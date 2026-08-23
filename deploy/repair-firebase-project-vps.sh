#!/usr/bin/env bash
set -Eeuo pipefail

PROJECT_ID="${1:-}"
if [[ ${EUID} -ne 0 ]]; then
  echo "Run as root." >&2
  exit 1
fi
if [[ -z "$PROJECT_ID" ]]; then
  echo "Usage: bash deploy/repair-firebase-project-vps.sh PROJECT_ID" >&2
  exit 2
fi
for command in gcloud curl jq; do
  command -v "$command" >/dev/null 2>&1 || { echo "Missing command: $command" >&2; exit 3; }
done

ACCOUNT="$(gcloud auth list --filter=status:ACTIVE --format='value(account)' | head -n 1)"
if [[ -z "$ACCOUNT" ]]; then
  echo "No active gcloud account. Run: gcloud auth login --no-launch-browser" >&2
  exit 4
fi

echo "Active Google account: $ACCOUNT"
echo "Project: $PROJECT_ID"

gcloud projects describe "$PROJECT_ID" >/dev/null
gcloud config set project "$PROJECT_ID" >/dev/null

echo "[1/5] Enabling prerequisite APIs"
gcloud services enable serviceusage.googleapis.com cloudresourcemanager.googleapis.com firebase.googleapis.com --project "$PROJECT_ID"

echo "[2/5] Checking current Firebase state"
TOKEN="$(gcloud auth print-access-token)"
HTTP="$(curl -sS -o /tmp/socialbird-firebase-get.json -w '%{http_code}' -H "Authorization: Bearer $TOKEN" "https://firebase.googleapis.com/v1beta1/projects/$PROJECT_ID")"
if [[ "$HTTP" == "200" ]]; then
  echo "Firebase is already enabled for $PROJECT_ID"
  rm -f /tmp/socialbird-firebase-get.json
  echo "Run next: bash deploy/setup-firebase-vps.sh $PROJECT_ID"
  exit 0
fi

echo "Firebase GET returned HTTP $HTTP; trying Management REST addFirebase."

echo "[3/5] Calling projects.addFirebase directly"
TOKEN="$(gcloud auth print-access-token)"
ADD_HTTP="$(curl -sS -o /tmp/socialbird-addfirebase.json -w '%{http_code}' -X POST -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d '{}' "https://firebase.googleapis.com/v1beta1/projects/$PROJECT_ID:addFirebase")"
echo "addFirebase HTTP: $ADD_HTTP"

if [[ "$ADD_HTTP" != "200" && "$ADD_HTTP" != "201" && "$ADD_HTTP" != "202" ]]; then
  echo "Firebase Management API response:" >&2
  jq . /tmp/socialbird-addfirebase.json 2>/dev/null >&2 || cat /tmp/socialbird-addfirebase.json >&2 || true
  echo >&2
  echo "[4/5] Project IAM roles for active account" >&2
  gcloud projects get-iam-policy "$PROJECT_ID" --flatten='bindings[].members' --filter="bindings.members:user:$ACCOUNT" --format='table(bindings.role)' >&2 || true
  echo >&2
  if [[ "$ADD_HTTP" == "403" ]]; then
    echo "HTTP 403 means either the active account lacks the required Firebase/service-usage permissions, or Firebase Terms of Service have not been accepted." >&2
    echo "Firebase Terms cannot be accepted with CLI/REST; Google requires the Firebase Console for that one consent step." >&2
  fi
  rm -f /tmp/socialbird-firebase-get.json
  exit 10
fi

cat /tmp/socialbird-addfirebase.json | jq . 2>/dev/null || true

echo "[4/5] Waiting until Firebase project is ready"
for attempt in {1..40}; do
  sleep 3
  TOKEN="$(gcloud auth print-access-token)"
  HTTP="$(curl -sS -o /tmp/socialbird-firebase-get.json -w '%{http_code}' -H "Authorization: Bearer $TOKEN" "https://firebase.googleapis.com/v1beta1/projects/$PROJECT_ID")"
  if [[ "$HTTP" == "200" ]]; then
    echo "Firebase is ready."
    rm -f /tmp/socialbird-firebase-get.json /tmp/socialbird-addfirebase.json
    echo "[5/5] Completed"
    echo "Run next: bash deploy/setup-firebase-vps.sh $PROJECT_ID"
    exit 0
  fi
done

echo "Firebase add request was accepted, but the project did not become ready in time." >&2
cat /tmp/socialbird-firebase-get.json >&2 || true
exit 11
