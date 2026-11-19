import { HttpError } from "./common.js";
import type { Tx } from "../../server-infra/src/db.js";
export async function recordRegistration(tx: Tx, workspaceId: string) {
  await tx.query(
    "INSERT INTO product_metrics_settings(workspace_id) VALUES($1) ON CONFLICT DO NOTHING",
    [workspaceId],
  );
  await tx.query(
    "INSERT INTO product_milestones(workspace_id,kind,subject_id) VALUES($1,'registration_completed',$1) ON CONFLICT DO NOTHING",
    [workspaceId],
  );
  await tx.query(
    "INSERT INTO product_events(workspace_id,event,subject_id,dedupe_key) VALUES($1,'registration_completed',$1,'registered') ON CONFLICT DO NOTHING",
    [workspaceId],
  );
}
export async function recordOpen(
  tx: Tx,
  workspaceId: string,
  projectId: string,
  visitId: string,
) {
  // One serialized project lock prevents two first opens from both becoming first.
  await tx.query("SELECT id FROM projects WHERE id=$1 FOR UPDATE", [projectId]);
  if (
    (
      await tx.query(
        "SELECT 1 FROM product_events WHERE subject_id=$1 AND dedupe_key=$2 AND event IN ('project_opened','project_reopened')",
        [projectId, visitId],
      )
    ).rowCount
  )
    return;
  const recent = (
    await tx.query(
      "SELECT count(*)::int AS n FROM product_events WHERE project_id=$1 AND event IN ('project_opened','project_reopened') AND created_at>now()-interval '1 minute'",
      [projectId],
    )
  ).rows[0].n;
  if (recent >= 60)
    throw new HttpError(429, "OPEN_RATE_LIMIT", "打开记录过于频繁，请稍后重试");
  const first = await tx.query(
    "INSERT INTO product_milestones(workspace_id,kind,subject_id,project_id) VALUES($1,'project_opened',$2,$2) ON CONFLICT DO NOTHING RETURNING subject_id",
    [workspaceId, projectId],
  );
  await tx.query(
    "INSERT INTO product_events(workspace_id,event,subject_id,dedupe_key,project_id) VALUES($1,$2,$3,$4,$3) ON CONFLICT DO NOTHING",
    [
      workspaceId,
      first.rowCount ? "project_opened" : "project_reopened",
      projectId,
      visitId,
    ],
  );
}
export async function recordDownload(tx: Tx, workspaceId: string, job: any) {
  const first = await tx.query(
    "INSERT INTO product_milestones(workspace_id,kind,subject_id,project_id) VALUES($1,'download_requested',$2,$3) ON CONFLICT DO NOTHING RETURNING subject_id",
    [workspaceId, job.id, job.project_id],
  );
  if (first.rowCount)
    await tx.query(
      "INSERT INTO product_events(workspace_id,event,subject_id,dedupe_key,project_id,format) VALUES($1,'download_requested',$2,'first',$3,$4) ON CONFLICT DO NOTHING",
      [workspaceId, job.id, job.project_id, job.payload.format],
    );
}
