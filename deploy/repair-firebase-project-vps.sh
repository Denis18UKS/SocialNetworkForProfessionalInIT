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

echo "[1/6] Enabling prerequisite APIs"
gcloud services enable serviceusage.googleapis.com cloudresourcemanager.googleapis.com firebase.googleapis.com --project "$PROJECT_ID"

echo "[2/6] Verifying the exact required IAM permissions"
TOKEN="$(gcloud auth print-access-token)"
PERM_HTTP="$(curl -sS -o /tmp/socialbird-firebase-permissions.json -w '%{http_code}' -X POST \
  -H "Authorization: Bearer $TOKEN" \
  -H "x-goog-user-project: $PROJECT_ID" \
  -H 'Content-Type: application/json' \
  --data-binary '{"permissions":["firebase.projects.update","resourcemanager.projects.get","serviceusage.services.enable","serviceusage.services.get"]}' \
  "https://cloudresourcemanager.googleapis.com/v1/projects/$PROJECT_ID:testIamPermissions")"
echo "IAM test HTTP: $PERM_HTTP"
if [[ "$PERM_HTTP" == "200" ]]; then
  jq . /tmp/socialbird-firebase-permissions.json
else
  echo "IAM permission test failed:" >&2
  cat /tmp/socialbird-firebase-permissions.json >&2 || true
fi

echo "[3/6] Checking Firebase state with an explicit quota project"
TOKEN="$(gcloud auth print-access-token)"
HTTP="$(curl -sS -D /tmp/socialbird-firebase-get.headers -o /tmp/socialbird-firebase-get.json -w '%{http_code}' \
  -H "Authorization: Bearer $TOKEN" \
  -H "x-goog-user-project: $PROJECT_ID" \
  "https://firebase.googleapis.com/v1beta1/projects/$PROJECT_ID")"
echo "Firebase GET HTTP: $HTTP"
if [[ "$HTTP" == "200" ]]; then
  jq . /tmp/socialbird-firebase-get.json
  rm -f /tmp/socialbird-firebase-get.json /tmp/socialbird-firebase-get.headers /tmp/socialbird-firebase-permissions.json
  echo "[4/6] Firebase is already enabled"
  echo "[5/6] No repair needed"
  echo "[6/6] Completed"
  echo "Run next: bash deploy/setup-firebase-vps.sh $PROJECT_ID"
  exit 0
fi

echo "Firebase GET response body:"
if [[ -s /tmp/socialbird-firebase-get.json ]]; then
  jq . /tmp/socialbird-firebase-get.json 2>/dev/null || cat /tmp/socialbird-firebase-get.json
else
  echo "(empty body)"
fi

echo "[4/6] Calling projects.addFirebase with the target project as quota project"
TOKEN="$(gcloud auth print-access-token)"
ADD_HTTP="$(curl -sS -D /tmp/socialbird-addfirebase.headers -o /tmp/socialbird-addfirebase.json -w '%{http_code}' -X POST \
  -H "Authorization: Bearer $TOKEN" \
  -H "x-goog-user-project: $PROJECT_ID" \
  "https://firebase.googleapis.com/v1beta1/projects/$PROJECT_ID:addFirebase")"
echo "addFirebase HTTP: $ADD_HTTP"

if [[ "$ADD_HTTP" != "200" && "$ADD_HTTP" != "201" && "$ADD_HTTP" != "202" ]]; then
  echo "Firebase Management API response:" >&2
  if [[ -s /tmp/socialbird-addfirebase.json ]]; then
    jq . /tmp/socialbird-addfirebase.json 2>/dev/null >&2 || cat /tmp/socialbird-addfirebase.json >&2
  else
    echo "(empty body)" >&2
    echo "Response headers:" >&2
    cat /tmp/socialbird-addfirebase.headers >&2 || true
  fi
  echo >&2
  echo "Project IAM roles for active account:" >&2
  gcloud projects get-iam-policy "$PROJECT_ID" --flatten='bindings[].members' --filter="bindings.members:user:$ACCOUNT" --format='table(bindings.role)' >&2 || true
  echo >&2
  echo "The request now includes x-goog-user-project, so quota/billing attribution is no longer ambiguous." >&2
  echo "If the IAM test above includes all four required permissions and this call still returns 403, the remaining likely causes are Firebase account Terms/eligibility or an organization-level deny/policy." >&2
  rm -f /tmp/socialbird-firebase-get.json /tmp/socialbird-firebase-get.headers /tmp/socialbird-firebase-permissions.json
  exit 10
fi

if [[ -s /tmp/socialbird-addfirebase.json ]]; then
  jq . /tmp/socialbird-addfirebase.json 2>/dev/null || cat /tmp/socialbird-addfirebase.json
fi

echo "[5/6] Waiting until Firebase project is ready"
for attempt in {1..40}; do
  sleep 3
  TOKEN="$(gcloud auth print-access-token)"
  HTTP="$(curl -sS -o /tmp/socialbird-firebase-get.json -w '%{http_code}' \
    -H "Authorization: Bearer $TOKEN" \
    -H "x-goog-user-project: $PROJECT_ID" \
    "https://firebase.googleapis.com/v1beta1/projects/$PROJECT_ID")"
  if [[ "$HTTP" == "200" ]]; then
    echo "Firebase is ready."
    jq . /tmp/socialbird-firebase-get.json
    rm -f /tmp/socialbird-firebase-get.json /tmp/socialbird-addfirebase.json /tmp/socialbird-firebase-get.headers /tmp/socialbird-addfirebase.headers /tmp/socialbird-firebase-permissions.json
    echo "[6/6] Completed"
    echo "Run next: bash deploy/setup-firebase-vps.sh $PROJECT_ID"
    exit 0
  fi
done

echo "Firebase add request was accepted, but the project did not become ready in time." >&2
cat /tmp/socialbird-firebase-get.json >&2 || true
exit 11
