package com.wuaizhibo.app;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.ActivityInfo;
import android.content.res.Configuration;
import android.graphics.Bitmap;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.widget.FrameLayout;
import android.widget.ImageView;
import android.widget.Toast;

import com.tencent.smtt.export.external.TbsCoreSettings;
import com.tencent.smtt.export.external.interfaces.IX5WebChromeClient;
import com.tencent.smtt.export.external.interfaces.SslError;
import com.tencent.smtt.export.external.interfaces.SslErrorHandler;
import com.tencent.smtt.sdk.CookieManager;
import com.tencent.smtt.sdk.DownloadListener;
import com.tencent.smtt.sdk.QbSdk;
import com.tencent.smtt.sdk.ValueCallback;
import com.tencent.smtt.sdk.WebChromeClient;
import com.tencent.smtt.sdk.WebSettings;
import com.tencent.smtt.sdk.WebView;
import com.tencent.smtt.sdk.WebViewClient;

import java.util.HashMap;
import java.util.Map;

public class MainActivity extends Activity {
    private static final String HOME_URL = "https://jiami.ttplays.uk:6067/";
    private static final String TRUSTED_HOST = "jiami.ttplays.uk";
    private static final int FILE_CHOOSER_REQUEST = 12001;
    private static final long MIN_SPLASH_MS = 1200L;
    private static final String PREFS = "wuaizhibo_settings";
    private static final String PREF_PRIVACY = "privacy_accepted_v1";

    private final Handler ui = new Handler(Looper.getMainLooper());
    private FrameLayout root;
    private WebView webView;
    private ImageView splash;
    private View customView;
    private IX5WebChromeClient.CustomViewCallback customCallback;
    private ValueCallback<Uri[]> fileCallback;
    private long splashStart;
    private boolean webCreated;
    private boolean initCallback;
    private boolean serverLandscapeMode;
    private boolean serverPortraitMode;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        splashStart = System.currentTimeMillis();
        getWindow().setStatusBarColor(Color.rgb(6, 20, 46));
        getWindow().setNavigationBarColor(Color.rgb(6, 20, 46));
        createShell();
        enterImmersive();
        scheduleImmersiveRefresh();

