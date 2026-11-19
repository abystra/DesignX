import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { tenantTransaction } from "../../../packages/server-infra/src/db.js";
import {
  feedbackDetail,
  feedbackPage,
  submitFeedback,
} from "../../../packages/server-domain/src/feedback.js";
export async function feedbackRoutes(app: FastifyInstance) {
  app.get("/api/feedback", async (req: any) =>
    tenantTransaction(req.identity.workspace.id, (tx) =>
      feedbackPage(tx, req.query),
    ),
  );
  app.get("/api/feedback/:id", async (req: any) =>
    tenantTransaction(req.identity.workspace.id, (tx) =>
      feedbackDetail(tx, z.uuid().parse(req.params.id)),
    ),
  );
  app.post("/api/feedback", async (req: any, reply) => {
    const receipt = await tenantTransaction(req.identity.workspace.id, (tx) =>
      submitFeedback(
        tx,
        req.identity.workspace.id,
        req.body,
        req.headers["idempotency-key"],
      ),
    );
    reply.code(201);
    return receipt;
  });
}
