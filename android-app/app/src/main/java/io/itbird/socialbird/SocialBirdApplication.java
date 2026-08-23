package io.itbird.socialbird;

import android.app.Application;

import com.google.firebase.FirebaseApp;
import com.google.firebase.FirebaseOptions;
import com.google.firebase.messaging.FirebaseMessaging;

/**
 * Initializes the native Android push transport. The React website remains the
 * single application UI and WebRTC implementation; Firebase is used only to wake
 * Android and show OS notifications/call UI while the WebView is not running.
 */
public class SocialBirdApplication extends Application {
    @Override
    public void onCreate() {
        super.onCreate();

        if (!hasFirebaseConfig()) return;

        try {
            if (FirebaseApp.getApps(this).isEmpty()) {
                FirebaseOptions options = new FirebaseOptions.Builder()
                    .setProjectId(BuildConfig.FIREBASE_PROJECT_ID)
                    .setApplicationId(BuildConfig.FIREBASE_APP_ID)
                    .setApiKey(BuildConfig.FIREBASE_API_KEY)
                    .setGcmSenderId(BuildConfig.FIREBASE_SENDER_ID)
                    .build();
                FirebaseApp.initializeApp(this, options);
            }

            FirebaseMessaging.getInstance().setAutoInitEnabled(true);
            FirebaseMessaging.getInstance().getToken()
                .addOnSuccessListener(token -> NativePushRegistrar.updateDeviceToken(this, token));
        } catch (Exception ignored) {
            // The app still works as the full SocialBIRD website if Firebase has not
            // been configured correctly yet. /native-push/status exposes server state.
        }
    }

    public static boolean hasFirebaseConfig() {
        return !BuildConfig.FIREBASE_PROJECT_ID.isBlank()
            && !BuildConfig.FIREBASE_APP_ID.isBlank()
            && !BuildConfig.FIREBASE_API_KEY.isBlank()
            && !BuildConfig.FIREBASE_SENDER_ID.isBlank();
    }
}
