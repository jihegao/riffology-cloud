# A derived candidate, never the unqualified Playwright tag or the AMD fixture.
# Public MCR linux/amd64 manifest and config were read/hash-checked on 2026-10-17.
FROM --platform=linux/amd64 mcr.microsoft.com/playwright@sha256:957bb6b7cba151ced0b5bb841703e282c45df1d934af88933b1b655411ecba3a
WORKDIR /opt/viewer
COPY vendor/playwright /opt/viewer/node_modules/playwright
COPY vendor/playwright-core /opt/viewer/node_modules/playwright-core
RUN groupadd --gid 10001 viewer \
 && useradd --uid 10001 --gid 10001 --create-home --home-dir /home/viewer --shell /usr/sbin/nologin viewer \
 && ln -s /ms-playwright/chromium-1243/chrome-linux64 /opt/chrome \
 && test -x /opt/chrome/chrome \
 && node -e 'if(require("playwright/package.json").version!=="1.63.0"||require("playwright-core/package.json").version!=="1.63.0")process.exit(1)'
USER 10001:10001
# The Worker supplies a fixed entrypoint and controls its one browser via exec IO.
# No HTTP listener, secret, project file, download, install, or elevated sandbox flag.
ENTRYPOINT ["node", "-e", "process.on('SIGTERM',()=>process.exit(0));setInterval(()=>{},1000)"]
