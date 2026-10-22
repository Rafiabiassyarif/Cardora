# Aplikasi Android & iOS (Capacitor)

Aplikasi native memuat build web dari dalam paket (single-player offline) dan terhubung
ke server multiplayer lewat VITE_SERVER_URL yang ditanam saat build (bisa diganti di Pengaturan).

Konfigurasi: packages/web/capacitor.config.ts (appId com.kuypoker.app).
Aset sumber ikon/splash: packages/web/resources/ (icon.png, icon-foreground.png, splash.png).

## Android (Windows/Mac/Linux)

Butuh: Android Studio (SDK 34+), JDK 17 (bawaan Android Studio di `jbr/`).

    cd packages/web
    npx cap add android                 # sekali saja, membuat folder android/
    npx @capacitor/assets generate --android   # opsional: ikon & splash dari resources/
    cd ../..
    set VITE_SERVER_URL=https://server-anda   (Windows)  /  export VITE_SERVER_URL=...  (Mac/Linux)
    npm run cap:sync
    cd packages/web/android
    gradlew assembleDebug               # APK: app/build/outputs/apk/debug/app-debug.apk

Pasang ke HP: aktifkan USB debugging lalu `adb install -r app/build/outputs/apk/debug/app-debug.apk`,
atau buka folder android/ di Android Studio → Run.

Rilis Play Store: buat keystore, `gradlew bundleRelease` (AAB), tanda tangani, unggah.
Server WAJIB HTTPS (Android memblokir HTTP biasa secara default).

## iOS (wajib Mac + Xcode 15+)

Build iOS tidak bisa dilakukan di Windows.

    cd packages/web
    npx cap add ios
    cd ../.. && VITE_SERVER_URL=https://server-anda npm run cap:sync
    npx --prefix packages/web cap open ios

Di Xcode: pilih Team (Apple ID) di Signing & Capabilities, pilih iPhone, Run.
Distribusi: Product → Archive → App Store Connect / TestFlight (butuh Apple Developer Program).

## Catatan toko aplikasi

Game kartu dengan chip virtual tanpa nilai uang umumnya diizinkan; tetap isi kuesioner rating
konten (simulated gambling). Menambah pembelian chip atau hadiah bernilai uang mengubah
klasifikasi dan legalitas — tinjau hukum dulu.
