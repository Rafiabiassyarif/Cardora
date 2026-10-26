-- 004_economy.sql — chip/XP/level/misi/pencapaian disimpan di akun (server otoritatif).
-- Disimpan sebagai JSONB agar bentuk state bisa berkembang tanpa migrasi baru.
CREATE TABLE IF NOT EXISTS user_economy (
  user_id    BIGINT      PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  economy    JSONB       NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
