#!/usr/bin/env bash
set -Eeuo pipefail

APP_DIR="/opt/socialbird/current"
REPO="Denis18UKS/SocialNetworkForProfessionalInIT"
BRANCH="deploy/socialbird-vps-production"
PACKAGE_NAME="io.itbird.socialbird"
PROJECT_ID="${1:-socialbird-ru-$(date +%y%m%d)-$(openssl rand -hex 2)}"
DISPLAY_NAME="SocialBIRD"
SDK_CONFIG="/root/socialbird-google-services.json"
SERVICE_KEY="/root/firebase-service-account.json"
SA_NAME="socialbird-fcm"
SA_EMAIL="${SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"

if [[ ${EUID} -ne 0 ]]; then
  echo "Run as root." >&2
  exit 1
fi

for command in gcloud gh jq node curl openssl base64; do
  if ! command -v "$command" >/dev/null 2>&1; then
    echo "Missing command: $command" >&2
    exit 2
  fi
done

if ! gcloud auth list --filter=status:ACTIVE --format='value(account)' | grep -q .; then
  echo "Google Cloud CLI is not authenticated. Run: gcloud auth login --no-launch-browser" >&2
  exit 4
fi
if ! gh auth status >/dev/null 2>&1; then
  echo "GitHub CLI is not authenticated. Run: gh auth login" >&2
  exit 5
fi

cd "$APP_DIR"

echo "[1/10] Preparing Firebase project: $PROJECT_ID"
if gcloud projects describe "$PROJECT_ID" >/dev/null 2>&1; then
  echo "Google Cloud project already exists; resuming: $PROJECT_ID"
else
  gcloud projects create "$PROJECT_ID" --name="$DISPLAY_NAME"
fi

gcloud config set project "$PROJECT_ID" >/dev/null

gcloud services enable serviceusage.googleapis.com cloudresourcemanager.googleapis.com firebase.googleapis.com --project "$PROJECT_ID"

TOKEN="$(gcloud auth print-access-token)"
FIREBASE_HTTP_STATUS="$(curl -sS -o /tmp/socialbird-firebase-project.json -w '%{http_code}' \
  -H "Authorization: Bearer $TOKEN" \
  -H "x-goog-user-project: $PROJECT_ID" \
  "https://firebase.googleapis.com/v1beta1/projects/$PROJECT_ID")"
if [[ "$FIREBASE_HTTP_STATUS" != "200" ]]; then
  echo "Firebase is not ready yet; running the quota-aware repair path."
  bash deploy/repair-firebase-project-vps.sh "$PROJECT_ID"
fi

TOKEN="$(gcloud auth print-access-token)"
FIREBASE_HTTP_STATUS="$(curl -sS -o /tmp/socialbird-firebase-project.json -w '%{http_code}' \
  -H "Authorization: Bearer $TOKEN" \
  -H "x-goog-user-project: $PROJECT_ID" \
  "https://firebase.googleapis.com/v1beta1/projects/$PROJECT_ID")"
if [[ "$FIREBASE_HTTP_STATUS" != "200" ]]; then
  echo "Firebase project is still unavailable after repair." >&2
  cat /tmp/socialbird-firebase-project.json >&2 || true
  exit 12
fi
rm -f /tmp/socialbird-firebase-project.json

echo "[2/10] Registering SocialBIRD Android app through Firebase Management REST"
TOKEN="$(gcloud auth print-access-token)"
APPS_HTTP="$(curl -sS -o /tmp/socialbird-android-apps.json -w '%{http_code}' \
  -H "Authorization: Bearer $TOKEN" \
  -H "x-goog-user-project: $PROJECT_ID" \
  "https://firebase.googleapis.com/v1beta1/projects/$PROJECT_ID/androidApps")"
if [[ "$APPS_HTTP" != "200" ]]; then
  echo "Unable to list Firebase Android apps (HTTP $APPS_HTTP)." >&2
  cat /tmp/socialbird-android-apps.json >&2 || true
  exit 13
fi

