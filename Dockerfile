FROM node:20-slim

RUN apt-get update -qq && \
    apt-get install -y --no-install-recommends \
      texlive-xetex \
      texlive-fonts-extra \
      fontconfig && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app/editor
