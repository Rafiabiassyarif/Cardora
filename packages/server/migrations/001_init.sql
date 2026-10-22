-- 001_init.sql — skema awal KUYPOKER (PostgreSQL 13+).
-- Password TIDAK pernah disimpan sebagai teks biasa: kolom password_hash berisi bcrypt.

CREATE TABLE IF NOT EXISTS users (
  id            BIGSERIAL PRIMARY KEY,
  username      VARCHAR(20)  NOT NULL,
  password_hash VARCHAR(100) NOT NULL,
  display_name  VARCHAR(20)  NOT NULL,
  avatar        VARCHAR(16)  NOT NULL DEFAULT '🦊',
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS users_username_lower_idx ON users (lower(username));

CREATE TABLE IF NOT EXISTS matches (
  id          BIGSERIAL PRIMARY KEY,
  game_id     VARCHAR(40) NOT NULL,
  room_code   VARCHAR(12),
  players     SMALLINT    NOT NULL,
  finished_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS matches_finished_idx ON matches (finished_at DESC);

CREATE TABLE IF NOT EXISTS match_players (
  match_id   BIGINT      NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  seat       SMALLINT    NOT NULL,
  user_id    BIGINT      REFERENCES users(id) ON DELETE SET NULL,
  name       VARCHAR(20) NOT NULL,
  is_bot     BOOLEAN     NOT NULL DEFAULT false,
  rank       SMALLINT    NOT NULL,
  score      INTEGER     NOT NULL,
  PRIMARY KEY (match_id, seat)
);
CREATE INDEX IF NOT EXISTS match_players_user_idx ON match_players (user_id);

-- Statistik agregat per pengguna per game (diperbarui setiap pertandingan online).
CREATE TABLE IF NOT EXISTS user_game_stats (
  user_id  BIGINT      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  game_id  VARCHAR(40) NOT NULL,
  played   INTEGER     NOT NULL DEFAULT 0,
  wins     INTEGER     NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, game_id)
);

CREATE TABLE IF NOT EXISTS schema_migrations (
  name       VARCHAR(100) PRIMARY KEY,
  applied_at TIMESTAMPTZ  NOT NULL DEFAULT now()
);