APP_ID="$(jq -r --arg pkg "$PACKAGE_NAME" '.apps[]? | select(.packageName == $pkg and .state != "DELETED") | .appId' /tmp/socialbird-android-apps.json | head -n 1)"
if [[ -z "$APP_ID" ]]; then
  echo "Creating Android app: $PACKAGE_NAME"
  TOKEN="$(gcloud auth print-access-token)"
  CREATE_HTTP="$(curl -sS -o /tmp/socialbird-create-android.json -w '%{http_code}' -X POST \
    -H "Authorization: Bearer $TOKEN" \
    -H "x-goog-user-project: $PROJECT_ID" \
    -H 'Content-Type: application/json' \
    --data-binary "{\"displayName\":\"$DISPLAY_NAME\",\"packageName\":\"$PACKAGE_NAME\"}" \
    "https://firebase.googleapis.com/v1beta1/projects/$PROJECT_ID/androidApps")"
  if [[ "$CREATE_HTTP" != "200" && "$CREATE_HTTP" != "201" && "$CREATE_HTTP" != "202" ]]; then
    echo "Android app creation failed (HTTP $CREATE_HTTP)." >&2
    cat /tmp/socialbird-create-android.json >&2 || true
    exit 14
  fi

  for attempt in {1..40}; do
    sleep 3
    TOKEN="$(gcloud auth print-access-token)"
    curl -fsS \
      -H "Authorization: Bearer $TOKEN" \
      -H "x-goog-user-project: $PROJECT_ID" \
      "https://firebase.googleapis.com/v1beta1/projects/$PROJECT_ID/androidApps" \
      -o /tmp/socialbird-android-apps.json
    APP_ID="$(jq -r --arg pkg "$PACKAGE_NAME" '.apps[]? | select(.packageName == $pkg and .state != "DELETED") | .appId' /tmp/socialbird-android-apps.json | head -n 1)"
    if [[ -n "$APP_ID" ]]; then break; fi
  done
fi

if [[ -z "$APP_ID" ]]; then
  echo "Firebase Android app did not become ready." >&2
  exit 15
fi

echo "Android app id: $APP_ID"
TOKEN="$(gcloud auth print-access-token)"
CONFIG_HTTP="$(curl -sS -o /tmp/socialbird-android-config.json -w '%{http_code}' \
  -H "Authorization: Bearer $TOKEN" \
  -H "x-goog-user-project: $PROJECT_ID" \
  "https://firebase.googleapis.com/v1beta1/projects/$PROJECT_ID/androidApps/$APP_ID/config")"
if [[ "$CONFIG_HTTP" != "200" ]]; then
  echo "Firebase Android config download failed (HTTP $CONFIG_HTTP)." >&2
  cat /tmp/socialbird-android-config.json >&2 || true
  exit 16
fi
jq -r '.configFileContents' /tmp/socialbird-android-config.json | base64 -d > "$SDK_CONFIG"
test -s "$SDK_CONFIG"

CONFIG_PROJECT_ID="$(jq -r '.project_info.project_id // empty' "$SDK_CONFIG")"
PROJECT_NUMBER="$(jq -r '.project_info.project_number // empty' "$SDK_CONFIG")"
CONFIG_APP_ID="$(jq -r --arg pkg "$PACKAGE_NAME" '.client[] | select(.client_info.android_client_info.package_name == $pkg) | .client_info.mobilesdk_app_id' "$SDK_CONFIG" | head -n 1)"
API_KEY="$(jq -r --arg pkg "$PACKAGE_NAME" '.client[] | select(.client_info.android_client_info.package_name == $pkg) | .api_key[0].current_key' "$SDK_CONFIG" | head -n 1)"

for value in "$CONFIG_PROJECT_ID" "$PROJECT_NUMBER" "$CONFIG_APP_ID" "$API_KEY"; do
  if [[ -z "$value" || "$value" == "null" ]]; then
    echo "Firebase Android SDK config is incomplete." >&2
    exit 7
  fi
done

