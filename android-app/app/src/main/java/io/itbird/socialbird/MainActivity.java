package io.itbird.socialbird;

import android.Manifest;
import android.app.Activity;
import android.app.DownloadManager;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Bitmap;
import android.graphics.PixelFormat;
import android.hardware.display.DisplayManager;
import android.hardware.display.VirtualDisplay;
import android.media.AudioAttributes;
import android.media.AudioFormat;
import android.media.AudioPlaybackCaptureConfiguration;
import android.media.AudioRecord;
import android.media.Image;
import android.media.ImageReader;
import android.media.projection.MediaProjection;
import android.media.projection.MediaProjectionManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.os.Handler;
import android.os.HandlerThread;
import android.os.Process;
import android.util.Base64;
import android.util.DisplayMetrics;
import android.view.ViewGroup;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.URLUtil;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.Toast;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.nio.ByteBuffer;
import java.util.ArrayList;
import java.util.List;

public class MainActivity extends Activity {
    private static final String SITE_ORIGIN = "https://socialbird.31.207.74.138.nip.io";
    private static final String SITE_HOST = "socialbird.31.207.74.138.nip.io";
    private static final int REQUEST_WEB_MEDIA = 3001;
    private static final int REQUEST_FILE_CHOOSER = 3002;
    private static final int REQUEST_SCREEN_CAPTURE = 3003;
    private static final long FRAME_INTERVAL_MS = 100L;
    private static final int MAX_CAPTURE_WIDTH = 720;
    private static final int PLAYBACK_SAMPLE_RATE = 48000;
    private static final int PLAYBACK_CHANNELS = 2;

    private WebView webView;
    private PermissionRequest pendingWebPermissionRequest;
    private ValueCallback<Uri[]> fileChooserCallback;
    private MediaProjectionManager projectionManager;
    private MediaProjection mediaProjection;
    private VirtualDisplay virtualDisplay;
    private ImageReader imageReader;
    private HandlerThread captureThread;
    private Handler captureHandler;
    private AudioRecord playbackAudioRecord;
    private HandlerThread playbackAudioThread;
    private volatile boolean playbackAudioActive = false;
    private long lastFrameAt = 0L;
    private boolean screenCaptureActive = false;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        projectionManager = (MediaProjectionManager) getSystemService(Context.MEDIA_PROJECTION_SERVICE);

