FROM node:20-slim

RUN apt-get update -qq && \
    apt-get install -y --no-install-recommends \
      texlive-xetex \
      texlive-fonts-extra \
      texlive-fonts-recommended \
      fontconfig \
      ca-certificates \
      curl \
      unzip && \
    mkdir -p /usr/share/fonts/source-sans /usr/share/fonts/roboto && \
    curl -fsSL -o /tmp/source-sans.zip \
      "https://github.com/adobe-fonts/source-sans/releases/download/3.052R/OTF-source-sans-3.052R.zip" && \
    unzip -o /tmp/source-sans.zip -d /tmp/source-sans && \
    find /tmp/source-sans -name '*.otf' -exec cp {} /usr/share/fonts/source-sans/ \; && \
    curl -fsSL -o /tmp/roboto.zip \
      "https://github.com/googlefonts/roboto/releases/download/v2.138/roboto-android.zip" && \
    unzip -o /tmp/roboto.zip -d /tmp/roboto && \
    find /tmp/roboto -name '*.ttf' -exec cp {} /usr/share/fonts/roboto/ \; && \
    printf '<?xml version="1.0"?>\n<!DOCTYPE fontconfig SYSTEM "fonts.dtd">\n<fontconfig>\n  <dir>/app/build</dir>\n  <dir>/app/templates</dir>\n</fontconfig>\n' > /etc/fonts/conf.d/99-app-fonts.conf && \
    fc-cache -fv && \
    rm -rf /tmp/source-sans.zip /tmp/source-sans /tmp/roboto.zip /tmp/roboto && \
    apt-get purge -y curl unzip && apt-get autoremove -y && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app/editor