if [[ "$CONFIG_PROJECT_ID" != "$PROJECT_ID" ]]; then
  echo "Firebase config project mismatch: expected $PROJECT_ID, got $CONFIG_PROJECT_ID" >&2
  exit 8
fi

echo "[3/10] Enabling FCM HTTP v1 API"
gcloud services enable fcm.googleapis.com --project "$PROJECT_ID"

echo "[4/10] Creating dedicated FCM service account"
if ! gcloud iam service-accounts describe "$SA_EMAIL" --project "$PROJECT_ID" >/dev/null 2>&1; then
  gcloud iam service-accounts create "$SA_NAME" --display-name="SocialBIRD FCM sender" --project "$PROJECT_ID"
fi

gcloud projects add-iam-policy-binding "$PROJECT_ID" --member="serviceAccount:$SA_EMAIL" --role="roles/firebasecloudmessaging.admin" --condition=None >/dev/null

rm -f "$SERVICE_KEY"
gcloud iam service-accounts keys create "$SERVICE_KEY" --iam-account="$SA_EMAIL" --project "$PROJECT_ID"
chmod 600 "$SERVICE_KEY"
test -s "$SERVICE_KEY"

echo "[5/10] Configuring SocialBIRD backend FCM transport"
bash deploy/configure-fcm-server.sh "$SERVICE_KEY"
STATUS="$(curl -fsS http://127.0.0.1:5000/native-push/status)"
if ! grep -Fq '"configured":true' <<<"$STATUS"; then
  echo "Backend did not report configured=true: $STATUS" >&2
  exit 9
fi
echo "$STATUS"
shred -u "$SERVICE_KEY"

echo "[6/10] Writing Firebase Android values to GitHub Actions variables"
gh variable set SOCIALBIRD_FIREBASE_PROJECT_ID -R "$REPO" --body "$PROJECT_ID"
gh variable set SOCIALBIRD_FIREBASE_APP_ID -R "$REPO" --body "$CONFIG_APP_ID"
gh variable set SOCIALBIRD_FIREBASE_API_KEY -R "$REPO" --body "$API_KEY"
gh variable set SOCIALBIRD_FIREBASE_SENDER_ID -R "$REPO" --body "$PROJECT_NUMBER"

for variable in SOCIALBIRD_FIREBASE_PROJECT_ID SOCIALBIRD_FIREBASE_APP_ID SOCIALBIRD_FIREBASE_API_KEY SOCIALBIRD_FIREBASE_SENDER_ID; do
  gh variable get "$variable" -R "$REPO" >/dev/null
  echo "  OK: $variable"
done

echo "[7/10] Triggering Android APK build"
gh workflow run android-apk.yml -R "$REPO" --ref "$BRANCH"
sleep 6
RUN_ID="$(gh run list -R "$REPO" --workflow android-apk.yml --branch "$BRANCH" --event workflow_dispatch --limit 1 --json databaseId --jq '.[0].databaseId')"
if [[ -z "$RUN_ID" ]]; then
  echo "Could not resolve the Android workflow run id." >&2
  exit 10
fi
echo "Workflow run: $RUN_ID"

echo "[8/10] Waiting for Android build"
gh run watch "$RUN_ID" -R "$REPO" --exit-status

echo "[9/10] Verifying published APK"
curl -fsSL --range 0-0 -o /dev/null "https://github.com/Denis18UKS/SocialNetworkForProfessionalInIT/releases/download/android-latest/SocialBIRD-Android.apk"

rm -f "$SDK_CONFIG" /tmp/socialbird-android-apps.json /tmp/socialbird-create-android.json /tmp/socialbird-android-config.json

echo "[10/10] Completed"
echo "Firebase project: $PROJECT_ID"
echo "Backend FCM: configured=true"
echo "Android package: $PACKAGE_NAME"
echo "GitHub Actions variables: configured"
echo "APK: android-latest published"
echo "Next step: install the new APK, sign in once, allow notifications/full-screen calls, then test an offline message and incoming call."
