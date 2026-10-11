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
  `,
  /* 5 — planner: tarefas com agenda, prazo e quadro kanban */ `
  CREATE TABLE tasks (
    id             INTEGER PRIMARY KEY,
    title          TEXT    NOT NULL,
    description    TEXT    NOT NULL DEFAULT '',
    status         TEXT    NOT NULL DEFAULT 'todo' CHECK (status IN ('todo', 'doing', 'done')),
    position       REAL    NOT NULL DEFAULT 0,             -- ordem dentro da coluna do kanban
    scheduled_date TEXT,                                   -- 'AAAA-MM-DD', dia local
    scheduled_time TEXT,                                   -- 'HH:MM', só com data
    duration_min   INTEGER,
    due_date       TEXT,                                   -- prazo, 'AAAA-MM-DD'
    course_id      INTEGER REFERENCES courses(id) ON DELETE SET NULL,
    lesson_id      INTEGER REFERENCES lessons(id) ON DELETE SET NULL,
    completed_at   INTEGER,
    notified_at    INTEGER,                                -- aviso de início do bloco já enviado
    created_at     INTEGER NOT NULL DEFAULT (unixepoch()),
    updated_at     INTEGER NOT NULL DEFAULT (unixepoch())
  );
  CREATE INDEX tasks_board ON tasks(status, position);
  CREATE INDEX tasks_scheduled ON tasks(scheduled_date);
  CREATE INDEX tasks_due ON tasks(due_date);
  `,
  /* 6 — bancos de questões e simulados. Tentativas guardam cópia das questões (notas não mudam ao editar). */ `
  CREATE TABLE question_banks (
    id          INTEGER PRIMARY KEY,
    title       TEXT    NOT NULL,
    description TEXT    NOT NULL DEFAULT '',
    created_at  INTEGER NOT NULL DEFAULT (unixepoch()),
    updated_at  INTEGER NOT NULL DEFAULT (unixepoch())
  );

  CREATE TABLE questions (
    id          INTEGER PRIMARY KEY,
    bank_id     INTEGER NOT NULL REFERENCES question_banks(id) ON DELETE CASCADE,
    type        TEXT    NOT NULL CHECK (type IN ('single', 'multiple', 'truefalse', 'short', 'essay')),
    statement   TEXT    NOT NULL,
    options_json TEXT   NOT NULL DEFAULT '[]',
    key_json    TEXT    NOT NULL,
    explanation TEXT    NOT NULL DEFAULT '',
    topic       TEXT    NOT NULL DEFAULT '',
    difficulty  INTEGER NOT NULL DEFAULT 3 CHECK (difficulty BETWEEN 1 AND 5),
    points      REAL    NOT NULL DEFAULT 1,
    created_at  INTEGER NOT NULL DEFAULT (unixepoch()),
    updated_at  INTEGER NOT NULL DEFAULT (unixepoch())
  );
  CREATE INDEX questions_bank ON questions(bank_id, topic);

  CREATE TABLE exams (
    id             INTEGER PRIMARY KEY,
    bank_id        INTEGER NOT NULL REFERENCES question_banks(id) ON DELETE CASCADE,
    title          TEXT    NOT NULL,
    settings_json  TEXT    NOT NULL,
    selection_json TEXT    NOT NULL,
    created_at     INTEGER NOT NULL DEFAULT (unixepoch()),
    updated_at     INTEGER NOT NULL DEFAULT (unixepoch())
  );

  CREATE TABLE attempts (
    id              INTEGER PRIMARY KEY,
    exam_id         INTEGER NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
    status          TEXT    NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress', 'submitted')),
    started_at      INTEGER NOT NULL,
    submitted_at    INTEGER,
    time_limit_sec  INTEGER,
    settings_json   TEXT    NOT NULL,
    questions_json  TEXT    NOT NULL,   -- cópia das questões, na ordem da prova e com alternativas já embaralhadas
    score           REAL,
    max_score       REAL    NOT NULL,
    focus_losses    INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX attempts_exam ON attempts(exam_id, started_at);

  CREATE TABLE attempt_answers (
    attempt_id  INTEGER NOT NULL REFERENCES attempts(id) ON DELETE CASCADE,
    question_id INTEGER NOT NULL,       -- id da questão no momento da prova (sem FK: a cópia vale)
    answer_json TEXT,
    marked      INTEGER NOT NULL DEFAULT 0,
    correct     INTEGER,                -- NULL = pendente (dissertativa) ou sem resposta ainda
    points      REAL    NOT NULL DEFAULT 0,
    answered_at INTEGER,
    PRIMARY KEY (attempt_id, question_id)
  );

  CREATE TRIGGER search_question_ai AFTER INSERT ON questions BEGIN
    INSERT INTO search_index (rowid, title, body) VALUES (new.id * 8 + 6, new.statement, new.explanation);
  END;
  CREATE TRIGGER search_question_au AFTER UPDATE OF statement, explanation ON questions BEGIN
    UPDATE search_index SET title = new.statement, body = new.explanation WHERE rowid = new.id * 8 + 6;
  END;
  CREATE TRIGGER search_question_ad AFTER DELETE ON questions BEGIN
    DELETE FROM search_index WHERE rowid = old.id * 8 + 6;
  END;
  `
]
