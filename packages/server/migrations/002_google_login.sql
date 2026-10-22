-- 002_google_login.sql — dukungan "Masuk dengan Google".
-- Akun Google tidak memakai password: password_hash berisi bcrypt dari nilai acak (tidak bisa dipakai login).
ALTER TABLE users ADD COLUMN IF NOT EXISTS google_sub VARCHAR(64);
ALTER TABLE users ADD COLUMN IF NOT EXISTS email VARCHAR(254);
CREATE UNIQUE INDEX IF NOT EXISTS users_google_sub_idx ON users (google_sub) WHERE google_sub IS NOT NULL;
