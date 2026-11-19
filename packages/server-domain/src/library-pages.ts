import { createHash } from "node:crypto";
import { z } from "zod";
import type { Tx } from "../../server-infra/src/db.js";
import { assetDto, HttpError } from "./common.js";
import { projectDto } from "./projects.js";

const baseQuery = z.object({
  q: z.string().trim().max(200).default(""),
  limit: z.coerce.number().int().min(1).max(100).default(24),
  cursor: z.string().max(2048).optional(),
});
const projectQuery = baseQuery
  .extend({
    sort: z.enum(["updated", "name", "recent"]).default("updated"),
    trash: z.enum(["0", "1"]).default("0"),
    recent: z.enum(["0", "1"]).default("0"),
    folderId: z.string().uuid().optional(),
    type: z.enum(["all", "design", "ai"]).default("all"),
  })
  .strict();
const assetQuery = baseQuery
  .extend({
    favorites: z.enum(["0", "1"]).default("0"),
    status: z.enum(["all", "ready"]).default("all"),
  })
  .strict();
const cursorSchema = z
  .object({
    scope: z.string(),
    value: z.string().max(300),
    id: z.string().min(1).max(100),
  })
  .strict();

// A cursor is bound to its tenant and filters. It is a position, never authority;
// all page/count queries still run with tenant RLS and parameterized values.
function pageScope(
  workspaceId: string,
  kind: string,
  query: Record<string, unknown>,
) {
  const { cursor, limit, ...filters } = query;
  return createHash("sha256")
    .update(JSON.stringify([workspaceId, kind, filters]))
    .digest("hex");
}
function readCursor(
  encoded: string | undefined,
  scope: string,
  isName = false,
) {
  if (!encoded) return null;
  try {
    const cursor = cursorSchema.parse(
      JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")),
    );
    if (
      cursor.scope !== scope ||
      (!isName && !Number.isFinite(Date.parse(cursor.value)))
    )
      throw new Error();
    return cursor;
  } catch {
    throw new HttpError(400, "INVALID_CURSOR", "列表条件已变化，请重新加载");
  }
}
function resultPage(
  rows: any[],
  total: number,
  limit: number,
  scope: string,
  dto: (row: any) => any,
) {
  const items = rows.slice(0, limit),
    last = items.at(-1);
  return {
    items: items.map(dto),
    total,
    nextCursor:
      rows.length > limit && last
        ? Buffer.from(
            JSON.stringify({ scope, value: last.page_value, id: last.id }),
          ).toString("base64url")
        : null,
  };
}

export async function projectPage(tx: Tx, workspaceId: string, input: unknown) {
  const query = projectQuery.parse(input),
    scope = pageScope(workspaceId, "projects", query);
  const cursor = readCursor(query.cursor, scope, query.sort === "name");
  const values: unknown[] = [];
  const bind = (value: unknown) => {
    values.push(value);
    return `$${values.length}`;
  };
  const conditions = [
    `p.deleted_at IS ${query.trash === "1" ? "NOT " : ""}NULL`,
  ];
  if (query.q)
    conditions.push(`position(lower(${bind(query.q)}) in lower(p.title)) > 0`);
  if (query.folderId) conditions.push(`p.folder_id=${bind(query.folderId)}`);
  if (query.sort === "recent" || query.recent === "1")
    conditions.push("p.last_opened_at IS NOT NULL");
  if (query.type !== "all")
    conditions.push(`p.type ${query.type === "ai" ? "~*" : "!~*"} '(ai|生成)'`);
  const field =
    query.sort === "name"
      ? 'title COLLATE "C"'
      : query.sort === "recent"
        ? "last_opened_at"
        : "updated_at";
  const direction = query.sort === "name" ? "ASC" : "DESC";
  const cursorCondition = cursor
    ? `WHERE (${field},id) ${direction === "ASC" ? ">" : "<"} (${bind(cursor.value)}${query.sort === "name" ? '::text COLLATE "C"' : "::timestamptz"},${bind(cursor.id)})`
    : "";
  const limit = bind(query.limit + 1);
  // One statement gives the count and page the same snapshot. The list never
  // reads design JSON or creation briefs; visible previews load separately.
  const {
    rows: [page],
  } = await tx.query(
    `WITH matches AS NOT MATERIALIZED (
    SELECT p.id,p.title,p.workspace_mode,p.type,p.image,p.color,p.folder_id,
      p.created_at,p.updated_at,p.last_opened_at,p.deleted_at,d.id AS document_id,d.revision
    FROM projects p LEFT JOIN documents d ON d.id=p.primary_artboard_id
    WHERE ${conditions.join(" AND ")}
  ) SELECT (SELECT count(*)::int FROM matches) AS total,
    COALESCE((SELECT jsonb_agg(page) FROM (
      SELECT *,(${field})::text AS page_value FROM matches ${cursorCondition}
      ORDER BY ${field} ${direction},id ${direction} LIMIT ${limit}
    ) page),'[]'::jsonb) AS items`,
    values,
  );
  return resultPage(page.items, page.total, query.limit, scope, projectDto);
}

export async function assetPage(tx: Tx, workspaceId: string, input: unknown) {
  const query = assetQuery.parse(input),
    scope = pageScope(workspaceId, "assets", query);
  const cursor = readCursor(query.cursor, scope);
  const values: unknown[] = [];
  const bind = (value: unknown) => {
    values.push(value);
    return `$${values.length}`;
  };
  const conditions = ["a.deleted_at IS NULL"];
  if (query.q)
    conditions.push(`position(lower(${bind(query.q)}) in lower(a.title)) > 0`);
  if (query.status === "ready")
    conditions.push("a.status='ready' AND a.current_version_id IS NOT NULL");
  if (query.favorites === "1")
    conditions.push(
      "EXISTS (SELECT 1 FROM preferences f WHERE f.key='asset-favorites' AND f.value ? a.id)",
    );
  const cursorCondition = cursor
    ? `WHERE (created_at,id) < (${bind(cursor.value)}::timestamptz,${bind(cursor.id)})`
    : "";
  const limit = bind(query.limit + 1);
  const {
    rows: [page],
  } = await tx.query(
    `WITH matches AS NOT MATERIALIZED (
    SELECT a.id,a.title,a.current_version_id,a.status,a.error,a.bytes,a.width,a.height,a.created_at
    FROM assets a WHERE ${conditions.join(" AND ")}
  ) SELECT (SELECT count(*)::int FROM matches) AS total,
    COALESCE((SELECT jsonb_agg(page) FROM (
      SELECT *,created_at::text AS page_value FROM matches ${cursorCondition}
      ORDER BY created_at DESC,id DESC LIMIT ${limit}
    ) page),'[]'::jsonb) AS items`,
    values,
  );
  return resultPage(page.items, page.total, query.limit, scope, assetDto);
}
