# syntax=docker/dockerfile:1.7

# ============================================
# Stage 1: Install all dependencies (含 devDependencies)
# ============================================
FROM node:22-alpine AS dependencies
WORKDIR /build
COPY package*.json ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci --include=dev

# ============================================
# Stage 2: Build frontend (vite)
# ============================================
FROM dependencies AS frontend-builder
WORKDIR /build
COPY frontend ./frontend
COPY shared ./shared
COPY vite.config.ts tsconfig.frontend.json postcss.config.js tailwind.config.js ./
RUN npm run build:client

# ============================================
# Stage 3: Build backend + pack tarball
# ============================================
FROM dependencies AS backend-builder
WORKDIR /build
# 关键：先复制前端产物，确保 npm pack 包含 dist/client
COPY --from=frontend-builder /build/dist/client ./dist/client
COPY src ./src
COPY shared ./shared
COPY tsconfig.server.prod.json package.json LICENSE README.md CHANGELOG.md ./
RUN npm run build:server:prod
RUN npm pack --pack-destination=/build

# ============================================
# Stage 4: Runtime (node:22-slim + Python3 + uv standalone)
# ============================================
FROM node:22-slim AS runtime

# 安装 Python3（含 venv 模块，--copies 模式兼容 SMB/NTFS 无符号链接文件系统）
RUN apt-get update && apt-get install -y --no-install-recommends \
        python3 python3-venv curl ca-certificates && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

# Standalone 方式安装 uv，清理安装残留
RUN curl -LsSf https://astral.sh/uv/install.sh | sh && \
    mv /root/.local/bin/uv /usr/local/bin/uv && \
    mv /root/.local/bin/uvx /usr/local/bin/uvx && \
    rm -rf /root/.local

WORKDIR /app

# bind mount 避免 .tgz 永久残留；合并安装/清理/权限到同一层避免 copy-on-write
RUN --mount=type=bind,from=backend-builder,source=/build,target=/build \
    npm install --omit=dev /build/*.tgz && \
    # 清理 npm 缓存和日志
    npm cache clean --force && \
    rm -rf ~/.npm/_logs ~/.npm/_cacache ~/.npm/_locks 2>/dev/null || true && \
    # 删除运行时不需要的声明文件和 source maps
    find /app -type f \( -name "*.d.ts" -o -name "*.d.ts.map" -o -name "*.js.map" -o -name "*.tsbuildinfo" \) -delete 2>/dev/null || true && \
    # 关键：chown 合并在同一层，避免 overlay2 copy-on-write 导致 52MB 重复
    chown -R node:node /app

# 让 bin 命令可被 CMD 直接调用
ENV PATH="/app/node_modules/.bin:${PATH}"

# 确保配置目录存在且 node 用户可写
RUN mkdir -p /home/node/.mcp-hub-lite/config && \
    chown -R node:node /home/node/.mcp-hub-lite

USER node

EXPOSE 7788

# HEALTHCHECK JSON 数组格式
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD ["sh", "-c", "curl -fsS http://localhost:7788/web/health || exit 1"]

# CMD JSON 数组格式确保 SIGTERM 正确传递给 Node 进程
# isCliEntry() 已修复符号链接解析，bin 命令可正常启动
CMD ["mcp-hub-lite", "start", "--foreground"]
