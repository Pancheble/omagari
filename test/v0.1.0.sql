-- v0.1.0 서버가 만든 DB. 그 판의 startServer를 한 번 띄워 sqlite_master에서 뜬 표에, 그 판에서 쌓였을 줄 몇 개를 넣었다.
-- 서버가 표를 바꾸면(열을 더하면) 이 DB로도 떠야 한다. 이 파일은 고치지 않는다.
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
    message TEXT NOT NULL
  ) STRICT;
CREATE TABLE channels (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE COLLATE NOCASE
  ) STRICT;
CREATE TABLE messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    channel TEXT NOT NULL REFERENCES channels (id),
    login TEXT NOT NULL,
    text TEXT,
    qa INTEGER UNIQUE REFERENCES qas (id),
    at INTEGER NOT NULL,
    CHECK ((text IS NULL) != (qa IS NULL))
  ) STRICT;
CREATE INDEX messages_by_channel ON messages (channel, id);
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
CREATE TABLE visits (
    day TEXT NOT NULL,
    login TEXT NOT NULL,
    PRIMARY KEY (day, login)
  ) STRICT;
INSERT INTO people (login, name) VALUES ('owner', 'owner'), ('alice', 'alice');
INSERT INTO profiles (login, presence, until, message) VALUES ('alice', 'online', NULL, '예전 상태');
INSERT INTO channels (id, name) VALUES ('c0', '결제');
INSERT INTO qas (id, channel, login, executor, question, at, visibility, answer, settled) VALUES
  (1, 'c0', 'owner', 'claude-code', '예전에 올린 질문', 1762900000000, 'public',
   '{"state":"answered","text":"예전 답","source":{"branch":"main","commit":"0123456789abcdef0123456789abcdef01234567","dirty":false}}',
   1762900005000);
INSERT INTO messages (id, channel, login, text, qa, at) VALUES
  (1, 'c0', 'alice', '예전 글', NULL, 1762899000000),
  (2, 'c0', 'owner', NULL, 1, 1762900010000);
