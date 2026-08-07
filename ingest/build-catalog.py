"""
Build the expanded Columbia catalog from the committed bulletin pages.

The prerequisite line is printed in a regular grammar: course codes, the words
"and" and "or", and parentheses, followed by any free text the department felt
like adding. That is a parser's job, not a model's. A model asked to do this
will occasionally invent a course code, and a course code that does not exist is
a prerequisite the solver can never satisfy, which turns into an infeasible plan
with no explanation.

Anything the parser cannot turn into a course id becomes an UNVERIFIABLE node
carrying the original words, which the UI surfaces as "ask your advisor". Not
knowing is a legitimate answer here. Guessing is not.
"""
import re, json, sys

CODE = re.compile(r"\b([A-Z]{4})\s+([A-Z]{1,2}\d{4})\b")

def cid(code):
    return "COLUMBIA:" + re.sub(r"\s+", "", code)

def tokenize(text):
    toks, i = [], 0
    while i < len(text):
        ch = text[i]
        if ch in "()":
            toks.append(ch); i += 1; continue
        if ch.isspace():
            i += 1; continue
        m = CODE.match(text, i)
        if m:
            toks.append(("COURSE", f"{m.group(1)} {m.group(2)}")); i = m.end(); continue
        w = re.match(r"[A-Za-z']+", text[i:])
        if w:
            word = w.group(0).lower()
            if word in ("and", "or"): toks.append(word)
            else: toks.append(("WORD", w.group(0)))
            i += len(w.group(0)); continue
        i += 1
    return toks

def parse(toks):
    """Grammar: expr := term (('or') term)* ; term := factor (('and') factor)* ."""
    pos = 0
    def peek(): return toks[pos] if pos < len(toks) else None
    def factor():
        nonlocal pos
        t = peek()
        if t == "(":
            pos += 1
            node = expr()
            if peek() == ")": pos += 1
            return node
        if isinstance(t, tuple) and t[0] == "COURSE":
            pos += 1
            return {"op": "COURSE", "courseId": cid(t[1])}
        pos += 1
        return None
    def term():
        nonlocal pos
        kids = [k for k in [factor()] if k]
        while peek() == "and":
            pos += 1
            k = factor()
            if k: kids.append(k)
        if not kids: return None
        return kids[0] if len(kids) == 1 else {"op": "AND", "children": kids}
    def expr():
        nonlocal pos
        kids = [k for k in [term()] if k]
        while peek() == "or":
            pos += 1
            k = term()
            if k: kids.append(k)
        if not kids: return None
        return kids[0] if len(kids) == 1 else {"op": "OR", "children": kids}
    node = expr()
    return node

def logic_open_brackets(s):
    """How many brackets the logic half has opened and not yet closed."""
    return s.count("(") - s.count(")")


NOTE_LEAD = re.compile(r"^[\s.;,)\]]+")
NOTE_TAIL = re.compile(r"[\s.;,(\[]+$")


def clean_note(s):
    """
    Tidy a fragment of catalog prose so it reads as a sentence a student wrote.

    These strings are shown to a student inside quotation marks, as the
    catalog's own words, so a stray bracket or a dangling half sentence is not a
    cosmetic problem: it makes the page look like it is quoting nonsense.
    Only punctuation and whitespace are touched. No word is ever changed, or the
    quotation would stop being one.
    """
    if not s:
        return ""
    s = NOTE_LEAD.sub("", s)
    s = NOTE_TAIL.sub("", s)
    # A course code that lost its space when the code was squeezed into an id,
    # "MATHUN1202" reading as one word in the middle of an English sentence.
    s = re.sub(r"\b([A-Z]{4})((?:UN|GU|GR|BC|E|W|V|C)?\d{4})\b", r"\1 \2", s)
    # Columbia also prints codes the other way round, "COMS4711W" for COMS W4711.
    s = re.sub(r"\b([A-Z]{4})(\d{4})([A-Z])\b", r"\1 \3\2", s)
    # A fragment ending in a conjunction is a sentence the bulletin cut off.
    # Quoting it back at a student with the "and" still hanging reads as a bug,
    # which is what it is, but it is the bulletin's.
    s = re.sub(r"[\s,;]+(and|or)\s*$", "", s, flags=re.I)
    # The bulletin sometimes runs the course description straight on from the
    # prerequisite line. Anything after the first full stop is that, not a
    # condition on taking the course.
    s = re.split(r"(?<=[a-z])\.\s+(?=[A-Z])", s)[0]
    s = re.sub(r"\s+", " ", s).strip()
    # A fragment the bulletin wrapped entirely in brackets, which reads as an
    # unclosed thought once it is quoted on its own. Done last, because the
    # closing bracket is only at the end once any trailing conjunction has gone.
    if s.startswith("(") and s.endswith(")") and s.count("(") == 1:
        s = s[1:-1].strip()
    return s


