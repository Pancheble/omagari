-- 워크스페이스가 하나이던 판(계약 46, 도그푸딩 서버의 둘째 배포)의 서버가 만든 DB. 그 판의 startServer를 한 번 띄워 sqlite_master에서 뜬 표에,
-- 그 판에서 쌓였을 것(alice의 세션과 권한, 작업, 알림과 포스트, 결정, 채팅 채널 하나와 글, 문답, 방문, 합쳐 돌려 본 판정)을 넣었다. 이 파일은 고치지 않는다.
-- 표를 만든 순서대로 넣어도 외래 키가 서로를 가리켜(channels.alert, messages.channel) 넣는 동안은 꺼 둔다.
PRAGMA foreign_keys = OFF;
CREATE TABLE sessions (
    hash TEXT PRIMARY KEY,
    login TEXT NOT NULL,
    github_token TEXT NOT NULL
  ) STRICT;
CREATE TABLE people (
    login TEXT PRIMARY KEY,
    name TEXT NOT NULL
  ) STRICT;
CREATE TABLE agents (
    login TEXT NOT NULL,
    executor TEXT NOT NULL,
    PRIMARY KEY (login, executor)
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
  , alert INTEGER REFERENCES messages (id), verdict TEXT, kind TEXT NOT NULL DEFAULT 'chat' CHECK (kind IN ('chat', 'forum')), issue INTEGER, issue_url TEXT, issue_title TEXT, issue_labels TEXT, issue_open INTEGER, issue_closed INTEGER, labels TEXT, filter TEXT, repo TEXT) STRICT;
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
  , branch TEXT, deciders TEXT NOT NULL DEFAULT '[]', closes INTEGER NOT NULL DEFAULT 0, reopened INTEGER NOT NULL DEFAULT 0, early INTEGER NOT NULL DEFAULT 0, stuck TEXT, absent TEXT NOT NULL DEFAULT '[]') STRICT;
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
  , run TEXT, confirmed INTEGER NOT NULL DEFAULT 0, held INTEGER NOT NULL DEFAULT 0, repo TEXT NOT NULL DEFAULT '') STRICT;
CREATE TABLE inbox (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    login TEXT NOT NULL,
    branch TEXT NOT NULL,
    alert INTEGER REFERENCES alerts (id),
    news TEXT,
    at INTEGER NOT NULL, repo TEXT NOT NULL DEFAULT '',
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
  , repo TEXT NOT NULL DEFAULT '') STRICT;
CREATE TABLE feed (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kind TEXT NOT NULL,
    claim TEXT NOT NULL,
    at INTEGER NOT NULL
  , repo TEXT NOT NULL DEFAULT '') STRICT;
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
  , repo TEXT NOT NULL DEFAULT '') STRICT;
CREATE TABLE ask_off (login TEXT PRIMARY KEY) STRICT;
CREATE TABLE debates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    post TEXT NOT NULL UNIQUE,
    round INTEGER NOT NULL DEFAULT 1,
    at INTEGER NOT NULL,
    state TEXT NOT NULL DEFAULT 'open' CHECK (state IN ('open', 'choosing', 'concluded', 'ended')),
    flip INTEGER NOT NULL DEFAULT 0,
    winner INTEGER,
    by TEXT,
    chooser TEXT,
    decided INTEGER,
    expired INTEGER NOT NULL DEFAULT 0
  ) STRICT;
CREATE TABLE debate_requests (
    post TEXT PRIMARY KEY,
    login TEXT NOT NULL,
    agenda TEXT NOT NULL,
    grounds TEXT NOT NULL,
    opened INTEGER NOT NULL,
    at INTEGER NOT NULL
  ) STRICT;
CREATE TABLE seats (
    debate INTEGER NOT NULL,
    seat INTEGER NOT NULL,
    login TEXT NOT NULL,
    branch TEXT NOT NULL,
    state TEXT NOT NULL CHECK (state IN ('waiting', 'submitted', 'off', 'failed')),
    stance TEXT,
    error TEXT,
    proxy TEXT,
    PRIMARY KEY (debate, seat)
  ) STRICT;
