import type { CapacitorConfig } from '@capacitor/cli';

// Aplikasi iOS/Android memuat build web lokal (dist/) — offline untuk single-player.
// Multiplayer terhubung ke server lewat VITE_SERVER_URL yang ditanam saat build.
const config: CapacitorConfig = {
  appId: 'com.cardora.app',
  appName: 'Cardora',
  webDir: 'dist',
  backgroundColor: '#101827',
  server: {
    androidScheme: 'https',
  },
  ios: {
    contentInset: 'always',
  },
};

export default config;
