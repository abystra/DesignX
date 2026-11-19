import { z } from "zod";
import {
  pool,
  tenantTransaction,
  type Tx,
} from "../packages/server-infra/src/db.js";
export type Scope = { workspaceId?: string; all?: boolean };
export async function scopedWorkspaces(scope: Scope) {
  if (Boolean(scope.workspaceId) === Boolean(scope.all))
    throw new Error("Choose exactly one explicit --workspace UUID or --all");
  if (scope.workspaceId) z.uuid().parse(scope.workspaceId);
  const rows = (
    await pool.query(
      "SELECT id FROM workspaces WHERE ($1::text IS NULL OR id=$1) ORDER BY id",
      [scope.workspaceId || null],
    )
  ).rows;
  if (scope.workspaceId && !rows.length) throw new Error("Workspace not found");
  return rows.map((r) => r.id as string);
}
export async function operationalReport(scope: Scope, days = 30) {
  z.number().int().min(1).max(90).parse(days);
  const workspaceIds = await scopedWorkspaces(scope),
    end = new Date(),
    start = new Date(end.getTime() - days * 86400000),
    workspaces = [];
  let registered = 0,
    cohortFirstExport = 0,
    cohortFirstProject = 0;
  const events: Record<string, number> = {},
    exports: Record<string, number> = {};
  for (const workspaceId of workspaceIds) {
    const row = await tenantTransaction(workspaceId, async (tx) => {
      const settings = (
        await tx.query(
          "SELECT excluded,tracking_started_at FROM product_metrics_settings",
        )
      ).rows[0];
      const excluded = !!settings?.excluded;
      const generations = (
        await tx.query(
          "SELECT execution_status,settlement_status,count(*)::int FROM creative_requests GROUP BY 1,2",
        )
      ).rows;
      const calls = (
        await tx.query(
          "SELECT provider,model,cost_status,count(*)::int,sum(cost_usd) AS known_cost_usd FROM provider_calls GROUP BY 1,2,3",
        )
      ).rows;
      const holds = (
        await tx.query(
          "SELECT count(*)::int AS reserved,count(*) FILTER(WHERE expires_at<now())::int AS overdue FROM quota_reservations WHERE status='reserved'",
        )
      ).rows[0];
      const leases = (
        await tx.query(
          "SELECT count(*)::int AS active,count(*) FILTER(WHERE deadline_at<now() OR lease_until<now())::int AS expired FROM ai_attempts WHERE status='active'",
        )
      ).rows[0];
      const queues = (
        await tx.query(
          "SELECT kind,status,count(*)::int,min(created_at) AS oldest FROM jobs WHERE status IN ('queued','running','failed') GROUP BY 1,2",
        )
      ).rows;
      const facts = (
        await tx.query(
          "SELECT event,count(*)::int FROM product_events WHERE created_at>=$1 AND created_at<$2 GROUP BY event",
          [start, end],
        )
      ).rows;
      const exportStates = (
        await tx.query(
          "SELECT j.status,count(*)::int FROM jobs j JOIN projects p ON p.id=j.project_id WHERE j.kind='render.export' AND p.workspace_mode='editor' AND j.created_at>=$1 AND j.created_at<$2 GROUP BY j.status",
          [start, end],
        )
      ).rows;
      const cohort = !!(
        await tx.query(
          "SELECT 1 FROM product_milestones WHERE kind='registration_completed' AND created_at>=$1 AND created_at<$2",
          [start, end],
        )
      ).rowCount;
      const firstProject = !!(
        await tx.query(
          "SELECT 1 FROM product_events e JOIN projects p ON p.id=e.project_id WHERE e.event='project_created' AND p.workspace_mode='editor' AND e.created_at<$1 LIMIT 1",
          [end],
        )
      ).rowCount;
      const firstExport = !!(
        await tx.query(
          "SELECT 1 FROM product_events e JOIN projects p ON p.id=e.project_id WHERE e.event='export_completed' AND p.workspace_mode='editor' AND e.created_at<$1 LIMIT 1",
          [end],
        )
      ).rowCount;
      const feedback = (
        await tx.query(
          "SELECT status,count(*)::int FROM feedback GROUP BY status",
        )
      ).rows;
      return {
        workspaceId,
        excluded,
        trackingStartedAt: settings?.tracking_started_at || null,
        generations,
        calls,
        holds,
        leases,
        queues,
        feedback,
        facts,
        exportStates,
        cohort,
        firstProject,
        firstExport,
      };
    });
    workspaces.push(row);
    if (!row.excluded) {
      if (row.cohort) {
        registered++;
        if (row.firstProject) cohortFirstProject++;
        if (row.firstExport) cohortFirstExport++;
      }
      for (const fact of row.facts)
        events[fact.event] = (events[fact.event] || 0) + fact.count;
      for (const state of row.exportStates)
        exports[state.status] = (exports[state.status] || 0) + state.count;
    }
  }
  const terminal = (exports.succeeded || 0) + (exports.failed || 0);
  return {
    generatedAt: new Date().toISOString(),
    scope: { ...scope, workspaces: workspaceIds.length },
    window: { start: start.toISOString(), end: end.toISOString(), days },
    metrics: {
      excludedWorkspaces: workspaces.filter((w) => w.excluded).length,
      registeredCohort: registered,
      cohortFirstPosterProject: cohortFirstProject,
      cohortFirstPosterExport: cohortFirstExport,
      firstPosterExportRate: registered ? cohortFirstExport / registered : null,
      exports,
      terminalExportFailureRate: terminal
        ? (exports.failed || 0) / terminal
        : null,
      events,
    },
    definitions: {
      cohort:
        "New registrations recorded in window; legacy accounts with no registration fact are not backfilled. Excluded fixtures do not enter metrics.",
      firstPosterExportRate:
        "Registered cohort workspaces with at least one completed Editor-project export before window end / registered cohort; observation time differs by registration date.",
      terminalExportFailureRate:
        "Currently failed Editor export jobs created in window / currently failed or succeeded such jobs. Cancelled/queued/running are separate; not per-attempt failure history.",
      download_requested:
        "First authorized export GET with bytes prepared by server, deduplicated per export. Does not prove client receipt or device save.",
      opens:
        "Authorized client visit requests, deduplicated per visit within 180-day event retention; not proof of human viewing.",
      operational:
        "Queues, provider calls, holds and leases include excluded workspaces and are scoped with tenantTransaction; status sampled at query time.",
    },
    workspaces,
  };
}
export async function metricsExclusion(
  tx: Tx,
  workspaceId: string,
  excluded: boolean,
  reason: string,
) {
  z.boolean().parse(excluded);
  z.string().trim().min(1).max(200).parse(reason);
  await tx.query(
    "INSERT INTO product_metrics_settings(workspace_id,excluded,reason) VALUES($1,$2,$3) ON CONFLICT(workspace_id) DO UPDATE SET excluded=$2,reason=$3,updated_at=now()",
    [workspaceId, excluded, reason],
  );
  return { workspaceId, excluded, reason };
}
export async function retainProductData(scope: Scope, apply = false) {
  const workspaceIds = await scopedWorkspaces(scope),
    results = [];
  for (const workspaceId of workspaceIds)
    results.push(
      await tenantTransaction(workspaceId, async (tx) => {
        // Serialize retention against another operator, never delete active feedback.
        await tx.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
          workspaceId + ":product-retention",
        ]);
        const events = (
          await tx.query(
            "SELECT count(*)::int AS n FROM product_events WHERE created_at<now()-interval '180 days'",
          )
        ).rows[0].n;
        const feedback = (
          await tx.query(
            "SELECT count(*)::int AS n FROM feedback WHERE status IN ('resolved','closed') AND updated_at<now()-interval '365 days'",
          )
        ).rows[0].n;
        if (apply) {
          await tx.query(
            "DELETE FROM product_events WHERE created_at<now()-interval '180 days'",
          );
          await tx.query(
            "DELETE FROM feedback WHERE status IN ('resolved','closed') AND updated_at<now()-interval '365 days'",
          );
        }
        return { workspaceId, events, feedback, applied: apply };
      }),
    );
  return { scope, apply, results };
}
