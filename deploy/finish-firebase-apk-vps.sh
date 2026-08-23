#!/usr/bin/env bash
set -Eeuo pipefail

REPO="Denis18UKS/SocialNetworkForProfessionalInIT"
BRANCH="deploy/socialbird-vps-production"
STATUS_URL="http://127.0.0.1:5000/native-push/status"
APK_URL="https://github.com/Denis18UKS/SocialNetworkForProfessionalInIT/releases/download/android-latest/SocialBIRD-Android.apk"

if [[ ${EUID} -ne 0 ]]; then
  echo "Run as root." >&2
  exit 1
fi

for command in gh curl grep; do
  command -v "$command" >/dev/null 2>&1 || { echo "Missing command: $command" >&2; exit 2; }
done

if ! gh auth status >/dev/null 2>&1; then
  echo "GitHub CLI is not authenticated." >&2
  exit 3
fi

echo "[1/5] Verifying SocialBIRD native FCM backend"
STATUS_FILE="$(mktemp)"
curl -fsS "$STATUS_URL" -o "$STATUS_FILE"
cat "$STATUS_FILE"
if ! grep -Fq '"configured":true' "$STATUS_FILE"; then
  echo "Native FCM backend is not configured=true." >&2
  rm -f "$STATUS_FILE"
  exit 4
fi
rm -f "$STATUS_FILE"

echo "[2/5] Verifying GitHub Actions Firebase variables"
VARIABLES_FILE="$(mktemp)"
gh variable list -R "$REPO" > "$VARIABLES_FILE"
for variable in SOCIALBIRD_FIREBASE_PROJECT_ID SOCIALBIRD_FIREBASE_APP_ID SOCIALBIRD_FIREBASE_API_KEY SOCIALBIRD_FIREBASE_SENDER_ID; do
  if ! grep -Fq "$variable" "$VARIABLES_FILE"; then
    echo "Missing GitHub Actions variable: $variable" >&2
    rm -f "$VARIABLES_FILE"
    exit 5
  fi
  echo "  OK: $variable"
done
rm -f "$VARIABLES_FILE"

echo "[3/5] Triggering Android APK workflow"
gh workflow run android-apk.yml -R "$REPO" --ref "$BRANCH"
sleep 6
RUN_ID="$(gh run list -R "$REPO" --workflow android-apk.yml --branch "$BRANCH" --event workflow_dispatch --limit 1 --json databaseId --jq '.[0].databaseId')"
if [[ -z "$RUN_ID" ]]; then
  echo "Could not resolve Android workflow run id." >&2
  exit 6
fi
echo "Workflow run: $RUN_ID"

echo "[4/5] Waiting for Android APK build"
gh run watch "$RUN_ID" -R "$REPO" --exit-status

echo "[5/5] Verifying published APK"
curl -fsSL --range 0-0 -o /dev/null "$APK_URL"

echo
 echo "Firebase backend: configured=true"
echo "GitHub Actions variables: present"
echo "Android APK workflow: succeeded"
echo "APK android-latest: published"
