import fs from 'node:fs';

const mainFile = 'android-app/app/src/main/java/io/itbird/socialbird/MainActivity.java';
const manifestFile = 'android-app/app/src/main/AndroidManifest.xml';
let source = fs.readFileSync(mainFile, 'utf8');
let manifest = fs.readFileSync(manifestFile, 'utf8');

const replaceRequired = (label, from, to) => {
  if (source.includes(to)) return;
  if (!source.includes(from)) throw new Error(`Android forced updater patch failed: ${label}`);
  source = source.replace(from, to);
};

const marker = '// NATIVE_FORCED_UPDATE_V1: launch-gate';

if (!source.includes('private NativeUpdateManager nativeUpdateManager;')) {
  replaceRequired(
    'manager field',
    '    private WebView webView;\n',
    '    private WebView webView;\n    private NativeUpdateManager nativeUpdateManager;\n',
  );
}

if (!source.includes(marker)) {
  replaceRequired(
    'launch update gate',
    `        configureWebView();\n        Uri deepLink = getIntent() != null ? getIntent().getData() : null;\n        webView.loadUrl(isTrustedUri(deepLink) ? deepLink.toString() : SITE_ORIGIN);`,
    `        configureWebView();\n        webView.setVisibility(android.view.View.INVISIBLE);\n        Uri deepLink = getIntent() != null ? getIntent().getData() : null;\n        ${marker}\n        nativeUpdateManager = new NativeUpdateManager(this);\n        nativeUpdateManager.checkBeforeLaunch(BuildConfig.VERSION_CODE, () -> {\n            if (webView == null) return;\n            webView.setVisibility(android.view.View.VISIBLE);\n            webView.loadUrl(isTrustedUri(deepLink) ? deepLink.toString() : SITE_ORIGIN);\n        });`,
  );
}

if (!source.includes('// NATIVE_FORCED_UPDATE_V1: resume-installer')) {
  replaceRequired(
    'resume install permission flow',
    `        activityVisible = true;\n        String token = getSharedPreferences(BackgroundMessagingService.PREFS, MODE_PRIVATE)`,
    `        activityVisible = true;\n        // NATIVE_FORCED_UPDATE_V1: resume-installer\n        if (nativeUpdateManager != null) nativeUpdateManager.onResume();\n        String token = getSharedPreferences(BackgroundMessagingService.PREFS, MODE_PRIVATE)`,
  );
}

if (!source.includes('// NATIVE_FORCED_UPDATE_V1: cleanup-updater')) {
  replaceRequired(
    'updater cleanup',
    `        stopScreenCapture(false);\n        if (fileChooserCallback != null) fileChooserCallback.onReceiveValue(null);`,
    `        stopScreenCapture(false);\n        // NATIVE_FORCED_UPDATE_V1: cleanup-updater\n        if (nativeUpdateManager != null) {\n            nativeUpdateManager.destroy();\n            nativeUpdateManager = null;\n        }\n        if (fileChooserCallback != null) fileChooserCallback.onReceiveValue(null);`,
  );
}

if (!manifest.includes('android.permission.REQUEST_INSTALL_PACKAGES')) {
  const permissionAnchor = '    <uses-permission android:name="android.permission.INTERNET" />';
  if (!manifest.includes(permissionAnchor)) throw new Error('Android forced updater patch failed: manifest INTERNET permission anchor');
  manifest = manifest.replace(
    permissionAnchor,
    `${permissionAnchor}\n    <uses-permission android:name="android.permission.REQUEST_INSTALL_PACKAGES" />`,
  );
}

for (const expected of [
  marker,
  'private NativeUpdateManager nativeUpdateManager;',
  'nativeUpdateManager.checkBeforeLaunch(BuildConfig.VERSION_CODE',
  'NATIVE_FORCED_UPDATE_V1: resume-installer',
  'NATIVE_FORCED_UPDATE_V1: cleanup-updater',
]) {
  if (!source.includes(expected)) throw new Error(`Android forced updater verification failed: ${expected}`);
}
if (!manifest.includes('android.permission.REQUEST_INSTALL_PACKAGES')) {
  throw new Error('Android forced updater verification failed: REQUEST_INSTALL_PACKAGES');
}

fs.writeFileSync(mainFile, source, 'utf8');
fs.writeFileSync(manifestFile, manifest, 'utf8');
console.log('Android forced self-update gate is current: release manifest check, verified APK download, install permission handoff.');
