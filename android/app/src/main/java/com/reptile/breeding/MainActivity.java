package com.reptile.breeding;

import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.widget.TextView;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;

import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import com.getcapacitor.BridgeActivity;

/**
 * 爬宠繁育 · 主 Activity
 * 在 Capacitor BridgeActivity 基础上补充：
 *  1. 全面屏安全区适配：edge-to-edge 下将系统栏（状态栏/手势区/刘海）insets
 *     以 CSS 变量 --safe-area-inset-* 注入 WebView，供样式层做顶部/底部避让；
 *  2. 返回键/全面屏手势返回：先关浮层（图片放大查看器 / 弹窗），其次有历史先回退，
 *     再交 Web 层 __rbBack 处理（回首页），仅在首页才允许退出；
 *  3. 状态栏/导航栏图标明暗随 Web 主题联动（RBNative.setStatusBarStyle）。
 *  4. v3.3：启动页 —— WebView 加载期间覆盖一层原生启动页（logo / 软件名 / 标语 / 免费与捐助说明 /
 *     「一键捐助」按钮），3 秒后右上角「跳过」按钮淡入，无操作 5 秒自动进入主界面。
 */
public class MainActivity extends BridgeActivity {

    /** 最近一次系统栏 insets（px），供 Web 层就绪后重新注入 */
    private int insetTop = 0, insetRight = 0, insetBottom = 0, insetLeft = 0;

