-- 포스트에 라벨이 없던 판(계약 32)의 서버가 만든 DB. 그 판의 startServer를 한 번 띄워 sqlite_master에서 뜬 표에,
-- 그 판에서 쌓였을 포스트 둘(이슈가 열린 직접 충돌, 확인돼 이슈에 확인됨이 붙은 간접 충돌)을 넣었다. 이 파일은 고치지 않는다.
CREATE TABLE sessions (
    hash TEXT PRIMARY KEY,
    login TEXT NOT NULL,
    github_token TEXT NOT NULL
  ) STRICT;
CREATE TABLE people (
    login TEXT PRIMARY KEY,
    name TEXT NOT NULL
  ) STRICT;
CREATE TABLE works (
    login TEXT NOT NULL,
    branch TEXT NOT NULL,
    base TEXT NOT NULL,
    share TEXT NOT NULL,
    files TEXT NOT NULL,
    PRIMARY KEY (login, branch)
  ) STRICT;
CREATE TABLE lines (
    login TEXT NOT NULL,
    branch TEXT NOT NULL,
    text TEXT NOT NULL,
    at INTEGER NOT NULL,
    PRIMARY KEY (login, branch)
  ) STRICT;
CREATE TABLE agents (
    login TEXT NOT NULL,
    executor TEXT NOT NULL,
    PRIMARY KEY (login, executor)
  ) STRICT;
CREATE TABLE offline (
    login TEXT PRIMARY KEY,
    since INTEGER NOT NULL
  ) STRICT;
CREATE TABLE profiles (
    login TEXT PRIMARY KEY,
    presence TEXT NOT NULL,
    until INTEGER,
    message TEXT NOT NULL,
    emoji TEXT NOT NULL DEFAULT ''
  ) STRICT;
CREATE TABLE channels (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE COLLATE NOCASE
  , alert INTEGER REFERENCES messages (id), verdict TEXT, kind TEXT NOT NULL DEFAULT 'chat' CHECK (kind IN ('chat', 'forum')), issue INTEGER, issue_url TEXT, issue_title TEXT, issue_labels TEXT, issue_open INTEGER, issue_closed INTEGER) STRICT;
CREATE TABLE messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    channel TEXT NOT NULL REFERENCES channels (id),
    login TEXT NOT NULL,
    text TEXT,
    qa INTEGER UNIQUE REFERENCES qas (id),
    at INTEGER NOT NULL,
    note TEXT, decision INTEGER REFERENCES decisions (id), comment INTEGER, github INTEGER NOT NULL DEFAULT 0, alert INTEGER REFERENCES alerts (id),
    CHECK ((text IS NULL) != (qa IS NULL))
  ) STRICT;
CREATE INDEX messages_by_channel ON messages (channel, id);
CREATE UNIQUE INDEX channels_by_alert ON channels (alert);
CREATE TABLE verdict_comments (id INTEGER PRIMARY KEY) STRICT;
CREATE TABLE decisions (
    id INTEGER PRIMARY KEY,
    post TEXT NOT NULL REFERENCES channels (id),
    login TEXT NOT NULL,
    title TEXT NOT NULL,
    path TEXT NOT NULL,
    pull INTEGER NOT NULL,
    url TEXT NOT NULL,
    span TEXT NOT NULL,
    state TEXT NOT NULL DEFAULT 'proposed',
    at INTEGER NOT NULL
  , branch TEXT, deciders TEXT NOT NULL DEFAULT '[]', closes INTEGER NOT NULL DEFAULT 0, reopened INTEGER NOT NULL DEFAULT 0, early INTEGER NOT NULL DEFAULT 0, stuck TEXT) STRICT;
CREATE TABLE agreements (
    decision INTEGER NOT NULL REFERENCES decisions (id),
    login TEXT NOT NULL,
    PRIMARY KEY (decision, login)
  ) STRICT;
CREATE TABLE objections (
    decision INTEGER NOT NULL REFERENCES decisions (id),
    login TEXT NOT NULL,
    via TEXT NOT NULL CHECK (via IN ('post', 'github')),
    at INTEGER NOT NULL,
    PRIMARY KEY (decision, login, via)
  ) STRICT;
