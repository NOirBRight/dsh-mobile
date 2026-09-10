import type { CapacitorConfig } from '@capacitor/cli'

/**
 * WebView DevTools is off in every shipped build. One operator diagnosing a
 * device sets DSH_MOBILE_WEBVIEW_DEBUG=1 for that build only, which is what
 * makes the release WebView reachable over adb.
 */
const webContentsDebuggingEnabled = process.env.DSH_MOBILE_WEBVIEW_DEBUG === '1'

/** Android-local application shell: no runtime web server or CDN origin. */
const config: CapacitorConfig = {
  appId: 'top.noirbright.dshmobile',
  appName: 'DSH Mobile',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
    hostname: 'localhost',
  },
  android: {
    webContentsDebuggingEnabled,
  },
}

export default config
