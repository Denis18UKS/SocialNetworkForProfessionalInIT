import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const file = path.join(root, 'android-app/app/src/main/java/io/itbird/socialbird/MainActivity.java');
let source = fs.readFileSync(file, 'utf8');

const replaceRequired = (label, from, to) => {
  if (source.includes(to)) return;
  if (!source.includes(from)) throw new Error(`Android runtime patch failed: ${label}`);
  source = source.replace(from, to);
};

if (!source.includes('import android.media.AudioFocusRequest;')) {
  replaceRequired(
    'audio focus imports',
    'import android.media.AudioFormat;\n',
    'import android.media.AudioFormat;\nimport android.media.AudioFocusRequest;\nimport android.media.AudioManager;\n',
  );
}

if (!source.includes('import android.view.View;')) {
  replaceRequired(
    'fullscreen imports',
    'import android.view.ViewGroup;\n',
    'import android.view.View;\nimport android.view.ViewGroup;\n',
  );
}

if (!source.includes('pendingNativeAutoAnswer')) {
  replaceRequired(
    'native runtime fields',
    '    private boolean callActive = false;\n',
    `    private boolean callActive = false;\n    // NATIVE_ANDROID_RUNTIME: call/audio/fullscreen state\n    private boolean pendingNativeAutoAnswer = false;\n    private AudioManager audioManager;\n    private AudioFocusRequest callAudioFocusRequest;\n    private View customFullscreenView;\n    private WebChromeClient.CustomViewCallback customFullscreenCallback;\n`,
  );
}

if (!source.includes('NATIVE_ANDROID_RUNTIME: initialize-runtime')) {
  replaceRequired(
    'runtime initialization',
    `        projectionManager = (MediaProjectionManager) getSystemService(Context.MEDIA_PROJECTION_SERVICE);\n`,
    `        projectionManager = (MediaProjectionManager) getSystemService(Context.MEDIA_PROJECTION_SERVICE);\n        // NATIVE_ANDROID_RUNTIME: initialize-runtime\n        audioManager = (AudioManager) getSystemService(Context.AUDIO_SERVICE);\n        Intent launchIntent = getIntent();\n        pendingNativeAutoAnswer = launchIntent != null && launchIntent.getBooleanExtra("answer_call", false);\n        if (pendingNativeAutoAnswer) BackgroundMessagingService.dismissIncomingCallNotification(this);\n`,
  );
}

if (!source.includes('NATIVE_ANDROID_RUNTIME: page-ready-answer')) {
  replaceRequired(
    'page-ready native answer',
    `            public void onPageFinished(WebView view, String url) {\n                super.onPageFinished(view, url);\n                callJs("window.dispatchEvent(new Event('itbird-native-ready')); ");\n            }`,
    `            public void onPageFinished(WebView view, String url) {\n                super.onPageFinished(view, url);\n                callJs("window.dispatchEvent(new Event('itbird-native-ready')); ");\n                // NATIVE_ANDROID_RUNTIME: page-ready-answer\n                deliverPendingNativeAnswer();\n            }`,
  );
}

if (!source.includes('NATIVE_ANDROID_RUNTIME: web-fullscreen')) {
  const marker = `            @Override\n            public void onPermissionRequest(PermissionRequest request) {`;
  if (!source.includes(marker)) throw new Error('Android runtime patch failed: WebChromeClient marker');
  const block = `            // NATIVE_ANDROID_RUNTIME: web-fullscreen\n            @Override\n            public void onShowCustomView(View view, CustomViewCallback callback) {\n                showWebFullscreen(view, callback);\n            }\n\n            @Override\n            public void onHideCustomView() {\n                hideWebFullscreen();\n            }\n\n${marker}`;
  source = source.replace(marker, block);
}

if (!source.includes('NATIVE_ANDROID_RUNTIME: configure-call-audio')) {
  replaceRequired(
    'native call audio hook',
    `    private void setNativeCallActive(boolean active) {\n        callActive = active;\n        BackgroundMessagingService.setCallActive(this, active);`,
    `    private void setNativeCallActive(boolean active) {\n        callActive = active;\n        // NATIVE_ANDROID_RUNTIME: configure-call-audio\n        configureCallAudio(active);\n        BackgroundMessagingService.setCallActive(this, active);`,
  );
}

