package io.itbird.socialbird;

import android.app.Activity;
import android.content.Intent;
import android.media.AudioDeviceInfo;
import android.media.AudioManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;

/**
 * Tiny no-UI Android bridge for call audio routing. The WebView invokes the
 * socialbird-call:// URI, MainActivity forwards non-http URLs through ACTION_VIEW,
 * and this Activity changes the Android communication route without owning WebRTC.
 */
public class CallControlActivity extends Activity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        handle(getIntent());
        finish();
        overridePendingTransition(0, 0);
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handle(intent);
        finish();
        overridePendingTransition(0, 0);
    }

    private void handle(Intent intent) {
        Uri uri = intent != null ? intent.getData() : null;
        if (uri == null || !"socialbird-call".equalsIgnoreCase(uri.getScheme())) return;
        String command = uri.getHost();
        if (command == null || command.isBlank()) command = uri.getPath();
        if (command == null) return;
        command = command.replace("/", "").trim();

        if ("speaker".equalsIgnoreCase(command)) {
            setSpeaker("1".equals(uri.getQueryParameter("enabled"))
                || "true".equalsIgnoreCase(uri.getQueryParameter("enabled")));
        } else if ("active".equalsIgnoreCase(command)) {
            setCallMode("1".equals(uri.getQueryParameter("enabled"))
                || "true".equalsIgnoreCase(uri.getQueryParameter("enabled")));
        }
    }

    private void setCallMode(boolean active) {
        AudioManager manager = (AudioManager) getSystemService(AUDIO_SERVICE);
        if (manager == null) return;
        try {
            manager.setMode(active ? AudioManager.MODE_IN_COMMUNICATION : AudioManager.MODE_NORMAL);
            if (!active && Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                manager.clearCommunicationDevice();
            }
        } catch (Exception ignored) {}
    }

    private void setSpeaker(boolean enabled) {
        AudioManager manager = (AudioManager) getSystemService(AUDIO_SERVICE);
        if (manager == null) return;
        try {
            manager.setMode(AudioManager.MODE_IN_COMMUNICATION);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                AudioDeviceInfo selected = null;
                for (AudioDeviceInfo device : manager.getAvailableCommunicationDevices()) {
                    if (enabled && device.getType() == AudioDeviceInfo.TYPE_BUILTIN_SPEAKER) {
                        selected = device;
                        break;
                    }
                    if (!enabled && device.getType() == AudioDeviceInfo.TYPE_BUILTIN_EARPIECE) {
                        selected = device;
                        break;
                    }
                }
                if (selected != null) manager.setCommunicationDevice(selected);
                else if (!enabled) manager.clearCommunicationDevice();
            } else {
                manager.setSpeakerphoneOn(enabled);
            }
        } catch (Exception ignored) {}
    }
}
