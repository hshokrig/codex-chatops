export const migrations = [
  `
    CREATE TABLE IF NOT EXISTS repos (
      id TEXT PRIMARY KEY,
      slug TEXT NOT NULL UNIQUE,
      category_name TEXT NOT NULL,
      local_path TEXT NOT NULL,
      default_branch TEXT NOT NULL,
      codex_profile TEXT NOT NULL,
      allowed_users_json TEXT NOT NULL,
      allowed_roles_json TEXT NOT NULL,
      checks_json TEXT NOT NULL,
      deploy_workflows_json TEXT NOT NULL,
      require_pr_approval INTEGER NOT NULL DEFAULT 1,
      require_prod_confirmation INTEGER NOT NULL DEFAULT 1,
      github_owner TEXT,
      github_repo TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `,
  `
    CREATE TABLE IF NOT EXISTS channel_bindings (
      channel_id TEXT PRIMARY KEY,
      repo_id TEXT,
      purpose TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (repo_id) REFERENCES repos(id)
    );
  `,
  `
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      platform TEXT NOT NULL,
      guild_id TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      thread_id TEXT NOT NULL UNIQUE,
      repo_id TEXT NOT NULL,
      codex_thread_id TEXT NOT NULL,
      worktree_path TEXT NOT NULL,
      branch_name TEXT NOT NULL,
      requested_by TEXT NOT NULL,
      title TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      archived_at TEXT
    );
  `,
  `
    CREATE TABLE IF NOT EXISTS runs (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      prompt TEXT NOT NULL,
      requested_by TEXT NOT NULL,
      status TEXT NOT NULL,
      result_summary TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      completed_at TEXT,
      FOREIGN KEY (session_id) REFERENCES sessions(id)
    );
  `,
  `
    CREATE TABLE IF NOT EXISTS approvals (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      run_id TEXT,
      type TEXT NOT NULL,
      status TEXT NOT NULL,
      requested_by TEXT NOT NULL,
      decided_by TEXT,
      created_at TEXT NOT NULL,
      decided_at TEXT,
      payload_json TEXT NOT NULL,
      FOREIGN KEY (session_id) REFERENCES sessions(id),
      FOREIGN KEY (run_id) REFERENCES runs(id)
    );
  `,
  `
    CREATE TABLE IF NOT EXISTS events (
      id TEXT PRIMARY KEY,
      session_id TEXT,
      run_id TEXT,
      ts TEXT NOT NULL,
      kind TEXT NOT NULL,
      payload_json TEXT NOT NULL
    );
  `,
  `
    CREATE TABLE IF NOT EXISTS usage_rollups (
      date TEXT NOT NULL,
      repo_slug TEXT NOT NULL,
      session_count INTEGER NOT NULL,
      run_count INTEGER NOT NULL,
      prompt_count INTEGER NOT NULL,
      success_count INTEGER NOT NULL,
      failure_count INTEGER NOT NULL,
      avg_run_ms INTEGER NOT NULL,
      active_session_count INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (date, repo_slug)
    );
  `
];
