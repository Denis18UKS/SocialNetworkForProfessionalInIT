package io.itbird.socialbird;

import android.app.Activity;
import android.app.AlertDialog;
import android.app.DownloadManager;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.view.View;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;
import android.widget.Toast;

import org.json.JSONObject;

import java.io.InputStream;
import java.security.MessageDigest;
import java.util.Locale;
import java.util.concurrent.TimeUnit;

import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.Response;

/**
 * Native sideload updater for SocialBIRD.
 *
 * The web UI stays server-driven and normally updates without an APK. This manager
 * only gates users when a newer native Android shell is published on android-latest.
 */
public final class NativeUpdateManager {
    // NATIVE_FORCED_UPDATE_V1: stable-release-manifest
    private static final String UPDATE_MANIFEST_URL =
        "https://github.com/Denis18UKS/SocialNetworkForProfessionalInIT/releases/download/android-latest/SocialBIRD-Android-version.json";
    private static final String DEFAULT_APK_URL =
        "https://github.com/Denis18UKS/SocialNetworkForProfessionalInIT/releases/download/android-latest/SocialBIRD-Android.apk";
    private static final String APK_MIME = "application/vnd.android.package-archive";
    private static final long PROGRESS_POLL_MS = 450L;

    private final Activity activity;
    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private final DownloadManager downloadManager;
    private final OkHttpClient httpClient = new OkHttpClient.Builder()
        .connectTimeout(10, TimeUnit.SECONDS)
        .readTimeout(20, TimeUnit.SECONDS)
        .followRedirects(true)
        .followSslRedirects(true)
        .build();

    private AlertDialog updateDialog;
    private ProgressBar progressBar;
    private TextView statusText;
    private UpdateInfo activeUpdate;
    private long downloadId = -1L;
    private Uri pendingInstallUri;
    private boolean receiverRegistered = false;
    private boolean destroyed = false;
    private boolean launchDelivered = false;
    private Runnable launchCallback;
    private int currentVersionCode = 0;

    private final BroadcastReceiver downloadReceiver = new BroadcastReceiver() {
        @Override
        public void onReceive(Context context, Intent intent) {
            if (!DownloadManager.ACTION_DOWNLOAD_COMPLETE.equals(intent.getAction())) return;
            long completedId = intent.getLongExtra(DownloadManager.EXTRA_DOWNLOAD_ID, -1L);
            if (completedId != downloadId) return;
            handleDownloadComplete();
        }
    };

    private final Runnable progressPoller = new Runnable() {
        @Override
        public void run() {
            if (destroyed || downloadId <= 0L) return;
            DownloadState state = queryDownload(downloadId);
            if (state == null) {
                mainHandler.postDelayed(this, PROGRESS_POLL_MS);
                return;
            }
            if (state.totalBytes > 0L && progressBar != null) {
                int percent = (int) Math.max(0L, Math.min(100L, (state.downloadedBytes * 100L) / state.totalBytes));
                progressBar.setIndeterminate(false);
                progressBar.setProgress(percent);
                setStatus("Скачиваем обновление… " + percent + "%");
            } else if (progressBar != null) {
                progressBar.setIndeterminate(true);
                setStatus("Скачиваем обновление…");
            }

            if (state.status == DownloadManager.STATUS_FAILED) {
                failDownload("Не удалось скачать обновление. Нажмите «Обновить» и повторите попытку.");
                return;
            }
            if (state.status == DownloadManager.STATUS_SUCCESSFUL) return;
            mainHandler.postDelayed(this, PROGRESS_POLL_MS);
        }
    };

    public NativeUpdateManager(Activity activity) {
        this.activity = activity;
        this.downloadManager = (DownloadManager) activity.getSystemService(Context.DOWNLOAD_SERVICE);
        registerDownloadReceiver();
    }

    /**
     * Checks android-latest before the WebView becomes visible. Network/manifest
     * failures fail open so a GitHub outage cannot brick SocialBIRD.
     */
    public void checkBeforeLaunch(int installedVersionCode, Runnable onAllowed) {
        currentVersionCode = installedVersionCode;
        launchCallback = onAllowed;
        fetchUpdateManifest();
    }

    public void onResume() {
        if (destroyed || pendingInstallUri == null) return;
        if (canRequestPackageInstalls()) {
            Uri uri = pendingInstallUri;
            pendingInstallUri = null;
            launchInstaller(uri);
        }
    }

