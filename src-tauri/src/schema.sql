PRAGMA journal_mode=WAL;
CREATE TABLE IF NOT EXISTS songs (
    id TEXT PRIMARY KEY, group_id TEXT NOT NULL, created_at TEXT NOT NULL,
    finished_at TEXT, status TEXT NOT NULL, message TEXT, title TEXT,
    caption TEXT NOT NULL, lyrics TEXT, seed INTEGER NOT NULL, params TEXT NOT NULL,
    result_meta TEXT, engine TEXT, file TEXT, favorite INTEGER NOT NULL DEFAULT 0,
    folder_id TEXT, started_at TEXT, audio_missing INTEGER NOT NULL DEFAULT 0,
    output_kind TEXT NOT NULL DEFAULT 'audio' CHECK (output_kind IN ('audio','midi'))
);
CREATE INDEX IF NOT EXISTS idx_songs_status ON songs(status);
CREATE INDEX IF NOT EXISTS idx_songs_group ON songs(group_id);
CREATE INDEX IF NOT EXISTS idx_songs_created_at ON songs(created_at);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS folders (id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS stem_models (
    model TEXT NOT NULL,
    repository TEXT NOT NULL,
    revision TEXT NOT NULL,
    active INTEGER NOT NULL,
    installed_at TEXT NOT NULL,
    artifact TEXT NOT NULL,
    PRIMARY KEY (model, repository, revision)
);
CREATE UNIQUE INDEX IF NOT EXISTS stem_models_active ON stem_models(model) WHERE active=1;

CREATE TABLE IF NOT EXISTS stem_model_transfers (
    model TEXT PRIMARY KEY,
    repository TEXT NOT NULL,
    revision TEXT NOT NULL,
    artifact TEXT NOT NULL,
    error TEXT
);

CREATE TABLE IF NOT EXISTS stem_sources (
    id TEXT PRIMARY KEY,
    song_id TEXT,
    data TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS stem_sources_song ON stem_sources(song_id);

CREATE TABLE IF NOT EXISTS stem_jobs (
    id TEXT PRIMARY KEY,
    source_id TEXT NOT NULL REFERENCES stem_sources(id),
    request TEXT NOT NULL,
    status TEXT NOT NULL,
    phase TEXT NOT NULL,
    error TEXT,
    created_at TEXT NOT NULL,
    finished_at TEXT,
    result TEXT
);
CREATE INDEX IF NOT EXISTS stem_jobs_queue ON stem_jobs(status, created_at);
CREATE INDEX IF NOT EXISTS stem_jobs_source ON stem_jobs(source_id);

CREATE TABLE IF NOT EXISTS stem_mixes (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES stem_jobs(id),
    name TEXT NOT NULL,
    data TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS stem_mixes_project ON stem_mixes(project_id, updated_at);

CREATE TABLE IF NOT EXISTS stem_exports (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES stem_jobs(id),
    request TEXT NOT NULL,
    status TEXT NOT NULL,
    progress INTEGER NOT NULL DEFAULT 0,
    error TEXT,
    created_at TEXT NOT NULL,
    finished_at TEXT,
    result TEXT
);
CREATE INDEX IF NOT EXISTS stem_exports_queue ON stem_exports(status, created_at);

CREATE TABLE IF NOT EXISTS stem_layers (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES stem_jobs(id),
    source_id TEXT NOT NULL REFERENCES stem_sources(id),
    created_at TEXT NOT NULL
);
