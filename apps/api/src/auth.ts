import {
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
  createHash,
} from "node:crypto";
import { promisify } from "node:util";
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import {
  pool,
  transaction,
  type Tx,
} from "../../../packages/server-infra/src/db.js";
import { config } from "../../../packages/server-infra/src/config.js";
import { HttpError, id } from "../../../packages/server-domain/src/common.js";

const scrypt = promisify(scryptCallback);
const digest = (token: string) =>
  createHash("sha256").update(token).digest("hex");
const password = z
  .string()
  .min(10, "密码至少 10 位")
  .max(128, "密码最多 128 位");
const name = z
  .string()
  .trim()
  .min(1, "请填写昵称")
  .max(80, "昵称最多 80 个字符");
const username = z
  .string()
  .trim()
  .toLowerCase()
  .regex(
    /^[a-z][a-z0-9_.-]{2,31}$/,
    "账号需为 3–32 位，以字母开头，可用字母、数字、下划线、点和短横线",
  );
const registerSchema = z.union([
  z.object({ username, password, name: name.optional() }).strict(),
  // Compatibility for existing clients; email is an identifier, never proof of ownership.
  z
    .object({
      email: z.string().trim().toLowerCase().email().max(254),
      password,
      name: name.optional(),
    })
    .strict(),
]);
const identifier = z
  .string()
  .trim()
  .toLowerCase()
  .min(1, "请填写账号")
  .max(254);