CREATE TABLE debate_comments (
    debate INTEGER NOT NULL,
    seat INTEGER NOT NULL,
    round INTEGER NOT NULL,
    id INTEGER NOT NULL,
    PRIMARY KEY (debate, seat, round)
  ) STRICT;
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
CREATE TABLE repos (
    name TEXT PRIMARY KEY COLLATE NOCASE,
    at INTEGER NOT NULL
  ) STRICT;
CREATE TABLE access (
    login TEXT NOT NULL,
    repo TEXT NOT NULL,
    PRIMARY KEY (login, repo)
  ) STRICT;
CREATE TABLE "works" (repo TEXT NOT NULL, login TEXT NOT NULL, branch TEXT NOT NULL, base TEXT NOT NULL,
      share TEXT NOT NULL, files TEXT NOT NULL, PRIMARY KEY (repo, login, branch)) STRICT;
CREATE TABLE "lines" (repo TEXT NOT NULL, login TEXT NOT NULL, branch TEXT NOT NULL, text TEXT NOT NULL,
      at INTEGER NOT NULL, PRIMARY KEY (repo, login, branch)) STRICT;
CREATE TABLE "work_agents" (repo TEXT NOT NULL, login TEXT NOT NULL, branch TEXT NOT NULL, executor TEXT NOT NULL,
      PRIMARY KEY (repo, login, branch)) STRICT;
CREATE TABLE "offline" (repo TEXT NOT NULL, login TEXT NOT NULL, since INTEGER NOT NULL, PRIMARY KEY (repo, login)) STRICT;
CREATE TABLE "labels" (repo TEXT NOT NULL, name TEXT NOT NULL COLLATE NOCASE, github INTEGER, color TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      importance TEXT NOT NULL DEFAULT 'reference' CHECK (importance IN ('reference', 'discuss')),
      UNIQUE (repo, name), UNIQUE (repo, github)) STRICT;
