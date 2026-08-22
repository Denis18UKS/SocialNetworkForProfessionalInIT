package io.itbird.socialbird;

import android.app.Activity;
import android.app.Application;
import android.os.Bundle;
import android.webkit.CookieManager;

/**
 * Small native lifecycle adapter shared by every Android entry point.
 *
 * The React/WebRTC app remains the single call implementation. Android only
 * records OS actions (for example tapping "Answer" on a system call
 * notification) in the first-party SocialBIRD cookie jar. The React bridge
 * consumes that one-shot action after the WebView is ready.
 */
public class SocialBirdApplication extends Application implements Application.ActivityLifecycleCallbacks {
    private static final String SITE_ORIGIN = "https://socialbird.31.207.74.138.nip.io";
    private static final String NATIVE_ANSWER_COOKIE = "itbird_native_answer=1; Path=/; Secure; SameSite=Strict";

    @Override
    public void onCreate() {
        super.onCreate();
        registerActivityLifecycleCallbacks(this);
    }

    @Override
    public void onActivityResumed(Activity activity) {
        if (!(activity instanceof MainActivity)) return;
        if (activity.getIntent() == null || !activity.getIntent().getBooleanExtra("incoming_call", false)) return;

        activity.getIntent().removeExtra("incoming_call");
        try {
            CookieManager cookies = CookieManager.getInstance();
            cookies.setAcceptCookie(true);
            cookies.setCookie(SITE_ORIGIN, NATIVE_ANSWER_COOKIE);
            cookies.flush();
        } catch (Exception ignored) {
            // The in-app incoming-call dialog is still available as a fallback.
        }
    }

    @Override public void onActivityCreated(Activity activity, Bundle savedInstanceState) {}
    @Override public void onActivityStarted(Activity activity) {}
    @Override public void onActivityPaused(Activity activity) {}
    @Override public void onActivityStopped(Activity activity) {}
    @Override public void onActivitySaveInstanceState(Activity activity, Bundle outState) {}
    @Override public void onActivityDestroyed(Activity activity) {}
}
