package io.itbird.socialbird;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Person;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.ServiceInfo;
import android.media.AudioAttributes;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.Locale;
import java.util.concurrent.TimeUnit;

import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.Response;
import okhttp3.WebSocket;
import okhttp3.WebSocketListener;

/**
 * Native OS companion for the shared SocialBIRD web application.
 *
 * React/WebRTC remains the only interactive implementation. This service owns only
 * Android responsibilities that a background WebView cannot reliably provide:
 * persistent signalling awareness, system call/message notifications, ringing and
 * a wake lock while an accepted call is active.
 *
 * AUTH_NATIVE is deliberately notification-only. The service never consumes the
 * durable WebRTC offer/ICE queue; when the user opens/answers a call the global
 * React call host receives that queue and creates the same peer connection code used
 * on the website.
 */
public class BackgroundMessagingService extends Service {
    public static final String PREFS = "socialbird_native";
    public static final String PREF_AUTH_TOKEN = "auth_token";
    public static final String PREF_LANGUAGE = "language";

    public static final String ACTION_SYNC_AUTH = "io.itbird.socialbird.SYNC_AUTH";
    public static final String ACTION_DECLINE_CALL = "io.itbird.socialbird.DECLINE_CALL";
    public static final String ACTION_CALL_STATE = "io.itbird.socialbird.CALL_STATE";
    public static final String EXTRA_TOKEN = "token";
    public static final String EXTRA_CALL_JSON = "call_json";
    public static final String EXTRA_CALL_ACTIVE = "call_active";

    private static final String WS_URL = "wss://api.31.207.74.138.nip.io";
    private static final String CHANNEL_BACKGROUND = "socialbird_background";
    private static final String CHANNEL_CALLS = "socialbird_calls";
    private static final String CHANNEL_MESSAGES = "socialbird_messages";
    private static final int BACKGROUND_NOTIFICATION_ID = 4101;
    private static final int CALL_NOTIFICATION_ID = 4102;

    private final Handler handler = new Handler(Looper.getMainLooper());
    private OkHttpClient httpClient;
    private WebSocket socket;
    private boolean stopping = false;
    private int reconnectAttempt = 0;
    private String authToken = "";
    private JSONObject currentCall;
    private JSONObject pendingDecline;
    private PowerManager.WakeLock callWakeLock;

    public static void syncAuth(Context context, String token) {
        String normalized = token == null ? "" : token.trim();
        SharedPreferences prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        prefs.edit().putString(PREF_AUTH_TOKEN, normalized).apply();
        if (normalized.isEmpty()) {
            context.stopService(new Intent(context, BackgroundMessagingService.class));
            dismissIncomingCallNotification(context);
            return;
        }

        Intent intent = new Intent(context, BackgroundMessagingService.class)
            .setAction(ACTION_SYNC_AUTH)
            .putExtra(EXTRA_TOKEN, normalized);
        startCompat(context, intent);
    }

    public static void syncLanguage(Context context, String language) {
        String normalized = "en".equalsIgnoreCase(language) ? "en" : "ru";
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit()
            .putString(PREF_LANGUAGE, normalized)
            .apply();
    }

    public static void setCallActive(Context context, boolean active) {
        Intent intent = new Intent(context, BackgroundMessagingService.class)
            .setAction(ACTION_CALL_STATE)
            .putExtra(EXTRA_CALL_ACTIVE, active);
        startCompat(context, intent);
    }

    public static void restartIfAuthenticated(Context context) {
        String token = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .getString(PREF_AUTH_TOKEN, "");
        if (token == null || token.isBlank()) return;
        syncAuth(context, token);
    }

    public static void dismissIncomingCallNotification(Context context) {
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        if (manager != null) manager.cancel(CALL_NOTIFICATION_ID);
    }

