FROM node:24-bookworm-slim
ENV NODE_ENV=production PORT=8080 DATA_DIR=/app/data
WORKDIR /opt/storage-probe
COPY server.mjs ./server.mjs
RUN mkdir -p /app/data && chown node:node /app/data
USER node
EXPOSE 8080
CMD ["node", "/opt/storage-probe/server.mjs"]
