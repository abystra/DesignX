import { z } from "zod";
import type { Tx } from "../../server-infra/src/db.js";
import { HttpError, id, notFound } from "./common.js";
import { idempotent } from "./idempotency.js";
export const feedbackInput = z
  .object({
    category: z.enum(["problem", "suggestion"]),
    subject: z.string().trim().min(1).max(100),
    message: z.string().trim().min(1).max(2000),
    projectId: z.uuid().optional(),
    jobId: z.uuid().optional(),
  })
  .strict();
export const feedbackStatus = z.enum([
  "received",
  "triaged",
  "resolved",
  "closed",
]);
export function feedbackDto(row: any) {
  return {
    id: row.id,
    category: row.category,
    subject: row.subject,
    message: row.message,
    projectId: row.project_id,
    jobId: row.job_id,
    status: row.status,
    revision: row.revision,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
export async function feedbackDetail(tx: Tx, feedbackId: string) {
  const row = (
    await tx.query("SELECT * FROM feedback WHERE id=$1", [feedbackId])
  ).rows[0];
  if (!row) notFound();
  const updates = (
    await tx.query(
      'SELECT revision,status,reply,created_at AS "createdAt" FROM feedback_updates WHERE feedback_id=$1 ORDER BY revision',
      [feedbackId],
    )
  ).rows;
  const job = row.job_id
    ? (
        await tx.query(
          'SELECT id,kind,status,created_at AS "createdAt",updated_at AS "updatedAt" FROM jobs WHERE id=$1',
          [row.job_id],
        )
      ).rows[0]
    : null;
  return { ...feedbackDto(row), updates, job: job || null };
}
export async function feedbackPage(tx: Tx, query: unknown) {
  const { cursor, limit, status } = z
    .object({
      cursor: z.uuid().optional(),
      limit: z.coerce.number().int().min(1).max(50).default(20),
      status: feedbackStatus.optional(),
    })
    .parse(query);
  let before;
  if (cursor) {
    before = (
      await tx.query("SELECT created_at,id FROM feedback WHERE id=$1", [cursor])
    ).rows[0];
    if (!before) notFound();
  }
  const rows = (
    await tx.query(
      "SELECT * FROM feedback WHERE ($1::text IS NULL OR status=$1) AND ($2::timestamptz IS NULL OR (created_at,id)<($2,$3)) ORDER BY created_at DESC,id DESC LIMIT $4",
      [
        status || null,
        before?.created_at || null,
        before?.id || null,
        limit + 1,
      ],
    )
  ).rows;
  return {
    items: rows.slice(0, limit).map(feedbackDto),
    nextCursor: rows.length > limit ? rows[limit - 1].id : null,
  };
}
export async function submitFeedback(
  tx: Tx,
  workspaceId: string,
  input: unknown,
  key: unknown,
) {
  const body = feedbackInput.parse(input);
  if (!key)
    throw new HttpError(
      428,
      "IDEMPOTENCY_REQUIRED",
      "请保留反馈请求标识后重试",
    );
  const requestId = z.uuid().parse(key);
  return idempotent(
    tx,
    workspaceId,
    requestId,
    { route: "feedback.create", body },
    async () => {
      await tx.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
        workspaceId + ":feedback-rate",
      ]);
      const recent = (
        await tx.query(
          "SELECT count(*)::int AS count FROM feedback WHERE created_at>now()-interval '10 minutes'",
        )
      ).rows[0].count;
      if (recent >= 5)
        throw new HttpError(
          429,
          "FEEDBACK_RATE_LIMIT",
          "10 分钟内最多提交 5 条反馈，请稍后重试；已提交的记录可在我的反馈查看",
        );
      let projectId = body.projectId;
      if (body.jobId) {
        const job = (
          await tx.query("SELECT id,project_id FROM jobs WHERE id=$1", [
            body.jobId,
          ])
        ).rows[0];
        if (!job) notFound();
        if (projectId && job.project_id !== projectId)
          throw new HttpError(
            400,
            "FEEDBACK_CONTEXT_MISMATCH",
            "任务与作品不一致",
          );
        projectId = job.project_id || undefined;
      }
      if (
        projectId &&
        !(
          await tx.query(
            "SELECT 1 FROM projects WHERE id=$1 AND deleted_at IS NULL",
            [projectId],
          )
        ).rowCount
      )
        notFound();
      const feedbackId = id();
      await tx.query(
        "INSERT INTO feedback(id,workspace_id,category,subject,message,project_id,job_id) VALUES($1,$2,$3,$4,$5,$6,$7)",
        [
          feedbackId,
          workspaceId,
          body.category,
          body.subject,
          body.message,
          projectId || null,
          body.jobId || null,
        ],
      );
      // Receipt only: retention must not leave the message in idempotency_keys.response.
      return { id: feedbackId, status: "received" };
    },
  );
}
/** Trusted operations CLI only. No HTTP route invokes this function. */
export async function updateFeedback(
  tx: Tx,
  workspaceId: string,
  feedbackId: string,
  input: unknown,
) {
  const body = z
    .object({
      revision: z.number().int().positive(),
      status: feedbackStatus,
      reply: z.string().trim().min(1).max(2000),
      actor: z.string().trim().min(1).max(80),
    })
    .strict()
    .parse(input);
  const current = (
    await tx.query("SELECT * FROM feedback WHERE id=$1 FOR UPDATE", [
      feedbackId,
    ])
  ).rows[0];
  if (!current) notFound();
  if (current.revision !== body.revision)
    throw new HttpError(
      409,
      "FEEDBACK_REVISION_CONFLICT",
      "反馈已由其他操作更新，请读取最新 revision 后再处理",
    );
  const row = (
    await tx.query(
      "UPDATE feedback SET status=$1,revision=revision+1,updated_at=now() WHERE id=$2 RETURNING *",
      [body.status, feedbackId],
    )
  ).rows[0];
  await tx.query(
    "INSERT INTO feedback_updates(workspace_id,feedback_id,revision,status,reply,actor) VALUES($1,$2,$3,$4,$5,$6)",
    [
      workspaceId,
      feedbackId,
      row.revision,
      body.status,
      body.reply,
      body.actor,
    ],
  );
  return feedbackDetail(tx, feedbackId);
}
