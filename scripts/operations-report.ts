import { parseArgs } from "node:util";
import { pool } from "../packages/server-infra/src/db.js";
import { operationalReport } from "./product-operations.js";
try {
  const { values } = parseArgs({
    options: {
      workspace: { type: "string" },
      all: { type: "boolean" },
      days: { type: "string", default: "30" },
    },
  });
  console.log(
    JSON.stringify(
      await operationalReport(
        { workspaceId: values.workspace, all: values.all },
        Number(values.days),
      ),
      null,
      2,
    ),
  );
} catch (error: any) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
