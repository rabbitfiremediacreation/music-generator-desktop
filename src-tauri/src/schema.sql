PRAGMA journal_mode=WAL;
CREATE TABLE IF NOT EXISTS songs (
    id TEXT PRIMARY KEY, group_id TEXT NOT NULL, created_at TEXT NOT NULL,
    finished_at TEXT, status TEXT NOT NULL, message TEXT, title TEXT,
    caption TEXT NOT NULL, lyrics TEXT, seed INTEGER NOT NULL, params TEXT NOT NULL,
    result_meta TEXT, engine TEXT, file TEXT, favorite INTEGER NOT NULL DEFAULT 0,
    folder_id TEXT, started_at TEXT, audio_missing INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_songs_status ON songs(status);
CREATE INDEX IF NOT EXISTS idx_songs_group ON songs(group_id);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS folders (id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at TEXT NOT NULL);
