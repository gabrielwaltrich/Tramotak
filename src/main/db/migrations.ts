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
  `,
  /* 3 — busca global (FTS5). rowid = id * 8 + tipo: 1 curso, 2 módulo, 3 aula, 4 anotação */ `
  CREATE VIRTUAL TABLE search_index USING fts5(
    title, body,
    tokenize = 'unicode61 remove_diacritics 2'
  );

  CREATE TRIGGER search_course_ai AFTER INSERT ON courses BEGIN
    INSERT INTO search_index (rowid, title, body) VALUES (new.id * 8 + 1, new.title, new.description);
  END;
  CREATE TRIGGER search_course_au AFTER UPDATE OF title, description ON courses BEGIN
    UPDATE search_index SET title = new.title, body = new.description WHERE rowid = new.id * 8 + 1;
  END;
  CREATE TRIGGER search_course_ad AFTER DELETE ON courses BEGIN
    DELETE FROM search_index WHERE rowid = old.id * 8 + 1;
  END;

  CREATE TRIGGER search_module_ai AFTER INSERT ON modules BEGIN
    INSERT INTO search_index (rowid, title, body) VALUES (new.id * 8 + 2, new.title, '');
  END;
  CREATE TRIGGER search_module_au AFTER UPDATE OF title ON modules BEGIN
    UPDATE search_index SET title = new.title WHERE rowid = new.id * 8 + 2;
  END;
  CREATE TRIGGER search_module_ad AFTER DELETE ON modules BEGIN
    DELETE FROM search_index WHERE rowid = old.id * 8 + 2;
  END;

  CREATE TRIGGER search_lesson_ai AFTER INSERT ON lessons BEGIN
    INSERT INTO search_index (rowid, title, body) VALUES (new.id * 8 + 3, new.title, '');
  END;
  CREATE TRIGGER search_lesson_au AFTER UPDATE OF title ON lessons BEGIN
    UPDATE search_index SET title = new.title WHERE rowid = new.id * 8 + 3;
  END;
  CREATE TRIGGER search_lesson_ad AFTER DELETE ON lessons BEGIN
    DELETE FROM search_index WHERE rowid = old.id * 8 + 3;
  END;

  CREATE TRIGGER search_note_ai AFTER INSERT ON notes BEGIN
    INSERT INTO search_index (rowid, title, body) VALUES (new.id * 8 + 4, '', new.body_md);
  END;
  CREATE TRIGGER search_note_au AFTER UPDATE OF body_md ON notes BEGIN
    UPDATE search_index SET body = new.body_md WHERE rowid = new.id * 8 + 4;
  END;
  CREATE TRIGGER search_note_ad AFTER DELETE ON notes BEGIN
    DELETE FROM search_index WHERE rowid = old.id * 8 + 4;
  END;

  INSERT INTO search_index (rowid, title, body) SELECT id * 8 + 1, title, description FROM courses;
  INSERT INTO search_index (rowid, title, body) SELECT id * 8 + 2, title, '' FROM modules;
  INSERT INTO search_index (rowid, title, body) SELECT id * 8 + 3, title, '' FROM lessons;
  INSERT INTO search_index (rowid, title, body) SELECT id * 8 + 4, '', body_md FROM notes;
  `,
  /* 4 — flashcards com repetição espaçada (SM-2). Cards entram na busca com tipo 5. */ `
  CREATE TABLE decks (
    id          INTEGER PRIMARY KEY,
    title       TEXT    NOT NULL,
    description TEXT    NOT NULL DEFAULT '',
    course_id   INTEGER REFERENCES courses(id) ON DELETE SET NULL,
    created_at  INTEGER NOT NULL DEFAULT (unixepoch()),
    updated_at  INTEGER NOT NULL DEFAULT (unixepoch())
  );

  CREATE TABLE cards (
    id             INTEGER PRIMARY KEY,
    deck_id        INTEGER NOT NULL REFERENCES decks(id) ON DELETE CASCADE,
    front          TEXT    NOT NULL,
    back           TEXT    NOT NULL DEFAULT '',
    lesson_id      INTEGER REFERENCES lessons(id) ON DELETE SET NULL,
    timestamp_sec  REAL,
    state          TEXT    NOT NULL DEFAULT 'new' CHECK (state IN ('new', 'learning', 'review', 'relearning')),
    step           INTEGER NOT NULL DEFAULT 0,
    interval_days  REAL    NOT NULL DEFAULT 0,
    ease           REAL    NOT NULL DEFAULT 2.5,
    due            INTEGER NOT NULL DEFAULT 0,
    reps           INTEGER NOT NULL DEFAULT 0,
    lapses         INTEGER NOT NULL DEFAULT 0,
    last_review_at INTEGER,
    created_at     INTEGER NOT NULL DEFAULT (unixepoch()),
    updated_at     INTEGER NOT NULL DEFAULT (unixepoch())
  );
  CREATE INDEX cards_queue ON cards(deck_id, state, due);
  CREATE INDEX cards_lesson ON cards(lesson_id);

  CREATE TABLE reviews (
    id              INTEGER PRIMARY KEY,
    card_id         INTEGER NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
    reviewed_at     INTEGER NOT NULL,
    rating          INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 4),
    state_before    TEXT    NOT NULL,
    interval_before REAL    NOT NULL,
    interval_after  REAL    NOT NULL,
    ease_after      REAL    NOT NULL,
    duration_ms     INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX reviews_card ON reviews(card_id, reviewed_at);
  CREATE INDEX reviews_day ON reviews(reviewed_at);

  CREATE TRIGGER search_card_ai AFTER INSERT ON cards BEGIN
    INSERT INTO search_index (rowid, title, body) VALUES (new.id * 8 + 5, new.front, new.back);
  END;
  CREATE TRIGGER search_card_au AFTER UPDATE OF front, back ON cards BEGIN
    UPDATE search_index SET title = new.front, body = new.back WHERE rowid = new.id * 8 + 5;
  END;
  CREATE TRIGGER search_card_ad AFTER DELETE ON cards BEGIN
    DELETE FROM search_index WHERE rowid = old.id * 8 + 5;
  END;
  `
]