        SharedPreferences sp = getSharedPreferences(PREFS, MODE_PRIVATE);
        if (sp.getBoolean(PREF_PRIVACY, false)) {
            initX5();
        } else {
            new AlertDialog.Builder(this)
                    .setTitle("吾爱直播")
                    .setMessage("首次启动需要初始化腾讯 TBS/X5 网页内核，用于加载本站页面与视频。\n\n本 App 不集成广告 SDK、统计 SDK，也不主动申请通讯录、短信或定位权限。")
                    .setCancelable(false)
                    .setNegativeButton("退出", (d, w) -> finish())
                    .setPositiveButton("同意并进入", (d, w) -> {
                        getSharedPreferences(PREFS, MODE_PRIVATE).edit().putBoolean(PREF_PRIVACY, true).apply();
                        enterImmersive();
                        scheduleImmersiveRefresh();
                        initX5();
                    })
                    .show();
            scheduleImmersiveRefresh();
        }
    }

    private void createShell() {
        root = new FrameLayout(this);
        root.setBackgroundColor(Color.rgb(6, 20, 46));

        splash = new ImageView(this);
        splash.setBackgroundColor(Color.rgb(6, 20, 46));
        splash.setImageResource(R.drawable.splash_brand);
        splash.setScaleType(ImageView.ScaleType.FIT_CENTER);
        splash.setClickable(true);
        splash.setVisibility(View.VISIBLE);
        splash.setAlpha(1f);
        root.addView(splash, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT));

        setContentView(root);
    }

    private void initX5() {
        QbSdk.setDownloadWithoutWifi(false);
        Map<String, Object> settings = new HashMap<>();
        settings.put(TbsCoreSettings.TBS_SETTINGS_USE_SPEEDY_CLASSLOADER, true);
        settings.put(TbsCoreSettings.TBS_SETTINGS_USE_DEXLOADER_SERVICE, true);
        QbSdk.initTbsSettings(settings);

        QbSdk.initX5Environment(getApplicationContext(), new QbSdk.PreInitCallback() {
            @Override public void onCoreInitFinished() { }

            @Override public void onViewInitFinished(boolean isX5Core) {
                initCallback = true;
                createWebView();
            }
        });

        ui.postDelayed(() -> {
            if (!initCallback && !webCreated && !isFinishing()) {
                createWebView();
            }
        }, 8000L);
    }

    private void createWebView() {
        if (webCreated || isFinishing()) return;
        webCreated = true;

        webView = new WebView(this);
        webView.setBackgroundColor(Color.rgb(6, 20, 46));
        root.addView(webView, 0, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT));

        configureWebView();
        enterImmersive();
        webView.loadUrl(HOME_URL);
    }

    private void configureWebView() {
        WebView.setWebContentsDebuggingEnabled(false);
        WebSettings s = webView.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setLoadsImagesAutomatically(true);
        s.setUseWideViewPort(true);
        s.setLoadWithOverviewMode(false);
        s.setCacheMode(WebSettings.LOAD_DEFAULT);
        s.setTextZoom(100);
        s.setDefaultFontSize(16);
        s.setDefaultFixedFontSize(13);
        s.setMinimumFontSize(1);
        s.setMinimumLogicalFontSize(1);
        s.setSupportZoom(false);
        s.setBuiltInZoomControls(false);
        s.setDisplayZoomControls(false);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setJavaScriptCanOpenWindowsAutomatically(true);
        s.setSupportMultipleWindows(false);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setMixedContentMode(0);

        webView.addJavascriptInterface(new NativeBridge(), "WuAiNative");

        CookieManager cm = CookieManager.getInstance();
        cm.setAcceptCookie(true);
        cm.setAcceptThirdPartyCookies(webView, true);

        webView.setWebViewClient(new WebViewClient() {
            @Override public void onPageStarted(WebView view, String url, Bitmap favicon) {
                super.onPageStarted(view, url, favicon);
                if (!isTrustedUrl(url) && (serverLandscapeMode || serverPortraitMode)) {
                    handleServerFullscreenMode("off");
                }
                enterImmersive();
            }

            @Override public void onPageFinished(WebView view, String url) {
                super.onPageFinished(view, url);
                applyMobileFix(view);
                hideSplash();
                scheduleImmersiveRefresh();
            }

            @Override public boolean shouldOverrideUrlLoading(WebView view, String url) {
                if (url == null) return false;
                Uri uri = Uri.parse(url);
                String scheme = uri.getScheme();
                if (scheme == null || "http".equalsIgnoreCase(scheme) || "https".equalsIgnoreCase(scheme)) {
                    return false;
                }
                return openExternal(uri);
            }

            @Override public void onReceivedSslError(WebView view, SslErrorHandler handler, SslError error) {
                if (handler != null) handler.cancel();
                hideSplash();
                enterImmersive();
                Toast.makeText(MainActivity.this, "网站 HTTPS 证书校验失败", Toast.LENGTH_LONG).show();
            }
        });

        webView.setWebChromeClient(new WebChromeClient() {
            @Override public void onProgressChanged(WebView view, int progress) {
                super.onProgressChanged(view, progress);
                if (progress >= 100) {
                    applyMobileFix(view);
                    hideSplash();
                    scheduleImmersiveRefresh();
                }
            }

            @Override public void onShowCustomView(View view, IX5WebChromeClient.CustomViewCallback callback) {
                if (customView != null) {
                    callback.onCustomViewHidden();
                    return;
                }

                customView = view;
                customCallback = callback;
                webView.setVisibility(View.GONE);
                root.addView(view, new FrameLayout.LayoutParams(
                        ViewGroup.LayoutParams.MATCH_PARENT,
                        ViewGroup.LayoutParams.MATCH_PARENT));

                getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                enterImmersive();
                applyNativeFullscreenOrientation();
                scheduleImmersiveRefresh();
            }

            @Override public void onHideCustomView() {
                exitFullscreen();
            }

            @Override public boolean onShowFileChooser(WebView view,
                                                       ValueCallback<Uri[]> callback,
                                                       FileChooserParams params) {
                if (fileCallback != null) fileCallback.onReceiveValue(null);
                fileCallback = callback;

                Intent intent;
                try {
                    intent = params.createIntent();
                } catch (Exception e) {
                    intent = new Intent(Intent.ACTION_GET_CONTENT);
                    intent.addCategory(Intent.CATEGORY_OPENABLE);
                    intent.setType("*/*");
                }

                try {
                    startActivityForResult(intent, FILE_CHOOSER_REQUEST);
                    return true;
                } catch (ActivityNotFoundException e) {
                    fileCallback = null;
                    enterImmersive();
                    return false;
                }
            }
        });

        webView.setDownloadListener(new DownloadListener() {
            @Override public void onDownloadStart(String url,
                                                  String userAgent,
                                                  String contentDisposition,
                                                  String mimetype,
                                                  long contentLength) {
                openExternal(Uri.parse(url));
            }
        });
    }

    private void applyMobileFix(WebView view) {
        if (view == null) return;

        String js = "(function(){try{" +
                "var d=document;if(!d||!d.head)return;" +
                "var v=d.querySelector('meta[name=\\\"viewport\\\"]');" +
                "if(!v){v=d.createElement('meta');v.name='viewport';d.head.appendChild(v);}" +
                "v.setAttribute('content','width=device-width, initial-scale=1.0, viewport-fit=cover');" +
                "var s=d.getElementById('wuaizhibo-mobile-fix');" +
                "if(!s){s=d.createElement('style');s.id='wuaizhibo-mobile-fix';d.head.appendChild(s);}" +
                "s.textContent='" +
                "html{-webkit-text-size-adjust:100% !important;text-size-adjust:100% !important;}" +
                ".madouym[data-video-orientation=\\\"portrait\\\"] .force-landscape-hitbox{pointer-events:auto !important;}" +
                "html.wuaizhibo-portrait-page,body.wuaizhibo-portrait-page{margin:0 !important;padding:0 !important;width:100% !important;height:100% !important;overflow:hidden !important;background:#000 !important;overscroll-behavior:none !important;}" +
                ".madouym.wuaizhibo-portrait-player{position:fixed !important;left:0 !important;top:0 !important;right:0 !important;bottom:0 !important;width:100vw !important;height:100vh !important;height:100dvh !important;max-width:none !important;max-height:none !important;margin:0 !important;padding:0 !important;z-index:2147483646 !important;background:#000 !important;overflow:hidden !important;}" +
                ".madouym.wuaizhibo-portrait-player iframe,.madouym.wuaizhibo-portrait-player video,.madouym.wuaizhibo-portrait-player>iframe,.madouym.wuaizhibo-portrait-player>video{width:100% !important;height:100% !important;max-width:none !important;max-height:none !important;margin:0 !important;padding:0 !important;}" +
                "';" +
                "if(!window.__wuaifsBridgeInstalled){" +
                    "window.__wuaifsBridgeInstalled=true;" +
                    "var nativeSet=function(m){try{if(window.WuAiNative&&typeof window.WuAiNative.setFullscreenMode==='function')window.WuAiNative.setFullscreenMode(m);}catch(x){}};" +
                    "var portraitPlayer=null;" +
                    "var sync=function(){try{" +
                        "var de=d.documentElement,b=d.body;" +
                        "var landscape=!!((de&&de.classList.contains('force-landscape-page'))||(b&&b.classList.contains('force-landscape-page'))||d.querySelector('.madouym.force-landscape-player'));" +
                        "var portrait=!!d.querySelector('.madouym.wuaizhibo-portrait-player');" +
                        "nativeSet(landscape?'landscape':(portrait?'portrait':'off'));" +
                    "}catch(x){}};" +
                    "var exitPortrait=function(){try{" +
                        "var p=d.querySelector('.madouym.wuaizhibo-portrait-player');" +
                        "if(p)p.classList.remove('wuaizhibo-portrait-player');" +
                        "if(d.documentElement)d.documentElement.classList.remove('wuaizhibo-portrait-page');" +
                        "if(d.body)d.body.classList.remove('wuaizhibo-portrait-page');" +
                        "portraitPlayer=null;nativeSet('off');return true;" +
                    "}catch(x){nativeSet('off');return false;}};" +
                    "var enterPortrait=function(p){try{" +
                        "var old=d.querySelector('.madouym.wuaizhibo-portrait-player');" +
                        "if(old&&old!==p)old.classList.remove('wuaizhibo-portrait-player');" +
                        "portraitPlayer=p;" +
                        "if(d.documentElement)d.documentElement.classList.add('wuaizhibo-portrait-page');" +
                        "if(d.body)d.body.classList.add('wuaizhibo-portrait-page');" +
                        "p.classList.add('wuaizhibo-portrait-player');nativeSet('portrait');return true;" +
                    "}catch(x){return false;}};" +
                    "window.__WuAiExitPortrait=exitPortrait;" +
                    "d.addEventListener('click',function(e){try{" +
                        "var t=e.target;var btn=t&&t.closest?t.closest('.force-landscape-hitbox'):null;if(!btn)return;" +
                        "var p=btn.closest?btn.closest('.madouym'):null;if(!p)return;" +
                        "var mode=p.getAttribute('data-video-orientation')||'';if(mode!=='portrait')return;" +
                        "e.preventDefault();e.stopPropagation();if(typeof e.stopImmediatePropagation==='function')e.stopImmediatePropagation();" +
                        "if(p.classList.contains('wuaizhibo-portrait-player'))exitPortrait();else enterPortrait(p);" +
                    "}catch(x){}},true);" +
                    "var mo=new MutationObserver(sync);" +
                    "mo.observe(d.documentElement,{attributes:true,childList:true,subtree:true,attributeFilter:['class','data-video-orientation']});" +
                    "d.addEventListener('fullscreenchange',sync,true);" +
                    "window.addEventListener('pageshow',sync,true);" +
                    "window.addEventListener('pagehide',function(){try{exitPortrait();nativeSet('off');}catch(x){}},true);" +
                    "sync();" +
                "}" +
                "}catch(e){}})();";

        view.evaluateJavascript(js, null);
    }

    private final class NativeBridge {
        @JavascriptInterface
        public void setFullscreenMode(String mode) {
            ui.post(() -> {
                if (!isTrustedCurrentUrl()) return;
                handleServerFullscreenMode(mode);
            });
        }
    }

    private void handleServerFullscreenMode(String mode) {
        boolean landscape = "landscape".equalsIgnoreCase(mode);
        boolean portrait = "portrait".equalsIgnoreCase(mode);

        if (landscape) {
            serverLandscapeMode = true;
            serverPortraitMode = false;
            getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            if (customView == null) {
                setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE);
            }
            enterImmersive();
            scheduleImmersiveRefresh();
            return;
        }

        if (portrait) {
            serverPortraitMode = true;
            serverLandscapeMode = false;
            getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            if (customView == null) {
                setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_SENSOR_PORTRAIT);
            }
            enterImmersive();
            scheduleImmersiveRefresh();
            return;
        }

        boolean wasManagedFullscreen = serverLandscapeMode || serverPortraitMode;
        serverLandscapeMode = false;
        serverPortraitMode = false;

        if (wasManagedFullscreen && customView == null) {
            getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED);
        }

        enterImmersive();
        scheduleImmersiveRefresh();
    }

    private void applyNativeFullscreenOrientation() {
        if (webView == null) {
            setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_SENSOR_PORTRAIT);
            return;
        }

        String js = "(function(){try{" +
                "var p=document.querySelector('.madouym.wuaizhibo-portrait-player');if(p)return 'portrait';" +
                "var ps=document.querySelectorAll('.madouym[data-video-orientation]');" +
                "for(var i=0;i<ps.length;i++){var m=ps[i].getAttribute('data-video-orientation');if(m==='portrait'||m==='landscape')return m;}" +
                "var v=document.querySelector('video');if(v&&v.videoWidth&&v.videoHeight)return v.videoHeight>v.videoWidth?'portrait':'landscape';" +
                "return 'portrait';}catch(e){return 'portrait';}})();";

        webView.evaluateJavascript(js, value -> {
            if (customView == null) return;
            String mode = value == null ? "portrait" : value.replace("\"", "").trim();
            if ("landscape".equalsIgnoreCase(mode)) {
                setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE);
            } else {
                setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_SENSOR_PORTRAIT);
            }
            scheduleImmersiveRefresh();
        });
    }

    private boolean isTrustedCurrentUrl() {
        return webView != null && isTrustedUrl(webView.getUrl());
    }

    private boolean isTrustedUrl(String url) {
        if (url == null) return false;
        try {
            Uri uri = Uri.parse(url);
            return TRUSTED_HOST.equalsIgnoreCase(uri.getHost());
        } catch (Exception e) {
            return false;
        }
    }

    private boolean openExternal(Uri uri) {
        try {
            if ("intent".equalsIgnoreCase(uri.getScheme())) {
                Intent parsed = Intent.parseUri(uri.toString(), Intent.URI_INTENT_SCHEME);
                if (parsed.resolveActivity(getPackageManager()) != null) {
                    startActivity(parsed);
                } else {
                    String fallback = parsed.getStringExtra("browser_fallback_url");
                    if (fallback != null && webView != null) webView.loadUrl(fallback);
                }
                return true;
            }

            startActivity(new Intent(Intent.ACTION_VIEW, uri));
            return true;
        } catch (Exception e) {
            Toast.makeText(this, "未安装可打开此链接的应用", Toast.LENGTH_SHORT).show();
            enterImmersive();
            return true;
        }
    }

    private void hideSplash() {
        if (splash == null || splash.getVisibility() != View.VISIBLE) return;

        long delay = Math.max(0L, MIN_SPLASH_MS - (System.currentTimeMillis() - splashStart));
        ui.postDelayed(() -> {
            if (splash == null || splash.getVisibility() != View.VISIBLE) return;
            splash.animate()
                    .alpha(0f)
                    .setDuration(260L)
                    .withEndAction(() -> {
                        splash.setVisibility(View.GONE);
                        splash.setAlpha(1f);
                        splash.setClickable(false);
                        enterImmersive();
                        scheduleImmersiveRefresh();
                    })
                    .start();
        }, delay);
    }

    private void scheduleImmersiveRefresh() {
        ui.postDelayed(() -> {
            if (!isFinishing()) enterImmersive();
        }, 60L);
        ui.postDelayed(() -> {
            if (!isFinishing()) enterImmersive();
        }, 240L);
        ui.postDelayed(() -> {
            if (!isFinishing()) enterImmersive();
        }, 700L);
    }

    private void enterImmersive() {
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            WindowManager.LayoutParams lp = getWindow().getAttributes();
            lp.layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
            getWindow().setAttributes(lp);
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            getWindow().setStatusBarContrastEnforced(false);
            getWindow().setNavigationBarContrastEnforced(false);
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            getWindow().setDecorFitsSystemWindows(false);
            WindowInsetsController controller = getWindow().getInsetsController();
            if (controller != null) {
                controller.hide(WindowInsets.Type.statusBars() | WindowInsets.Type.navigationBars());
                controller.setSystemBarsBehavior(WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
            }
        }

        getWindow().getDecorView().setSystemUiVisibility(
                View.SYSTEM_UI_FLAG_FULLSCREEN |
                View.SYSTEM_UI_FLAG_HIDE_NAVIGATION |
                View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY |
                View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN |
                View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION |
                View.SYSTEM_UI_FLAG_LAYOUT_STABLE);
    }

    private void exitFullscreen() {
        if (customView == null) return;

        root.removeView(customView);
        customView = null;
        if (webView != null) webView.setVisibility(View.VISIBLE);

        if (customCallback != null) {
            customCallback.onCustomViewHidden();
            customCallback = null;
        }

        if (serverLandscapeMode) {
            setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE);
            getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        } else if (serverPortraitMode) {
            setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_SENSOR_PORTRAIT);
            getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        } else {
            getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED);
        }

        enterImmersive();
        scheduleImmersiveRefresh();
    }

    @Override public void onBackPressed() {
        if (customView != null) {
            exitFullscreen();
            return;
        }

        if (serverPortraitMode) {
            if (webView != null) {
                webView.evaluateJavascript("(function(){try{if(window.__WuAiExitPortrait)return window.__WuAiExitPortrait();return false;}catch(e){return false;}})();", null);
            }
            handleServerFullscreenMode("off");
            return;
        }

        if (serverLandscapeMode) {
            if (webView != null) {
                webView.evaluateJavascript("(function(){try{var b=document.querySelector('.force-landscape-hitbox');if(b){b.click();return true;}document.documentElement.classList.remove('force-landscape-page');if(document.body)document.body.classList.remove('force-landscape-page');var p=document.querySelector('.madouym.force-landscape-player');if(p)p.classList.remove('force-landscape-player');return true;}catch(e){return false;}})();", null);
            }
            handleServerFullscreenMode("off");
            return;
        }

        if (webView != null && webView.canGoBack()) {
            webView.goBack();
            scheduleImmersiveRefresh();
        } else {
            super.onBackPressed();
        }
    }

    @Override public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) scheduleImmersiveRefresh();
    }

    @Override public void onConfigurationChanged(Configuration newConfig) {
        super.onConfigurationChanged(newConfig);
        scheduleImmersiveRefresh();
    }

    @Override protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == FILE_CHOOSER_REQUEST && fileCallback != null) {
            Uri[] result = null;
            if (resultCode == RESULT_OK && data != null && data.getData() != null) {
                result = new Uri[]{data.getData()};
            }
            fileCallback.onReceiveValue(result);
            fileCallback = null;
        }
        scheduleImmersiveRefresh();
    }

    @Override protected void onPause() {
        super.onPause();
        if (webView != null) {
            webView.onPause();
            CookieManager.getInstance().flush();
        }
    }

    @Override protected void onResume() {
        super.onResume();
        if (webView != null) webView.onResume();
        enterImmersive();
        scheduleImmersiveRefresh();
    }

    @Override protected void onDestroy() {
        ui.removeCallbacksAndMessages(null);
        if (webView != null) {
            webView.stopLoading();
            webView.removeJavascriptInterface("WuAiNative");
            webView.setWebChromeClient(null);
            webView.setWebViewClient(null);
            webView.removeAllViews();
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }
}