    public void destroy() {
        destroyed = true;
        mainHandler.removeCallbacks(progressPoller);
        if (receiverRegistered) {
            try {
                activity.unregisterReceiver(downloadReceiver);
            } catch (Exception ignored) {}
            receiverRegistered = false;
        }
        if (updateDialog != null) {
            try { updateDialog.dismiss(); } catch (Exception ignored) {}
            updateDialog = null;
        }
    }

    private void registerDownloadReceiver() {
        if (receiverRegistered) return;
        IntentFilter filter = new IntentFilter(DownloadManager.ACTION_DOWNLOAD_COMPLETE);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            activity.registerReceiver(downloadReceiver, filter, Context.RECEIVER_EXPORTED);
        } else {
            activity.registerReceiver(downloadReceiver, filter);
        }
        receiverRegistered = true;
    }

    private void fetchUpdateManifest() {
        new Thread(() -> {
            UpdateInfo info;
            try {
                Request request = new Request.Builder()
                    .url(UPDATE_MANIFEST_URL + "?t=" + System.currentTimeMillis())
                    .header("Cache-Control", "no-cache")
                    .build();
                try (Response response = httpClient.newCall(request).execute()) {
                    if (!response.isSuccessful() || response.body() == null) {
                        throw new IllegalStateException("HTTP " + response.code());
                    }
                    JSONObject json = new JSONObject(response.body().string());
                    int latestVersionCode = json.optInt("versionCode", 0);
                    if (latestVersionCode <= 0) throw new IllegalStateException("Invalid versionCode");
                    info = new UpdateInfo(
                        latestVersionCode,
                        json.optString("versionName", String.valueOf(latestVersionCode)),
                        json.optInt("minSupportedVersionCode", latestVersionCode),
                        json.optBoolean("forceUpdate", true),
                        json.optString("apkUrl", DEFAULT_APK_URL),
                        normalizeSha256(json.optString("sha256", ""))
                    );
                }
            } catch (Exception error) {
                mainHandler.post(this::allowLaunch);
                return;
            }

            UpdateInfo resolved = info;
            mainHandler.post(() -> handleUpdateInfo(resolved));
        }, "SocialBIRD-UpdateCheck").start();
    }

    private void handleUpdateInfo(UpdateInfo info) {
        if (destroyed) return;
        if (info.versionCode <= currentVersionCode) {
            allowLaunch();
            return;
        }

        activeUpdate = info;
        boolean mandatory = currentVersionCode < info.minSupportedVersionCode || info.forceUpdate;
        if (mandatory) {
            showUpdateDialog(info, true);
            return;
        }

        allowLaunch();
        showUpdateDialog(info, false);
    }

    private void allowLaunch() {
        if (destroyed || launchDelivered) return;
        launchDelivered = true;
        Runnable callback = launchCallback;
        launchCallback = null;
        if (callback != null) callback.run();
    }

    private void showUpdateDialog(UpdateInfo info, boolean mandatory) {
        if (destroyed || activity.isFinishing()) return;
        if (updateDialog != null && updateDialog.isShowing()) return;

        int pad = Math.round(20f * activity.getResources().getDisplayMetrics().density);
        LinearLayout content = new LinearLayout(activity);
        content.setOrientation(LinearLayout.VERTICAL);
        content.setPadding(pad, Math.round(8f * activity.getResources().getDisplayMetrics().density), pad, 0);

        TextView description = new TextView(activity);
        description.setText(
            (mandatory ? "Эта версия SocialBIRD больше не поддерживается. " : "Доступна новая версия SocialBIRD. ")
                + "Установлена: " + BuildConfig.VERSION_NAME
                + "\nНовая: " + info.versionName
                + (mandatory ? "\n\nДля продолжения необходимо обновить приложение." : "")
        );
        description.setTextSize(15f);
        content.addView(description);

        statusText = new TextView(activity);
        statusText.setText(mandatory ? "Обновление обязательно." : "Можно обновить сейчас или позже.");
        statusText.setTextSize(13f);
        statusText.setPadding(0, pad / 2, 0, pad / 2);
        content.addView(statusText);

        progressBar = new ProgressBar(activity, null, android.R.attr.progressBarStyleHorizontal);
        progressBar.setMax(100);
        progressBar.setProgress(0);
        progressBar.setVisibility(View.GONE);
        content.addView(progressBar, new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT,
            LinearLayout.LayoutParams.WRAP_CONTENT
        ));

        AlertDialog.Builder builder = new AlertDialog.Builder(activity)
            .setTitle(mandatory ? "Требуется обновление SocialBIRD" : "Доступно обновление SocialBIRD")
            .setView(content)
            .setPositiveButton("Обновить", null)
            .setCancelable(!mandatory);

        if (!mandatory) {
            builder.setNegativeButton("Позже", (dialog, which) -> dialog.dismiss());
        }

        updateDialog = builder.create();
        updateDialog.setCanceledOnTouchOutside(false);
        updateDialog.setOnShowListener(dialog -> updateDialog.getButton(AlertDialog.BUTTON_POSITIVE)
            .setOnClickListener(view -> startDownload(info)));
        updateDialog.setOnDismissListener(dialog -> {
            if (!mandatory) {
                updateDialog = null;
                progressBar = null;
                statusText = null;
            }
        });
        updateDialog.show();
    }

    private void startDownload(UpdateInfo info) {
        if (destroyed || downloadManager == null || downloadId > 0L) return;
        if (info.sha256.length() != 64) {
            setStatus("Сервер обновлений не вернул контрольную сумму APK. Установка отменена для безопасности.");
            return;
        }

        try {
            String fileName = "SocialBIRD-Android-" + info.versionCode + ".apk";
            DownloadManager.Request request = new DownloadManager.Request(Uri.parse(info.apkUrl));
            request.setMimeType(APK_MIME);
            request.setTitle("Обновление SocialBIRD " + info.versionName);
            request.setDescription("Загрузка новой версии приложения");
            request.setAllowedOverMetered(true);
            request.setAllowedOverRoaming(false);
            request.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE);
            request.setDestinationInExternalFilesDir(activity, Environment.DIRECTORY_DOWNLOADS, fileName);

            downloadId = downloadManager.enqueue(request);
            activeUpdate = info;
            if (progressBar != null) {
                progressBar.setVisibility(View.VISIBLE);
                progressBar.setIndeterminate(true);
            }
            if (updateDialog != null) {
                updateDialog.getButton(AlertDialog.BUTTON_POSITIVE).setEnabled(false);
            }
            setStatus("Скачиваем обновление…");
            mainHandler.removeCallbacks(progressPoller);
            mainHandler.post(progressPoller);
        } catch (Exception error) {
            failDownload("Не удалось запустить загрузку: " + safeMessage(error));
        }
    }

    private DownloadState queryDownload(long id) {
        if (downloadManager == null || id <= 0L) return null;
        Cursor cursor = null;
        try {
            DownloadManager.Query query = new DownloadManager.Query().setFilterById(id);
            cursor = downloadManager.query(query);
            if (cursor == null || !cursor.moveToFirst()) return null;
            int status = cursor.getInt(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS));
            long downloaded = cursor.getLong(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_BYTES_DOWNLOADED_SO_FAR));
            long total = cursor.getLong(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_TOTAL_SIZE_BYTES));
            return new DownloadState(status, downloaded, total);
        } catch (Exception ignored) {
            return null;
        } finally {
            if (cursor != null) cursor.close();
        }
    }

    private void handleDownloadComplete() {
        mainHandler.removeCallbacks(progressPoller);
        DownloadState state = queryDownload(downloadId);
        if (state == null || state.status != DownloadManager.STATUS_SUCCESSFUL) {
            failDownload("Загрузка обновления завершилась ошибкой. Повторите попытку.");
            return;
        }

        Uri apkUri = downloadManager.getUriForDownloadedFile(downloadId);
        if (apkUri == null || activeUpdate == null) {
            failDownload("Android не смог открыть загруженный APK.");
            return;
        }

        if (progressBar != null) {
            progressBar.setIndeterminate(true);
            progressBar.setProgress(100);
        }
        setStatus("Проверяем целостность обновления…");

        UpdateInfo info = activeUpdate;
        new Thread(() -> {
            boolean valid = verifySha256(apkUri, info.sha256);
            mainHandler.post(() -> {
                if (destroyed) return;
                if (!valid) {
                    try { downloadManager.remove(downloadId); } catch (Exception ignored) {}
                    failDownload("Контрольная сумма APK не совпала. Повреждённый файл удалён.");
                    return;
                }
                setStatus("APK проверен. Подготавливаем установку…");
                installApk(apkUri);
            });
        }, "SocialBIRD-UpdateVerify").start();
    }

    private boolean verifySha256(Uri uri, String expectedSha256) {
        try (InputStream input = activity.getContentResolver().openInputStream(uri)) {
            if (input == null) return false;
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            byte[] buffer = new byte[64 * 1024];
            int read;
            while ((read = input.read(buffer)) >= 0) {
                if (read > 0) digest.update(buffer, 0, read);
            }
            StringBuilder actual = new StringBuilder(64);
            for (byte value : digest.digest()) actual.append(String.format(Locale.US, "%02x", value & 0xff));
            return actual.toString().equalsIgnoreCase(expectedSha256);
        } catch (Exception ignored) {
            return false;
        }
    }

    private void installApk(Uri apkUri) {
        if (!canRequestPackageInstalls()) {
            pendingInstallUri = apkUri;
            setStatus("Разрешите SocialBIRD устанавливать обновления, затем вернитесь в приложение.");
            try {
                Intent settings = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES)
                    .setData(Uri.parse("package:" + activity.getPackageName()));
                activity.startActivity(settings);
            } catch (Exception error) {
                Toast.makeText(activity, "Разрешите установку приложений из SocialBIRD в настройках Android", Toast.LENGTH_LONG).show();
            }
            return;
        }
        launchInstaller(apkUri);
    }

    private boolean canRequestPackageInstalls() {
        return Build.VERSION.SDK_INT < Build.VERSION_CODES.O
            || activity.getPackageManager().canRequestPackageInstalls();
    }

    private void launchInstaller(Uri apkUri) {
        try {
            Intent install = new Intent(Intent.ACTION_INSTALL_PACKAGE)
                .setData(apkUri)
                .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            setStatus("Нажмите «Установить» в системном окне Android. После обновления ваши данные сохранятся.");
            activity.startActivity(install);
        } catch (Exception error) {
            try {
                Intent fallback = new Intent(Intent.ACTION_VIEW)
                    .setDataAndType(apkUri, APK_MIME)
                    .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                activity.startActivity(fallback);
            } catch (Exception ignored) {
                failDownload("Не удалось открыть системный установщик Android.");
            }
        }
    }

    private void failDownload(String message) {
        mainHandler.removeCallbacks(progressPoller);
        downloadId = -1L;
        if (progressBar != null) {
            progressBar.setIndeterminate(false);
            progressBar.setProgress(0);
            progressBar.setVisibility(View.GONE);
        }
        if (updateDialog != null) {
            updateDialog.getButton(AlertDialog.BUTTON_POSITIVE).setEnabled(true);
        }
        setStatus(message);
    }

    private void setStatus(String message) {
        if (statusText != null) statusText.setText(message);
    }

    private static String normalizeSha256(String value) {
        String normalized = value == null ? "" : value.trim().toLowerCase(Locale.US);
        if (normalized.startsWith("sha256:")) normalized = normalized.substring("sha256:".length());
        return normalized.replaceAll("[^0-9a-f]", "");
    }

    private static String safeMessage(Exception error) {
        String message = error == null ? null : error.getMessage();
        return message == null || message.isBlank() ? "неизвестная ошибка" : message;
    }

    private static final class UpdateInfo {
        final int versionCode;
        final String versionName;
        final int minSupportedVersionCode;
        final boolean forceUpdate;
        final String apkUrl;
        final String sha256;

        UpdateInfo(int versionCode, String versionName, int minSupportedVersionCode, boolean forceUpdate, String apkUrl, String sha256) {
            this.versionCode = versionCode;
            this.versionName = versionName;
            this.minSupportedVersionCode = minSupportedVersionCode;
            this.forceUpdate = forceUpdate;
            this.apkUrl = apkUrl == null || apkUrl.isBlank() ? DEFAULT_APK_URL : apkUrl;
            this.sha256 = sha256 == null ? "" : sha256;
        }
    }

    private static final class DownloadState {
        final int status;
        final long downloadedBytes;
        final long totalBytes;

        DownloadState(int status, long downloadedBytes, long totalBytes) {
            this.status = status;
            this.downloadedBytes = downloadedBytes;
            this.totalBytes = totalBytes;
        }
    }
}
