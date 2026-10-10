#!/usr/bin/env node
/**
 * Held-out measurement of the tag suggester.
 *
 * Reads one person's tagged bullets, splits them into two halves with a fixed
 * seed, selects the neighbour-vote parameters (blend weight, K, and whether the
 * starter vocabulary is in play) on the FIRST half, and scores hit@1 / hit@3 on
 * the SECOND half, which no selection step reads. Both arms run the same code
 * the API serves: lib/suggest ranking over lib/embed-scorer, with and without
 * lib/neighbour-scorer composed in.
 *
 * Protocol, so a printed figure says what it measures:
 *  - Selection: each first-half bullet is scored against a vote pool of the rest
 *    of the first half. The second half is absent from both the pool and the
 *    score.
 *  - Scoring: each second-half bullet is scored against a vote pool of the whole
 *    first half, so no scored bullet is ever in its own pool and no second-half
 *    tag votes for another.
 *  - Candidate vocabulary is the person's full tag set, which exists before any
 *    one bullet is tagged; usage counts, which only break ties, come from the
 *    pool side alone. Both arms get the identical candidate list.
 *
 * The bullets are résumé text, so they live only in a private database. The seed
 * and the protocol are fixed here; the rows are not in this repository, and
 * without them the printed rates cannot be regenerated.
 *
 * It takes either a database path plus a person id, or the JSON an export of
 * that person writes:
 *
 *   node scripts/eval-tag-suggest.cjs --db ../cv.db --person 5
 *   node scripts/eval-tag-suggest.cjs --export <exported-person JSON>
 *   node scripts/eval-tag-suggest.cjs --db ../cv.db --person 5 --seed 2
 *
 * Needs the optional @huggingface/transformers dependency and the MiniLM model
 * cache; CV_EMBED_OFFLINE=1 forbids a runtime download.
 */

const path = require('node:path');
const suggest = require('../lib/suggest');
const { withNeighbours, ALPHA, K } = require('../lib/neighbour-scorer');
const { SEED_TAGS } = require('../lib/seed-tags');
const { SEED_UNTIL } = require('../lib/db/tags');

const SEED_DEFAULT = 1;
const ALPHAS = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1];
const KS = [1, 2, 3, 4, 6, 8, 12, 16, 24];

function parseArgs(argv) {
  const out = { seed: SEED_DEFAULT };
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i].replace(/^--/, '');
    const val = argv[i + 1];
    if (key === 'seed' || key === 'person') out[key] = Number(val);
    else out[key] = val;
  }
  return out;
}

/** Bullets with text and at least one tag, from a person's export JSON. */
function bulletsFromExport(doc) {
  const rows = [];
  for (const s of doc.sections || []) {
    for (const e of s.entries || []) {
      for (const it of e.items || []) {
        const text = (it.content || '').trim();
        if (text && it.tags && it.tags.length) rows.push({ text, tags: [...it.tags].sort() });
      }
    }
  }
  return rows;
}

/** The same bullets straight from SQLite, for a database that is not exported. */
function bulletsFromDb(dbPath, personId) {
  const Database = require('better-sqlite3');
  const db = new Database(path.resolve(dbPath), { readonly: true });
  try {
    const rows = db
      .prepare(
        `SELECT i.id AS id, i.content AS content, it.tag AS tag
           FROM items i
           JOIN entries e ON e.id = i.entry_id
           JOIN sections s ON s.id = e.section_id
           JOIN item_tags it ON it.item_id = i.id
          WHERE s.person_id = ?
          ORDER BY i.id, it.tag`,
      )
      .all(personId);
    const byItem = new Map();
    for (const r of rows) {
      const text = (r.content || '').trim();
      if (!text) continue;
      const cur = byItem.get(r.id) || { text, tags: [] };
      cur.tags.push(r.tag);
      byItem.set(r.id, cur);
    }
    return [...byItem.values()];
  } finally {
    db.close();
  }
}