        FrameLayout root = new FrameLayout(this);
        webView = new WebView(this);
        root.addView(webView, new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.MATCH_PARENT
        ));
        setContentView(root);

        configureWebView();
        Uri deepLink = getIntent() != null ? getIntent().getData() : null;
        webView.loadUrl(isTrustedUri(deepLink) ? deepLink.toString() : SITE_ORIGIN);
    }

    private void configureWebView() {
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setAllowFileAccess(true);
        settings.setAllowContentAccess(true);
        settings.setBuiltInZoomControls(false);
        settings.setDisplayZoomControls(false);
        settings.setUserAgentString(settings.getUserAgentString() + " SocialBIRDAndroid/1.0.0");

        CookieManager cookieManager = CookieManager.getInstance();
        cookieManager.setAcceptCookie(true);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            cookieManager.setAcceptThirdPartyCookies(webView, false);
        }

        webView.addJavascriptInterface(new NativeBridge(), "ITBirdAndroid");

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if (isTrustedUri(uri)) return false;
                openExternal(uri);
                return true;
            }

            @Override
            public void onPageStarted(WebView view, String url, Bitmap favicon) {
                super.onPageStarted(view, url, favicon);
                if (!url.startsWith(SITE_ORIGIN)) stopScreenCapture(true);
            }
        });

        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onPermissionRequest(PermissionRequest request) {
                runOnUiThread(() -> handleWebPermissionRequest(request));
            }

            @Override
            public void onPermissionRequestCanceled(PermissionRequest request) {
                if (pendingWebPermissionRequest == request) pendingWebPermissionRequest = null;
            }

            @Override
            public boolean onShowFileChooser(
                WebView webView,
                ValueCallback<Uri[]> filePathCallback,
                FileChooserParams fileChooserParams
            ) {
                if (fileChooserCallback != null) fileChooserCallback.onReceiveValue(null);
                fileChooserCallback = filePathCallback;
                Intent intent = fileChooserParams.createIntent();
                try {
                    startActivityForResult(intent, REQUEST_FILE_CHOOSER);
                } catch (Exception error) {
                    fileChooserCallback = null;
                    Toast.makeText(MainActivity.this, "Не удалось открыть выбор файла", Toast.LENGTH_SHORT).show();
                    return false;
                }
                return true;
            }
        });

        webView.setDownloadListener((url, userAgent, contentDisposition, mimeType, contentLength) -> {
            try {
                DownloadManager.Request request = new DownloadManager.Request(Uri.parse(url));
                request.setMimeType(mimeType);
                request.addRequestHeader("User-Agent", userAgent);
                String cookies = CookieManager.getInstance().getCookie(url);
                if (cookies != null) request.addRequestHeader("Cookie", cookies);
                request.setTitle(URLUtil.guessFileName(url, contentDisposition, mimeType));
                request.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
                request.setDestinationInExternalPublicDir(
                    Environment.DIRECTORY_DOWNLOADS,
                    URLUtil.guessFileName(url, contentDisposition, mimeType)
                );
                DownloadManager manager = (DownloadManager) getSystemService(DOWNLOAD_SERVICE);
                manager.enqueue(request);
                Toast.makeText(this, "Файл скачивается", Toast.LENGTH_SHORT).show();
            } catch (Exception error) {
                openExternal(Uri.parse(url));
            }
        });
    }

    private boolean isTrustedUri(Uri uri) {
        return uri != null
            && "https".equalsIgnoreCase(uri.getScheme())
            && SITE_HOST.equalsIgnoreCase(uri.getHost());
    }

    private void openExternal(Uri uri) {
        if (uri == null) return;
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, uri));
        } catch (Exception error) {
            Toast.makeText(this, "Не удалось открыть ссылку", Toast.LENGTH_SHORT).show();
        }
    }

    private void handleWebPermissionRequest(PermissionRequest request) {
        if (!isTrustedUri(request.getOrigin())) {
            request.deny();
            return;
        }

        List<String> androidPermissions = new ArrayList<>();
        for (String resource : request.getResources()) {
            if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(resource)
                && checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
                androidPermissions.add(Manifest.permission.RECORD_AUDIO);
            }
            if (PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(resource)
                && checkSelfPermission(Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
                androidPermissions.add(Manifest.permission.CAMERA);
            }
        }

        if (androidPermissions.isEmpty()) {
            request.grant(request.getResources());
            return;
        }

        pendingWebPermissionRequest = request;
        requestPermissions(androidPermissions.toArray(new String[0]), REQUEST_WEB_MEDIA);
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode != REQUEST_WEB_MEDIA || pendingWebPermissionRequest == null) return;

        boolean granted = grantResults.length > 0;
        for (int result : grantResults) granted &= result == PackageManager.PERMISSION_GRANTED;
        if (granted) pendingWebPermissionRequest.grant(pendingWebPermissionRequest.getResources());
        else pendingWebPermissionRequest.deny();
        pendingWebPermissionRequest = null;
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);

        if (requestCode == REQUEST_FILE_CHOOSER) {
            ValueCallback<Uri[]> callback = fileChooserCallback;
            fileChooserCallback = null;
            if (callback != null) callback.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(resultCode, data));
            return;
        }

        if (requestCode == REQUEST_SCREEN_CAPTURE) {
            if (resultCode != RESULT_OK || data == null) {
                callJs("window.__itbirdNativeScreenStopped && window.__itbirdNativeScreenStopped();");
                return;
            }

            stopScreenCapture(false);
            startProjectionForegroundService();
            final Intent projectionData = data;
            waitForProjectionService(resultCode, projectionData, 0);
        }
    }

    private void startProjectionForegroundService() {
        Intent serviceIntent = new Intent(this, MediaProjectionService.class);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) startForegroundService(serviceIntent);
        else startService(serviceIntent);
    }

    private void waitForProjectionService(int resultCode, Intent data, int attempt) {
        if (MediaProjectionService.isForegroundReady()) {
            beginMediaProjection(resultCode, data);
            return;
        }
        if (attempt >= 40) {
            stopService(new Intent(this, MediaProjectionService.class));
            callJs("window.__itbirdNativeScreenError && window.__itbirdNativeScreenError('Android не успел запустить службу MediaProjection');");
            return;
        }
        webView.postDelayed(() -> waitForProjectionService(resultCode, data, attempt + 1), 50L);
    }

    private void beginMediaProjection(int resultCode, Intent data) {
        try {
            mediaProjection = projectionManager.getMediaProjection(resultCode, data);
            if (mediaProjection == null) throw new IllegalStateException("MediaProjection unavailable");

            mediaProjection.registerCallback(new MediaProjection.Callback() {
                @Override
                public void onStop() {
                    runOnUiThread(() -> stopScreenCapture(true));
                }
            }, new Handler(getMainLooper()));

            DisplayMetrics metrics = new DisplayMetrics();
            getWindowManager().getDefaultDisplay().getRealMetrics(metrics);
            int sourceWidth = Math.max(2, metrics.widthPixels);
            int sourceHeight = Math.max(2, metrics.heightPixels);
            float scale = sourceWidth > MAX_CAPTURE_WIDTH ? ((float) MAX_CAPTURE_WIDTH / sourceWidth) : 1f;
            int captureWidth = Math.max(2, Math.round(sourceWidth * scale));
            int captureHeight = Math.max(2, Math.round(sourceHeight * scale));

            imageReader = ImageReader.newInstance(captureWidth, captureHeight, PixelFormat.RGBA_8888, 2);
            captureThread = new HandlerThread("SocialBIRDScreenCapture");
            captureThread.start();
            captureHandler = new Handler(captureThread.getLooper());
            imageReader.setOnImageAvailableListener(reader -> handleCapturedImage(reader, captureWidth, captureHeight), captureHandler);

            virtualDisplay = mediaProjection.createVirtualDisplay(
                "SocialBIRD-ScreenShare",
                captureWidth,
                captureHeight,
                metrics.densityDpi,
                DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR,
                imageReader.getSurface(),
                null,
                captureHandler
            );

            screenCaptureActive = true;
            lastFrameAt = 0L;
            boolean playbackAudioSupported = startPlaybackAudioCapture();
            callJs("window.__itbirdNativeScreenStarted && window.__itbirdNativeScreenStarted("
                + captureWidth + "," + captureHeight + ",10," + (playbackAudioSupported ? "true" : "false") + ");");
        } catch (Exception error) {
            stopScreenCapture(false);
            callJs("window.__itbirdNativeScreenError && window.__itbirdNativeScreenError("
                + JSONObject.quote("Не удалось запустить MediaProjection: " + error.getMessage()) + ");");
        }
    }

    private boolean startPlaybackAudioCapture() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q || mediaProjection == null) return false;
        if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) return false;

        try {
            AudioPlaybackCaptureConfiguration configuration =
                new AudioPlaybackCaptureConfiguration.Builder(mediaProjection)
                    .addMatchingUsage(AudioAttributes.USAGE_MEDIA)
                    .addMatchingUsage(AudioAttributes.USAGE_GAME)
                    .addMatchingUsage(AudioAttributes.USAGE_UNKNOWN)
                    .excludeUid(Process.myUid())
                    .build();

            AudioFormat format = new AudioFormat.Builder()
                .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                .setSampleRate(PLAYBACK_SAMPLE_RATE)
                .setChannelMask(AudioFormat.CHANNEL_IN_STEREO)
                .build();

            int minimum = AudioRecord.getMinBufferSize(
                PLAYBACK_SAMPLE_RATE,
                AudioFormat.CHANNEL_IN_STEREO,
                AudioFormat.ENCODING_PCM_16BIT
            );
            int bufferSize = Math.max(8192, minimum > 0 ? minimum * 2 : 8192);

            playbackAudioRecord = new AudioRecord.Builder()
                .setAudioFormat(format)
                .setBufferSizeInBytes(bufferSize)
                .setAudioPlaybackCaptureConfig(configuration)
                .build();

            if (playbackAudioRecord.getState() != AudioRecord.STATE_INITIALIZED) {
                playbackAudioRecord.release();
                playbackAudioRecord = null;
                return false;
            }

            playbackAudioRecord.startRecording();
            playbackAudioActive = true;
            playbackAudioThread = new HandlerThread("SocialBIRDPlaybackAudio");
            playbackAudioThread.start();
            Handler handler = new Handler(playbackAudioThread.getLooper());
            AudioRecord activeRecord = playbackAudioRecord;
            handler.post(() -> pumpPlaybackAudio(activeRecord));
            return true;
        } catch (Exception error) {
            stopPlaybackAudioCapture();
            return false;
        }
    }

    private void pumpPlaybackAudio(AudioRecord record) {
        byte[] buffer = new byte[4096];
        while (playbackAudioActive && record == playbackAudioRecord) {
            int read;
            try {
                read = record.read(buffer, 0, buffer.length, AudioRecord.READ_BLOCKING);
            } catch (Exception error) {
                break;
            }
            if (read <= 0) continue;

            String encoded = Base64.encodeToString(buffer, 0, read, Base64.NO_WRAP);
            callJs("window.__itbirdNativeScreenAudio && window.__itbirdNativeScreenAudio("
                + JSONObject.quote(encoded) + "," + PLAYBACK_SAMPLE_RATE + "," + PLAYBACK_CHANNELS + ");");
        }
    }

    private void stopPlaybackAudioCapture() {
        playbackAudioActive = false;
        if (playbackAudioRecord != null) {
            AudioRecord record = playbackAudioRecord;
            playbackAudioRecord = null;
            try { record.stop(); } catch (Exception ignored) {}
            try { record.release(); } catch (Exception ignored) {}
        }
        if (playbackAudioThread != null) {
            playbackAudioThread.quitSafely();
            playbackAudioThread = null;
        }
    }

    private void handleCapturedImage(ImageReader reader, int captureWidth, int captureHeight) {
        Image image = null;
        try {
            image = reader.acquireLatestImage();
            if (image == null || !screenCaptureActive) return;
            long now = System.currentTimeMillis();
            if (now - lastFrameAt < FRAME_INTERVAL_MS) return;
            lastFrameAt = now;

            Image.Plane plane = image.getPlanes()[0];
            ByteBuffer buffer = plane.getBuffer();
            int pixelStride = plane.getPixelStride();
            int rowStride = plane.getRowStride();
            int rowPadding = rowStride - pixelStride * captureWidth;
            int paddedWidth = captureWidth + Math.max(0, rowPadding / Math.max(1, pixelStride));

            Bitmap padded = Bitmap.createBitmap(paddedWidth, captureHeight, Bitmap.Config.ARGB_8888);
            padded.copyPixelsFromBuffer(buffer);
            Bitmap cropped = Bitmap.createBitmap(padded, 0, 0, captureWidth, captureHeight);
            padded.recycle();

            ByteArrayOutputStream output = new ByteArrayOutputStream();
            cropped.compress(Bitmap.CompressFormat.JPEG, 58, output);
            cropped.recycle();

            String encoded = Base64.encodeToString(output.toByteArray(), Base64.NO_WRAP);
            String dataUrl = "data:image/jpeg;base64," + encoded;
            callJs("window.__itbirdNativeScreenFrame && window.__itbirdNativeScreenFrame("
                + JSONObject.quote(dataUrl) + "," + captureWidth + "," + captureHeight + ");");
        } catch (Exception ignored) {
            // A later frame can recover automatically.
        } finally {
            if (image != null) image.close();
        }
    }

    private void stopScreenCapture(boolean notifyWeb) {
        boolean wasActive = screenCaptureActive || mediaProjection != null || virtualDisplay != null;
        screenCaptureActive = false;
        stopPlaybackAudioCapture();

        if (virtualDisplay != null) {
            virtualDisplay.release();
            virtualDisplay = null;
        }
        if (imageReader != null) {
            imageReader.close();
            imageReader = null;
        }
        if (mediaProjection != null) {
            MediaProjection projection = mediaProjection;
            mediaProjection = null;
            try { projection.stop(); } catch (Exception ignored) {}
        }
        if (captureThread != null) {
            captureThread.quitSafely();
            captureThread = null;
            captureHandler = null;
        }

        stopService(new Intent(this, MediaProjectionService.class));
        if (notifyWeb && wasActive) {
            callJs("window.__itbirdNativeScreenStopped && window.__itbirdNativeScreenStopped();");
        }
    }

    private void callJs(String script) {
        if (webView == null) return;
        runOnUiThread(() -> webView.evaluateJavascript(script, null));
    }

    private final class NativeBridge {
        @JavascriptInterface
        public boolean isNativeApp() {
            return true;
        }

        @JavascriptInterface
        public String getVersion() {
            return "1.0.0";
        }

        @JavascriptInterface
        public void requestScreenShare() {
            runOnUiThread(() -> {
                if (projectionManager == null) {
                    callJs("window.__itbirdNativeScreenError && window.__itbirdNativeScreenError('MediaProjection недоступен');");
                    return;
                }
                Intent intent = projectionManager.createScreenCaptureIntent();
                startActivityForResult(intent, REQUEST_SCREEN_CAPTURE);
            });
        }

        @JavascriptInterface
        public void stopScreenShare() {
            runOnUiThread(() -> stopScreenCapture(false));
        }
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        Uri uri = intent != null ? intent.getData() : null;
        if (isTrustedUri(uri) && webView != null) webView.loadUrl(uri.toString());
    }

    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) webView.goBack();
        else super.onBackPressed();
    }

    @Override
    protected void onDestroy() {
        stopScreenCapture(false);
        if (fileChooserCallback != null) fileChooserCallback.onReceiveValue(null);
        fileChooserCallback = null;
        if (webView != null) {
            webView.removeJavascriptInterface("ITBirdAndroid");
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }
}
