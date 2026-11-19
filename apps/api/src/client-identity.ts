import type { FastifyRequest } from "fastify";

// Nginx is on this host and overwrites X-Forwarded-For. Never trust other peers.
export const trustedProxy = ["127.0.0.1", "::1", "::ffff:127.0.0.1"];
export function requestLimitKey(request: FastifyRequest) {
  // Authentication endpoints retain their IP budget even for signed-in clients.
  if (request.routeOptions.url?.startsWith("/api/auth/"))
    return `ip:${request.ip}`;
  return request.identity
    ? `user:${request.identity.user.id}`
    : `ip:${request.ip}`;
}
