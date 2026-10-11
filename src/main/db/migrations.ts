/**
 * Migrations em ordem. A versão aplicada fica em `PRAGMA user_version`.
 * Nunca edite uma migration já publicada: crie uma nova no fim da lista.
 */
export const MIGRATIONS: string[] = [
  /* 1 — biblioteca, progresso, anotações e sessões de estudo */ `
  CREATE TABLE courses (
    id             INTEGER PRIMARY KEY,
    title          TEXT    NOT NULL,
    description    TEXT    NOT NULL DEFAULT '',
    root_path      TEXT    NOT NULL,
    structure      TEXT    NOT NULL CHECK (structure IN ('flat', 'modules', 'submodules')),
    numbering      TEXT    NOT NULL CHECK (numbering IN ('dot', 'dash', 'none')),
    cover_path     TEXT,
    created_at     INTEGER NOT NULL DEFAULT (unixepoch()),
    updated_at     INTEGER NOT NULL DEFAULT (unixepoch()),
    last_opened_at INTEGER
  );

  CREATE TABLE modules (
    id        INTEGER PRIMARY KEY,
    course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    parent_id INTEGER REFERENCES modules(id) ON DELETE CASCADE,
    title     TEXT    NOT NULL,
    rel_path  TEXT    NOT NULL,
    position  INTEGER NOT NULL
  );
  CREATE INDEX modules_course ON modules(course_id, parent_id, position);

  CREATE TABLE lessons (
    id           INTEGER PRIMARY KEY,
    course_id    INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    module_id    INTEGER REFERENCES modules(id) ON DELETE CASCADE, -- NULL = aula na raiz do curso
    title        TEXT    NOT NULL,
    rel_path     TEXT    NOT NULL,
    kind         TEXT    NOT NULL CHECK (kind IN ('video', 'text', 'document')),
    duration_sec REAL,
    position     INTEGER NOT NULL,
    file_size    INTEGER NOT NULL,
    mtime_ms     INTEGER NOT NULL,
    UNIQUE (course_id, rel_path)
  );
  CREATE INDEX lessons_module ON lessons(course_id, module_id, position);

  CREATE TABLE lesson_assets (
    id        INTEGER PRIMARY KEY,
    lesson_id INTEGER NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
    kind      TEXT    NOT NULL CHECK (kind IN ('subtitle', 'attachment')),
    rel_path  TEXT    NOT NULL,
    lang      TEXT
  );
  CREATE INDEX lesson_assets_lesson ON lesson_assets(lesson_id);

  CREATE TABLE lesson_progress (
    lesson_id       INTEGER PRIMARY KEY REFERENCES lessons(id) ON DELETE CASCADE,
    position_sec    REAL    NOT NULL DEFAULT 0,
    duration_sec    REAL,
    completed_at    INTEGER,
    favorite        INTEGER NOT NULL DEFAULT 0,
    last_watched_at INTEGER
  );
  CREATE INDEX lesson_progress_recent ON lesson_progress(last_watched_at);

  CREATE TABLE notes (
    id            INTEGER PRIMARY KEY,
    lesson_id     INTEGER NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
    timestamp_sec REAL,
    body_md       TEXT    NOT NULL,
    created_at    INTEGER NOT NULL DEFAULT (unixepoch()),
    updated_at    INTEGER NOT NULL DEFAULT (unixepoch())
  );
  CREATE INDEX notes_lesson ON notes(lesson_id, timestamp_sec);

  CREATE TABLE study_sessions (
    id         INTEGER PRIMARY KEY,
    lesson_id  INTEGER REFERENCES lessons(id) ON DELETE SET NULL,
    started_at INTEGER NOT NULL,
    ended_at   INTEGER NOT NULL,
    seconds    INTEGER NOT NULL
  );
  CREATE INDEX study_sessions_day ON study_sessions(started_at);

  CREATE TABLE settings (
    key        TEXT PRIMARY KEY,
    value_json TEXT NOT NULL
  );
  `,
  /* 2 — estrutura escolhida no import (inclui 'auto'), usada ao revalidar */ `
  ALTER TABLE courses ADD COLUMN scan_structure TEXT NOT NULL DEFAULT 'auto'
    CHECK (scan_structure IN ('auto', 'flat', 'modules', 'submodules'));
  `
]