    /** v3.3：启动页覆盖层（WebView 之上），无操作 5 秒后移除 */
    private View splashOverlay = null;
    private final Handler splashHandler = new Handler(Looper.getMainLooper());
    /** 「跳过」按钮出现前的等待时长（毫秒）—— 3 秒 */
    private static final long SPLASH_SKIP_SHOW_DELAY = 3000L;
    /** v3.5：跳过按钮上的倒计时秒数（从出现起倒数，到 0 自动进入主界面） */
    private static final int SPLASH_COUNTDOWN_SECONDS = 5;
    /** 无操作自动进入的等待时长（毫秒）—— 跳过按钮出现后倒计时结束即自动进入 */
    private static final long SPLASH_DELAY = SPLASH_SKIP_SHOW_DELAY + SPLASH_COUNTDOWN_SECONDS * 1000L;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setupWindow();
        setupSafeArea();
        disableWebViewCache();
        setupNativeBridge();
        showSplash();
    }

    /**
     * v3.3：显示原生启动页覆盖层。
     * 做法：在 Activity 根视图（android.R.id.content）上叠加一层 activity_splash 布局，
     * 覆盖 WebView 之上 —— WebView 加载较慢时用户看到的是启动页而非白屏。
     * 时序：启动时先只显示 logo/文案；3 秒后右上角「跳过」按钮淡入；
     *      5 秒内无操作则自动移除进入主界面；点「跳过」可立即进入。
     */
    private void showSplash() {
        try {
            final ViewGroup root = (ViewGroup) findViewById(android.R.id.content);
            if (root == null) return;
            View v = LayoutInflater.from(this).inflate(R.layout.activity_splash, root, false);
            root.addView(v, new ViewGroup.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
            splashOverlay = v;
            // 「一键捐助」按钮：跳转爱发电主页（URL 为空则隐藏按钮）
            View donate = v.findViewById(R.id.splashDonateBtn);
            if (donate != null) {
                String url = getString(R.string.splash_donate_url);
                if (url == null || url.trim().isEmpty()) {
                    donate.setVisibility(View.GONE);
                } else {
                    final String link = url.trim();
                    donate.setOnClickListener(new View.OnClickListener() {
                        @Override
                        public void onClick(View view) {
                            openExternalUrl(link);
                        }
                    });
                }
            }
            // 跳过按钮：初始 alpha=0，3 秒后淡入；v3.5：按钮上带倒计时（跳过 (5) → 跳过 (1)）
            final View skip = v.findViewById(R.id.splashSkip);
            if (skip != null) {
                skip.setOnClickListener(new View.OnClickListener() {
                    @Override
                    public void onClick(View view) { hideSplash(); }
                });
                splashHandler.postDelayed(new Runnable() {
                    @Override
                    public void run() {
                        try {
                            skip.animate().alpha(1f).setDuration(220).start();
                        } catch (Exception e) { /* ignore */ }
                    }
                }, SPLASH_SKIP_SHOW_DELAY);
                // v3.5：倒计时文本「跳过 (N)」，每秒递减；归零后自动进入主界面
                startSkipCountdown(skip);
            }
            // 倒计时结束后自动进入
            splashHandler.postDelayed(new Runnable() {
                @Override
                public void run() { hideSplash(); }
            }, SPLASH_DELAY);
        } catch (Exception e) {
            android.util.Log.w("RBNative", "showSplash failed: " + e.getMessage());
        }
    }

    /**
     * 用系统浏览器打开外部链接（启动页「一键捐助」等）。
     * 链接不以 http(s):// 开头时自动补 https://；无浏览器等异常静默忽略。
     */
    private void openExternalUrl(final String url) {
        try {
            String u = url == null ? "" : url.trim();
            if (u.isEmpty()) return;
            if (!u.startsWith("http://") && !u.startsWith("https://")) {
                u = "https://" + u;
            }
            Intent it = new Intent(Intent.ACTION_VIEW, Uri.parse(u));
            it.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            startActivity(it);
        } catch (Exception e) {
            android.util.Log.w("RBNative", "openExternalUrl failed: " + url);
        }
    }

    /**
     * v3.5：启动页「跳过」按钮倒计时。
     * 按钮文案从「跳过 (5)」逐秒递减到「跳过 (1)」，归零后由 SPLASH_DELAY 触发的
     * hideSplash() 移除覆盖层进入主界面。
     */
    private void startSkipCountdown(final View skip) {
        try {
            if (!(skip instanceof TextView)) return;
            final TextView tv = (TextView) skip;
            final String base = getString(R.string.splash_skip);
            final int[] remain = { SPLASH_COUNTDOWN_SECONDS };
            tv.setText(base + " (" + remain[0] + ")");
            splashHandler.postDelayed(new Runnable() {
                @Override
                public void run() {
                    try {
                        remain[0]--;
                        if (remain[0] > 0) {
                            tv.setText(base + " (" + remain[0] + ")");
                            splashHandler.postDelayed(this, 1000L);
                        } else {
                            tv.setText(base);
                        }
                    } catch (Exception e) { /* ignore */ }
                }
            }, 1000L);
        } catch (Exception e) { /* ignore */ }
    }

    /** 移除启动页覆盖层（幂等） */
    private void hideSplash() {
        splashHandler.removeCallbacksAndMessages(null);
        final View v = splashOverlay;
        splashOverlay = null;
        if (v == null) return;
        try {
            final ViewGroup parent = (ViewGroup) v.getParent();
            if (parent != null) parent.removeView(v);
        } catch (Exception e) { /* ignore */ }
    }

    @Override
    public void onDestroy() {
        splashHandler.removeCallbacksAndMessages(null);
        super.onDestroy();
    }

    /**
     * v2.9：关闭 WebView 的 HTTP 缓存。
     * 背景：Capacitor 以 https://localhost 提供 assets，URL 在各版本间完全相同，
     * 覆盖安装新 APK 后 WebView 仍会命中旧的磁盘缓存 —— 表现为
     *「手机端导出的基因预测图还是旧样式」「新建个体界面不是最新版」。
     * 本应用完全离线、数据全在本地，禁用缓存无任何副作用（应用本身不依赖网络请求）。
     * 注意：这只解决「同一路径不同内容」的问题；ES module 的相对导入还需靠
     *       sync-web.mjs 注入 ?v= 版本号（两者互补）。
     */
    private void disableWebViewCache() {
        try {
            WebView webView = getBridge() != null ? getBridge().getWebView() : null;
            if (webView == null) return;
            webView.getSettings().setCacheMode(android.webkit.WebSettings.LOAD_NO_CACHE);
        } catch (Exception e) {
            android.util.Log.w("RBNative", "disableWebViewCache failed: " + e.getMessage());
        }
    }

    @Override
    public void onResume() {
        super.onResume();
        // 兜底：页面加载早于 insets 回调时，恢复时补一次注入
        injectSafeArea(insetTop, insetRight, insetBottom, insetLeft);
    }

    /** 让内容延伸到系统栏下方（edge-to-edge），具体避让由 Web 层安全区样式完成 */
    private void setupWindow() {
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        getWindow().setStatusBarColor(android.graphics.Color.TRANSPARENT);
        getWindow().setNavigationBarColor(android.graphics.Color.TRANSPARENT);
    }

    /** 监听窗口 insets 并注入 CSS 变量；旋转 / 分屏 / 键盘弹出时会再次回调 */
    private void setupSafeArea() {
        final View content = findViewById(android.R.id.content);
        ViewCompat.setOnApplyWindowInsetsListener(content, (v, insets) -> {
            Insets bars = insets.getInsets(
                WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout());
            injectSafeArea(bars.top, bars.right, bars.bottom, bars.left);
            return insets;
        });
        ViewCompat.requestApplyInsets(content);
    }

    private void injectSafeArea(int top, int right, int bottom, int left) {
        insetTop = top; insetRight = right; insetBottom = bottom; insetLeft = left;
        applySafeAreaJs();
    }

    /**
     * 把系统栏 insets 以 CSS 变量注入 WebView。
     * 注意：insets 回调返回的是【物理像素】，而 CSS px 对应【dp（逻辑像素）】，
     * 高 DPR 机型（2.75 / 3.0）上不换算会把安全区放大 2~3 倍，
     * 表现为顶部/底部出现巨大空白。此处统一除以 density 换算为 dp。
     */
    private void applySafeAreaJs() {
        WebView webView = getBridge() != null ? getBridge().getWebView() : null;
        if (webView == null) return;
        final float density = getResources().getDisplayMetrics().density;
        final int topDp = Math.round(insetTop / density);
        final int rightDp = Math.round(insetRight / density);
        final int bottomDp = Math.round(insetBottom / density);
        final int leftDp = Math.round(insetLeft / density);
        final String js = "(function(){var s=document.documentElement.style;"
            + "s.setProperty('--safe-area-inset-top','" + topDp + "px');"
            + "s.setProperty('--safe-area-inset-right','" + rightDp + "px');"
            + "s.setProperty('--safe-area-inset-bottom','" + bottomDp + "px');"
            + "s.setProperty('--safe-area-inset-left','" + leftDp + "px');"
            + "})();";
        // post 到 WebView 消息队列，确保页面已挂载后执行
        webView.post(() -> webView.evaluateJavascript(js, null));
    }

    /** 供 Web 层同步状态栏/导航栏图标明暗 */
    private void setupNativeBridge() {
        WebView webView = getBridge() != null ? getBridge().getWebView() : null;
        if (webView == null) return;
        webView.addJavascriptInterface(new Object() {
            @JavascriptInterface
            public void setStatusBarStyle(boolean lightIcons) {
                runOnUiThread(() -> {
                    View decor = findViewById(android.R.id.content);
                    WindowInsetsControllerCompat c =
                        WindowCompat.getInsetsController(getWindow(), decor);
                    c.setAppearanceLightStatusBars(!lightIcons);
                    c.setAppearanceLightNavigationBars(!lightIcons);
                });
            }

            /**
             * 保存文件到系统「下载」目录（Web 层导出备份 JSON / 个体分享包 / 趋势图 PNG）。
             * Android WebView 对 a[download] 的支持不稳定（常无响应），统一走原生通道保证导出可用。
             * base64 为文件内容的 Base64 编码（不含 data: 前缀）。
             */
            @JavascriptInterface
            public void saveFile(final String fileName, final String base64, final String mime) {
                runOnUiThread(() -> {
                    try {
                        byte[] data = android.util.Base64.decode(base64, android.util.Base64.DEFAULT);
                        writeToDownloads(fileName, data, mime);
                    } catch (Exception e) {
                        android.util.Log.e("RBNative", "saveFile failed: " + fileName, e);
                    }
                });
            }

            /** Web 层页面就绪后调用：重新注入安全区变量（防止加载时序丢失） */
            @JavascriptInterface
            public void ready() {
                runOnUiThread(() -> {
                    injectSafeArea(insetTop, insetRight, insetBottom, insetLeft);
                    ViewCompat.requestApplyInsets(findViewById(android.R.id.content));
                });
            }

            /**
             * v3.6：一键加群 —— 调起 QQ 客户端打开群资料卡。
             *
             * 优先用 QQ 官方 scheme（mqqapi://card/open_psgrcard?uin_group=群号），
             * 该 scheme 由 QQ/ TIM 自行处理，不会被系统浏览器拦截；
             * 若设备未装 QQ（找不到可处理的应用），回退到网页版加群页。
             */
            @JavascriptInterface
            public void joinQQGroup(final String groupNo) {
                runOnUiThread(() -> {
                    try {
                        final String no = groupNo == null ? "" : groupNo.trim();
                        if (no.isEmpty()) return;
                        // 优先唤起 QQ 客户端
                        Intent qq = new Intent(Intent.ACTION_VIEW,
                                Uri.parse("mqqapi://card/open_psgrcard?uin_group=" + no));
                        qq.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                        if (qq.resolveActivity(getPackageManager()) != null) {
                            startActivity(qq);
                            return;
                        }
                        // 回退：网页版加群页
                        Intent web = new Intent(Intent.ACTION_VIEW,
                                Uri.parse("https://qm.qq.com/cgi-bin/qm/qr?k=" + no));
                        web.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                        startActivity(web);
                    } catch (Exception e) {
                        android.util.Log.w("RBNative", "joinQQGroup failed: " + groupNo);
                    }
                });
            }
        }, "RBNative");
    }

    /**
     * 写入系统下载目录：
     *  - API 29+（Q）：MediaStore.Downloads 插入，无需任何存储权限；
     *  - 更低版本：应用外置 Download 目录（同样无需权限）+ 媒体扫描通知。
     */
    private void writeToDownloads(String fileName, byte[] data, String mime) {
        try {
            if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.Q) {
                android.content.ContentValues values = new android.content.ContentValues();
                values.put(android.provider.MediaStore.Downloads.DISPLAY_NAME, fileName);
                values.put(android.provider.MediaStore.Downloads.MIME_TYPE, mime);
                values.put(android.provider.MediaStore.Downloads.RELATIVE_PATH, android.os.Environment.DIRECTORY_DOWNLOADS);
                android.net.Uri uri = getContentResolver().insert(
                        android.provider.MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
                if (uri != null) {
                    try (java.io.OutputStream os = getContentResolver().openOutputStream(uri)) {
                        if (os != null) {
                            os.write(data);
                            os.flush();
                            return;
                        }
                    }
                }
            }
            // 低版本回退：/Android/data/<pkg>/files/Download
            java.io.File dir = getExternalFilesDir(android.os.Environment.DIRECTORY_DOWNLOADS);
            if (dir != null) {
                java.io.File f = new java.io.File(dir, fileName);
                try (java.io.FileOutputStream fos = new java.io.FileOutputStream(f)) {
                    fos.write(data);
                    fos.flush();
                }
                android.media.MediaScannerConnection.scanFile(
                        getApplicationContext(), new String[]{f.getAbsolutePath()}, new String[]{mime}, null);
            }
        } catch (Exception e) {
            android.util.Log.e("RBNative", "writeToDownloads failed: " + fileName, e);
        }
    }

    /**
     * 返回键 / 全面屏手势返回：
     *  1. 先问 Web 层是否有需要优先关闭的浮层（图片/SVG 全屏放大查看器、弹窗）
     *     —— v3.2：点缩略图放大后按返回键应「关闭放大层」，而不是后退路由或退出 App；
     *  2. WebView 有历史 → goBack()（hash 路由会触发页面返回）；
     *  3. 否则询问 Web 层 window.__rbBack()（回首页），返回 "exit" 才退出。
     */
    @Override
    public void onBackPressed() {
        WebView webView = getBridge() != null ? getBridge().getWebView() : null;
        if (webView == null) {
            super.onBackPressed();
            return;
        }
        // 浮层优先：放大查看器 / 弹窗打开时，先让 Web 层关掉它
        webView.evaluateJavascript(
                "window.__rbHasOverlay ? window.__rbHasOverlay() : 'no'",
                (overlay) -> {
                    if (overlay != null && overlay.contains("yes")) {
                        webView.evaluateJavascript("window.__rbBack ? window.__rbBack() : 'exit'", null);
                        return;
                    }
                    if (webView.canGoBack()) {
                        webView.goBack();
                        return;
                    }
                    webView.evaluateJavascript("window.__rbBack ? window.__rbBack() : 'exit'", (result) -> {
                        if (result != null && result.contains("handled")) return; // Web 层已处理
                        runOnUiThread(this::finish);
                    });
                });
    }
}
