#!/usr/bin/env node
/**
 * Rank a profile's items against a role, and see where the hand-kept ones land.
 *
 * A hand-built variant is ground truth for "what belongs in a targeted resume".
 * Its title stands in for a job posting: tag the title, score every item by how
 * well its tags match, sort, and cut at the number of items the author kept. If
 * the kept items rise to the top, posting to ranked items is a usable first
 * draft. If they sit where chance would put them, the tags identify content but
 * do not select it.
 *
 *   node scripts/rank-items.cjs --corpus <dump> --queries <queries>
 *   node scripts/rank-items.cjs --corpus <dump> --verify
 *
 * `--verify` prints the kept-item counts and pairwise overlaps, so a
 * disagreement with the live resolver shows up before a ranking number is
 * believed.
 *
 * Read-only: reads a profile dump and writes nothing.
 */
'use strict';

const fs = require('node:fs');

// Mirrors lib/db/variants.js: exclude is checked first and beats include, an
// empty include set passes everything, and an override with a non-null
// `included` answers before the tags are consulted at all.
function matchesTags(tags, rules) {
  if (rules.exclude.size && tags.some((t) => rules.exclude.has(t))) return false;
  if (rules.include.size === 0) return true;
  return tags.some((t) => rules.include.has(t));
}

function included(tags, rules, override) {
  if (override && override.included != null) return override.included === 1;
  return matchesTags(tags, rules);
}

/**
 * The items a variant renders, and the items it could have rendered.
 *
 * Section choice is not a tag decision — the resolver consults
 * `variant_sections` before it looks at a single tag — so the pool is scoped to
 * the sections the variant enables. An entry that fails is skipped whole: its
 * items are never reached, which is why entries are resolved first here too.
 */
function resolve(corpus, variant) {
  const rules = {
    include: new Set(variant.rules?.include || []),
    exclude: new Set(variant.rules?.exclude || []),
  };
  const entryOv = variant.entryOverrides || {};
  const itemOv = variant.itemOverrides || {};
  const enabled = new Set(
    (variant.sections || []).filter((s) => s.enabled).map((s) => s.sectionId),
  );
  const pool = [];
  const kept = new Set();
  for (const section of corpus.sections) {
    if (enabled.size && !enabled.has(section.id)) continue;
    for (const entry of section.entries) {
      const entryIn = included(entry.tags || [], rules, entryOv[String(entry.id)]);
      for (const item of entry.items || []) {
        pool.push({ id: item.id, tags: item.tags || [], entryId: entry.id, section: section.slug });
        if (entryIn && included(item.tags || [], rules, itemOv[String(item.id)])) kept.add(item.id);
      }
    }
  }
  return { pool, kept };
}

// Sum the query's scores for every query tag the item carries. Longer items
// carry more tags and would otherwise win on length alone, so the sum is damped
// by the square root of the tag count rather than divided by it outright, which
// would punish a well-tagged item for being well tagged.
function overlapScore(itemTags, queryTags) {
  const own = new Set(itemTags);
  let sum = 0;
  for (const q of queryTags) if (own.has(q.tag)) sum += q.score;
  return sum === 0 ? 0 : sum / Math.sqrt(itemTags.length || 1);
}

// Rank by score, breaking ties by id so a run is reproducible.
function rankBy(pool, score) {
  return [...pool].sort((a, b) => score(b) - score(a) || a.id - b.id);
}

function precisionAtK(ranked, kept, k) {
  const top = ranked.slice(0, k);
  const hit = top.filter((i) => kept.has(i.id)).length;
  return { p: hit / (k || 1), r: hit / (kept.size || 1), hit };
}

// Where the kept items sit in the ranking, 0 at the top, 0.5 at chance. Most
// items score zero, and ordering those by id would read as a ranking when it is
// an arbitrary order, so tied items take their group's average position.
function medianPercentile(ranked, kept, score) {
  const n = ranked.length;
  const rankOf = new Map();
  for (let i = 0; i < n;) {
    let j = i;
    while (j + 1 < n && score(ranked[j + 1]) === score(ranked[i])) j++;
    const mid = (i + j) / 2;
    for (let x = i; x <= j; x++) rankOf.set(ranked[x].id, mid);
    i = j + 1;
  }
  const pos = ranked.filter((i) => kept.has(i.id)).map((i) => rankOf.get(i.id) / (n - 1 || 1));
  if (!pos.length) return null;
  pos.sort((a, b) => a - b);
  const mid = Math.floor(pos.length / 2);
  return pos.length % 2 ? pos[mid] : (pos[mid - 1] + pos[mid]) / 2;
}

function jaccard(a, b) {
  const inter = [...a].filter((x) => b.has(x)).length;
  const union = new Set([...a, ...b]).size;
  return union ? inter / union : 0;
}

