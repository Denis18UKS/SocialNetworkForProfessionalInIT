package io.itbird.socialbird;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Person;
import android.content.Intent;
import android.media.AudioAttributes;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Build;

import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;

import org.json.JSONObject;

import java.util.Map;

/**
 * True Android push entry point. FCM can start this service while the WebView and
 * the persistent WebSocket process are absent. It only presents Android UI; once
 * the user answers/opens the notification the existing React/WebRTC call host owns
 * the interactive call exactly like on the website.
 */
public class SocialBirdFirebaseMessagingService extends FirebaseMessagingService {
    private static final String SITE_ORIGIN = "https://socialbird.ru";
    private static final String CHANNEL_CALLS = "socialbird_calls";
    private static final String CHANNEL_MESSAGES = "socialbird_messages";
    private static final int CALL_NOTIFICATION_ID = 4102;

    @Override
    public void onNewToken(String token) {
        super.onNewToken(token);
        NativePushRegistrar.updateDeviceToken(this, token);
    }

    @Override
    public void onMessageReceived(RemoteMessage message) {
        super.onMessageReceived(message);
        Map<String, String> data = message.getData();
        String type = value(data, "type", "");
        if (type.isBlank()) return;

        createChannels();
        if ("CALL_HANGUP".equals(type)) {
            BackgroundMessagingService.dismissIncomingCallNotification(this);
            return;
        }

        // Foreground React already receives the same targeted event over WebSocket.
        // Suppressing FCM UI here prevents duplicate message/call cards.
        if (MainActivity.isVisible()) return;

        if ("CALL_INVITE".equals(type)) {
            showIncomingCall(data);
        } else {
            showMessageNotification(data);
        }
    }

    private void createChannels() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager manager = getSystemService(NotificationManager.class);
        if (manager == null) return;

        NotificationChannel calls = new NotificationChannel(
            CHANNEL_CALLS,
            "Входящие звонки",
            NotificationManager.IMPORTANCE_HIGH
        );
        calls.setDescription("Push-звонки SocialBIRD");
        calls.enableVibration(true);
        calls.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
        Uri ringtone = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE);
        calls.setSound(ringtone, new AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE)
            .build());

        NotificationChannel messages = new NotificationChannel(
            CHANNEL_MESSAGES,
            "Уведомления SocialBIRD",
            NotificationManager.IMPORTANCE_HIGH
        );
        messages.setDescription("Сообщения, упоминания, друзья и форум");
        messages.enableVibration(true);

        manager.createNotificationChannel(calls);
        manager.createNotificationChannel(messages);
    }

    private void showIncomingCall(Map<String, String> data) {
        NotificationManager manager = getSystemService(NotificationManager.class);
        if (manager == null) return;

        JSONObject payload = parsePayload(data);
        String route = value(data, "route", "/");
        String title = value(data, "title", "Входящий звонок SocialBIRD");
        String body = value(data, "body", "Входящий голосовой звонок");
        boolean video = "video".equalsIgnoreCase(payload.optString("callKind", "voice"));
        String callerName = payload.optString("callerName", "");
        if (callerName.isBlank()) callerName = title.replace(" звонит", "").trim();
        if (callerName.isBlank()) callerName = "SocialBIRD";

        Intent ringIntent = buildOpenIntent(route)
            .putExtra("incoming_call", true);
        PendingIntent ringPending = PendingIntent.getActivity(
            this,
            5300,
            ringIntent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        Intent answerIntent = buildOpenIntent(route)
            .putExtra("incoming_call", true)
            .putExtra("answer_call", true);
        PendingIntent answerPending = PendingIntent.getActivity(
            this,
            5301,
            answerIntent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        Intent declineIntent = new Intent(this, BackgroundMessagingService.class)
            .setAction(BackgroundMessagingService.ACTION_DECLINE_CALL)
            .putExtra(BackgroundMessagingService.EXTRA_CALL_JSON, payload.toString());
        PendingIntent declinePending = PendingIntent.getService(
            this,
            5302,
            declineIntent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        Notification.Builder builder = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
            ? new Notification.Builder(this, CHANNEL_CALLS)
            : new Notification.Builder(this);

        builder
            .setSmallIcon(android.R.drawable.ic_menu_call)
            .setContentTitle(video ? "Входящий видеозвонок" : "Входящий голосовой звонок")
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
                "Отклонить",
                declinePending
            ).build());
            builder.addAction(new Notification.Action.Builder(
                android.R.drawable.ic_menu_call,
                "Ответить",
                answerPending
            ).build());
        }

        manager.notify(CALL_NOTIFICATION_ID, builder.build());
    }

    private void showMessageNotification(Map<String, String> data) {
        NotificationManager manager = getSystemService(NotificationManager.class);
        if (manager == null) return;

        String title = value(data, "title", "SocialBIRD");
        String body = value(data, "body", "Новое уведомление");
        String route = value(data, "route", "/");
        Intent openIntent = buildOpenIntent(route);
        int requestCode = 6000 + Math.abs((title + route + body).hashCode() % 100000);
        PendingIntent openPending = PendingIntent.getActivity(
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
            .setContentIntent(openPending)
            .setCategory(Notification.CATEGORY_MESSAGE)
            .setVisibility(Notification.VISIBILITY_PRIVATE)
            .setPriority(Notification.PRIORITY_HIGH)
            .setAutoCancel(true);
        manager.notify(requestCode, builder.build());
    }

    private Intent buildOpenIntent(String route) {
        String normalized = route == null || route.isBlank() ? "/" : route;
        if (!normalized.startsWith("/")) normalized = "/" + normalized;
        return new Intent(this, MainActivity.class)
            .setData(Uri.parse(SITE_ORIGIN + normalized))
            .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_NEW_TASK);
    }

    private static JSONObject parsePayload(Map<String, String> data) {
        try {
            String encoded = value(data, "payload_json", "{}");
            return new JSONObject(encoded);
        } catch (Exception ignored) {
            return new JSONObject();
        }
    }

    private static String value(Map<String, String> data, String key, String fallback) {
        if (data == null) return fallback;
        String value = data.get(key);
        return value == null || value.isBlank() ? fallback : value;
    }
}
