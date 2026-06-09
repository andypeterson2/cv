# syntax=docker/dockerfile:1
#
# Multi-target image for the CV editor.
#   texbase → deps → deploy   (self-contained image for any host / remote)
#   texbase → deps → dev      (bind-mounted source for the local container loop)
#
# Stage order keeps the heavy TeX/font layer (texbase) cached independently of
# app code and deps, so a code change rebuilds only the cheap `deploy` layer.

# ---------------------------------------------------------------------------
# texbase — XeLaTeX engine + fonts. Changes ~never → cached across builds.
# Trimmed: dropped texlive-fonts-extra (unused — the actual fonts are fetched
# below and FontAwesome is bundled in templates/). Added latex-recommended/
# latex-extra (tcolorbox, enumitem, hyperref, …) and pictures (PGF/tikz: the
# photo uses tikzpicture and tcolorbox[skins] pulls tikz).
# ---------------------------------------------------------------------------
FROM node:20-slim AS texbase
RUN apt-get update -qq && \
    apt-get install -y --no-install-recommends \
      texlive-xetex \
      texlive-latex-recommended \
      texlive-latex-extra \
      texlive-fonts-recommended \
      texlive-pictures \
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
    printf '<?xml version="1.0"?>\n<!DOCTYPE fontconfig SYSTEM "fonts.dtd">\n<fontconfig>\n  <dir>/app/build</dir>\n  <dir>/app/editor/layouts</dir>\n  <dir>/app/fonts</dir>\n</fontconfig>\n' > /etc/fonts/conf.d/99-app-fonts.conf && \
    fc-cache -fv && \
    rm -rf /tmp/source-sans.zip /tmp/source-sans /tmp/roboto.zip /tmp/roboto && \
    apt-get purge -y curl unzip && apt-get autoremove -y && \
    rm -rf /var/lib/apt/lists/*

# ---------------------------------------------------------------------------
# deps — production node_modules + baked embedding model. Rebuilds only when
# the lockfile or prefetch script change (not on app code edits).
# ---------------------------------------------------------------------------
FROM texbase AS deps
# Native build fallback (better-sqlite3 / onnxruntime usually use prebuilts).
RUN apt-get update -qq && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
WORKDIR /app/editor
COPY editor/package.json editor/package-lock.json ./
RUN npm ci --omit=dev
COPY editor/scripts/prefetch-model.cjs ./scripts/prefetch-model.cjs
RUN node scripts/prefetch-model.cjs   # bakes ~23MB quantized model into node_modules/.cache

# ---------------------------------------------------------------------------
# deploy — self-contained image. App code + deps + model COPYd in; no bind
# mounts. This is the one artifact you ship to any host.
# ---------------------------------------------------------------------------
FROM texbase AS deploy
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3001 CV_EMBED_OFFLINE=1
WORKDIR /app/editor
COPY editor/ ./
COPY --from=deps /app/editor/node_modules ./node_modules
# LaTeX layouts ship as bundles under editor/layouts/ (the awesome-cv builtin
# carries its own .cls + fonts in class/). Uploaded layouts live in the writable
# CV_LAYOUTS_DIR volume at runtime — no rebuild needed to add one.
COPY assets/ /app/assets/
RUN mkdir -p /app/build /app/fonts
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:'+(process.env.PORT||3001)+'/api/health',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"
CMD ["node", "server.js"]

# ---------------------------------------------------------------------------
# dev — fast local container. node_modules + model baked from `deps`; source is
# bind-mounted at runtime (see docker-compose.yml), so NO code COPY here.
# ---------------------------------------------------------------------------
FROM deps AS dev
ENV NODE_ENV=development HOST=0.0.0.0 PORT=3001 CV_EMBED_OFFLINE=1
WORKDIR /app/editor
EXPOSE 3001
CMD ["npm", "run", "dev"]
