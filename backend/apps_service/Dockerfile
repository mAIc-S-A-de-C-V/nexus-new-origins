FROM python:3.12.9-slim

WORKDIR /app

# Build context is the repo root (see docker-compose.yml). This Dockerfile
# needs the SDK source available so server-side esbuild can resolve
# `@nexus/app-sdk/react` when bundling user code submitted from the Studio.

RUN apt-get update && apt-get install -y --no-install-recommends \
      curl ca-certificates gnupg \
    && rm -rf /var/lib/apt/lists/*

# Node 20 (slim) + esbuild — used by the Studio publish flow to bundle user
# TSX into a deployable JS asset. We pre-create /studio-deps with React +
# the SDK so user code resolves `react` / `react-dom` / `@nexus/app-sdk`
# without per-publish npm installs.
RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && rm -rf /var/lib/apt/lists/* \
    && npm install -g esbuild@0.21.5

COPY backend/apps_service/requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt

# Copy SDK source, build it (produces dist/), then make it a package
# /studio-deps can install.
COPY nexus-apps-sdk /opt/nexus-apps-sdk
RUN cd /opt/nexus-apps-sdk && npm install --no-audit --no-fund && npm run build

RUN mkdir -p /studio-deps \
    && cd /studio-deps \
    && npm init -y \
    && npm install --no-audit --no-fund \
        react@18 react-dom@18 \
        file:/opt/nexus-apps-sdk

# Pack the SDK into an npm-compatible tarball + drop a manifest so the
# /sdk/* endpoints can serve it to authenticated developers. The version
# string comes from package.json — bump it there before each release.
RUN cd /opt/nexus-apps-sdk \
    && VERSION=$(node -p "require('./package.json').version") \
    && PACKED=$(npm pack 2>/dev/null | tail -n 1) \
    && mkdir -p /opt/sdk-dist/v${VERSION} \
    && mv "${PACKED}" /opt/sdk-dist/v${VERSION}/nexus-app-sdk.tgz \
    && (cd /opt/sdk-dist && ln -sf v${VERSION} latest) \
    && node -e "const fs=require('fs'),p=require('crypto'); const v='${VERSION}'; \
        const tgz=fs.readFileSync('/opt/sdk-dist/v'+v+'/nexus-app-sdk.tgz'); \
        const h=p.createHash('sha256').update(tgz).digest('hex'); \
        fs.writeFileSync('/opt/sdk-dist/v'+v+'/manifest.json', JSON.stringify({version:v,sha256:h,size:tgz.length,filename:'nexus-app-sdk.tgz'},null,2));"

# Bundle the CLI into a single self-contained file. The CLI imports `tar`
# (an npm package) and would fail at runtime without node_modules next to
# it — bundling inlines every dep so /opt/cli/nexus-app runs anywhere
# Node 18+ is installed, no node_modules required. We output CJS so the
# shebang-launched binary doesn't need a .mjs extension or a sibling
# package.json with type=module.
RUN mkdir -p /opt/cli \
    && cd /opt/nexus-apps-sdk \
    && npx --yes esbuild@0.21.5 cli/index.mjs \
         --bundle \
         --platform=node \
         --target=node18 \
         --format=cjs \
         --outfile=/opt/cli/nexus-app \
    && chmod +x /opt/cli/nexus-app

COPY backend/shared /app/shared
COPY backend/apps_service /app/

EXPOSE 8028

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8028"]