CREATE UNIQUE INDEX messages_by_comment ON messages (comment);
CREATE TABLE alerts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    pair TEXT NOT NULL,
    kind TEXT NOT NULL DEFAULT 'direct',
    works TEXT NOT NULL,
    files TEXT NOT NULL,
    resolved INTEGER,
    updated INTEGER NOT NULL
  , run TEXT, confirmed INTEGER NOT NULL DEFAULT 0, held INTEGER NOT NULL DEFAULT 0) STRICT;
CREATE UNIQUE INDEX alerts_open ON alerts (pair) WHERE resolved IS NULL;
CREATE TABLE inbox (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    login TEXT NOT NULL,
    branch TEXT NOT NULL,
    alert INTEGER REFERENCES alerts (id),
    news TEXT,
    at INTEGER NOT NULL,
    UNIQUE (login, branch, alert),
    CHECK ((alert IS NULL) != (news IS NULL))
  ) STRICT;
CREATE TABLE claims (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    login TEXT NOT NULL,
    branch TEXT NOT NULL,
    path TEXT NOT NULL,
    unit TEXT NOT NULL,
    symbol TEXT,
    lines TEXT,
    at INTEGER NOT NULL,
    stale INTEGER,
    plan TEXT
  ) STRICT;
CREATE TABLE feed (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kind TEXT NOT NULL,
    claim TEXT NOT NULL,
    at INTEGER NOT NULL
  ) STRICT;
CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  ) STRICT;
CREATE TABLE qas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    channel TEXT NOT NULL REFERENCES channels (id),
    login TEXT NOT NULL,
    executor TEXT NOT NULL,
    question TEXT NOT NULL,
    at INTEGER NOT NULL,
    visibility TEXT NOT NULL CHECK (visibility IN ('private', 'public')),
    answer TEXT,
    settled INTEGER
  ) STRICT;
CREATE INDEX qas_by_asker ON qas (login, channel, id);
CREATE TABLE questions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    login TEXT NOT NULL,
    branch TEXT NOT NULL,
    target TEXT NOT NULL,
    executor TEXT,
    text TEXT NOT NULL,
    at INTEGER NOT NULL,
    answer TEXT
  ) STRICT;
CREATE TABLE ask_off (login TEXT PRIMARY KEY) STRICT;
CREATE TABLE visits (
    day TEXT NOT NULL,
    login TEXT NOT NULL,
    PRIMARY KEY (day, login)
  ) STRICT;
CREATE TABLE merge_runs (
    fingerprint TEXT PRIMARY KEY,
    verdict TEXT NOT NULL,
    at INTEGER NOT NULL
  ) STRICT;
INSERT INTO channels (id, name, kind) VALUES ('f0', '부딪힘', 'forum');
INSERT INTO settings (key, value) VALUES ('alert_channel', 'f0');
INSERT INTO alerts (id, pair, kind, works, files, updated) VALUES (1, 'p1', 'direct',
  '[{"login":"alice","name":"alice","branch":"refund"},{"login":"bob","name":"bob","branch":"payment"}]',
  '[{"path":"src/pay.ts","lines":[[{"from":3,"to":3}],[{"from":3,"to":3}]]}]', 1);
INSERT INTO alerts (id, pair, kind, works, files, updated, run, confirmed) VALUES (2, 'indirect p2', 'indirect',
  '[{"login":"alice","name":"alice","branch":"refund"},{"login":"bob","name":"bob","branch":"payment"}]',
  '[{"name":"pay","places":[[{"path":"src/use.ts","line":2,"role":"uses"}],[{"path":"src/pay.ts","line":1,"role":"changed"}]]}]', 1,
  '{"verdict":"broken","omitted":[],"fingerprint":"f","stale":false,"login":"alice","at":"2026-11-16T00:00:00.000Z"}', 1);
INSERT INTO messages (id, channel, login, text, alert, at) VALUES (1, 'f0', '', '', 1, 1), (2, 'f0', '', '', 2, 2);
INSERT INTO channels (id, name, alert, issue, issue_url, issue_title, issue_labels, issue_open) VALUES
  ('a1', char(10) || 'a1', 1, 101, 'https://github.com/omagari-test/space/issues/101', 'pay.ts 직접 충돌', '["직접 충돌"]', 1);
INSERT INTO channels (id, name, alert, verdict, issue, issue_url, issue_title, issue_labels, issue_open) VALUES
  ('a2', char(10) || 'a2', 2, 'confirmed', 102, 'https://github.com/omagari-test/space/issues/102', 'pay 간접 충돌', '["간접 충돌","확인됨"]', 1);
