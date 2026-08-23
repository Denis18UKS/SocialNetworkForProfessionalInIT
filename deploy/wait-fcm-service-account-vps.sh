#!/usr/bin/env bash
set -Eeuo pipefail

PROJECT_ID="${1:-}"
SA_EMAIL="socialbird-fcm@${PROJECT_ID}.iam.gserviceaccount.com"

if [[ ${EUID} -ne 0 ]]; then
  echo "Run as root." >&2
  exit 1
fi

if [[ -z "$PROJECT_ID" ]]; then
  echo "Usage: bash deploy/wait-fcm-service-account-vps.sh PROJECT_ID" >&2
  exit 2
fi

for attempt in {1..60}; do
  if gcloud iam service-accounts describe "$SA_EMAIL" --project "$PROJECT_ID" >/dev/null 2>&1; then
    echo "Service account is ready: $SA_EMAIL"
    exit 0
  fi
  echo "Waiting for Google IAM propagation: $attempt/60"
  sleep 2
done

echo "Service account did not become visible after 120 seconds: $SA_EMAIL" >&2
exit 3
