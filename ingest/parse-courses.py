"""
Turn the committed bulletin pages into structured course records.

Everything here is lifted from the page as printed. Nothing is inferred and
nothing is written by a model: the description is the bulletin's own paragraph,
the credits are its own number, the prerequisite text is its own sentence. The
only later step that involves a model is deciding which job skills a
description proves, and that step must quote this text back verbatim.
"""
import re, html, json, glob, os

TERM = {"Fall": "FA", "Spring": "SP", "Summer": "SU"}

def text_of(path):
    h = open(path, encoding="utf-8", errors="ignore").read()
    t = re.sub(r"<script.*?</script>|<style.*?</style>", "", h, flags=re.S | re.I)
    t = re.sub(r"<[^>]+>", "\n", t)
    t = html.unescape(t)
    # The bulletin separates "COMS" from "W1004" with a non-breaking space, so
    # every course id built from it silently differed from every course id built
    # from the degree requirements, and no prerequisite ever resolved.
    t = t.replace("\u00a0", " ").replace("\u2009", " ").replace("\u202f", " ")
    t = re.sub(r"[ \t]+", " ", t)
    return [l.strip() for l in t.split("\n") if l.strip()]

# Variable credit courses print "1.00-2.00 points". The non greedy title stopped
# at the first full stop it could, which swallowed the low end of the range into
# the title and left the credits as "00". Match the range explicitly.
HEADER = re.compile(
    r"^([A-Z]{4}\s+[A-Z]{1,2}\d{4})\s+(.+?)\.\s*([\d.]+)(?:\s*-\s*([\d.]+))?\s*point", re.I)
TERMLINE = re.compile(r"^(Fall|Spring|Summer)\s+(\d{4}):\s")

def parse(path):
    lines = text_of(path)
    try:
        start = next(i for i, l in enumerate(lines) if l.startswith("Search Results for"))
    except StopIteration:
        return None
    lines = lines[start + 1:]

    hi = next((i for i, l in enumerate(lines) if HEADER.match(l)), None)
    if hi is None:
        return None
    m = HEADER.match(lines[hi])
    code, title = m.group(1), m.group(2).strip()
    # For a range, take the top of it: a student picking a variable credit course
    # to fill a slot is choosing how much of it to take, and the planner should
    # not quietly assume the smallest.
    credits = float(m.group(4) or m.group(3))

    # Terms the registrar actually lists a section for.
    terms, seen = [], set()
    for l in lines:
        tm = TERMLINE.match(l)
        if tm and TERM[tm.group(1)] not in seen:
            seen.add(TERM[tm.group(1)]); terms.append(TERM[tm.group(1)])

    end = next((i for i, l in enumerate(lines) if TERMLINE.match(l)), len(lines))
    body = lines[hi + 1:end]

    prereq_text = ""
    for i, l in enumerate(body):
        if l.startswith("Prerequisites:") or l.startswith("Prerequisite:"):
            # The parenthesised course list is broken across lines by the markup.
            chunk = []
            for x in body[i:]:
                if len(x) > 120: break
                chunk.append(x)
            prereq_text = " ".join(chunk)
            prereq_text = re.sub(r"\s+", " ", prereq_text).strip()
            break

    # The bulletin's own description is the substantial prose paragraph.
    cands = [l for l in body if len(l) > 100 and not l.startswith("Prerequisite")]
    description = max(cands, key=len) if cands else ""

    # Courses that cannot both count toward the degree.
    #
    # The bulletin states this in prose, and the codes sit just outside the
    # paragraph the description is taken from, so they were being lost: the
    # planner read "students may only receive credit for either" and had no idea
    # which courses that meant. A plan then scheduled COMS W3134 in the first
    # semester and COMS W3136 in the last, four credits that will never count.
    flat = " ".join(lines)
    overlaps = []
    om = re.search(
        r"(?:may (?:only |not )?(?:receive|be given) credit for(?: only)?(?: one of| either| both)?"
        r"|credit for only one|not to be taken in addition to)([^.]{0,180})", flat, re.I)
    if om:
        tail = om.group(1)
        dept = code.split()[0]
        # Cut the sentence at the term listing, so "Spring 2026" is not read as
        # a course number, and require the bare form to carry a letter prefix
        # the way Columbia numbers do.
        tail = re.split(r"\b(?:Fall|Spring|Summer)\s+\d{4}", tail)[0]
        # Columbia renumbered: the old codes carry one letter (MATH V2010) and
        # the current ones carry two (MATH UN2010, COMS GU4771). Matching only
        # the single letter form meant the rule stated on every modern page was
        # read off the old pages and nowhere else, so a plan could hold both
        # Linear Algebra and Honors Linear Algebra, which the bulletin forbids
        # in the very sentence the parser was looking at.
        for hit in re.findall(r"\b([A-Z]{4}\s+[A-Z]{1,2}\d{4}|[A-Z]{1,2}\d{4})\b", tail):
            h = hit.strip()
            full = h if " " in h else f"{dept} {h}"
            full = re.sub(r"\s+", " ", full)
            if full != code and full not in overlaps:
                overlaps.append(full)

    return {
        "code": code, "title": title, "credits": credits,
        "overlapsWith": overlaps,
        "termsOffered": terms or ["FA", "SP"],
        "prereqText": prereq_text, "description": description,
        "snapshot": os.path.basename(path),
        "sourceUrl": f"https://bulletin.columbia.edu/search/?P={code.replace(' ', '%20')}",
    }

out = []
for p in sorted(glob.glob("data/snapshots/courses/*.html")):
    r = parse(p)
    if r: out.append(r)

json.dump(out, open("ingest/columbia-parsed.json", "w"), indent=1)
withdesc = [c for c in out if len(c["description"]) > 100]
print(f"parsed            : {len(out)}/193")
print(f"with a description: {len(withdesc)}")
print(f"with prerequisites: {sum(1 for c in out if c['prereqText'])}")
print(f"title-case titles : {sum(1 for c in out if not c['title'].isupper())}")