BARE_CODE = re.compile(r"^([A-Z]{4})\s+((?:UN|GU|GR|BC|E|W|V|C)?\d{4}[A-Z]?)$")


def say_missing(note):
    """
    A note that is nothing but a course code is a prerequisite the parser could
    not place, usually because the bulletin line was cut off mid sentence. It is
    still a real requirement, so it is worded like the other unresolvable ones
    rather than left as a bare code with no sentence around it.
    """
    return f"{note} is not in this catalog" if BARE_CODE.match(note) else note


def prereq_tree(text):
    if not text: return None, []
    body = re.sub(r"^Prerequisite[s]?:\s*", "", text).strip()
    # Split off trailing prose: everything after the last course code that is
    # not joined by and/or is a human instruction, not a course requirement.
    codes = list(CODE.finditer(body))
    if not codes:
        # No course code anywhere, so the whole line is a condition a person has
        # to check. It becomes a node rather than loose prose, so there is one
        # place the wording lives.
        note = say_missing(clean_note(body))
        if len(note) <= 3:
            return None, []
        return {"op": "UNVERIFIABLE", "text": note}, [note]
    # Columbia closes its bracket AFTER the last course code, so cutting at the
    # end of that code leaves the ")" at the head of the prose and an unbalanced
    # "(" in the logic. The student then read ") Or instructor's permission" as
    # if the catalog had written it. Carry the cut past any closing brackets the
    # logic still owes.
    cut = codes[-1].end()
    owed = logic_open_brackets(body[:cut])
    while owed > 0 and cut < len(body):
        if body[cut] == ")":
            owed -= 1
            cut += 1
        elif body[cut].isspace():
            cut += 1
        else:
            break
    logic, prose = body[:cut], body[cut:]
    node = parse(tokenize(logic))
    notes = []
    prose = clean_note(prose)
    if prose and len(prose) > 3:
        notes.append(prose)
    # Sentences like "General mathematical maturity" sit between codes too.
    for w in re.findall(r"(?<=[.;])\s*([A-Z][^.;]{8,120})", logic):
        if not CODE.search(w):
            w = clean_note(w)
            if len(w) > 3: notes.append(w)
    notes = [say_missing(n) for n in notes]
    if notes:
        kids = ([node] if node else []) + [{"op": "UNVERIFIABLE", "text": n} for n in notes]
        node = kids[0] if len(kids) == 1 else {"op": "AND", "children": kids}
    return node, notes

SMALL = {"a", "an", "and", "as", "at", "by", "for", "from", "in", "of", "on",
         "or", "the", "to", "with", "via", "into"}
ROMAN = {"i", "ii", "iii", "iv", "v", "vi", "vii", "viii", "ix", "x"}
ACRONYM = {"ai", "ui", "ux", "os", "db", "hci", "gpu", "cpu", "nlp", "3d", "2d",
           "ml", "iot", "api", "sql", "vlsi", "cad", "usa", "ii", "iii"}