/** Seeded PRNG, so one seed names exactly one split. */
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffled(rows, rand) {
  const out = [...rows];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * Halve the rows, stratified by each bullet's most-used tag, so both halves see
 * the same tag mix. Shuffled rows are dealt alternately and the deal index runs
 * across stratum boundaries, so an odd stratum tips to whichever half the last
 * one did not, and the halves stay within one row of each other.
 */
function splitHalves(rows, seed) {
  const freq = new Map();
  for (const r of rows) for (const t of r.tags) freq.set(t, (freq.get(t) || 0) + 1);
  const stratumOf = (r) =>
    [...r.tags].sort((a, b) => freq.get(b) - freq.get(a) || (a < b ? -1 : 1))[0];

  const strata = new Map();
  for (const r of rows) {
    const key = stratumOf(r);
    if (!strata.has(key)) strata.set(key, []);
    strata.get(key).push(r);
  }

  const rand = mulberry32(seed);
  const first = [];
  const second = [];
  let dealt = 0;
  for (const key of [...strata.keys()].sort()) {
    for (const r of shuffled(strata.get(key), rand)) {
      (dealt++ % 2 === 0 ? first : second).push(r);
    }
  }
  return { first, second };
}

/**
 * Candidate list: every tag the person uses, with counts from the pool side
 * only. `withSeed` adds the starter vocabulary, which serving does while the
 * person's own tag count is under SEED_UNTIL.
 */
function buildCandidates(allRows, pool, withSeed) {
  const counts = new Map();
  for (const r of pool) for (const t of r.tags) counts.set(t, (counts.get(t) || 0) + 1);
  const byTag = new Map();
  for (const r of allRows) {
    for (const t of r.tags) {
      if (!byTag.has(t)) byTag.set(t, { tag: t, count: counts.get(t) || 0, inCatalog: false });
    }
  }
  if (withSeed) {
    for (const s of SEED_TAGS) {
      if (!byTag.has(s.tag))
        byTag.set(s.tag, { tag: s.tag, count: 0, inCatalog: false, description: s.description });
    }
  }
  return [...byTag.values()];
}

/**
 * hit@1 and hit@3 counts over `queries`, with `pool` supplying the votes.
 * `arm.opts` absent means the embedding ranker alone.
 * @param {Array} queries
 * @param {Array} pool
 * @param {{candidates: Array, embed: Function, base: Function, opts?: object}} arm
 */
async function score(queries, pool, arm) {
  const scorer = arm.opts ? withNeighbours(arm.base, arm.embed, pool, arm.opts) : arm.base;
  let hit1 = 0;
  let hit3 = 0;
  for (const q of queries) {
    const out = await suggest.suggestTags(q.text, arm.candidates, { limit: 3, scorer });
    const ranked = out.map((r) => r.tag);
    const gold = new Set(q.tags);
    if (ranked.slice(0, 1).some((t) => gold.has(t))) hit1++;
    if (ranked.slice(0, 3).some((t) => gold.has(t))) hit3++;
  }
  return { hit1, hit3, n: queries.length };
}

/** hit@3, then hit@1, then the weight that trusts the votes least. */
function beats(cand, best) {
  if (!best) return true;
  if (cand.hit3 !== best.hit3) return cand.hit3 > best.hit3;
  if (cand.hit1 !== best.hit1) return cand.hit1 > best.hit1;
  return cand.alpha > best.alpha;
}

/** The grid point `beats` ranks first on the selection half. */
async function selectParams(first, allRows, embed, base) {
  const grid = [];
  for (const withSeed of [false, true]) {
    for (const alpha of ALPHAS) {
      // A weight of 1 discards the votes, so k changes nothing about it.
      for (const k of alpha === 1 ? KS.slice(0, 1) : KS) grid.push({ alpha, k, withSeed });
    }
  }
  const candidatesFor = new Map(
    [false, true].map((withSeed) => [withSeed, buildCandidates(allRows, first, withSeed)]),
  );
  let best = null;
  for (const point of grid) {
    const arm = {
      candidates: candidatesFor.get(point.withSeed),
      embed,
      base,
      opts: { alpha: point.alpha, k: point.k },
    };
    const cand = { ...point, ...(await score(first, first, arm)) };
    if (beats(cand, best)) best = cand;
  }
  return best;
}

function pct(hit, n) {
  return n ? `${((100 * hit) / n).toFixed(1)}%` : 'n/a';
}

function line(label, r) {
  return `  ${label.padEnd(22)} hit@1 ${r.hit1}/${r.n} (${pct(r.hit1, r.n)})   hit@3 ${r.hit3}/${r.n} (${pct(r.hit3, r.n)})`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  let rows;
  if (args.export) {
    rows = bulletsFromExport(JSON.parse(require('node:fs').readFileSync(args.export, 'utf8')));
  } else if (args.db) {
    if (!args.person) throw new Error('--db needs --person <id>');
    rows = bulletsFromDb(args.db, args.person);
  } else {
    throw new Error('pass --export <json> or --db <path> --person <id>');
  }

  if (rows.length < 8) {
    console.error(
      `Only ${rows.length} tagged bullets found. A two-half protocol needs a tagged corpus; ` +
        'point --db or --export at a database that has one.',
    );
    process.exitCode = 1;
    return;
  }

  const { first, second } = splitHalves(rows, args.seed);
  const { embed, scorer: base } = require('../lib/embed-scorer');

  const chosen = await selectParams(first, rows, embed, base);
  const candidates = buildCandidates(rows, first, chosen.withSeed);
  const baseline = await score(second, first, { candidates, embed, base });
  const blended = await score(second, first, {
    candidates,
    embed,
    base,
    opts: { alpha: chosen.alpha, k: chosen.k },
  });

  const vocab = new Set(rows.flatMap((r) => r.tags));
  console.log(`tagged bullets ${rows.length}   tag vocabulary ${vocab.size}   seed ${args.seed}`);
  console.log(`split  selection n=${first.length}   held out n=${second.length}`);
  console.log(
    `selected on the selection half: blend weight ${chosen.alpha}, k ${chosen.k}, ` +
      `starter vocabulary ${chosen.withSeed ? 'on' : 'off'}`,
  );
  console.log(
    `serving uses: blend weight ${ALPHA}, k ${K}, ` +
      `starter vocabulary under ${SEED_UNTIL} tags of the person's own`,
  );
  console.log(line('selection half fit', { ...chosen }));
  console.log('held-out half:');
  console.log(line('no neighbour votes', baseline));
  console.log(line('blended', blended));
  console.log(
    `  difference            hit@1 ${blended.hit1 - baseline.hit1} items   ` +
      `hit@3 ${blended.hit3 - baseline.hit3} items`,
  );
  if (chosen.alpha === 1) {
    console.log('  a blend weight of 1 discards the votes, so the two arms are the same ranker.');
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exitCode = 1;
});
