# Deploy ke VPS (Linux)

Server Node menyajikan web, REST API, dan Socket.IO di SATU port.

## 1. Build

    git clone <repo> kuypoker && cd kuypoker
    npm ci
    npm run build
    npm test

## 2. Konfigurasi

    cp packages/server/.env.example packages/server/.env

Minimal production:

    NODE_ENV=production
    PORT=3000
    HOST=127.0.0.1          # hanya diakses lewat Nginx
    WEB_DIST=../web/dist

Dengan akun: tambah DATABASE_URL dan JWT_SECRET (wajib, server menolak start tanpa itu), lalu:

    npm run db:migrate:prod -w @kuypoker/server

## 3. PM2

    cd packages/server
    pm2 start dist/index.js --name kuypoker --update-env
    pm2 save

Penting: Socket.IO menyimpan room di memori proses. Jalankan SATU instance
(jangan `-i max`/cluster) kecuali sudah menambah Redis adapter + sticky session.
Restart server = room aktif hilang (pemain kembali ke lobby).

## 4. Nginx (WebSocket wajib di-upgrade)

    server {
      server_name kuypoker.example.com;
      location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_read_timeout 120s;
      }
    }

Lalu `sudo nginx -t && sudo systemctl reload nginx` dan pasang HTTPS (certbot).
Jika di belakang Cloudflare Tunnel: tambahkan Public Hostname di dashboard CF (DNS saja tidak cukup).

## 5. Verifikasi

    curl -s https://kuypoker.example.com/api/health
    # buka di dua perangkat, buat room di satu, gabung pakai kode di yang lain

## Aplikasi mobile ke server ini

Build web dengan URL server lalu sinkron Capacitor:

    VITE_SERVER_URL=https://kuypoker.example.com npm run cap:sync

Pemain juga bisa mengganti URL server di Pengaturan aplikasi.
