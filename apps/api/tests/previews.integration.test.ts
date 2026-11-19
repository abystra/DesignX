import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import sharp from "sharp";
import { buildApp } from "../src/server.js";
import { migrate } from "../../../db/migrate.js";
import {
  pool,
  tenantTransaction,
} from "../../../packages/server-infra/src/db.js";
import { stopQueue } from "../../../packages/server-infra/src/queue.js";
import { deleteObject } from "../../../packages/server-infra/src/storage.js";
import { runBusinessJob } from "../../worker/src/process.js";
import { renderExport, closeBrowser } from "../../renderer/src/render.js";
await migrate();
const app = await buildApp({ logger: false });
let cookie = "",
  workspace = "",
  other = "";
const request = (method: string, url: string, body?: any, headers: any = {}) =>
  app.inject({
    method: method as any,
    url: "/api" + url,
    payload: body,
    headers: { cookie, ...headers },
  });
async function run(id: string) {
  const row = (
    await tenantTransaction(workspace, (tx) =>
      tx.query("SELECT * FROM jobs WHERE id=$1", [id]),
    )
  ).rows[0];
  await runBusinessJob(
    { id: row.queue_id, data: { workspaceId: workspace, jobId: id } },
    renderExport,
  );
  return row;
}
async function create() {
  const result = await request("POST", "/projects", {
    workspaceMode: "editor",
    title: "真实缩略图",
    templateId: "t1",
  });
  assert.equal(result.statusCode, 201, result.body);
  return result.json();
}
test.before(async () => {
  for (let n = 0; n < 2; n++) {
    const r = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: {
        username: "preview_" + randomUUID().slice(0, 8),
        password: "preview-test-password",
      },
    });
    assert.equal(r.statusCode, 201);
    if (!n) {
      cookie = String(r.headers["set-cookie"]).split(";")[0];
      workspace = r.json().workspace.id;
    } else other = String(r.headers["set-cookie"]).split(";")[0];
  }
});
test.after(async () => {
  await closeBrowser();
  await app.close();
  await stopQueue();
  await pool.end();
});
test("concurrent preview requests deduplicate, shared renderer produces private revision image, revalidation never skips authorization", async () => {
  const project = await create(),
    responses = await Promise.all(
      Array.from({ length: 8 }, () =>
        request("POST", `/projects/${project.id}/preview`, {}),
      ),
    );
  for (const response of responses)
    assert.equal(response.statusCode, 200, response.body);
  const jobs = new Set(responses.map((r) => r.json().current.jobId));
  assert.equal(jobs.size, 1);
  const jobId = [...jobs][0] as string;
  await run(jobId);
  const status = (
    await request("POST", `/projects/${project.id}/preview`, {})
  ).json();
  assert.equal(status.current.status, "succeeded");
  assert.equal(status.preview.stale, false);
  assert.ok(!JSON.stringify(status).includes("nodes"));
  const file = await request("GET", status.preview.url.replace("/api", ""));
  assert.equal(file.statusCode, 200);
  const meta = await sharp(file.rawPayload).metadata();
  assert.equal(meta.width, 360);
  assert.equal(meta.height, 480);
  assert.equal(meta.format, "webp");
  assert.equal(
    file.headers["cache-control"],
    "private, max-age=0, must-revalidate",
  );
  assert.equal(file.headers.vary, "Cookie");
  const etag = file.headers.etag;
  assert.equal(
    (
      await request("GET", status.preview.url.replace("/api", ""), undefined, {
        "if-none-match": etag,
      })
    ).statusCode,
    304,
  );
  assert.equal(
    (
      await request("GET", status.preview.url.replace("/api", ""), undefined, {
        "if-none-match": etag,
        cookie: other,
      })
    ).statusCode,
    404,
  );
  assert.equal(
    (
      await request(
        "POST",
        `/projects/${project.id}/preview`,
        {},
        { cookie: other },
      )
    ).statusCode,
    404,
  );
  assert.equal(
    (await request("GET", "/jobs"))
      .json()
      .some((job: any) => job.kind === "render.thumbnail"),
    false,
  );
  assert.equal(
    (await request("POST", `/jobs/${jobId}/retry`, {})).statusCode,
    409,
  );
  await request("DELETE", "/projects/" + project.id);
  assert.equal(
    (
      await request("GET", status.preview.url.replace("/api", ""), undefined, {
        "if-none-match": etag,
      })
    ).statusCode,
    404,
  );
});
test("save keeps explicit old image while new revision renders; GC protects current preview and expires superseded output", async () => {
  const project = await create(),
    first = (
      await request("POST", `/projects/${project.id}/preview`, {})
    ).json();
  await run(first.current.jobId);
  const old = (
    await request("POST", `/projects/${project.id}/preview`, {})
  ).json().preview;
  const saved = await request("PATCH", "/projects/" + project.id, {
    baseRevision: project.revision,
    design: { ...project.design, background: "#ff0000", nodes: [] },
  });
  assert.equal(saved.statusCode, 200, saved.body);
  const next = (
    await request("POST", `/projects/${project.id}/preview`, {})
  ).json();
  assert.notEqual(next.current.jobId, old.jobId);
  assert.equal(next.preview.stale, true);
  assert.equal(next.preview.url, old.url);
  await run(next.current.jobId);
  const ready = (
    await request("POST", `/projects/${project.id}/preview`, {})
  ).json();
  assert.equal(ready.preview.stale, false);
  assert.equal(ready.preview.revision, project.revision + 1);
  const bytes = (await request("GET", ready.preview.url.replace("/api", "")))
    .rawPayload;
  const pixel = await sharp(bytes).raw().toBuffer();
  assert.ok(pixel[0] > 245 && pixel[1] < 10 && pixel[2] < 10);
  await tenantTransaction(workspace, (tx) =>
    tx.query(
      "UPDATE storage_candidates SET created_at=now()-interval '3 days'",
    ),
  );
  const candidates = execFileSync(
    process.execPath,
    ["--import", "tsx", "scripts/cleanup-storage.ts", "--workspace", workspace],
    { encoding: "utf8" },
  )
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  const rows = (
    await tenantTransaction(workspace, (tx) =>
      tx.query("SELECT id,result FROM jobs WHERE id=ANY($1::text[])", [
        [old.jobId, ready.preview.jobId],
      ]),
    )
  ).rows;
  assert.ok(
    candidates.some(
      (c) => c.key === rows.find((r) => r.id === old.jobId).result.objectKey,
    ),
  );
  assert.ok(
    !candidates.some(
      (c) =>
        c.key ===
        rows.find((r) => r.id === ready.preview.jobId).result.objectKey,
    ),
  );
});
test("expired private file and failed generation have explicit deduplicated retry without modifying the saved document", async () => {
  const project = await create(),
    first = (
      await request("POST", `/projects/${project.id}/preview`, {})
    ).json();
  await run(first.current.jobId);
  const row = (
    await tenantTransaction(workspace, (tx) =>
      tx.query("SELECT * FROM jobs WHERE id=$1", [first.current.jobId]),
    )
  ).rows[0];
  await deleteObject(row.result.objectKey, {
    bucket: row.result.storageBucket,
  });
  assert.equal(
    (await request("GET", `/previews/${row.id}/file`)).statusCode,
    410,
  );
  assert.equal(
    (await request("POST", `/projects/${project.id}/preview`, {})).json()
      .current.status,
    "failed",
  );
  const responses = await Promise.all(
    Array.from({ length: 5 }, () =>
      request("POST", `/projects/${project.id}/preview`, { retry: true }),
    ),
  );
  assert.ok(responses.every((r) => r.json().current.jobId === row.id));
  await run(row.id);
  const file = await request("GET", `/previews/${row.id}/file`);
  assert.equal(file.statusCode, 200);
  assert.deepEqual(
    (await request("GET", "/projects/" + project.id)).json().design,
    project.design,
  );
});

test("a renderer upgrade cannot publish an old fingerprint with new renderer/font bytes", async () => {
  const project = await create();
  const first = (
    await request("POST", `/projects/${project.id}/preview`, {})
  ).json();
  await tenantTransaction(workspace, (tx) =>
    tx.query(
      "UPDATE jobs SET payload=jsonb_set(payload,'{rendererFingerprint}','\"obsolete-renderer\"'::jsonb) WHERE id=$1",
      [first.current.jobId],
    ),
  );
  await assert.rejects(run(first.current.jobId), /渲染版本已更新/);
  const row = (
    await tenantTransaction(workspace, (tx) =>
      tx.query("SELECT status,result FROM jobs WHERE id=$1", [
        first.current.jobId,
      ]),
    )
  ).rows[0];
  assert.equal(row.status, "failed");
  assert.ok(!row.result?.objectKey);
});
