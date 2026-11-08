package uk.co.appsforus.yourfeed;

import android.content.pm.ActivityInfo;
import android.graphics.Color;
import android.os.Bundle;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.widget.FrameLayout;

import androidx.activity.OnBackPressedCallback;
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
                fullView = view;
                fullCallback = callback;
                ViewGroup decor = (ViewGroup) getWindow().getDecorView();
                decor.addView(view, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
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
        // Back while a video is full screen: leave full screen first
        exitFull = new OnBackPressedCallback(false) {
            @Override
            public void handleOnBackPressed() {
                leaveFullScreen();
            }
        };
        getOnBackPressedDispatcher().addCallback(this, exitFull);
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
    }
}