CREATE UNIQUE INDEX alerts_open ON alerts (repo, pair) WHERE resolved IS NULL;
INSERT INTO sessions (hash, login, github_token) VALUES ('42ed3ac47d541d0ab162c9f67bc3ae8482cfef2ef8a047d77f17579ef16d6bf3', 'alice', 'gho_old_alice');
INSERT INTO people (login, name) VALUES ('alice', '앨리스');
INSERT INTO channels (id, name, alert, verdict, kind, issue, issue_url, issue_title, issue_labels, issue_open, issue_closed, labels, filter, repo) VALUES ('alerts', '
alerts', NULL, NULL, 'forum', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL);
INSERT INTO channels (id, name, alert, verdict, kind, issue, issue_url, issue_title, issue_labels, issue_open, issue_closed, labels, filter, repo) VALUES ('fcba89fa0e46107e', '참고', NULL, NULL, 'forum', NULL, NULL, NULL, NULL, NULL, NULL, NULL, '{"importance":"reference"}', NULL);
INSERT INTO channels (id, name, alert, verdict, kind, issue, issue_url, issue_title, issue_labels, issue_open, issue_closed, labels, filter, repo) VALUES ('1f8117e36dd9e02f', '논의', NULL, NULL, 'forum', NULL, NULL, NULL, NULL, NULL, NULL, NULL, '{"importance":"discuss"}', NULL);
INSERT INTO channels (id, name, alert, verdict, kind, issue, issue_url, issue_title, issue_labels, issue_open, issue_closed, labels, filter, repo) VALUES ('p1', '
p1', 1, NULL, 'chat', NULL, NULL, NULL, NULL, NULL, NULL, '["직접 충돌"]', NULL, 'omagari-test/space');
INSERT INTO channels (id, name, alert, verdict, kind, issue, issue_url, issue_title, issue_labels, issue_open, issue_closed, labels, filter, repo) VALUES ('c1', '일반', NULL, NULL, 'chat', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL);
INSERT INTO messages (id, channel, login, text, qa, at, note, decision, comment, github, alert) VALUES (1, 'alerts', '', '', NULL, 1790000000000, NULL, NULL, NULL, 0, 1);
INSERT INTO messages (id, channel, login, text, qa, at, note, decision, comment, github, alert) VALUES (2, 'p1', 'alice', '이건 제가 고칠게요', NULL, 1790000000001, NULL, NULL, NULL, 0, NULL);
INSERT INTO messages (id, channel, login, text, qa, at, note, decision, comment, github, alert) VALUES (3, 'p1', '', 'opened', NULL, 1790000000002, NULL, 1, NULL, 0, NULL);
INSERT INTO messages (id, channel, login, text, qa, at, note, decision, comment, github, alert) VALUES (4, 'c1', 'alice', '안녕하세요', NULL, 1790000000003, NULL, NULL, NULL, 0, NULL);
INSERT INTO decisions (id, post, login, title, path, pull, url, span, state, at, branch, deciders, closes, reopened, early, stuck, absent) VALUES (1, 'p1', 'alice', '결제는 alice가', 'docs/decisions/0001-pay.md', 7, 'https://github.com/omagari-test/space/pull/7', 'three_days', 'proposed', 1790000000002, 'omagari/decision-0001-aaaaaa', '["alice"]', 4102444800000, 0, 0, NULL, '[]');
INSERT INTO alerts (id, pair, kind, works, files, resolved, updated, run, confirmed, held, repo) VALUES (1, '["alice","payment","owner","refund"]', 'direct', '[{"login":"alice","name":"앨리스","branch":"payment"},{"login":"owner","name":"owner","branch":"refund"}]', '[{"path":"src/pay.ts","unknown":"share"}]', NULL, 1790000000000, NULL, 0, 0, 'omagari-test/space');
INSERT INTO settings (key, value) VALUES ('check omagari-test/space', '{"problem":"missing"}');
INSERT INTO qas (id, channel, login, executor, question, at, visibility, answer, settled) VALUES (1, 'c1', 'alice', 'claude-code', '이건 뭐죠?', 1790000000004, 'private', '{"state":"answered","text":"네"}', 1790000000005);
INSERT INTO visits (day, login) VALUES ('2026-11-18', 'alice');
INSERT INTO merge_runs (fingerprint, verdict, at) VALUES ('fp1', 'pass', 1790000000006);
INSERT INTO repos (name, at) VALUES ('omagari-test/space', 1795021955935);
INSERT INTO access (login, repo) VALUES ('alice', 'omagari-test/space');
INSERT INTO works (repo, login, branch, base, share, files) VALUES ('omagari-test/space', 'alice', 'payment', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'full', '[]');
INSERT INTO lines (repo, login, branch, text, at) VALUES ('omagari-test/space', 'alice', 'payment', '결제 고치는 중', 1790000000000);
INSERT INTO work_agents (repo, login, branch, executor) VALUES ('omagari-test/space', 'alice', 'payment', 'claude-code');
INSERT INTO labels (repo, name, github, color, description, importance) VALUES ('omagari-test/space', '직접 충돌', NULL, 'd93f0b', '', 'discuss');
INSERT INTO labels (repo, name, github, color, description, importance) VALUES ('omagari-test/space', '간접 충돌', NULL, 'fbca04', '', 'reference');
INSERT INTO labels (repo, name, github, color, description, importance) VALUES ('omagari-test/space', '중복 구현', NULL, 'c5def5', '', 'reference');
INSERT INTO labels (repo, name, github, color, description, importance) VALUES ('omagari-test/space', '계약 변경', NULL, '5319e7', '', 'discuss');
INSERT INTO labels (repo, name, github, color, description, importance) VALUES ('omagari-test/space', '확인됨', NULL, 'b60205', '', 'discuss');
