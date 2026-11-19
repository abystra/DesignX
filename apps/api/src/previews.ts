import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { tenantTransaction } from "../../../packages/server-infra/src/db.js";
import { getObject } from "../../../packages/server-infra/src/storage.js";
import { projectPreview } from "../../../packages/server-domain/src/previews.js";
import {
  HttpError,
  notFound,
} from "../../../packages/server-domain/src/common.js";
export async function previewRoutes(app: FastifyInstance) {
  app.post("/api/projects/:id/preview", async (req: any) => {
    const body = z
      .object({ retry: z.boolean().default(false) })
      .strict()
      .parse(req.body || {});
    return tenantTransaction(req.identity.workspace.id, (tx) =>
      projectPreview(tx, req.identity.workspace.id, req.params.id, body.retry),
    );
  });
  app.get("/api/previews/:id/file", async (req: any, reply) => {
    const job = await tenantTransaction(
      req.identity.workspace.id,
      async (tx) =>
        (
          await tx.query(
            "SELECT j.id,j.result,j.status FROM jobs j JOIN projects p ON p.id=j.project_id WHERE j.id=$1 AND j.kind='render.thumbnail' AND p.deleted_at IS NULL",
            [req.params.id],
          )
        ).rows[0],
    );
    if (!job) notFound();
    if (job.status !== "succeeded")
      throw new HttpError(409, "PREVIEW_NOT_READY", "预览尚未完成");
    const etag = '"' + job.result.sha256 + '"';
    // Every use revalidates tenant/session/deletion. Never cache public or skip auth on 304.
    if (req.headers["if-none-match"] === etag) {
      reply
        .header("Cache-Control", "private, max-age=0, must-revalidate")
        .header("Vary", "Cookie")
        .header("ETag", etag);
      return reply.code(304).send();
    }
    let object;
    try {
      object = await getObject(job.result.objectKey, {
        bucket: job.result.storageBucket,
        maxBytes: 4 * 1024 * 1024,
      });
    } catch (error: any) {
      if (
        error.$metadata?.httpStatusCode !== 404 &&
        error.name !== "NoSuchKey" &&
        error.name !== "NotFound"
      )
        throw error;
      await tenantTransaction(req.identity.workspace.id, (tx) =>
        tx.query(
          "UPDATE jobs SET status='failed',error='预览文件已过期，请重试',updated_at=now() WHERE id=$1 AND status='succeeded'",
          [job.id],
        ),
      );
      throw new HttpError(410, "PREVIEW_EXPIRED", "预览文件已过期，请重试");
    }
    reply
      .header("Cache-Control", "private, max-age=0, must-revalidate")
      .header("Vary", "Cookie")
      .header("ETag", etag)
      .type("image/webp");
    return object.bytes;
  });
}
