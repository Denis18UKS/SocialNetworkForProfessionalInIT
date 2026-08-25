import fs from 'node:fs';

const activityFile = 'android-app/app/src/main/java/io/itbird/socialbird/MainActivity.java';
const manifestFile = 'android-app/app/src/main/AndroidManifest.xml';
const fcmFile = 'android-app/app/src/main/java/io/itbird/socialbird/SocialBirdFirebaseMessagingService.java';
const controlFile = 'android-app/app/src/main/java/io/itbird/socialbird/CallControlActivity.java';

let source = fs.readFileSync(activityFile, 'utf8').replace(/\r\n/g, '\n');
const replaceRequired = (label, from, to) => {
  if (source.includes(to)) return;
  if (!source.includes(from)) throw new Error(`Android Call V4 patch failed: ${label}`);
  source = source.replace(from, to);
};

if (!source.includes('import android.media.AudioDeviceInfo;')) {
  replaceRequired(
    'AudioDeviceInfo import',
    'import android.media.AudioAttributes;\n',
    'import android.media.AudioAttributes;\nimport android.media.AudioDeviceInfo;\n',
  );
}

if (!source.includes('ANDROID_CALL_SYSTEM_V4: speaker-route')) {
  const anchor = '    private boolean canUseFullScreenCalls() {';
  const method = `    // ANDROID_CALL_SYSTEM_V4: speaker-route\n    private void setCallSpeakerphone(boolean enabled) {\n        if (audioManager == null) audioManager = (AudioManager) getSystemService(Context.AUDIO_SERVICE);\n        if (audioManager == null) return;\n        try {\n            audioManager.setMode(AudioManager.MODE_IN_COMMUNICATION);\n            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {\n                AudioDeviceInfo selected = null;\n                for (AudioDeviceInfo device : audioManager.getAvailableCommunicationDevices()) {\n                    if (enabled && device.getType() == AudioDeviceInfo.TYPE_BUILTIN_SPEAKER) {\n                        selected = device;\n                        break;\n                    }\n                    if (!enabled && device.getType() == AudioDeviceInfo.TYPE_BUILTIN_EARPIECE) {\n                        selected = device;\n                        break;\n                    }\n                }\n                if (selected != null) audioManager.setCommunicationDevice(selected);\n                else if (!enabled) audioManager.clearCommunicationDevice();\n            } else {\n                audioManager.setSpeakerphoneOn(enabled);\n            }\n        } catch (Exception ignored) {}\n    }\n\n${anchor}`;
  replaceRequired('native speaker route method', anchor, method);
}

if (!source.includes('ANDROID_CALL_SYSTEM_V4: speaker-js-bridge')) {
  const anchor = `        @JavascriptInterface\n        public void enterPictureInPicture() {`;
  const bridge = `        // ANDROID_CALL_SYSTEM_V4: speaker-js-bridge\n        @JavascriptInterface\n        public void setSpeakerphone(boolean enabled) {\n            runOnUiThread(() -> setCallSpeakerphone(enabled));\n        }\n\n${anchor}`;
  replaceRequired('speaker JavaScript bridge', anchor, bridge);
}

fs.writeFileSync(activityFile, source, 'utf8');

const manifest = fs.readFileSync(manifestFile, 'utf8');
const fcm = fs.readFileSync(fcmFile, 'utf8');
const control = fs.readFileSync(controlFile, 'utf8');

const checks = [
  [source, 'NATIVE_ANDROID_RUNTIME: answer-intent', 'runtime answer intent'],
  [source, 'itbird-native-answer-call', 'runtime answer event'],
  [source, 'requestScreenShare()', 'MediaProjection JS bridge'],
  [source, 'ANDROID_CALL_SYSTEM_V4: speaker-js-bridge', 'speaker JS bridge'],
  [source, 'SITE_ORIGIN = "https://socialbird.ru"', 'canonical socialbird.ru origin'],
  [manifest, 'android.permission.CAMERA', 'camera permission'],
  [manifest, 'android.permission.RECORD_AUDIO', 'microphone permission'],
  [manifest, 'android.permission.MODIFY_AUDIO_SETTINGS', 'audio route permission'],
  [manifest, '.CallControlActivity', 'fallback call control activity'],
  [manifest, 'android:scheme="socialbird-call"', 'fallback audio route scheme'],
  [fcm, '.putExtra("answer_call", true)', 'FCM explicit answer action'],
  [control, 'TYPE_BUILTIN_EARPIECE', 'earpiece fallback route'],
  [control, 'TYPE_BUILTIN_SPEAKER', 'speaker fallback route'],
];
for (const [text, needle, label] of checks) {
  if (!text.includes(needle)) throw new Error(`Android Call V4 verification failed: ${label}`);
}

console.log('Android Call System V4 is current: push answer, direct speaker/earpiece routing, camera/mic and MediaProjection bridges verified.');
