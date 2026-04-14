FROM node:24-bookworm-slim

WORKDIR /app

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV AGENT_PASSPORT_USE_KEYCHAIN=0

COPY package.json README.md ./
COPY src ./src
COPY public ./public
COPY scripts ./scripts
COPY docs ./docs

RUN mkdir -p /app/data /var/data \
  && chown -R node:node /app /var/data

USER node

EXPOSE 4319

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch(`http://127.0.0.1:${process.env.PORT || 4319}/api/health`).then((response) => process.exit(response.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "src/server.js"]
