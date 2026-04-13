import type { DatabaseClient } from "../persistence/db.js";
import type { UsageRollup } from "../types/domain.js";

function nowIso(): string {
  return new Date().toISOString();
}

export class UsageMetricsService {
  constructor(private readonly db: DatabaseClient) {}

  buildDailyRollups(date: string): UsageRollup[] {
    const rows = this.db.raw<
      Array<{
        repo_slug: string;
        session_count: number;
        run_count: number;
        prompt_count: number;
        success_count: number;
        failure_count: number;
        avg_run_ms: number;
        active_session_count: number;
      }>
    >(
      `
      SELECT
        repos.slug AS repo_slug,
        COUNT(DISTINCT sessions.id) AS session_count,
        COUNT(DISTINCT runs.id) AS run_count,
        COUNT(DISTINCT runs.id) AS prompt_count,
        SUM(CASE WHEN runs.status = 'succeeded' THEN 1 ELSE 0 END) AS success_count,
        SUM(CASE WHEN runs.status = 'failed' THEN 1 ELSE 0 END) AS failure_count,
        COALESCE(AVG(
          CASE
            WHEN runs.completed_at IS NOT NULL THEN
              (julianday(runs.completed_at) - julianday(runs.created_at)) * 86400000
            ELSE NULL
          END
        ), 0) AS avg_run_ms,
        SUM(CASE WHEN sessions.status IN ('open', 'running', 'awaiting_approval') THEN 1 ELSE 0 END) AS active_session_count
      FROM repos
      LEFT JOIN sessions ON sessions.repo_id = repos.id AND substr(sessions.created_at, 1, 10) = ?
      LEFT JOIN runs ON runs.session_id = sessions.id AND substr(runs.created_at, 1, 10) = ?
      GROUP BY repos.slug
      ORDER BY repos.slug ASC
    `,
      date,
      date
    );

    return rows.map((row) => ({
      date,
      repoSlug: row.repo_slug,
      sessionCount: Number(row.session_count ?? 0),
      runCount: Number(row.run_count ?? 0),
      promptCount: Number(row.prompt_count ?? 0),
      successCount: Number(row.success_count ?? 0),
      failureCount: Number(row.failure_count ?? 0),
      avgRunMs: Math.round(Number(row.avg_run_ms ?? 0)),
      activeSessionCount: Number(row.active_session_count ?? 0),
      createdAt: nowIso()
    }));
  }

  persistDailyRollups(date: string): UsageRollup[] {
    const rollups = this.buildDailyRollups(date);
    for (const rollup of rollups) {
      this.db.saveUsageRollup(rollup);
    }
    return rollups;
  }
}
