FROM registry.cloudflare.com/8b0d70250211aa10d89e20605a1c7e5e/riffology-issue165-trusted-pi@sha256:9b76ab9ee7a4f31d250957fbbeefc62d71056e6bd1eb24686ebbeaff3d65873c

USER root
RUN mkdir -p /opt/riffology/project-resources /opt/riffology/browser-preview/runtime \
    && chown root:root /opt/riffology/project-resources /opt/riffology/browser-preview /opt/riffology/browser-preview/runtime \
    && chmod 0755 /opt/riffology/project-resources /opt/riffology/browser-preview /opt/riffology/browser-preview/runtime

COPY --chown=root:root --chmod=0444 services/browser-preview/runtime/sha256.mjs /opt/riffology/browser-preview/runtime/sha256.mjs
COPY --chown=root:root --chmod=0444 services/project-resources/text.mjs /opt/riffology/project-resources/text.mjs
COPY --chown=root:root --chmod=0444 services/runtime/controlled-pi.mjs /opt/riffology/runtime/controlled-pi.mjs
COPY --chown=root:root --chmod=0444 services/trusted-pi/release-candidate.mjs /opt/riffology/trusted-pi/release-candidate.mjs
COPY --chown=root:root --chmod=0444 services/trusted-pi/research-context.mjs /opt/riffology/trusted-pi/research-context.mjs
COPY --chown=root:root --chmod=0444 services/trusted-pi/release-candidate.mjs /opt/riffology/trusted-pi/trusted-pi-release.mjs
