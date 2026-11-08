package io.github.jofr.capacitor.mediasessionplugin;

import android.content.Intent;
import android.support.v4.media.session.MediaSessionCompat;
import android.view.KeyEvent;

import com.getcapacitor.JSObject;

public class MediaSessionCallback extends MediaSessionCompat.Callback {
    private static final String TAG = "MediaSessionCallback";

    private final MediaSessionPlugin plugin;

    MediaSessionCallback(MediaSessionPlugin plugin) {
        this.plugin = plugin;
    }

    @Override
    public void onPlay() {
        plugin.actionCallback("play");
    }

    @Override
    public void onPause() {
        plugin.actionCallback("pause");
    }

    @Override
    public void onSeekTo(long pos) {
        JSObject data = new JSObject();
        data.put("seekTime", (double) pos/1000.0);
        plugin.actionCallback("seekto", data);
    }

    @Override
    public void onRewind() {
        plugin.actionCallback("seekbackward");
    }

    @Override
    public void onFastForward() {
        plugin.actionCallback("seekforward");
    }

    @Override
    public void onSkipToPrevious() {
        plugin.actionCallback("previoustrack");
    }

    @Override
    public void onSkipToNext() {
        plugin.actionCallback("nexttrack");
    }

    @Override
    public void onCustomAction(String action, android.os.Bundle extras) {
        // YourFeed fork: back/forward buttons in Android's system media controls
        if ("seekbackward".equals(action) || "seekforward".equals(action)) {
            plugin.actionCallback(action);
        }
    }

    // YourFeed fork: headphone and car "next"/"previous" buttons skip forward/back within the episode.
    // Android only passes them on if the session offers next/previous track, which we don't (no playlist
    // buttons in the notification), so catch the key presses here instead.
    @Override
    public boolean onMediaButtonEvent(Intent mediaButtonEvent) {
        KeyEvent ev = mediaButtonEvent == null ? null : mediaButtonEvent.getParcelableExtra(Intent.EXTRA_KEY_EVENT);
        if (ev != null) {
            int code = ev.getKeyCode();
            String action = null;
            if (code == KeyEvent.KEYCODE_MEDIA_NEXT || code == KeyEvent.KEYCODE_MEDIA_FAST_FORWARD || code == KeyEvent.KEYCODE_MEDIA_SKIP_FORWARD) action = "seekforward";
            if (code == KeyEvent.KEYCODE_MEDIA_PREVIOUS || code == KeyEvent.KEYCODE_MEDIA_REWIND || code == KeyEvent.KEYCODE_MEDIA_SKIP_BACKWARD) action = "seekbackward";
            if (action != null) {
                if (ev.getAction() == KeyEvent.ACTION_DOWN && ev.getRepeatCount() == 0) plugin.actionCallback(action);
                return true;
            }
        }
        return super.onMediaButtonEvent(mediaButtonEvent);
    }

    @Override
    public void onStop() {
        plugin.actionCallback("stop");
    }
}
