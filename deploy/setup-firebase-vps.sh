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

for command in firebase gcloud gh jq node curl; do
  if ! command -v "$command" >/dev/null 2>&1; then
    echo "Missing command: $command" >&2
    exit 2
  fi
done

if ! firebase projects:list >/dev/null 2>&1; then
  echo "Firebase CLI is not authenticated. Run: firebase login --no-localhost" >&2
  exit 3
fi
if ! gcloud auth list --filter=status:ACTIVE --format='value(account)' | grep -q .; then
  echo "Google Cloud CLI is not authenticated. Run: gcloud auth login --no-launch-browser" >&2
  exit 4
fi
if ! gh auth status >/dev/null 2>&1; then
  echo "GitHub CLI is not authenticated. Run: gh auth login" >&2
  exit 5
fi

cd "$APP_DIR"

echo "[1/10] Creating Firebase project: $PROJECT_ID"
firebase projects:create "$PROJECT_ID" --display-name "$DISPLAY_NAME"

for attempt in {1..30}; do
  if gcloud projects describe "$PROJECT_ID" >/dev/null 2>&1; then break; fi
  if [[ "$attempt" -eq 30 ]]; then
    echo "Google Cloud project did not become visible to gcloud." >&2
    exit 6
  fi
  sleep 2
done

gcloud config set project "$PROJECT_ID" >/dev/null

echo "[2/10] Registering SocialBIRD Android app"
firebase apps:create -a "$PACKAGE_NAME" android "$DISPLAY_NAME" --project "$PROJECT_ID"
rm -f "$SDK_CONFIG"
firebase apps:sdkconfig android -o "$SDK_CONFIG" --project "$PROJECT_ID"
test -s "$SDK_CONFIG"

CONFIG_PROJECT_ID="$(jq -r '.project_info.project_id // empty' "$SDK_CONFIG")"
PROJECT_NUMBER="$(jq -r '.project_info.project_number // empty' "$SDK_CONFIG")"
APP_ID="$(jq -r --arg pkg "$PACKAGE_NAME" '.client[] | select(.client_info.android_client_info.package_name == $pkg) | .client_info.mobilesdk_app_id' "$SDK_CONFIG" | head -n 1)"
API_KEY="$(jq -r --arg pkg "$PACKAGE_NAME" '.client[] | select(.client_info.android_client_info.package_name == $pkg) | .api_key[0].current_key' "$SDK_CONFIG" | head -n 1)"

for value in "$CONFIG_PROJECT_ID" "$PROJECT_NUMBER" "$APP_ID" "$API_KEY"; do
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

# The backend script copied the key into /etc/socialbird with restricted permissions.
shred -u "$SERVICE_KEY"

echo "[6/10] Writing Firebase Android values to GitHub Actions variables"
gh variable set SOCIALBIRD_FIREBASE_PROJECT_ID -R "$REPO" --body "$PROJECT_ID"
gh variable set SOCIALBIRD_FIREBASE_APP_ID -R "$REPO" --body "$APP_ID"
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

rm -f "$SDK_CONFIG"

echo "[10/10] Completed"
echo "Firebase project: $PROJECT_ID"
echo "Backend FCM: configured=true"
echo "Android package: $PACKAGE_NAME"
echo "GitHub Actions variables: configured"
echo "APK: android-latest published"
echo "Next step: install the new APK, sign in once, allow notifications/full-screen calls, then test an offline message and incoming call."
