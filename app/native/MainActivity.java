package uk.co.appsforus.yourfeed;

import android.content.pm.ActivityInfo;
import android.graphics.Color;
import android.os.Bundle;
import android.view.MotionEvent;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.widget.FrameLayout;

import androidx.activity.OnBackPressedCallback;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebChromeClient;

// YourFeed: lets videos played inside the app go full screen, turning the phone to landscape
// (Capacitor's own web view closes full-screen video straight away). Copied in by the Android build.
public class MainActivity extends BridgeActivity {
    private View fullView;
    private WebChromeClient.CustomViewCallback fullCallback;
    private OnBackPressedCallback exitFull;
    // Set by the page before a video plays: short clips (mostly Shorts) stay upright in full screen
    private volatile boolean rotateFull = true;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        if (bridge == null) return;
        bridge.getWebView().addJavascriptInterface(new Object() {
            @JavascriptInterface
            public void setRotateFull(boolean landscape) { rotateFull = landscape; }

            // The page's background colour for Android's status and navigation bars, so they match the app
            @JavascriptInterface
            public void setBars(String hex, boolean dark) {
                final int c;
                try { c = Color.parseColor(hex); } catch (IllegalArgumentException e) { return; }
                runOnUiThread(() -> {
                    getWindow().getDecorView().setBackgroundColor(c);
                    getWindow().setStatusBarColor(c);
                    getWindow().setNavigationBarColor(c);
                    WindowInsetsControllerCompat bars = new WindowInsetsControllerCompat(getWindow(), getWindow().getDecorView());
                    bars.setAppearanceLightStatusBars(!dark);
                    bars.setAppearanceLightNavigationBars(!dark);
                });
            }
        }, "YFNative");
        bridge.getWebView().setWebChromeClient(new BridgeWebChromeClient(bridge) {
            @Override
            public void onShowCustomView(View view, CustomViewCallback callback) {
                if (fullView != null) { callback.onCustomViewHidden(); return; }
                fullCallback = callback;
                ViewGroup decor = (ViewGroup) getWindow().getDecorView();
                // The video sits in a frame that can be dragged down to close it
                FrameLayout frame = new DragToClose();
                frame.setBackgroundColor(Color.BLACK);
                frame.addView(view, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
                fullView = frame;
                decor.addView(frame, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
                bridge.getWebView().evaluateJavascript("window.yfVideoEnter && window.yfVideoEnter()", null);
                WindowInsetsControllerCompat bars = new WindowInsetsControllerCompat(getWindow(), decor);
                bars.setSystemBarsBehavior(WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
                bars.hide(WindowInsetsCompat.Type.systemBars());
                if (rotateFull) setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE);
                exitFull.setEnabled(true);
            }

            @Override
            public void onHideCustomView() {
                leaveFullScreen();
            }
        });
        // The keyboard: Android 15 draws apps edge to edge, so it would cover the page instead of shrinking it.
        // Pad the app by the keyboard's height (less the navigation bar the page already sits above),
        // so the page gets smaller and boxes can be scrolled into view above the keyboard.
        final View content = findViewById(android.R.id.content);
        ViewCompat.setOnApplyWindowInsetsListener(content, (v, insets) -> {
            int ime = insets.getInsets(WindowInsetsCompat.Type.ime()).bottom;
            int nav = insets.getInsets(WindowInsetsCompat.Type.navigationBars()).bottom;
            int pad = Math.max(0, ime - nav);
            if (v.getPaddingBottom() != pad) v.setPadding(0, 0, 0, pad);
            return insets;
        });
        // Back while a video is full screen: leave full screen first
        exitFull = new OnBackPressedCallback(false) {
            @Override
            public void handleOnBackPressed() {
                leaveFullScreen();
            }
        };
        getOnBackPressedDispatcher().addCallback(this, exitFull);
    }

    // Full-screen video frame: a firm downward drag closes it (taps and sideways swipes still reach the player)
    private class DragToClose extends FrameLayout {
        private float startX, startY;
        private boolean dragging;
        DragToClose() { super(MainActivity.this); }

        @Override
        public boolean onInterceptTouchEvent(MotionEvent ev) {
            switch (ev.getActionMasked()) {
                case MotionEvent.ACTION_DOWN:
                    startX = ev.getRawX(); startY = ev.getRawY(); dragging = false;
                    return false;
                case MotionEvent.ACTION_MOVE:
                    float dy = ev.getRawY() - startY, dx = Math.abs(ev.getRawX() - startX);
                    if (dy > 48 * getResources().getDisplayMetrics().density && dy > dx * 2) { dragging = true; return true; }
                    return false;
                default:
                    return false;
            }
        }

        @Override
        public boolean onTouchEvent(MotionEvent ev) {
            if (!dragging) return ev.getActionMasked() == MotionEvent.ACTION_DOWN;
            float dy = Math.max(0, ev.getRawY() - startY), h = Math.max(1, getHeight());
            switch (ev.getActionMasked()) {
                case MotionEvent.ACTION_MOVE:
                    setTranslationY(dy);
                    setAlpha(Math.max(0.35f, 1f - dy / h));
                    return true;
                case MotionEvent.ACTION_UP:
                    if (dy > h * 0.18f) { leaveFullScreen(); }
                    else { animate().translationY(0).alpha(1f).setDuration(180).start(); }
                    dragging = false;
                    return true;
                case MotionEvent.ACTION_CANCEL:
                    animate().translationY(0).alpha(1f).setDuration(180).start();
                    dragging = false;
                    return true;
            }
            return true;
        }
    }

    private void leaveFullScreen() {
        if (fullView == null) return;
        ViewGroup decor = (ViewGroup) getWindow().getDecorView();
        decor.removeView(fullView);
        fullView = null;
        new WindowInsetsControllerCompat(getWindow(), decor).show(WindowInsetsCompat.Type.systemBars());
        setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED);
        if (exitFull != null) exitFull.setEnabled(false);
        if (fullCallback != null) { fullCallback.onCustomViewHidden(); fullCallback = null; }
        // Tell the page: it pauses the video and scrolls back to where you were
        bridge.getWebView().evaluateJavascript("window.yfVideoExit && window.yfVideoExit()", null);
    }
}
