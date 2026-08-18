import type { CapacitorConfig } from '@capacitor/cli'

/** Android-local application shell: no runtime web server or CDN origin. */
const config: CapacitorConfig = {
  appId: 'top.noirbright.dshmobile',
  appName: 'DSH Mobile',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
    hostname: 'localhost',
  },
}

export default config
