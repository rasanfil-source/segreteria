FROM node:22-bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive
# The Apps Script project runs in Europe/Rome (see appsscript.json); the Node
# test suite constructs local-time Date objects and asserts against that zone.
ENV TZ=Europe/Rome

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ca-certificates \
        curl \
        git \
        tzdata \
    && ln -sf /usr/share/zoneinfo/Europe/Rome /etc/localtime \
    && echo "Europe/Rome" > /etc/timezone \
    && rm -rf /var/lib/apt/lists/*

# clasp is the CLI used to push/deploy the code to Google Apps Script.
RUN npm install -g @google/clasp

USER node
