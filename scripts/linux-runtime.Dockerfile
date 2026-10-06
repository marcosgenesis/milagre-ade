FROM node:24-bookworm AS node
FROM fedora:43
COPY --from=node /usr/local/bin/node /usr/local/bin/node
COPY --from=node /usr/local/lib/node_modules/ /usr/local/lib/node_modules/
RUN ln -s /usr/local/lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm \
    && ln -s /usr/local/lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx
RUN dnf install -y git rpm gnupg2 xorg-x11-server-Xvfb xorg-x11-xauth desktop-file-utils findutils procps-ng shadow-utils util-linux \
    && dnf clean all \
    && useradd -m -s /bin/bash tester
