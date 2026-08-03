FROM node:22-bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive \
    LANG=C.UTF-8 \
    LC_ALL=C.UTF-8

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ca-certificates \
        g++ \
        openjdk-17-jdk-headless \
        python3 \
        php-cli \
        lua5.4 \
        mono-mcs \
        mono-runtime \
    && npm install --global esbuild@0.25.8 \
    && rm -rf /var/lib/apt/lists/* /root/.npm

RUN groupadd --gid 65532 sandbox \
    && useradd --uid 65532 --gid 65532 --no-create-home --home-dir /tmp --shell /usr/sbin/nologin sandbox \
    && mkdir -p /workspace \
    && chown 65532:65532 /workspace

COPY --chown=65532:65532 runner.mjs /opt/socialbird-sandbox/runner.mjs

USER 65532:65532
WORKDIR /workspace
ENTRYPOINT ["node", "/opt/socialbird-sandbox/runner.mjs"]
