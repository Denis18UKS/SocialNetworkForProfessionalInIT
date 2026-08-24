#!/usr/bin/env bash
set -Eeuo pipefail

REPO="Denis18UKS/SocialNetworkForProfessionalInIT"
BRANCH="deploy/socialbird-vps-production"
ANDROID_APK_URL="https://github.com/Denis18UKS/SocialNetworkForProfessionalInIT/releases/download/android-latest/SocialBIRD-Android.apk"
ANDROID_META_URL="https://github.com/Denis18UKS/SocialNetworkForProfessionalInIT/releases/download/android-latest/SocialBIRD-Android-version.json"
ADMIN_EXE_URL="https://github.com/Denis18UKS/SocialNetworkForProfessionalInIT/releases/download/admin-desktop-latest/SocialBIRD-Admin-Setup.exe"

if [[ ${EUID} -ne 0 ]]; then
  echo "Run as root." >&2
  exit 1
fi

command -v gh >/dev/null 2>&1 || { echo "gh CLI is required." >&2; exit 2; }
command -v curl >/dev/null 2>&1 || { echo "curl is required." >&2; exit 2; }
gh auth status >/dev/null 2>&1 || { echo "GitHub CLI is not authenticated." >&2; exit 3; }

echo "[1/6] Triggering updated Android APK workflow"
gh workflow run android-apk.yml -R "$REPO" --ref "$BRANCH"
sleep 6
ANDROID_RUN="$(gh run list -R "$REPO" --workflow android-apk.yml --branch "$BRANCH" --event workflow_dispatch --limit 1 --json databaseId --jq '.[0].databaseId')"
if [[ -z "$ANDROID_RUN" ]]; then
  echo "Could not resolve Android workflow run." >&2
  exit 4
fi
echo "Android workflow: $ANDROID_RUN"

echo "[2/6] Waiting for Android APK"
gh run watch "$ANDROID_RUN" -R "$REPO" --exit-status

echo "[3/6] Verifying Android APK and version metadata"
curl -fsSL --range 0-0 -o /dev/null "$ANDROID_APK_URL"
curl -fsSL "$ANDROID_META_URL" -o /tmp/socialbird-android-version.json
grep -Fq '"versionCode"' /tmp/socialbird-android-version.json
grep -Fq '"versionName"' /tmp/socialbird-android-version.json
cat /tmp/socialbird-android-version.json
rm -f /tmp/socialbird-android-version.json

echo "[4/6] Triggering Electron Admin Desktop workflow"
gh workflow run admin-desktop.yml -R "$REPO" --ref "$BRANCH"
sleep 6
ADMIN_RUN="$(gh run list -R "$REPO" --workflow admin-desktop.yml --branch "$BRANCH" --event workflow_dispatch --limit 1 --json databaseId --jq '.[0].databaseId')"
if [[ -z "$ADMIN_RUN" ]]; then
  echo "Could not resolve Admin Desktop workflow run." >&2
  exit 5
fi
echo "Admin Desktop workflow: $ADMIN_RUN"

echo "[5/6] Waiting for Admin Desktop installer"
gh run watch "$ADMIN_RUN" -R "$REPO" --exit-status

echo "[6/6] Verifying published Admin Desktop installer"
curl -fsSL --range 0-0 -o /dev/null "$ADMIN_EXE_URL"

echo
echo "Android APK: published"
echo "Android version metadata: published"
echo "Admin Desktop installer: published"
echo "Artifacts are ready for end-to-end testing."
