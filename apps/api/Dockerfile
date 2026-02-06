# syntax=docker/dockerfile:1
FROM node:22-slim AS base

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
ENV CI=true

RUN corepack enable

# Build Go shared library
FROM golang:1.24 AS go-build
WORKDIR /app
COPY sharedLibs/go-html-to-md ./sharedLibs/go-html-to-md

RUN export GOPROXY=https://goproxy.io,direct && cd sharedLibs/go-html-to-md && \
    go mod download && \
    go build -o libhtml-to-markdown.so -buildmode=c-shared html-to-markdown.go

FROM base AS build
WORKDIR /app

# Use Tsinghua mirror for faster apt operations
RUN echo "deb https://mirrors.tuna.tsinghua.edu.cn/debian/ trixie main contrib non-free non-free-firmware" > /etc/apt/sources.list && \
    echo "deb https://mirrors.tuna.tsinghua.edu.cn/debian/ trixie-updates main contrib non-free non-free-firmware" >> /etc/apt/sources.list && \
    echo "deb https://mirrors.tuna.tsinghua.edu.cn/debian/ trixie-backports main contrib non-free non-free-firmware" >> /etc/apt/sources.list


# Install system dependencies
RUN apt-get update && apt-get install -y \
    curl \
    build-essential \
    pkg-config \
    python3 \
    && rm -rf /var/lib/apt/lists/*

ENV RUSTUP_DIST_SERVER=https://mirrors.sjtug.sjtu.edu.cn/rust-static
ENV RUSTUP_UPDATE_ROOT=https://mirrors.sjtug.sjtu.edu.cn/rust-static/rustup


# Install Rust
ENV RUSTUP_HOME=/usr/local/rustup \
    CARGO_HOME=/usr/local/cargo \
    PATH=/usr/local/cargo/bin:$PATH

# RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --no-modify-path \
#     && chmod -R a+w $RUSTUP_HOME $CARGO_HOME
COPY rustup-init.sh ./rustup-init.sh
RUN chmod +x rustup-init.sh && ./rustup-init.sh -y --no-modify-path --default-toolchain stable \
    && chmod -R a+w $RUSTUP_HOME $CARGO_HOME
    
ENV NPM_CONFIG_REGISTRY=https://registry.npmmirror.com

ENV PNPM_CONFIG_REGISTRY=https://registry.npmmirror.com

# 或者直接使用 pnpm 的环境变量
RUN echo "registry=https://registry.npmmirror.com" > .npmrc

# Copy source files
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY . .

# Install dependencies
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    --mount=type=cache,target=/usr/local/cargo/registry \
    --mount=type=cache,target=/app/native/target \
    pnpm install --frozen-lockfile

# Build the application
RUN pnpm run build

# Remove dev dependencies
RUN pnpm prune --prod --ignore-scripts

# Runtime stage
FROM base AS runtime

# Install runtime dependencies
RUN apt-get update && apt-get install -y \
    git \
    procps \
    && rm -rf /var/lib/apt/lists/*

EXPOSE 8080
WORKDIR /app

# Copy built application
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/native ./native

# Copy Go shared library
COPY --from=go-build /app/sharedLibs/go-html-to-md/libhtml-to-markdown.so ./sharedLibs/go-html-to-md/

CMD ["node", "dist/src/harness.js", "--start-docker"]
