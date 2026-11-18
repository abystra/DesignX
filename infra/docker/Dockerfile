FROM node:22-bookworm-slim
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.20.0 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json ./apps/web/package.json
RUN pnpm install --frozen-lockfile
COPY --chown=node:node . .
RUN pnpm exec playwright install --with-deps chromium && chmod -R a+rX /ms-playwright
ENV NODE_ENV=production
USER node
CMD ["node", "--import", "tsx", "apps/api/src/main.ts"]
