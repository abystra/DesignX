import type { FastifyRequest } from "fastify";

// Nginx is on this host and overwrites X-Forwarded-For. Never trust other peers.
export const trustedProxy = ["127.0.0.1", "::1", "::ffff:127.0.0.1"];
export function requestLimitKey(request: FastifyRequest) {
  // Public credential entry retains an IP budget even for signed-in clients.
  // Authenticated account management follows the user's own budget.
  if (
    ["/api/auth/register", "/api/auth/login"].includes(
      request.routeOptions.url || "",
    )
  )
    return `ip:${request.ip}`;
  return request.identity
    ? `user:${request.identity.user.id}`
    : `ip:${request.ip}`;
}