    private static void startCompat(Context context, Intent intent) {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(intent);
            } else {
                context.startService(intent);
            }
        } catch (Exception ignored) {
            // Honor/other OEM power managers can block a background launch after the
            // process has been force-stopped. The next Activity resume re-syncs auth.
        }
    }

    @Override
    public void onCreate() {
        super.onCreate();
        createNotificationChannels();
        httpClient = new OkHttpClient.Builder()
            .pingInterval(20, TimeUnit.SECONDS)
            .connectTimeout(15, TimeUnit.SECONDS)
            .readTimeout(0, TimeUnit.MILLISECONDS)
            .retryOnConnectionFailure(true)
            .build();
        startForegroundCompat(buildBackgroundNotification(false));
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String action = intent != null ? intent.getAction() : null;
        if (ACTION_DECLINE_CALL.equals(action)) {
            String callJson = intent.getStringExtra(EXTRA_CALL_JSON);
            if (callJson != null && !callJson.isBlank()) {
                try {
                    pendingDecline = new JSONObject(callJson);
                    sendPendingDecline();
                } catch (Exception ignored) {}
            }
            currentCall = null;
            cancelCallNotification();
        } else if (ACTION_CALL_STATE.equals(action)) {
            setCallWakeLock(intent.getBooleanExtra(EXTRA_CALL_ACTIVE, false));
            updateBackgroundNotification();
        }

        String suppliedToken = intent != null ? intent.getStringExtra(EXTRA_TOKEN) : null;
        if (suppliedToken != null) authToken = suppliedToken.trim();
        if (authToken.isEmpty()) {
            authToken = getSharedPreferences(PREFS, MODE_PRIVATE).getString(PREF_AUTH_TOKEN, "");
            if (authToken == null) authToken = "";
        }

        if (authToken.isBlank()) {
            stopping = true;
            stopSelf();
            return START_NOT_STICKY;
        }

        stopping = false;
        ensureConnected();
        return START_STICKY;
    }

    private void startForegroundCompat(Notification notification) {
        if (Build.VERSION.SDK_INT >= 34) {
            startForeground(
                BACKGROUND_NOTIFICATION_ID,
                notification,
                ServiceInfo.FOREGROUND_SERVICE_TYPE_REMOTE_MESSAGING
            );
        } else {
            startForeground(BACKGROUND_NOTIFICATION_ID, notification);
        }
    }

    private void ensureConnected() {
        if (socket != null || stopping || authToken.isBlank()) return;
        Request request = new Request.Builder().url(WS_URL).build();
        socket = httpClient.newWebSocket(request, new WebSocketListener() {
            @Override
            public void onOpen(WebSocket webSocket, Response response) {
                reconnectAttempt = 0;
                try {
                    JSONObject auth = new JSONObject();
                    auth.put("type", "AUTH_NATIVE");
                    auth.put("token", authToken);
                    auth.put("platform", "android");
                    auth.put("appVersion", BuildConfig.VERSION_NAME);
                    webSocket.send(auth.toString());
                    sendPendingDecline();
                } catch (Exception ignored) {}
            }

            @Override
            public void onMessage(WebSocket webSocket, String text) {
                handleMessage(text);
            }

            @Override
            public void onClosed(WebSocket webSocket, int code, String reason) {
                if (socket == webSocket) socket = null;
                scheduleReconnect();
            }

            @Override
            public void onFailure(WebSocket webSocket, Throwable error, Response response) {
                if (socket == webSocket) socket = null;
                scheduleReconnect();
            }
        });
    }

    private void scheduleReconnect() {
        if (stopping || authToken.isBlank()) return;
        reconnectAttempt = Math.min(reconnectAttempt + 1, 6);
        long delay = Math.min(30000L, (1L << reconnectAttempt) * 1000L);
        handler.removeCallbacks(reconnectRunnable);
        handler.postDelayed(reconnectRunnable, delay);
    }

    private final Runnable reconnectRunnable = this::ensureConnected;

    private void handleMessage(String text) {
        try {
            JSONObject payload = new JSONObject(text);
            String type = payload.optString("type", "");
            JSONObject data = payload.optJSONObject("data");
            if (data == null) data = new JSONObject();

            switch (type) {
                case "CALL_INVITE":
                    currentCall = data;
                    if (!MainActivity.isVisible()) showIncomingCall(data);
                    break;
                case "CALL_HANGUP":
                    currentCall = null;
                    cancelCallNotification();
                    setCallWakeLock(false);
                    break;
                case "NEW_MESSAGE":
                case "NEW_GROUP_MESSAGE":
                case "GROUP_MENTION":
                case "NEW_FORUM_ANSWER":
                case "FRIEND_REQUEST_CREATED":
                case "NEW_GROUP_CHAT":
                case "NEW_GROUP_MEMBER":
                    if (!MainActivity.isVisible()) showMessageNotification(type, data);
                    break;
                default:
                    break;
            }
        } catch (Exception ignored) {
            // Foreground React remains authoritative for malformed/unknown messages.
        }
    }

    private void sendPendingDecline() {
        JSONObject call = pendingDecline;
        WebSocket activeSocket = socket;
        if (call == null || activeSocket == null) return;
        try {
            int callerId = call.optInt("senderId", 0);
            if (callerId <= 0) {
                pendingDecline = null;
                return;
            }
            JSONObject payload = new JSONObject();
            payload.put("type", "CALL_HANGUP");
            payload.put("targetIds", new JSONArray().put(callerId));
            payload.put("data", call);
            if (activeSocket.send(payload.toString())) pendingDecline = null;
        } catch (Exception ignored) {}
    }

    private void createNotificationChannels() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager manager = getSystemService(NotificationManager.class);
        if (manager == null) return;

        NotificationChannel background = new NotificationChannel(
            CHANNEL_BACKGROUND,
            "SocialBIRD в фоне",
            NotificationManager.IMPORTANCE_LOW
        );
        background.setDescription("Поддерживает входящие звонки и уведомления SocialBIRD");
        background.setShowBadge(false);

        NotificationChannel calls = new NotificationChannel(
            CHANNEL_CALLS,
            "Входящие звонки",
            NotificationManager.IMPORTANCE_HIGH
        );
        calls.setDescription("Входящие голосовые и видеозвонки SocialBIRD");
        calls.enableVibration(true);
        Uri ringtone = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE);
        AudioAttributes attributes = new AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE)
            .build();
        calls.setSound(ringtone, attributes);
        calls.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);

        NotificationChannel messages = new NotificationChannel(
            CHANNEL_MESSAGES,
            "Сообщения SocialBIRD",
            NotificationManager.IMPORTANCE_DEFAULT
        );
        messages.setDescription("Сообщения, упоминания, заявки в друзья и ответы форума");

        manager.createNotificationChannel(background);
        manager.createNotificationChannel(calls);
        manager.createNotificationChannel(messages);
    }

    private Notification buildBackgroundNotification(boolean inCall) {
        boolean ru = isRussian();
        Intent openIntent = new Intent(this, MainActivity.class)
            .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent openPending = PendingIntent.getActivity(
            this,
            4201,
            openIntent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        Notification.Builder builder = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
            ? new Notification.Builder(this, CHANNEL_BACKGROUND)
            : new Notification.Builder(this);
        builder
            .setSmallIcon(android.R.drawable.ic_menu_info_details)
            .setContentTitle("SocialBIRD")
            .setContentText(inCall
                ? (ru ? "Звонок активен" : "Call is active")
                : (ru ? "Готов принимать звонки и сообщения" : "Ready for calls and messages"))
            .setContentIntent(openPending)
            .setOngoing(true)
            .setCategory(Notification.CATEGORY_SERVICE)
            .setShowWhen(false);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            builder.setForegroundServiceBehavior(Notification.FOREGROUND_SERVICE_IMMEDIATE);
        }
        return builder.build();
    }

    private void updateBackgroundNotification() {
        NotificationManager manager = getSystemService(NotificationManager.class);
        if (manager != null) {
            manager.notify(BACKGROUND_NOTIFICATION_ID, buildBackgroundNotification(isCallWakeLockHeld()));
        }
    }

    private void showIncomingCall(JSONObject call) {
        NotificationManager manager = getSystemService(NotificationManager.class);
        if (manager == null) return;

        boolean ru = isRussian();
        String callerName = firstNonBlank(
            call.optString("callerName", ""),
            call.optString("fromName", ""),
            call.optString("title", ""),
            ru ? "Пользователь SocialBIRD" : "SocialBIRD user"
        );
        boolean video = "video".equalsIgnoreCase(call.optString("callKind", "voice"));
        String route = callRoute(call);

        // Opening the notification/full-screen ringing UI must NOT accept the call.
        // Only the explicit Answer action sets answer_call=true.
        Intent ringIntent = buildOpenIntent(route)
            .putExtra("incoming_call", true);
        PendingIntent ringPending = PendingIntent.getActivity(
            this,
            4300,
            ringIntent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        Intent answerIntent = buildOpenIntent(route)
            .putExtra("incoming_call", true)
            .putExtra("answer_call", true);
        PendingIntent answerPending = PendingIntent.getActivity(
            this,
            4301,
            answerIntent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        Intent declineIntent = new Intent(this, BackgroundMessagingService.class)
            .setAction(ACTION_DECLINE_CALL)
            .putExtra(EXTRA_CALL_JSON, call.toString());
        PendingIntent declinePending = PendingIntent.getService(
            this,
            4302,
            declineIntent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        Notification.Builder builder = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
            ? new Notification.Builder(this, CHANNEL_CALLS)
            : new Notification.Builder(this);
        builder
            .setSmallIcon(android.R.drawable.ic_menu_call)
            .setContentTitle(video
                ? (ru ? "Входящий видеозвонок" : "Incoming video call")
                : (ru ? "Входящий голосовой звонок" : "Incoming voice call"))
            .setContentText(callerName)
            .setContentIntent(ringPending)
            .setFullScreenIntent(ringPending, true)
            .setCategory(Notification.CATEGORY_CALL)
            .setVisibility(Notification.VISIBILITY_PUBLIC)
            .setPriority(Notification.PRIORITY_MAX)
            .setOngoing(true)
            .setAutoCancel(false)
            .setTimeoutAfter(150000L);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            Person caller = new Person.Builder().setName(callerName).setImportant(true).build();
            builder.setStyle(Notification.CallStyle.forIncomingCall(caller, declinePending, answerPending));
        } else {
            builder.addAction(new Notification.Action.Builder(
                android.R.drawable.ic_menu_close_clear_cancel,
                ru ? "Отклонить" : "Decline",
                declinePending
            ).build());
            builder.addAction(new Notification.Action.Builder(
                android.R.drawable.ic_menu_call,
                ru ? "Ответить" : "Answer",
                answerPending
            ).build());
        }

        manager.notify(CALL_NOTIFICATION_ID, builder.build());
    }

    private void showMessageNotification(String type, JSONObject data) {
        NotificationManager manager = getSystemService(NotificationManager.class);
        if (manager == null) return;
        boolean ru = isRussian();

        String title;
        String body;
        String route;
        switch (type) {
            case "NEW_MESSAGE":
                title = ru ? "Новое личное сообщение" : "New private message";
                body = firstNonBlank(data.optString("username", ""), ru ? "Пользователь" : "User")
                    + ": " + firstNonBlank(data.optString("message", ""), ru ? "Файл" : "File");
                route = "/chats/" + data.optString("chat_id", "");
                break;
            case "NEW_GROUP_MESSAGE":
                title = ru ? "Новое сообщение в группе" : "New group message";
                body = firstNonBlank(data.optString("username", ""), ru ? "Участник" : "Member")
                    + ": " + firstNonBlank(data.optString("message", ""), ru ? "Файл" : "File");
                route = "/group-chats/" + data.optString("group_chat_id", "");
                break;
            case "GROUP_MENTION":
                title = data.optBoolean("mentionEveryone", false)
                    ? (ru ? "Упоминание @everyone" : "@everyone mention")
                    : (ru ? "Вас упомянули" : "You were mentioned");
                body = firstNonBlank(data.optString("username", ""), ru ? "Участник" : "Member")
                    + ": " + firstNonBlank(data.optString("message", ""), ru ? "Сообщение" : "Message");
                route = "/group-chats/" + data.optString("group_chat_id", "");
                break;
            case "FRIEND_REQUEST_CREATED":
                JSONObject request = data.optJSONObject("request");
                title = ru ? "Новая заявка в друзья" : "New friend request";
                body = firstNonBlank(request != null ? request.optString("user_name", "") : "", ru ? "Пользователь" : "User")
                    + (ru ? " хочет добавить вас в друзья" : " wants to add you as a friend");
                route = "/friend-requests";
                break;
            case "NEW_FORUM_ANSWER":
                title = ru ? "Новый ответ на форуме" : "New forum answer";
                body = firstNonBlank(data.optString("forumTitle", ""), ru ? "Откройте вопрос" : "Open the question");
                route = "/forums/" + data.optString("forum_id", "") + "/answers";
                break;
            case "NEW_GROUP_CHAT":
            case "NEW_GROUP_MEMBER":
                JSONObject chat = data.optJSONObject("chat");
                String chatId = chat != null ? chat.optString("id", "") : data.optString("chatId", "");
                title = ru ? "Вас добавили в группу" : "You were added to a group";
                body = chat != null ? firstNonBlank(chat.optString("name", ""), title) : title;
                route = "/group-chats/" + chatId;
                break;
            default:
                return;
        }

        Intent openIntent = buildOpenIntent(route);
        int requestCode = Math.abs((type + route).hashCode());
        PendingIntent pending = PendingIntent.getActivity(
            this,
            requestCode,
            openIntent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        Notification.Builder builder = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
            ? new Notification.Builder(this, CHANNEL_MESSAGES)
            : new Notification.Builder(this);
        builder
            .setSmallIcon(android.R.drawable.ic_dialog_email)
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(new Notification.BigTextStyle().bigText(body))
            .setContentIntent(pending)
            .setAutoCancel(true)
            .setCategory(Notification.CATEGORY_MESSAGE)
            .setPriority(Notification.PRIORITY_HIGH);
        manager.notify(5000 + (requestCode % 100000), builder.build());
    }

    private Intent buildOpenIntent(String route) {
        String normalized = route == null || route.isBlank() ? "/" : route;
        if (!normalized.startsWith("/")) normalized = "/" + normalized;
        return new Intent(this, MainActivity.class)
            .setData(Uri.parse("https://socialbird.31.207.74.138.nip.io" + normalized))
            .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_NEW_TASK);
    }

    private String callRoute(JSONObject call) {
        String chatId = call.optString("chatId", "");
        if ("group".equalsIgnoreCase(call.optString("mode", "private"))) {
            return "/group-chats/" + chatId;
        }
        return "/chats/" + chatId;
    }

    private void cancelCallNotification() {
        dismissIncomingCallNotification(this);
    }

    private void setCallWakeLock(boolean active) {
        if (!active) {
            if (callWakeLock != null && callWakeLock.isHeld()) callWakeLock.release();
            callWakeLock = null;
            return;
        }
        if (isCallWakeLockHeld()) return;
        PowerManager power = (PowerManager) getSystemService(POWER_SERVICE);
        if (power == null) return;
        callWakeLock = power.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "SocialBIRD:ActiveCall");
        callWakeLock.setReferenceCounted(false);
        callWakeLock.acquire(8 * 60 * 60 * 1000L);
    }

    private boolean isCallWakeLockHeld() {
        return callWakeLock != null && callWakeLock.isHeld();
    }

    private boolean isRussian() {
        String language = getSharedPreferences(PREFS, MODE_PRIVATE).getString(PREF_LANGUAGE, "");
        if ("en".equalsIgnoreCase(language)) return false;
        if ("ru".equalsIgnoreCase(language)) return true;
        return Locale.getDefault().getLanguage().equalsIgnoreCase("ru");
    }

    private static String firstNonBlank(String... values) {
        for (String value : values) {
            if (value != null && !value.isBlank()) return value;
        }
        return "";
    }

    @Override
    public void onDestroy() {
        stopping = true;
        handler.removeCallbacks(reconnectRunnable);
        if (socket != null) {
            try { socket.close(1000, "service stopped"); } catch (Exception ignored) {}
            socket = null;
        }
        if (httpClient != null) {
            httpClient.dispatcher().executorService().shutdown();
            httpClient.connectionPool().evictAll();
        }
        setCallWakeLock(false);
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
