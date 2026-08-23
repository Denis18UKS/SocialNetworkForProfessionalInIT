package io.itbird.socialbird;

import android.content.Context;
import android.content.SharedPreferences;

import com.google.firebase.messaging.FirebaseMessaging;

import org.json.JSONObject;

import java.io.IOException;
import java.util.concurrent.TimeUnit;

import okhttp3.Call;
import okhttp3.Callback;
import okhttp3.MediaType;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;

/** Keeps one Android FCM token attached to the same JWT session as the website. */
public final class NativePushRegistrar {
    private static final String API_ORIGIN = "https://api.socialbird.ru";
    private static final String PREF_PUSH_AUTH = "native_push_auth";
    private static final String PREF_DEVICE_TOKEN = "native_push_device_token";
    private static final MediaType JSON = MediaType.get("application/json; charset=utf-8");
    private static final OkHttpClient HTTP = new OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(20, TimeUnit.SECONDS)
        .retryOnConnectionFailure(true)
        .build();

    private NativePushRegistrar() {}

    public static void syncAuth(Context context, String token) {
        if (!SocialBirdApplication.hasFirebaseConfig()) return;
        Context appContext = context.getApplicationContext();
        SharedPreferences prefs = appContext.getSharedPreferences(BackgroundMessagingService.PREFS, Context.MODE_PRIVATE);
        String normalized = token == null ? "" : token.trim();
        String previousAuth = prefs.getString(PREF_PUSH_AUTH, "");
        String previousDeviceToken = prefs.getString(PREF_DEVICE_TOKEN, "");

        if (normalized.isBlank()) {
            if (previousAuth != null && !previousAuth.isBlank() && previousDeviceToken != null && !previousDeviceToken.isBlank()) {
                unregister(appContext, previousAuth, previousDeviceToken);
            }
            prefs.edit().remove(PREF_PUSH_AUTH).apply();
            return;
        }

        prefs.edit().putString(PREF_PUSH_AUTH, normalized).apply();
        FirebaseMessaging.getInstance().getToken()
            .addOnSuccessListener(deviceToken -> updateDeviceToken(appContext, deviceToken));
    }

    public static void updateDeviceToken(Context context, String deviceToken) {
        if (!SocialBirdApplication.hasFirebaseConfig()) return;
        String normalized = deviceToken == null ? "" : deviceToken.trim();
        if (normalized.isBlank()) return;

        Context appContext = context.getApplicationContext();
        SharedPreferences prefs = appContext.getSharedPreferences(BackgroundMessagingService.PREFS, Context.MODE_PRIVATE);
        prefs.edit().putString(PREF_DEVICE_TOKEN, normalized).apply();
        String auth = prefs.getString(PREF_PUSH_AUTH, "");
        if (auth == null || auth.isBlank()) {
            auth = prefs.getString(BackgroundMessagingService.PREF_AUTH_TOKEN, "");
        }
        if (auth == null || auth.isBlank()) return;
        register(appContext, auth, normalized);
    }

    private static void register(Context context, String auth, String deviceToken) {
        try {
            JSONObject payload = new JSONObject();
            payload.put("deviceToken", deviceToken);
            payload.put("appVersion", BuildConfig.VERSION_NAME);
            Request request = new Request.Builder()
                .url(API_ORIGIN + "/native-push/register")
                .header("Authorization", "Bearer " + auth)
                .post(RequestBody.create(payload.toString(), JSON))
                .build();
            HTTP.newCall(request).enqueue(new Callback() {
                @Override public void onFailure(Call call, IOException error) {}
                @Override public void onResponse(Call call, Response response) { response.close(); }
            });
        } catch (Exception ignored) {}
    }

    private static void unregister(Context context, String auth, String deviceToken) {
        try {
            JSONObject payload = new JSONObject();
            payload.put("deviceToken", deviceToken);
            Request request = new Request.Builder()
                .url(API_ORIGIN + "/native-push/register")
                .header("Authorization", "Bearer " + auth)
                .delete(RequestBody.create(payload.toString(), JSON))
                .build();
            HTTP.newCall(request).enqueue(new Callback() {
                @Override public void onFailure(Call call, IOException error) {}
                @Override public void onResponse(Call call, Response response) { response.close(); }
            });
        } catch (Exception ignored) {}
    }
}