if (!source.includes('private void configureCallAudio(boolean active)')) {
  const marker = `    private boolean canUseFullScreenCalls() {`;
  if (!source.includes(marker)) throw new Error('Android runtime patch failed: call audio method marker');
  const methods = `    private void configureCallAudio(boolean active) {\n        if (audioManager == null) return;\n        try {\n            if (active) {\n                audioManager.setMode(AudioManager.MODE_IN_COMMUNICATION);\n                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {\n                    AudioAttributes attributes = new AudioAttributes.Builder()\n                        .setUsage(AudioAttributes.USAGE_VOICE_COMMUNICATION)\n                        .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)\n                        .build();\n                    callAudioFocusRequest = new AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT)\n                        .setAudioAttributes(attributes)\n                        .setAcceptsDelayedFocusGain(false)\n                        .setWillPauseWhenDucked(false)\n                        .build();\n                    audioManager.requestAudioFocus(callAudioFocusRequest);\n                } else {\n                    audioManager.requestAudioFocus(null, AudioManager.STREAM_VOICE_CALL, AudioManager.AUDIOFOCUS_GAIN_TRANSIENT);\n                }\n            } else {\n                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && callAudioFocusRequest != null) {\n                    audioManager.abandonAudioFocusRequest(callAudioFocusRequest);\n                    callAudioFocusRequest = null;\n                } else {\n                    audioManager.abandonAudioFocus(null);\n                }\n                audioManager.setMode(AudioManager.MODE_NORMAL);\n            }\n        } catch (Exception ignored) {}\n    }\n\n    private void deliverPendingNativeAnswer() {\n        if (!pendingNativeAutoAnswer || webView == null) return;\n        pendingNativeAutoAnswer = false;\n        BackgroundMessagingService.dismissIncomingCallNotification(this);\n        callJs("try{sessionStorage.setItem('itbird-native-answer-call','1')}catch(e){};"\n            + "window.dispatchEvent(new Event('itbird-native-answer-call')); ");\n    }\n\n    private void showWebFullscreen(View view, WebChromeClient.CustomViewCallback callback) {\n        if (view == null) return;\n        if (customFullscreenView != null) {\n            if (callback != null) callback.onCustomViewHidden();\n            return;\n        }\n        customFullscreenView = view;\n        customFullscreenCallback = callback;\n        if (webView != null) webView.setVisibility(View.GONE);\n        getWindow().getDecorView().setSystemUiVisibility(\n            View.SYSTEM_UI_FLAG_FULLSCREEN\n                | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION\n                | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY\n        );\n        addContentView(view, new ViewGroup.LayoutParams(\n            ViewGroup.LayoutParams.MATCH_PARENT,\n            ViewGroup.LayoutParams.MATCH_PARENT\n        ));\n    }\n\n    private void hideWebFullscreen() {\n        View current = customFullscreenView;\n        if (current == null) return;\n        if (current.getParent() instanceof ViewGroup) {\n            ((ViewGroup) current.getParent()).removeView(current);\n        }\n        customFullscreenView = null;\n        if (webView != null) webView.setVisibility(View.VISIBLE);\n        getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_VISIBLE);\n        WebChromeClient.CustomViewCallback callback = customFullscreenCallback;\n        customFullscreenCallback = null;\n        if (callback != null) callback.onCustomViewHidden();\n    }\n\n${marker}`;
  source = source.replace(marker, methods);
}

if (!source.includes('NATIVE_ANDROID_RUNTIME: answer-intent')) {
  replaceRequired(
    'new intent answer handling',
    `        Uri uri = intent != null ? intent.getData() : null;\n        if (intent != null && intent.getBooleanExtra("incoming_call", false)`,
    `        Uri uri = intent != null ? intent.getData() : null;\n        // NATIVE_ANDROID_RUNTIME: answer-intent\n        if (intent != null && intent.getBooleanExtra("answer_call", false)) {\n            pendingNativeAutoAnswer = true;\n            BackgroundMessagingService.dismissIncomingCallNotification(this);\n        }\n        if (intent != null && intent.getBooleanExtra("incoming_call", false)`,
  );

  replaceRequired(
    'new intent answer delivery',
    `        if (isTrustedUri(uri) && webView != null) webView.loadUrl(uri.toString());\n    }\n\n    @Override\n    protected void onResume()`,
    `        if (isTrustedUri(uri) && webView != null) webView.loadUrl(uri.toString());\n        if (pendingNativeAutoAnswer && webView != null) {\n            webView.postDelayed(this::deliverPendingNativeAnswer, 250L);\n        }\n    }\n\n    @Override\n    protected void onResume()`,
  );
}

if (!source.includes('NATIVE_ANDROID_RUNTIME: cleanup-runtime')) {
  replaceRequired(
    'runtime cleanup',
    `    protected void onDestroy() {\n        activityVisible = false;\n        pictureInPictureVisible = false;\n        stopScreenCapture(false);`,
    `    protected void onDestroy() {\n        activityVisible = false;\n        pictureInPictureVisible = false;\n        // NATIVE_ANDROID_RUNTIME: cleanup-runtime\n        configureCallAudio(false);\n        hideWebFullscreen();\n        stopScreenCapture(false);`,
  );
}

fs.writeFileSync(file, source, 'utf8');
console.log('Android native runtime lifecycle is current.');