function verify(corpus) {
  const variants = corpus.variants.filter(
    (v) =>
      (v.itemOverrides && Object.keys(v.itemOverrides).length) ||
      (v.entryOverrides && Object.keys(v.entryOverrides).length),
  );
  const sets = new Map();
  console.log('variant                                  pool  kept');
  for (const v of variants) {
    const { pool, kept } = resolve(corpus, v);
    sets.set(v.id, kept);
    console.log(
      `${String(v.id).padStart(3)} ${v.name.slice(0, 34).padEnd(34)} ${String(pool.length).padStart(5)} ${String(kept.size).padStart(5)}`,
    );
  }
  console.log('\npairwise Jaccard of the kept sets');
  const ids = [...sets.keys()];
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      console.log(
        `  ${ids[i]} vs ${ids[j]}: ${jaccard(sets.get(ids[i]), sets.get(ids[j])).toFixed(2)}`,
      );
    }
  }
}

// The frequency prior: rank by how often a tag is used across the whole
// profile, ignoring the query entirely. A ranking that cannot beat this is
// reporting "tags the author uses a lot", not "tags this role wants".
function frequencyPrior(corpus) {
  const freq = new Map();
  for (const section of corpus.sections) {
    for (const entry of section.entries) {
      for (const item of entry.items || []) {
        for (const t of item.tags || []) freq.set(t, (freq.get(t) || 0) + 1);
      }
    }
  }
  return (item) =>
    (item.tags || []).reduce((n, t) => n + (freq.get(t) || 0), 0) /
    Math.sqrt(item.tags.length || 1);
}

function scoreVariant(corpus, variant, query, priorScore) {
  const { pool, kept } = resolve(corpus, variant);
  const k = kept.size;
  const qScore = (i) => overlapScore(i.tags, query.tags);
  const scored = rankBy(pool, qScore);
  const prior = rankBy(pool, priorScore);
  const at = precisionAtK(scored, kept, k);

  // Chance precision is k/pool in expectation. A single shuffle samples that
  // and can draw 0, which is useless as a denominator.
  const chance = k / pool.length;
  return {
    id: variant.id,
    name: variant.name,
    pool: pool.length,
    k,
    matched: pool.filter((i) => qScore(i) > 0).length,
    query: at,
    prior: precisionAtK(prior, kept, k),
    chance,
    lift: at.p / chance,
    pct: medianPercentile(scored, kept, qScore),
    priorPct: medianPercentile(prior, kept, priorScore),
    untagged: pool.filter((i) => !i.tags.length).length,
  };
}

function rank(corpus, queries) {
  const priorScore = frequencyPrior(corpus);
  const rows = corpus.variants
    .filter((v) => queries.queries[String(v.id)])
    .map((v) => scoreVariant(corpus, v, queries.queries[String(v.id)], priorScore));

  console.log(
    '                                      pool    k  matched   P@k  chance   prior   lift   med%ile  prior%ile',
  );
  for (const r of rows) {
    console.log(
      `${String(r.id).padStart(3)} ${r.name.slice(0, 32).padEnd(32)} ` +
        `${String(r.pool).padStart(5)}${String(r.k).padStart(5)}${String(r.matched).padStart(9)}  ` +
        `${r.query.p.toFixed(3)}  ${r.chance.toFixed(3)}  ${r.prior.p.toFixed(3)}  ` +
        `${r.lift.toFixed(2)}x     ${r.pct == null ? '  -  ' : r.pct.toFixed(3)}      ` +
        `${r.priorPct == null ? '  -  ' : r.priorPct.toFixed(3)}`,
    );
  }
  console.log(
    '\nP@k is precision at k = the number of items the author kept; at that k, recall equals precision.',
  );
  console.log(
    'chance = k/pool, the precision of an arbitrary order. prior = ranked by overall tag frequency.',
  );
  console.log(
    'lift = P@k over chance. med%ile = where the kept items sit, 0 = top, 0.5 = chance, ties averaged.',
  );
  const untagged = rows.reduce((n, r) => Math.max(n, r.untagged), 0);
  if (untagged)
    console.log(`\n${untagged} item(s) in scope carry no tags and can never be ranked.`);
  return rows;
}

function main() {
  const args = process.argv.slice(2);
  const get = (flag) => {
    const i = args.indexOf(flag);
    return i >= 0 ? args[i + 1] : null;
  };
  const corpusPath = get('--corpus');
  if (!corpusPath) {
    console.error(
      'usage: rank-items.cjs --corpus <getMain.json> [--queries <queries.json>] [--verify]',
    );
    process.exit(2);
  }
  const corpus = JSON.parse(fs.readFileSync(corpusPath, 'utf8'));
  if (args.includes('--verify')) return verify(corpus);

  const queriesPath = get('--queries');
  if (!queriesPath) {
    console.error('--queries is required unless --verify is passed');
    process.exit(2);
  }
  const rows = rank(corpus, JSON.parse(fs.readFileSync(queriesPath, 'utf8')));
  const out = get('--out');
  if (out) fs.writeFileSync(out, `${JSON.stringify(rows, null, 1)}\n`);
}

main();
