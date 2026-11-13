# 单阶段镜像：无构建步骤、无编译依赖。
FROM node:22-bookworm-slim

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8787 \
    DATA_DIR=/data

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY server.mjs ./
COPY lib ./lib
COPY public ./public
COPY scripts ./scripts

# 数据目录挂载卷；容器内以非 root 用户运行
RUN mkdir -p /data && chown -R node:node /app /data
USER node
VOLUME ["/data"]

EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8787)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.mjs"]
