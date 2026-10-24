-- 003_friends.sql — daftar teman (satu arah: user_id menambahkan friend_id).
CREATE TABLE IF NOT EXISTS friendships (
  user_id    BIGINT      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  friend_id  BIGINT      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, friend_id),
  CHECK (user_id <> friend_id)
);
