import { parseArgs } from "node:util";
import { readFile } from "node:fs/promises";
import { z } from "zod";
import { pool, tenantTransaction } from "../packages/server-infra/src/db.js";
import {
  feedbackPage,
  feedbackDetail,
  updateFeedback,
} from "../packages/server-domain/src/feedback.js";
import {
  scopedWorkspaces,
  metricsExclusion,
  retainProductData,
} from "./product-operations.js";
try {
  const { values: v, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      workspace: { type: "string" },
      all: { type: "boolean" },
      id: { type: "string" },
      revision: { type: "string" },
      status: { type: "string" },
      actor: { type: "string" },
      "reply-file": { type: "string" },
      "reply-stdin": { type: "boolean" },
      cursor: { type: "string" },
      limit: { type: "string" },
      excluded: { type: "string" },
      reason: { type: "string" },
      apply: { type: "boolean" },
    },
  });
  const [command] = positionals;
  if (positionals.length !== 1)
    throw new Error("Expected one command: list/show/update/exclude/retention");
  const scope = { workspaceId: v.workspace, all: v.all };
  let result;
  if (command === "retention")
    result = await retainProductData(scope, !!v.apply);
  else {
    if (v.all || !v.workspace)
      throw new Error("This operation requires one --workspace UUID");
    await scopedWorkspaces(scope);
    result = await tenantTransaction(v.workspace, async (tx) => {
      if (command === "list")
        return feedbackPage(tx, {
          status: v.status,
          cursor: v.cursor,
          limit: v.limit,
        });
      if (command === "show") return feedbackDetail(tx, z.uuid().parse(v.id));
      if (command === "update") {
        if (Boolean(v["reply-file"]) === Boolean(v["reply-stdin"]))
          throw new Error("Use exactly one --reply-file or --reply-stdin");
        const reply = await readFile(
          v["reply-stdin"] ? "/dev/stdin" : v["reply-file"]!,
          "utf8",
        );
        return updateFeedback(tx, v.workspace!, z.uuid().parse(v.id), {
          revision: Number(v.revision),
          status: v.status,
          reply,
          actor: v.actor,
        });
      }
      if (command === "exclude")
        return metricsExclusion(
          tx,
          v.workspace!,
          z.enum(["true", "false"]).parse(v.excluded) === "true",
          v.reason || "",
        );
      throw new Error("Unknown command: list/show/update/exclude/retention");
    });
  }
  console.log(JSON.stringify(result, null, 2));
} catch (error: any) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
