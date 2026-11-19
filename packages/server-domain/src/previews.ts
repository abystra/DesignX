import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createRequire } from "node:module";
import type { Tx } from "../../server-infra/src/db.js";
import { getProjectMetadata } from "./projects.js";
import { freezeRenderInputs } from "./render-inputs.js";
import { createJob } from "./jobs.js";
import { sendInTransaction } from "../../server-infra/src/queue.js";
import { notFound, HttpError } from "./common.js";
// Include actual renderer/font bytes: an upgrade cannot reuse an old preview key.
const require = createRequire(import.meta.url);
let fingerprint: string;
export function previewRendererVersion() {
  if (fingerprint) return fingerprint;
  const hash = createHash("sha256").update("preview-webp-v1-480");
  hash.update(
    readFileSync(
      new URL("../../../apps/renderer/src/render.ts", import.meta.url),
    ),
  );
  for (const pkg of ["playwright", "react-dom"])
    hash.update(readFileSync(require.resolve(pkg + "/package.json")));
  hash.update(JSON.stringify(require("sharp").versions));
  for (const name of ["render.tsx", "server.tsx"])
    hash.update(
      readFileSync(new URL("../../doc-render/src/" + name, import.meta.url)),
    );
  for (const pkg of [
    "@fontsource-variable/noto-sans-sc",
    "@fontsource-variable/source-serif-4",
  ]) {
    const path = require.resolve(pkg + "/index.css"),
      css = readFileSync(path, "utf8");
    hash.update(css);
    for (const match of css.matchAll(/url\(([^)]+)\)/g))
      hash.update(
        readFileSync(resolve(dirname(path), match[1].replace(/["']/g, ""))),
      );
  }
  return (fingerprint = hash.digest("hex"));
}
const columns =
  "id,status,error,result,payload->>'documentId' AS document_id,(payload->>'revision')::int AS revision,payload->>'previewKey' AS preview_key";
function dto(job: any, current: any) {
  return job
    ? {
        jobId: job.id,
        status: job.status,
        error: job.error,
        documentId: job.document_id,
        revision: job.revision,
        stale:
          job.document_id !== current.document_id ||
          job.revision !== current.revision ||
          job.preview_key !== current.preview_key,
        url: job.status === "succeeded" ? `/api/previews/${job.id}/file` : null,
      }
    : null;
}
export async function projectPreview(
  tx: Tx,
  workspaceId: string,
  projectId: string,
  retry = false,
) {
  await tx.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
    "preview:" + workspaceId + ":" + projectId,
  ]);
  const project = await getProjectMetadata(tx, projectId);
  if (!project.document_id) notFound();
  const key = createHash("sha256")
    .update(
      [project.document_id, project.revision, previewRendererVersion()].join(
        ":",
      ),
    )
    .digest("hex");
  project.preview_key = key;
  let job = (
    await tx.query(
      `SELECT ${columns} FROM jobs WHERE project_id=$1 AND kind='render.thumbnail' AND payload->>'previewKey'=$2 ORDER BY created_at DESC LIMIT 1`,
      [projectId, key],
    )
  ).rows[0];
  if (!job) {
    const doc = (
      await tx.query(
        "SELECT * FROM documents WHERE id=$1 AND project_id=$2 AND kind='artboard' FOR SHARE",
        [project.document_id, projectId],
      )
    ).rows[0];
    if (!doc) notFound();
    // Another save between the metadata and document reads must use its actual revision.
    if (doc.revision !== project.revision)
      throw new HttpError(
        409,
        "PREVIEW_CHANGED",
        "作品刚刚更新，请重新加载预览",
      );
    const assetVersions = await freezeRenderInputs(tx, doc.content);
    const created = await createJob(
      tx,
      workspaceId,
      "render.thumbnail",
      {
        previewKey: key,
        documentId: doc.id,
        revision: doc.revision,
        design: doc.content,
        assetVersions,
        format: "webp",
        title: "作品预览",
        scale: Math.min(
          1,
          480 / Math.max(doc.content.width, doc.content.height),
        ),
        rendererFingerprint: previewRendererVersion(),
      },
      projectId,
    );
    job = (
      await tx.query(`SELECT ${columns} FROM jobs WHERE id=$1`, [created.id])
    ).rows[0];
  } else if (retry && ["failed", "cancelled"].includes(job.status)) {
    const queueId = randomUUID();
    await tx.query(
      "UPDATE jobs SET status='queued',error=NULL,progress=0,execution_token=NULL,queue_id=$2,updated_at=now() WHERE id=$1",
      [job.id, queueId],
    );
    await sendInTransaction(
      tx,
      "render.thumbnail",
      { workspaceId, jobId: job.id },
      queueId,
    );
    job.status = "queued";
    job.error = null;
  }
  const previous =
    job.status === "succeeded"
      ? job
      : (
          await tx.query(
            `SELECT ${columns} FROM jobs WHERE project_id=$1 AND kind='render.thumbnail' AND status='succeeded' ORDER BY created_at DESC LIMIT 1`,
            [projectId],
          )
        ).rows[0];
  return { current: dto(job, project), preview: dto(previous, project) };
}