def nice_title(t: str) -> str:
    """
    The bulletin prints titles in capitals, and Python's title() turns
    "CALCULUS II" into "Calculus Ii" and "SECURITY II" into "Security Ii".
    Roman numerals, acronyms and the small words that should stay lowercase all
    have to be handled, because a student reads these and a course called
    "Security Ii" looks like the whole catalog was scraped carelessly.
    """
    if not t.isupper():
        return t
    words = t.lower().split()
    out = []
    for i, w in enumerate(words):
        core = w.strip("().,:;")
        pad_l = w[: len(w) - len(w.lstrip("("))]
        pad_r = w[len(core) + len(pad_l):]
        if core in ROMAN or core in ACRONYM:
            fixed = core.upper()
        elif core in SMALL and i not in (0, len(words) - 1):
            fixed = core
        else:
            fixed = core[:1].upper() + core[1:]
        out.append(pad_l + fixed + pad_r)
    return " ".join(out)


raw = json.load(open("ingest/columbia-parsed.json"))
out, skipped = [], 0
for c in raw:
    if len(c["description"]) < 100:
        skipped += 1
        continue
    node, notes = prereq_tree(c["prereqText"])
    num = int(re.search(r"(\d{4})", c["code"].split()[1]).group(1))
    code = re.sub(r"\s+", " ", c["code"]).strip()
    out.append({
        "id": cid(code),
        "code": code,
        "title": nice_title(c["title"]),
        "credits": int(round(c["credits"])) or 3,
        "description": c["description"],
        "prereq": node,
        "coreq": [],
        "termsOffered": c["termsOffered"],
        "level": "GR" if num >= 4000 else "UG",
        # Empty on purpose. These strings are already in the prereq tree as
        # UNVERIFIABLE nodes, and buildPlan concatenates the two lists, so
        # writing them here printed 24 of the 74 notes twice in the advisor box.
        # A course with no parseable prerequisite still gets its wording,
        # because prereq_tree now returns an UNVERIFIABLE node for that case
        # rather than prose with nowhere to live.
        "restrictions": [],
        "overlapsWith": [cid(o) for o in c.get("overlapsWith", [])],
        "verified": False,
        "sourceUrl": c["sourceUrl"],
        "skills": [],
    })

ids = {c["id"] for c in out}

# A prerequisite pointing at a course this catalog does not hold is not a
# prerequisite the solver can reason about. Left as a COURSE node it is simply
# unsatisfiable, and every course behind it quietly disappears from every plan
def pretty_code(course_id):
    """COLUMBIA:MATHUN1202 back into "MATH UN1202", the way the bulletin writes it."""
    raw = course_id.split(":")[-1]
    m = re.match(r"^([A-Z]{4})((?:UN|GU|GR|BC|E|W|V|C)?\d{4}[A-Z]?)$", raw)
    return f"{m.group(1)} {m.group(2)}" if m else raw


# with no explanation. Demoted to UNVERIFIABLE it becomes a visible "ask your
# advisor", which is what it actually is.
def demote(n):
    if not n: return None
    if n.get("op") == "COURSE" and n["courseId"] not in ids:
        # Print it the way the bulletin prints it. The id has the space
        # squeezed out, so the raw form read as "MATHUN1202" in the middle of an
        # English sentence shown to a student in quotation marks.
        return {"op": "UNVERIFIABLE", "text": f"{pretty_code(n['courseId'])} is not in this catalog"}
    if n.get("op") in ("AND", "OR"):
        return {"op": n["op"], "children": [demote(k) for k in n["children"]]}
    return n

demoted = 0
for c in out:
    before = json.dumps(c["prereq"])
    c["prereq"] = demote(c["prereq"])
    if json.dumps(c["prereq"]) != before: demoted += 1
print(f"courses whose prereqs mention a course outside this catalog: {demoted}")

json.dump(out, open("ingest/columbia-expanded.json", "w"), indent=1)
dangling = set()
def walk(n):
    if not n: return
    if n.get("op") == "COURSE": dangling.add(n["courseId"])
    for k in n.get("children", []): walk(k)
for c in out: walk(c["prereq"])
missing = dangling - ids

print(f"courses built      : {len(out)}  (skipped {skipped} with no description)")
print(f"with a prereq tree : {sum(1 for c in out if c['prereq'])}")
print(f"with advisor notes : {sum(1 for c in out if c['restrictions'])}")
print(f"prereq ids referenced: {len(dangling)}, of which {len(missing)} are not in this set")
if missing: print("  e.g.", ", ".join(sorted(missing)[:8]))
