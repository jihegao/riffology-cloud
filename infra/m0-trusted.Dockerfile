FROM docker.io/cloudflare/sandbox:0.12.9@sha256:4a56a37a3cfd9b38d65bb4b5d0b341e6490a3a4c0226274ae4c1cca4948e85fe

ENV PYTHON_POOL_MIN_SIZE=0 \
    JAVASCRIPT_POOL_MIN_SIZE=0 \
    TYPESCRIPT_POOL_MIN_SIZE=0
WORKDIR /opt/riffology
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY services/runtime/controlled-pi.mjs services/runtime/proxy-pi.mjs ./services/runtime/
COPY scripts/m0/proxy-pi-child.mjs scripts/m0/pi-image-check.mjs ./scripts/m0/
# Run the actual diagnostic entrypoint and locked SDK while the build step has no network.
RUN --network=none node scripts/m0/pi-image-check.mjs
# No project workspace is mounted here. Cloud model calls still require the
# scoped proxy integration; this image alone does not pass G0-T01.
