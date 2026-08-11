export interface Migration {
  id: number
  name: string
  sql: string
}

export const MIGRATIONS: Migration[] = [
  {
    id: 1,
    name: 'init',
    sql: `
      CREATE TABLE users (
        id            TEXT PRIMARY KEY,
        nickname      TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        password_salt TEXT NOT NULL,
        invited_by    TEXT REFERENCES users(id),
        created_at    INTEGER NOT NULL
      );

      CREATE TABLE invite_codes (
        code       TEXT PRIMARY KEY,
        created_by TEXT REFERENCES users(id),
        used_by    TEXT REFERENCES users(id),
        created_at INTEGER NOT NULL,
        used_at    INTEGER
      );

      CREATE TABLE sessions (
        token      TEXT PRIMARY KEY,
        user_id    TEXT NOT NULL REFERENCES users(id),
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL
      );
      CREATE INDEX idx_sessions_user ON sessions(user_id);

      CREATE TABLE friendships (
        user_a     TEXT NOT NULL REFERENCES users(id),
        user_b     TEXT NOT NULL REFERENCES users(id),
        created_at INTEGER NOT NULL,
        PRIMARY KEY (user_a, user_b)
      );

      CREATE TABLE friend_requests (
        id          TEXT PRIMARY KEY,
        from_user   TEXT NOT NULL REFERENCES users(id),
        to_user     TEXT NOT NULL REFERENCES users(id),
        status      TEXT NOT NULL CHECK (status IN ('pending','accepted','rejected')),
        created_at  INTEGER NOT NULL,
        resolved_at INTEGER
      );
      CREATE UNIQUE INDEX idx_friend_req_pair
        ON friend_requests(from_user, to_user) WHERE status = 'pending';

      -- 复式记账流水。account 形如 'user:<id>' 或 'system:mint'
      CREATE TABLE ledger_entries (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        txn_id     TEXT NOT NULL,
        account    TEXT NOT NULL,
        delta      INTEGER NOT NULL,
        reason     TEXT NOT NULL,
        ref_id     TEXT,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX idx_ledger_account ON ledger_entries(account);
      CREATE INDEX idx_ledger_txn ON ledger_entries(txn_id);

      CREATE TABLE loans (
        id         TEXT PRIMARY KEY,
        lender     TEXT NOT NULL REFERENCES users(id),
        borrower   TEXT NOT NULL REFERENCES users(id),
        principal  INTEGER NOT NULL CHECK (principal > 0),
        repaid     INTEGER NOT NULL DEFAULT 0 CHECK (repaid >= 0),
        status     TEXT NOT NULL CHECK (status IN ('open','settled')),
        created_at INTEGER NOT NULL,
        settled_at INTEGER
      );
      CREATE INDEX idx_loans_lender ON loans(lender);
      CREATE INDEX idx_loans_borrower ON loans(borrower);

      CREATE TABLE daily_claims (
        user_id TEXT NOT NULL REFERENCES users(id),
        day     TEXT NOT NULL,
        amount  INTEGER NOT NULL,
        PRIMARY KEY (user_id, day)
      );

      CREATE TABLE rooms (
        id         TEXT PRIMARY KEY,
        game_id    TEXT NOT NULL,
        owner_id   TEXT NOT NULL REFERENCES users(id),
        options    TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        closed_at  INTEGER
      );

      CREATE TABLE match_records (
        id         TEXT PRIMARY KEY,
        room_id    TEXT NOT NULL,
        game_id    TEXT NOT NULL,
        seed       INTEGER NOT NULL,
        players    TEXT NOT NULL,
        actions    TEXT NOT NULL,
        deltas     TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX idx_match_room ON match_records(room_id);
    `,
  },
]
