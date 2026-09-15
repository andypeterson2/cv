"""Build editor/lib/seed-tags.json: the starter tag vocabulary for tag suggestion.

The vocabulary is a short list of broad résumé categories written here, plus ESCO
skills (European Skills, Competences, Qualifications and Occupations, v1.1.0,
© European Union): the ICT knowledge subtree and the transversal and research skill
collections. ESCO labels
become short tags ("Java (computer programming)" -> "java"); the full label and the
first sentence of ESCO's description are kept as the text suggestion embeds.

Usage:
    python scripts/build_seed_tags.py --esco-dir /path/to/ESCO_v1.1.0_classification_en_csv
The directory must hold skills_en.csv, skillGroups_en.csv,
broaderRelationsSkillPillar_en.csv, transversalSkillsCollection_en.csv and
researchSkillsCollection_en.csv from the ESCO download (esco.ec.europa.eu).
"""

import argparse
import csv
import json
import re
import sys
import unicodedata
from collections import defaultdict
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "editor" / "lib" / "seed-tags.json"
MAX_WORDS = 4
MAX_CHARS = 32
MAX_DESCRIPTION = 220

CORE = {
    "leadership": "Leading teams, projects or organizations and setting their direction.",
    "mentoring": "Coaching, training or developing other people.",
    "teaching": "Instructing students or running workshops and courses.",
    "communication": "Presenting, explaining and keeping stakeholders informed.",
    "writing": "Writing reports, articles, documentation or other published text.",
    "public-speaking": "Giving talks, presentations and demonstrations to audiences.",
    "project-management": "Planning, scheduling and delivering projects to deadlines and budgets.",
    "product-management": "Defining products, prioritizing features and working with users.",
    "operations": "Running day-to-day processes, logistics and procedures.",
    "customer-service": "Supporting customers and resolving their problems.",
    "sales": "Selling products or services and managing client relationships.",
    "marketing": "Promoting products, brands or events.",
    "finance": "Budgeting, financial analysis and accounting.",
    "research": "Designing studies, running experiments and reporting findings.",
    "data-analysis": "Analysing data, building reports and drawing conclusions from numbers.",
    "machine-learning": "Training, evaluating and deploying machine-learning models.",
    "software-engineering": "Designing, writing and maintaining software.",
    "web-development": "Building websites and web applications.",
    "mobile-development": "Building apps for phones and tablets.",
    "backend": "Building servers, APIs and back-end services.",
    "frontend": "Building user interfaces and client-side applications.",
    "databases": "Designing and running databases, schemas and queries.",
    "cloud": "Deploying and running services on cloud platforms.",
    "devops": "Automating builds, deployment, monitoring and infrastructure.",
    "security": "Protecting systems and data: access control, hardening and threat response.",
    "cryptography": "Encryption, keys and secure communication protocols.",
    "networking": "Computer networks, network protocols and network administration.",
    "systems-administration": "Running servers, user accounts and IT systems.",
    "testing": "Testing software and assuring its quality.",
    "documentation": "Writing guides, manuals and knowledge bases.",
    "design": "Visual, graphic or product design.",
    "ux": "Researching and designing user experiences.",
    "hardware": "Electronics, lab equipment and physical systems.",
    "quantum-computing": "Quantum algorithms, quantum circuits and quantum hardware.",
    "event-planning": "Organizing events, conferences and competitions.",
    "volunteering": "Unpaid community, charity or student-organization work.",
    "recruiting": "Hiring, interviewing and onboarding people.",
    "collaboration": "Working across teams and with partners.",
    "problem-solving": "Diagnosing problems and finding solutions.",
    "compliance": "Meeting regulations, policies and standards.",
    "healthcare": "Clinical, patient-care or health-sector work.",
    "education": "Academic study, coursework and qualifications.",
}


def norm_tag(text: str) -> str:
    """Mirror of normTag in editor/lib/db/helpers.js."""
    t = unicodedata.normalize("NFKD", text)
    t = "".join(c for c in t if not unicodedata.combining(c)).strip().lower()
    t = re.sub(r"[\s_]+", "-", t)
    t = re.sub(r"-+", "-", t)
    return t.strip("-")


def short_tag(label: str) -> str | None:
    base = re.sub(r"\s*\([^)]*\)\s*$", "", label).strip()
    if not base or len(base.split()) > MAX_WORDS:
        return None
    tag = norm_tag(base)
    if len(tag) > MAX_CHARS or not re.fullmatch(r"[a-z0-9+#.\-]+", tag):
        return None
    return tag


def first_sentence(text: str) -> str:
    text = " ".join((text or "").split())
    m = re.match(r"(.+?[.!?])(\s|$)", text)
    sentence = m.group(1) if m else text
    return sentence[:MAX_DESCRIPTION]


def read(path: Path) -> list[dict]:
    with path.open(newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))


def ict_uris(esco: Path) -> set[str]:
    labels = {r["conceptUri"]: r["preferredLabel"] for r in read(esco / "skillGroups_en.csv")}
    children = defaultdict(list)
    for r in read(esco / "broaderRelationsSkillPillar_en.csv"):
        children[r["broaderUri"]].append(r["conceptUri"])
    ict = "information and communication tech"
    roots = [uri for uri, label in labels.items() if label.lower().startswith(ict)]
    seen, stack = set(), list(roots)
    while stack:
        for child in children.get(stack.pop(), []):
            if child not in seen:
                seen.add(child)
                stack.append(child)
    return seen


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--esco-dir", required=True, type=Path)
    esco = ap.parse_args().esco_dir

    skills = {r["conceptUri"]: r for r in read(esco / "skills_en.csv")}
    sources = [
        ("esco-ict", [skills[u] for u in sorted(ict_uris(esco)) if u in skills]),
        ("esco-transversal", read(esco / "transversalSkillsCollection_en.csv")),
        ("esco-research", read(esco / "researchSkillsCollection_en.csv")),
    ]
    tags = [{"tag": t, "description": d, "category": "core"} for t, d in CORE.items()]
    taken = set(CORE)
    for category, rows in sources:
        for row in sorted(rows, key=lambda r: r["preferredLabel"].lower()):
            tag = short_tag(row["preferredLabel"])
            # A bare verb ("plan") names no subject, so it is too vague to tag with.
            if not tag or tag in taken or (category != "esco-ict" and "-" not in tag):
                continue
            taken.add(tag)
            label = " ".join(row["preferredLabel"].split())
            description = first_sentence(row.get("description", ""))
            tags.append(
                {
                    "tag": tag,
                    "description": f"{label}: {description}" if description else label,
                    "category": category,
                    "uri": row["conceptUri"],
                }
            )

    out = {
        "version": 1,
        "attribution": (
            "Contains ESCO classification data (v1.1.0), © European Union, "
            "https://esco.ec.europa.eu. Reuse is authorised under Commission Decision "
            "2011/833/EU; ESCO labels are shortened to tags here."
        ),
        "tags": tags,
    }
    OUT.write_text(json.dumps(out, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    counts = defaultdict(int)
    for t in tags:
        counts[t["category"]] += 1
    sys.stdout.write(f"{len(tags)} tags -> {OUT}: {dict(counts)}\n")


if __name__ == "__main__":
    main()