const loginSchema = z.union([
  z
    .object({ account: identifier, password: z.string().min(1).max(128) })
    .strict(),
  z
    .object({ email: identifier, password: z.string().min(1).max(128) })
    .strict(),
]);
export type Identity = {
  user: {
    id: string;
    email: string | null;
    username: string | null;
    name: string;
  };
  workspace: { id: string; name: string };
  tokenHash: string;
};
declare module "fastify" {
  interface FastifyRequest {
    identity: Identity;
  }
}
const userDto = (r: any) => ({
  id: r.id,
  email: r.email,
  username: r.username,
  name: r.name,
});
async function hashPassword(value: string) {
  const salt = randomBytes(16).toString("hex");
  const result = (await scrypt(value, salt, 64)) as Buffer;
  return salt + ":" + result.toString("hex");
}
async function passwordMatches(value: string, stored: string) {
  const [salt, hash] = stored.split(":");
  const calculated = (await scrypt(value, salt, 64)) as Buffer;
  const expected = Buffer.from(hash, "hex");
  return (
    expected.length === calculated.length &&
    timingSafeEqual(expected, calculated)
  );
}
async function startSession(tx: Tx, userId: string) {
  const token = randomBytes(32).toString("base64url");
  await tx.query(
    "INSERT INTO sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '7 days')",
    [digest(token), userId],
  );
  return token;
}
function sessionCookie(reply: FastifyReply, token: string) {
  reply.setCookie("dx_session", token, {
    path: "/",
    httpOnly: true,
    secure: config.production,
    sameSite: "lax",
    maxAge: 7 * 86400,
  });
}
export async function resolveIdentity(
  token?: string,
): Promise<Identity | null> {
  if (!token) return null;
  const { rows } = await pool.query(
    "SELECT u.id,u.email,u.username,u.name,w.id as workspace_id,w.name as workspace_name FROM sessions s JOIN users u ON u.id=s.user_id JOIN workspaces w ON w.owner_id=u.id WHERE s.token_hash=$1 AND s.expires_at>now()",
    [digest(token)],
  );
  const r = rows[0];
  return r
    ? {
        user: userDto(r),
        workspace: { id: r.workspace_id, name: r.workspace_name },
        tokenHash: digest(token),
      }
    : null;
}
export async function requireIdentity(request: FastifyRequest) {
  if (request.identity) return;
  const identity = await resolveIdentity(request.cookies.dx_session);
  if (!identity)
    throw new HttpError(401, "UNAUTHENTICATED", "登录已过期，请重新登录");
  request.identity = identity;
}
// Serialize credential changes with logins and recheck the session after taking
// the user lock. Identity resolved before another request revoked it is stale.
async function lockedUser(tx: Tx, identity: Identity) {
  const row = (
    await tx.query("SELECT * FROM users WHERE id=$1 FOR UPDATE", [
      identity.user.id,
    ])
  ).rows[0];
  const session = await tx.query(
    "SELECT 1 FROM sessions WHERE token_hash=$1 AND user_id=$2 AND expires_at>now()",
    [identity.tokenHash, identity.user.id],
  );
  if (!row || !session.rowCount)
    throw new HttpError(401, "UNAUTHENTICATED", "登录已过期，请重新登录");
  return row;
}
export async function authRoutes(app: FastifyInstance) {
  app.post(
    "/api/auth/register",
    { config: { rateLimit: { max: 12, timeWindow: "15 minutes" } } },
    async (req, reply) => {
      const body = registerSchema.parse(req.body),
        userId = id(),
        workspaceId = id();
      const account = "username" in body ? body.username : null;
      const email = "email" in body ? body.email : null;
      const displayName = body.name || account || email!.split("@")[0];
      const passwordHash = await hashPassword(body.password);
      let token: string;
      try {
        token = await transaction(async (tx) => {
          await tx.query(
            "INSERT INTO users(id,email,username,name,password_hash) VALUES($1,$2,$3,$4,$5)",
            [userId, email, account, displayName, passwordHash],
          );
          await tx.query(
            "INSERT INTO workspaces(id,owner_id,name) VALUES($1,$2,$3)",
            [workspaceId, userId, displayName + " 的创作空间"],
          );
          return startSession(tx, userId);
        });
      } catch (error: any) {
        if (error.code === "23505")
          throw new HttpError(
            409,
            "ACCOUNT_IN_USE",
            "该账号已注册，请登录或换一个账号",
          );
        throw error;
      }
      sessionCookie(reply, token);
      reply.code(201);
      return {
        user: { id: userId, email, username: account, name: displayName },
        workspace: { id: workspaceId, name: displayName + " 的创作空间" },
      };
    },
  );
  app.post(
    "/api/auth/login",
    { config: { rateLimit: { max: 20, timeWindow: "15 minutes" } } },
    async (req, reply) => {
      const body = loginSchema.parse(req.body),
        account = "account" in body ? body.account : body.email;
      const result = await transaction(async (tx) => {
        const row = (
          await tx.query(
            "SELECT * FROM users WHERE username=$1 OR email=$1 FOR UPDATE",
            [account],
          )
        ).rows[0];
        const fake = "00000000000000000000000000000000:" + "00".repeat(64);
        const valid = await passwordMatches(
          body.password,
          row?.password_hash || fake,
        );
        if (!row || !valid)
          throw new HttpError(401, "INVALID_CREDENTIALS", "账号或密码不正确");
        if (req.cookies.dx_session)
          await tx.query("DELETE FROM sessions WHERE token_hash=$1", [
            digest(req.cookies.dx_session),
          ]);
        const token = await startSession(tx, row.id);
        const workspace = (
          await tx.query("SELECT id,name FROM workspaces WHERE owner_id=$1", [
            row.id,
          ])
        ).rows[0];
        return { user: userDto(row), workspace, token };
      });
      sessionCookie(reply, result.token);
      return { user: result.user, workspace: result.workspace };
    },
  );
  app.get("/api/auth/me", { preHandler: requireIdentity }, async (req) => ({
    user: req.identity.user,
    workspace: req.identity.workspace,
  }));
  app.patch(
    "/api/auth/profile",
    { preHandler: requireIdentity },
    async (req) => {
      const body = z
        .object({
          name,
          workspaceName: z.string().trim().min(1, "请填写空间名称").max(100),
        })
        .strict()
        .parse(req.body);
      return transaction(async (tx) => {
        await lockedUser(tx, req.identity);
        const user = (
          await tx.query(
            "UPDATE users SET name=$2 WHERE id=$1 RETURNING id,email,username,name",
            [req.identity.user.id, body.name],
          )
        ).rows[0];
        const workspace = (
          await tx.query(
            "UPDATE workspaces SET name=$2 WHERE owner_id=$1 RETURNING id,name",
            [user.id, body.workspaceName],
          )
        ).rows[0];
        return { user: userDto(user), workspace };
      });
    },
  );
  app.post(
    "/api/auth/password",
    {
      preHandler: requireIdentity,
      config: { rateLimit: { max: 10, timeWindow: "15 minutes" } },
    },
    async (req, reply) => {
      const body = z
        .object({
          currentPassword: z.string().min(1).max(128),
          newPassword: password,
        })
        .strict()
        .parse(req.body);
      const nextHash = await hashPassword(body.newPassword);
      const token = await transaction(async (tx) => {
        const row = await lockedUser(tx, req.identity);
        if (!(await passwordMatches(body.currentPassword, row.password_hash)))
          throw new HttpError(
            400,
            "INVALID_CURRENT_PASSWORD",
            "当前密码不正确",
          );
        if (body.currentPassword === body.newPassword)
          throw new HttpError(
            400,
            "UNCHANGED_PASSWORD",
            "新密码不能与当前密码相同",
          );
        await tx.query("UPDATE users SET password_hash=$2 WHERE id=$1", [
          row.id,
          nextHash,
        ]);
        await tx.query("DELETE FROM sessions WHERE user_id=$1", [row.id]);
        return startSession(tx, row.id);
      });
      sessionCookie(reply, token);
      return { ok: true };
    },
  );
  app.post(
    "/api/auth/sessions/revoke-others",
    {
      preHandler: requireIdentity,
      config: { rateLimit: { max: 10, timeWindow: "15 minutes" } },
    },
    async (req) =>
      transaction(async (tx) => {
        await lockedUser(tx, req.identity);
        const result = await tx.query(
          "DELETE FROM sessions WHERE user_id=$1 AND token_hash<>$2",
          [req.identity.user.id, req.identity.tokenHash],
        );
        return { ok: true, revoked: result.rowCount };
      }),
  );
  app.post("/api/auth/logout", async (req, reply) => {
    if (req.cookies.dx_session)
      await pool.query("DELETE FROM sessions WHERE token_hash=$1", [
        digest(req.cookies.dx_session),
      ]);
    reply.clearCookie("dx_session", { path: "/" });
    return { ok: true };
  });
}
