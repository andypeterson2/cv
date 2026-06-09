# Authoring a CV layout

A **layout** decides how a CV/resume/cover letter is typeset. It's a self-contained
bundle of Nunjucks templates + LaTeX support files that turns the resolved-CV data
into a `.tex` document. Layouts are selected per variant (with a global default) and
can be uploaded at runtime — no container rebuild. Every uploaded layout must pass a
**contract gate** before it becomes selectable.

Two builtins live here and are the best examples:
- [`awesome-cv/`](awesome-cv) — the original single-column design (ships its own `.cls` + fonts in `class/`).
- [`classic/`](classic) — a from-scratch layout on the stock `article` class (no third-party class).

## Bundle structure

```
my-layout/
  layout.json              manifest (required)
  templates/
    document.tex.njk        CV/resume template (required if kinds includes cv/resume)
    coverletter.tex.njk     cover-letter template (required if kinds includes coverletter)
    partials/…              optional includes/macros (\<% import %>, \<% include %>)
  class/                    optional .cls/.sty/.otf/.fd — copied next to the .tex at compile
  assets/                   optional images bundled with the layout
```

A bundle is uploaded as a `.zip` (the `layout.json` at the zip root, or inside a single
top-level folder).

### `layout.json`

```jsonc
{
  "id": "my-layout",            // slug: [a-z0-9_-]+ (unique; not a builtin id)
  "name": "My Layout",
  "version": "1.0.0",
  "engine": "nunjucks",         // only engine for now
  "contextVersion": 1,          // must match the host (see below)
  "kinds": ["cv", "resume", "coverletter"],
  "entry": {
    "document": "templates/document.tex.njk",
    "coverletter": "templates/coverletter.tex.njk"
  },
  "main": "{kind}.tex",         // rendered file name; {kind} → cv|resume|coverletter
  "classFiles": ["class/my.cls"] // declared support files (verified to exist)
}
```

## Template syntax

Nunjucks with **LaTeX-safe delimiters** (so template syntax never collides with `{}`/`%`):

| | delimiter |
|---|---|
| variable | `<< expr >>` |
| block | `<% if %> … <% endif %>`, `<% for x in xs %> … <% endfor %>` |
| comment | `<# … #>` |

**Escaping is explicit** — autoescape is off. Pipe every user value through `tex`:

- `<< value | tex >>` — escape for LaTeX text (`# $ % & _ ^`). Use this almost everywhere.
- `<< value | texurl >>` — escape for a URL argument (e.g. `\href{...}`).
- `<< array | texargs >>` — `['a','b']` → `{a}{b}` (variable-arity commands on one line).

Intentional LaTeX in a value passes through unescaped (e.g. a bullet containing
`\textbf{...}` renders bold) — `tex` only escapes the bare specials.

### Whitespace gotcha (important)

The engine runs with `trimBlocks`+`lstripBlocks`: a block tag **on its own line** emits
nothing (no stray blank line). But a block tag **at the end of a content line** eats that
line's trailing newline. So:

- ✅ Put `<% if %>` / `<% endif %>` / `<% for %>` on their **own lines**.
- ❌ Don't end a content line with an inline `…\par<% endif %>` — the `\par` will butt
  against the next word (`\parDear` → undefined control sequence). Same for `\quad`,
  control words generally, and blank lines inside non-`\long` macro args (e.g. awesome-cv's
  `\cventry`). A control word followed by a letter is the classic failure.

Mid-line conditionals are fine when followed by more content on the same line
(`a<% if both %> \textbullet{} <% endif %>b`).

## The data contract (template context)

`contextVersion: 1`. Your templates receive:

```
meta:    { kind, layoutId, contextVersion }
personal: {
  firstName, lastName, position, address, mobile, email, dateofbirth, quote, extrainfo,
  photo:   { enabled, file } | null,        // file is a path under the build dir, e.g. assets/profile
  socials: [ { key, values:[…] } ]          // key e.g. 'github'; 1 or 2 values
}
sections: [ {
  id,            // slug
  type,          // semantic: experience|education|skills|honors|summary|references|…
  latexType,     // one of: cventries | cvskills | cvhonors | cvreferences | cvparagraph
  title,
  entries: [ { …fields, items:[ "bullet text", … ] } ],  // for cventries; education's
                                                          // program+major are combined into position
  text           // for cvparagraph only
} ]
coverletter: {   // only when kind === 'coverletter'
  recipientName, recipientAddress, title, opening, closing,
  enclosure: { label, content }, sections: [ { title, body } ]
} | null
style:   { fontSize, pageSize, fontFamily, accentColor, accent:{ kind, value, hex } }
spacing: { horizontalMargin, marginTop, … }   // string values like "1.4cm"
fonts:   { headerNameSize, contentTextSize, … }
```

Field shapes per `latexType`:

| latexType | entry fields | items? |
|---|---|---|
| `cventries` | `position, organization, location, date` | yes |
| `cvskills` | `category, skills` | no |
| `cvhonors` | `award, issuer, location, date` | no |
| `cvreferences` | `name, relation, phone, email` | no |
| `cvparagraph` | (uses section `text`) | no |

Sections with no surviving entries are already dropped; tag-filtering/overrides/sorting
are already applied. Render defensively — any field may be empty.

## The contract gate

On upload (and via `POST /api/layouts/:id/verify`), a candidate is checked:

1. **Static** — manifest schema, `contextVersion` matches the host, declared `entry`/`classFiles` exist.
2. **Security** — rejects `\write18` and `\input`/`\openin`/`\openout` of absolute or `..` paths.
3. **Dynamic** — renders a synthetic kitchen-sink fixture (every section type, all socials,
   LaTeX specials, a photo, a cover letter) **and your real CVs**, compiles each with
   `xelatex --no-shell-escape`, and requires exit 0 + a PDF + ≥ 1 page + no undefined
   control sequences.

Untrusted templates are rendered in a worker thread with a timeout, so a runaway template
can't hang the server.

## Installing

- **REST:** `POST /api/layouts` (multipart, field `bundle` = the `.zip`). On failure the
  response includes the failing checks. `DELETE /api/layouts/:id` removes it (builtins are
  protected; variants using it revert to the default).
- **MCP:** `cv_install_layout({ zip_path })`, `cv_verify_layout({ layout_id })`,
  `cv_delete_layout({ layout_id })`, and select with `cv_set_variant_layout` /
  `cv_set_default_layout`.

Builtin bundles are baked into the image under `editor/layouts/`; uploaded bundles live in
`CV_LAYOUTS_DIR` (a persistent volume in deploy).
