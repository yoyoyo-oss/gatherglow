"""GatherGlow API (one Vercel Python function; also served locally by dev_server.py).

Routes (all JSON):
  GET  /api/health                         which services are configured
  GET  /api/me?token=                      Plus status, this browser's plans, stats and saved planet
  POST /api/plans                          create a plan            {token, name, date, sample?}
  GET  /api/plans/<id>?token=              read a plan (other people's budgets are never returned)
  PUT  /api/plans/<id>/me                  join or update yourself  {token, member}
  POST /api/plans/<id>/remove              organizer removes someone {token, memberId}
  POST /api/plans/<id>/vote                {token, key, value: 1|-1|0}
  POST /api/plans/<id>/comment             {token, key, text}
  POST /api/plans/<id>/suggest             share a swapped plan     {token, option}
  POST /api/plans/<id>/lock                organizer locks a plan   {token, option}
  POST /api/plans/<id>/book                organizer books (simulated codes) {token}
  POST /api/plans/<id>/ai                  Plus: Claude organizes   {token, context}
  POST /api/checkout                       Stripe Checkout (test mode) {token, plan, planId}
  GET  /api/checkout/verify?session_id=&token=  confirm payment and unlock Plus

Identity: no sign-up. Each browser keeps a random token; a plan stores which member
belongs to which token. The organizer is whoever created the plan.
"""
import json
import os
import re
import secrets
import time
import urllib.parse
import urllib.request
import urllib.error
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler

# Consumer plans. Everyone pays as a person or household; nothing is sold to businesses.
PLANS = {
    "pass":     {"name": "GatherGlow Event Pass", "cents": 799,   "interval": None,    "tier": "pass",   "seats": 0,
                 "desc": "One plan: AI organizer and up to 12 people, one-time"},
    "plus_m":   {"name": "GatherGlow Plus",       "cents": 999,   "interval": "month", "tier": "plus",   "seats": 1,
                 "desc": "Unlimited group plans and the AI organizer for one organizer"},
    "plus_y":   {"name": "GatherGlow Plus (yearly)", "cents": 7900, "interval": "year", "tier": "plus",  "seats": 1,
                 "desc": "Unlimited group plans and the AI organizer for one organizer"},
    "family_m": {"name": "GatherGlow Family",     "cents": 1999,  "interval": "month", "tier": "family", "seats": 6,
                 "desc": "Plus for up to 6 people in one household"},
    "family_y": {"name": "GatherGlow Family (yearly)", "cents": 15900, "interval": "year", "tier": "family", "seats": 6,
                 "desc": "Plus for up to 6 people in one household"},
    "crew_m":   {"name": "GatherGlow Crew",       "cents": 2499,  "interval": "month", "tier": "crew",   "seats": 8,
                 "desc": "Plus for a friend group of up to 8: anyone can start plans and use AI"},
    "crew_y":   {"name": "GatherGlow Crew (yearly)", "cents": 19900, "interval": "year", "tier": "crew",  "seats": 8,
                 "desc": "Plus for a friend group of up to 8: anyone can start plans and use AI"},
}
PRICE_LABEL = "from $9.99/month"
FREE_PLANS_PER_MONTH = 1
FREE_MAX_MEMBERS = 6
MAX_MEMBERS = 12
MAX_BODY = 200_000
MODEL = "claude-opus-5-5"
TOKEN_RE = re.compile(r"^[A-Za-z0-9_-]{16,64}$")
ID_RE = re.compile(r"^[a-z0-9]{6,16}$")


# ------------------------------------------------------------------ storage
class Store:
    """Key/value JSON store: Supabase table `kv` in production, a local file in development."""

    def __init__(self):
        self.url = os.environ.get("SUPABASE_URL", "").rstrip("/")
        self.key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
        self.file = os.environ.get("LOCAL_STORE_FILE", "")
        self.kind = "supabase" if (self.url and self.key) else ("file" if self.file else "none")

    def _sb(self, method, path, body=None, headers=None):
        h = {"apikey": self.key, "Authorization": "Bearer " + self.key, "Content-Type": "application/json"}
        h.update(headers or {})
        data = json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request(self.url + "/rest/v1/" + path, data=data, method=method, headers=h)
        with urllib.request.urlopen(req, timeout=15) as r:
            raw = r.read()
            return json.loads(raw) if raw else None

    def _load_file(self):
        try:
            with open(self.file, encoding="utf-8") as f:
                return json.load(f)
        except (FileNotFoundError, json.JSONDecodeError):
            return {}

    def get(self, key):
        if self.kind == "supabase":
            rows = self._sb("GET", "kv?select=value&key=eq." + urllib.parse.quote(key, safe=""))
            return rows[0]["value"] if rows else None
        if self.kind == "file":
            return self._load_file().get(key)
        raise RuntimeError("storage_not_configured")

    def get_many(self, keys):
        keys = list(keys)
        if not keys:
            return {}
        if self.kind == "supabase":
            inner = ",".join('"' + k.replace('"', '') + '"' for k in keys)
            rows = self._sb("GET", "kv?select=key,value&key=in." + urllib.parse.quote("(" + inner + ")", safe=""))
            return {r["key"]: r["value"] for r in rows or []}
        if self.kind == "file":
            data = self._load_file()
            return {k: data[k] for k in keys if k in data}
        raise RuntimeError("storage_not_configured")

    def put(self, key, value):
        if self.kind == "supabase":
            self._sb("POST", "kv", [{"key": key, "value": value, "updated_at": datetime.now(timezone.utc).isoformat()}],
                     {"Prefer": "resolution=merge-duplicates"})
            return
        if self.kind == "file":
            data = self._load_file()
            data[key] = value
            os.makedirs(os.path.dirname(self.file) or ".", exist_ok=True)
            tmp = self.file + ".tmp"
            with open(tmp, "w", encoding="utf-8") as f:
                json.dump(data, f)
            os.replace(tmp, self.file)
            return
        raise RuntimeError("storage_not_configured")


store = Store()


class ApiError(Exception):
    def __init__(self, status, code, message):
        super().__init__(message)
        self.status, self.code, self.message = status, code, message


def month_key():
    return datetime.now(timezone.utc).strftime("%Y-%m")


def check_token(t):
    if not isinstance(t, str) or not TOKEN_RE.match(t):
        raise ApiError(400, "bad_token", "Missing or invalid browser token.")
    return t


def ent(token):
    return store.get("ent:" + token) or {}


def own_tier(token):
    """The tier this browser paid for itself (plus, family or crew), or None."""
    e = ent(token)
    if e.get("plus") and e.get("until", 0) > time.time():
        return e.get("tier", "plus")
    return None


def is_plus(token):
    return own_tier(token) is not None


def coverage(token):
    """Plus through someone else's Family or Crew plan: you are among the first N people
    in a plan created by that subscriber. Returns (tier, organizer name) or (None, None)."""
    ids = (store.get("idx:" + token) or {}).get("ids", [])[:12]
    found = store.get_many("plan:" + i for i in ids)
    for pid in ids:
        p = found.get("plan:" + pid)
        if not p or p["organizerToken"] == token:
            continue
        e = ent(p["organizerToken"])
        tier = own_tier(p["organizerToken"])
        if tier in ("family", "crew"):
            seats = int(e.get("seats", 0))
            others = [m for m in p["members"] if m.get("token") != p["organizerToken"]]
            if any(m.get("token") == token for m in others[:max(0, seats - 1)]):
                org = member_for(p, p["organizerToken"])
                return tier, (org or {}).get("name", "your organizer")
    return None, None


def has_plus(token):
    return is_plus(token) or coverage(token)[0] is not None


def plan_unlocked(p):
    """A plan gets the paid features if it has an Event Pass or its organizer pays."""
    return bool(p.get("pass")) or is_plus(p["organizerToken"])


def load_plan(pid):
    if not isinstance(pid, str) or not ID_RE.match(pid):
        raise ApiError(404, "not_found", "Plan not found.")
    p = store.get("plan:" + pid)
    if not p:
        raise ApiError(404, "not_found", "Plan not found. Links only work on the deployment that created them.")
    return p


def save_plan(p):
    p["version"] = p.get("version", 0) + 1
    p["updatedAt"] = int(time.time() * 1000)
    store.put("plan:" + p["id"], p)


def member_for(p, token):
    return next((m for m in p["members"] if m.get("token") == token), None)


def require_org(p, token):
    if p["organizerToken"] != token:
        raise ApiError(403, "organizer_only", "Only the person who created the plan can do this.")


def index_add(token, pid):
    """Remember which plans this browser created or joined (newest first)."""
    k = "idx:" + token
    ids = [x for x in (store.get(k) or {}).get("ids", []) if x != pid]
    store.put(k, {"ids": ([pid] + ids)[:30]})


PROFILE_KEYS = ("name", "color", "foods", "vibes", "veg", "u21", "budget", "schedule")


def public_plan(p, token):
    """What one person may see: everything except other people's budgets and tokens."""
    mine = member_for(p, token)
    budgets = [float(m["budget"]) for m in p["members"] if isinstance(m.get("budget"), (int, float)) and m["budget"] > 0]
    members = []
    for m in p["members"]:
        pm = {k: v for k, v in m.items() if k not in ("token", "budget")}
        if m is mine:
            pm["budget"] = m.get("budget")
            pm["mine"] = True
        members.append(pm)
    return {
        "id": p["id"], "name": p["name"], "date": p["date"], "createdAt": p["createdAt"],
        "version": p.get("version", 0), "updatedAt": p.get("updatedAt"), "sample": p.get("sample", False),
        "isOrganizer": p["organizerToken"] == token, "meId": mine["id"] if mine else None,
        "members": members, "groupCap": min(budgets) if budgets else None,
        "votes": p.get("votes", {}), "comments": p.get("comments", {}), "suggested": p.get("suggested", []),
        "ai": p.get("ai"), "locked": p.get("locked"), "booked": p.get("booked"),
        "organizerPlus": plan_unlocked(p), "pass": bool(p.get("pass")),
        "organizerTier": own_tier(p["organizerToken"]),
        "maxMembers": MAX_MEMBERS if plan_unlocked(p) else FREE_MAX_MEMBERS,
    }


# ------------------------------------------------------------------ validation helpers
FOODS = {"pizza", "tacos", "noodles", "dumplings", "deli", "burgers", "bagels", "italian", "anything"}
VIBES = {"music", "shows", "holiday", "views", "art", "games", "comedy", "outdoors", "free", "nightlife", "anything"}
BLOCKS = {"", "work", "study", "busy", "relax", "sleep"}
COLOR_RE = re.compile(r"^#[0-9a-fA-F]{6}$")
VENUE_ID_RE = re.compile(r"^[a-z0-9-]{2,40}$")
TAG_RE = re.compile(r"^[^\W_][\w &'-]{1,19}$", re.UNICODE)


def clean_tags(raw, known, limit=14):
    out = []
    for t in raw if isinstance(raw, list) else []:
        t = str(t).strip().lower()[:20]
        if (t in known or TAG_RE.match(t)) and t not in out:
            out.append(t)
    return out[:limit]


def clean_member(raw, existing_id=None, sample=False):
    if not isinstance(raw, dict):
        raise ApiError(400, "bad_member", "Member data is missing.")
    name = str(raw.get("name", "")).strip()[:14]
    if not name:
        raise ApiError(400, "bad_member", "Add a name first.")
    sched = raw.get("schedule") or []
    if not (isinstance(sched, list) and len(sched) == 48 and all(s in BLOCKS for s in sched)):
        raise ApiError(400, "bad_member", "Timetable must have 48 half-hour slots.")
    try:
        budget = float(raw.get("budget", 0))
    except (TypeError, ValueError):
        budget = 0
    return {
        "id": existing_id or ("m" + secrets.token_hex(4)),
        "name": name,
        "color": raw.get("color") if COLOR_RE.match(str(raw.get("color", ""))) else "#3f5873",
        "foods": clean_tags(raw.get("foods"), FOODS),
        "vibes": clean_tags(raw.get("vibes"), VIBES),
        "veg": bool(raw.get("veg")), "u21": bool(raw.get("u21")),
        "schedule": sched,
        "wishes": [w for w in raw.get("wishes", []) if isinstance(w, str) and VENUE_ID_RE.match(w)][:40],
        "budget": max(0.0, min(budget, 5000.0)),
        "sample": sample,
    }


def clean_option(raw):
    if not isinstance(raw, dict):
        raise ApiError(400, "bad_option", "Plan option is missing.")
    stops = raw.get("stops")
    if not (isinstance(stops, list) and 1 <= len(stops) <= 5):
        raise ApiError(400, "bad_option", "A plan needs 1 to 5 stops.")
    out = []
    for s in stops:
        if not (isinstance(s, dict) and VENUE_ID_RE.match(str(s.get("id", ""))) and isinstance(s.get("start"), int) and 0 <= s["start"] <= 1440):
            raise ApiError(400, "bad_option", "Invalid stop.")
        out.append({"id": s["id"], "start": s["start"]})
    return {"key": "|".join(s["id"] for s in out), "stops": out, "label": str(raw.get("label", "Plan"))[:40],
            "perPerson": float(raw.get("perPerson") or 0)}


SAMPLE_MEMBERS = [
    {"name": "Aru", "color": "#3f5873", "foods": ["noodles", "dumplings"], "vibes": ["art", "views"], "budget": 150,
     "blocks": [["sleep", 0, 8], ["work", 9, 13], ["relax", 13, 14]], "wishes": ["top-of-the-rock", "met", "joes-shanghai"]},
    {"name": "Mira", "color": "#c2a46e", "foods": ["tacos", "pizza"], "vibes": ["music", "comedy"], "budget": 110,
     "blocks": [["sleep", 0, 9], ["study", 10, 14], ["busy", 15, 16]], "wishes": ["neighbourhood-21", "los-tacos", "comedy-cellar"]},
    {"name": "Jun", "color": "#8aa596", "foods": ["bagels", "italian"], "vibes": ["holiday", "outdoors", "free"], "budget": 180, "veg": True,
     "blocks": [["sleep", 0, 7.5], ["work", 8, 12], ["relax", 12, 13]], "wishes": ["bryant-park", "high-line", "rockettes"]},
]


def sample_member(s):
    sched = [""] * 48
    for t, a, b in s["blocks"]:
        for i in range(int(a * 2), int(b * 2)):
            sched[i] = t
    raw = dict(s, schedule=sched)
    m = clean_member(raw, sample=True)
    m["token"] = "sample-" + secrets.token_hex(8)
    return m


# ------------------------------------------------------------------ handlers
def h_health(q, b):
    return {"store": store.kind, "stripe": bool(os.environ.get("STRIPE_SECRET_KEY")),
            "stripeMode": "test" if os.environ.get("STRIPE_SECRET_KEY", "").startswith("sk_test_") else ("live" if os.environ.get("STRIPE_SECRET_KEY") else None),
            "ai": bool(os.environ.get("ANTHROPIC_API_KEY")), "price": PRICE_LABEL, "freePlansPerMonth": FREE_PLANS_PER_MONTH,
            "plans": {k: {"cents": v["cents"], "interval": v["interval"], "tier": v["tier"], "seats": v["seats"]} for k, v in PLANS.items()}}


def h_me(q, b):
    t = check_token(q.get("token"))
    used = (store.get("usage:" + t + ":" + month_key()) or {}).get("plans", 0)
    ids = (store.get("idx:" + t) or {}).get("ids", [])[:12]
    found = store.get_many("plan:" + i for i in ids)
    plans, friends, booked, saved = [], [], 0, 0.0
    for pid in ids:
        p = found.get("plan:" + pid)
        if not p:
            continue
        status = "booked" if p.get("booked") else ("locked" if p.get("locked") else "planning")
        mine = member_for(p, t)
        if status == "booked" and not p.get("sample"):
            booked += 1
            if mine and p.get("locked") and isinstance(mine.get("budget"), (int, float)):
                saved += max(0.0, float(mine["budget"]) - float(p["locked"].get("perPerson") or 0))
        if not p.get("sample"):
            for m in p["members"]:
                if m.get("token") != t and m["name"] not in friends:
                    friends.append(m["name"])
        plans.append({"id": pid, "name": p["name"], "date": p["date"], "status": status, "sample": p.get("sample", False),
                      "isOrganizer": p["organizerToken"] == t, "people": [m["name"] for m in p["members"]]})
    tier = own_tier(t)
    ctier, cby = (None, None) if tier else coverage(t)
    return {"plus": bool(tier or ctier), "tier": tier or ctier, "coveredBy": cby, "seats": ent(t).get("seats") if tier else None,
            "plusUntil": ent(t).get("until"), "cycle": ent(t).get("cycle"), "plansThisMonth": used,
            "freePlansPerMonth": FREE_PLANS_PER_MONTH, "price": PRICE_LABEL,
            "plans": plans, "stats": {"booked": booked, "friends": friends, "underBudget": round(saved, 2)},
            "profile": store.get("prof:" + t)}


def h_create(q, b):
    t = check_token(b.get("token"))
    sample = bool(b.get("sample"))
    ukey = "usage:" + t + ":" + month_key()
    usage = store.get(ukey) or {"plans": 0}
    if not sample and usage["plans"] >= FREE_PLANS_PER_MONTH and not has_plus(t):
        raise ApiError(402, "upgrade_required", "The free plan includes %d group plan a month. Plus, Family and Crew include unlimited plans." % FREE_PLANS_PER_MONTH)
    name = str(b.get("name", "")).strip()[:40] or "Our day out"
    date = str(b.get("date", ""))
    if not re.match(r"^\d{4}-\d{2}-\d{2}$", date):
        raise ApiError(400, "bad_date", "Pick a date.")
    pid = secrets.token_hex(5)
    p = {"id": pid, "name": name, "date": date, "createdAt": int(time.time() * 1000), "organizerToken": t,
         "members": [sample_member(s) for s in SAMPLE_MEMBERS] if sample else [],
         "votes": {}, "comments": {}, "suggested": [], "sample": sample}
    save_plan(p)
    index_add(t, pid)
    if not sample:
        usage["plans"] += 1
        store.put(ukey, usage)
    return {"plan": public_plan(p, t)}


def h_get(pid, q, b):
    t = check_token(q.get("token"))
    return {"plan": public_plan(load_plan(pid), t)}


def h_me_put(pid, q, b):
    t = check_token(b.get("token"))
    p = load_plan(pid)
    if p.get("booked"):
        raise ApiError(409, "booked", "This plan is already booked.")
    mine = member_for(p, t)
    if not mine and len(p["members"]) >= MAX_MEMBERS:
        raise ApiError(409, "full", "This plan is full.")
    if not mine and len(p["members"]) >= FREE_MAX_MEMBERS and not plan_unlocked(p):
        raise ApiError(402, "group_full_free", "Free plans fit up to %d people. The organizer can add an Event Pass or upgrade for up to %d." % (FREE_MAX_MEMBERS, MAX_MEMBERS))
    m = clean_member(b.get("member"), existing_id=mine["id"] if mine else None)
    m["token"] = t
    if mine:
        p["members"][p["members"].index(mine)] = m
    else:
        p["members"].append(m)
    save_plan(p)
    if not mine and p["organizerToken"] != t:
        index_add(t, pid)
    store.put("prof:" + t, {k: m[k] for k in PROFILE_KEYS})
    return {"plan": public_plan(p, t)}


def h_remove(pid, q, b):
    t = check_token(b.get("token"))
    p = load_plan(pid)
    require_org(p, t)
    mid = b.get("memberId")
    target = next((m for m in p["members"] if m["id"] == mid), None)
    if not target or target.get("token") == t:
        raise ApiError(400, "bad_member", "You can't remove yourself.")
    p["members"].remove(target)
    for v in p.get("votes", {}).values():
        v.pop(mid, None)
    save_plan(p)
    return {"plan": public_plan(p, t)}


def h_vote(pid, q, b):
    t = check_token(b.get("token"))
    p = load_plan(pid)
    me = member_for(p, t)
    if not me:
        raise ApiError(403, "join_first", "Join the plan first.")
    key = str(b.get("key", ""))[:200]
    val = b.get("value")
    if val not in (1, -1, 0):
        raise ApiError(400, "bad_vote", "Vote must be 1, -1 or 0.")
    p.setdefault("votes", {}).setdefault(key, {})[me["id"]] = val
    save_plan(p)
    return {"plan": public_plan(p, t)}


def h_comment(pid, q, b):
    t = check_token(b.get("token"))
    p = load_plan(pid)
    me = member_for(p, t)
    if not me:
        raise ApiError(403, "join_first", "Join the plan first.")
    text = str(b.get("text", "")).strip()[:200]
    if not text:
        raise ApiError(400, "empty", "Write a comment first.")
    key = str(b.get("key", ""))[:200]
    p.setdefault("comments", {}).setdefault(key, []).append({"by": me["id"], "text": text, "ts": int(time.time() * 1000)})
    save_plan(p)
    return {"plan": public_plan(p, t)}


def h_suggest(pid, q, b):
    t = check_token(b.get("token"))
    p = load_plan(pid)
    me = member_for(p, t)
    if not me:
        raise ApiError(403, "join_first", "Join the plan first.")
    o = clean_option(b.get("option"))
    o["by"] = me["id"]
    sug = [s for s in p.get("suggested", []) if s["key"] != o["key"]]
    sug.append(o)
    p["suggested"] = sug[-6:]
    save_plan(p)
    return {"plan": public_plan(p, t)}


def h_lock(pid, q, b):
    t = check_token(b.get("token"))
    p = load_plan(pid)
    require_org(p, t)
    if b.get("option") is None:
        p["locked"] = None
    else:
        p["locked"] = clean_option(b.get("option"))
    save_plan(p)
    return {"plan": public_plan(p, t)}


def h_book(pid, q, b):
    t = check_token(b.get("token"))
    p = load_plan(pid)
    require_org(p, t)
    if not p.get("locked"):
        raise ApiError(400, "not_locked", "Lock in a plan first.")
    free = set(b.get("freeIds") or [])
    p["booked"] = {"at": int(time.time() * 1000), "simulated": True,
                   "codes": [{"id": s["id"], "code": "No booking needed" if s["id"] in free else "PT-" + secrets.token_hex(3).upper()} for s in p["locked"]["stops"]]}
    save_plan(p)
    return {"plan": public_plan(p, t)}


# ------------------------------------------------------------------ AI organizer (Claude)
AI_INSTRUCTIONS = """You are the itinerary planner inside GatherGlow, a day planner for a group of working adults in New York City.
Plan ONE day for the group described below. Every stop must lie fully inside one of the free windows and inside its opening hours; fixed-start events must use exactly one listed start time; leave enough travel time between stops (walking about 12 minutes per km when under 1.3 km apart, otherwise subway about 12 minutes plus 3.2 minutes per km; Manhattan to Downtown Brooklyn is roughly 30 to 40 minutes). Use only the listed place ids, each at most once per plan. Keep the total per person at or under the hard budget.
Make 3 different plans of 2 to 4 stops, normally one food stop. Maximise how many people get something they wished for, then something they are into, while spending as little as possible. Plan 1: best for everyone. Plan 2: the cheapest good one. Plan 3: something different.
Reply with only JSON in exactly this shape and nothing else:
{"plans":[{"label":"short name, max 4 words","stops":[{"id":"place-id","start":"HH:MM"}],"why":"one sentence on who gets what and why it is good value"}],"tips":["up to 3 short tips for the group"]}"""


def build_ai_prompt(p, ctx):
    budgets = [float(m["budget"]) for m in p["members"] if m.get("budget")]
    cap = min(budgets) if budgets else 999
    people = []
    for m in p["members"]:
        people.append("- %s: food %s; into %s; wishes: %s" % (m["name"], "/".join(m["foods"]) or "-", "/".join(m["vibes"]) or "-", ", ".join(m["wishes"]) or "none"))
    windows = [str(w)[:13] for w in (ctx.get("windows") or [])][:12]
    venues = [str(v)[:400] for v in (ctx.get("venues") or [])][:80]
    return (AI_INSTRUCTIONS + "\n\nDate: %s. Group of %d.%s%s\nTimes the whole group is free: %s.\nHard budget: at most $%s per person (the group's lowest private budget; individual budgets stay hidden).\n\nPeople:\n%s\n\nPlaces available that day (id | name | type | category | price per person | duration | when | tags | area | lat,lng):\n%s"
            % (p["date"], len(p["members"]),
               " Someone is vegetarian (already filtered)." if any(m.get("veg") for m in p["members"]) else "",
               " Someone is under 21 (already filtered)." if any(m.get("u21") for m in p["members"]) else "",
               ", ".join(windows) or "none", round(cap, 2), "\n".join(people), "\n".join(venues)))


def h_ai(pid, q, b):
    t = check_token(b.get("token"))
    p = load_plan(pid)
    if not member_for(p, t) and p["organizerToken"] != t:
        raise ApiError(403, "join_first", "Join the plan first.")
    if not (plan_unlocked(p) or has_plus(t)):
        raise ApiError(402, "upgrade_required", "The AI organizer comes with an Event Pass, Plus, Family or Crew.")
    if not os.environ.get("ANTHROPIC_API_KEY"):
        raise ApiError(503, "ai_not_configured", "The AI organizer isn't configured on this deployment.")
    import anthropic  # imported lazily so the rest of the API works without it
    client = anthropic.Anthropic()
    prompt = build_ai_prompt(p, b.get("context") or {})
    try:
        resp = client.beta.messages.create(
            model=MODEL,
            max_tokens=16000,
            betas=["server-side-fallback-2026-07-01"],
            fallbacks="default",
            output_config={"effort": "medium"},
            messages=[{"role": "user", "content": prompt}],
        )
    except anthropic.RateLimitError:
        raise ApiError(429, "ai_busy", "The AI is busy right now. Try again in a minute.")
    except anthropic.APIStatusError as e:
        raise ApiError(502, "ai_error", "The AI request failed (%s)." % e.status_code)
    except anthropic.APIConnectionError:
        raise ApiError(502, "ai_error", "Couldn't reach the AI service.")
    if resp.stop_reason == "refusal":
        raise ApiError(422, "ai_refused", "The AI declined this request.")
    text = "".join(blk.text for blk in resp.content if getattr(blk, "type", "") == "text")
    a, z = text.find("{"), text.rfind("}")
    try:
        data = json.loads(text[a:z + 1])
    except (ValueError, json.JSONDecodeError):
        raise ApiError(502, "ai_bad_output", "The AI's answer couldn't be read. Try again.")
    result = {"plans": data.get("plans", [])[:3], "tips": [str(x)[:200] for x in data.get("tips", [])][:3],
              "at": int(time.time() * 1000), "model": resp.model}
    p["ai"] = result
    save_plan(p)
    return {"plan": public_plan(p, t)}


# ------------------------------------------------------------------ payments (Stripe Checkout, test mode)
def stripe(method, path, form=None):
    key = os.environ.get("STRIPE_SECRET_KEY")
    if not key:
        raise ApiError(503, "payments_not_configured", "Payments aren't configured on this deployment.")
    data = urllib.parse.urlencode(form).encode() if form else None
    req = urllib.request.Request("https://api.stripe.com/v1/" + path, data=data, method=method,
                                 headers={"Authorization": "Bearer " + key, "Content-Type": "application/x-www-form-urlencoded"})
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            return json.loads(r.read())
    except urllib.error.HTTPError as e:
        try:
            msg = json.loads(e.read()).get("error", {}).get("message", "")
        except Exception:
            msg = ""
        raise ApiError(502, "stripe_error", "Stripe error: " + (msg or str(e.code)))


def h_checkout(q, b, origin):
    t = check_token(b.get("token"))
    key = str(b.get("plan") or "plus_m")
    plan = PLANS.get(key)
    if not plan:
        raise ApiError(400, "bad_plan", "Unknown plan.")
    pid = b.get("planId") if ID_RE.match(str(b.get("planId", ""))) else ""
    if key == "pass":
        if not pid:
            raise ApiError(400, "pass_needs_plan", "An Event Pass belongs to one plan. Open the plan first.")
        p = load_plan(pid)
        if not member_for(p, t) and p["organizerToken"] != t:
            raise ApiError(403, "join_first", "Join the plan first.")
    back = origin + ("/p/" + pid if pid else "/")
    form = {
        "mode": "payment" if plan["interval"] is None else "subscription",
        "line_items[0][quantity]": "1",
        "line_items[0][price_data][currency]": "usd",
        "line_items[0][price_data][unit_amount]": str(plan["cents"]),
        "line_items[0][price_data][product_data][name]": plan["name"],
        "line_items[0][price_data][product_data][description]": plan["desc"],
        "metadata[token]": t, "metadata[plan]": key, "metadata[planId]": pid,
        "success_url": back + "?checkout=success&session_id={CHECKOUT_SESSION_ID}",
        "cancel_url": back + "?checkout=cancelled",
    }
    if plan["interval"]:
        form["line_items[0][price_data][recurring][interval]"] = plan["interval"]
        form["subscription_data[metadata][token]"] = t
        form["subscription_data[metadata][plan]"] = key
    s = stripe("POST", "checkout/sessions", form)
    return {"url": s["url"]}


def h_verify(q, b):
    t = check_token(q.get("token"))
    sid = str(q.get("session_id", ""))
    if not re.match(r"^cs_[A-Za-z0-9_]+$", sid):
        raise ApiError(400, "bad_session", "Invalid checkout session.")
    s = stripe("GET", "checkout/sessions/" + sid)
    if s.get("metadata", {}).get("token") != t:
        raise ApiError(403, "wrong_session", "This checkout belongs to another browser.")
    if s.get("status") != "complete" or s.get("payment_status") not in ("paid", "no_payment_required"):
        return {"plus": False, "status": s.get("status")}
    md = s.get("metadata", {})
    key = md.get("plan") or "plus_m"
    plan = PLANS.get(key, PLANS["plus_m"])
    if key == "pass":
        p = load_plan(md.get("planId", ""))
        if not p.get("pass"):
            p["pass"] = {"session": sid, "at": int(time.time() * 1000), "livemode": bool(s.get("livemode"))}
            save_plan(p)
        return {"plus": False, "pass": True, "planId": p["id"], "plan": key}
    days = 366 if plan["interval"] == "year" else 31
    store.put("ent:" + t, {"plus": True, "tier": plan["tier"], "seats": plan["seats"], "plan": key, "cycle": plan["interval"],
                           "until": time.time() + days * 86400, "session": sid,
                           "livemode": bool(s.get("livemode")), "since": int(time.time())})
    return {"plus": True, "tier": plan["tier"], "plan": key}


# ------------------------------------------------------------------ routing
def route(method, path, query, body, origin):
    parts = [x for x in path.split("/") if x][1:]  # drop "api"
    if method == "GET" and parts == ["health"]:
        return h_health(query, body)
    if method == "GET" and parts == ["me"]:
        return h_me(query, body)
    if method == "POST" and parts == ["plans"]:
        return h_create(query, body)
    if parts[:1] == ["plans"] and len(parts) >= 2:
        pid = parts[1]
        sub = parts[2] if len(parts) > 2 else ""
        table = {("GET", ""): h_get, ("PUT", "me"): h_me_put, ("POST", "remove"): h_remove, ("POST", "vote"): h_vote,
                 ("POST", "comment"): h_comment, ("POST", "suggest"): h_suggest, ("POST", "lock"): h_lock,
                 ("POST", "book"): h_book, ("POST", "ai"): h_ai}
        fn = table.get((method, sub))
        if fn:
            return fn(pid, query, body)
    if method == "POST" and parts == ["checkout"]:
        return h_checkout(query, body, origin)
    if method == "GET" and parts == ["checkout", "verify"]:
        return h_verify(query, body)
    raise ApiError(404, "not_found", "Unknown endpoint.")


def handle(method, raw_path, headers, raw_body):
    """Returns (status, payload). Shared by Vercel and the local dev server."""
    u = urllib.parse.urlsplit(raw_path)
    query = {k: v[0] for k, v in urllib.parse.parse_qs(u.query).items()}
    try:
        body = {}
        if raw_body:
            if len(raw_body) > MAX_BODY:
                raise ApiError(413, "too_large", "Request too large.")
            body = json.loads(raw_body)
            if not isinstance(body, dict):
                raise ApiError(400, "bad_json", "Expected a JSON object.")
        host = headers.get("x-forwarded-host") or headers.get("host") or "localhost"
        proto = headers.get("x-forwarded-proto") or ("http" if host.startswith(("localhost", "127.0.0.1")) else "https")
        return 200, route(method, u.path, query, body, proto + "://" + host)
    except ApiError as e:
        return e.status, {"error": e.code, "message": e.message}
    except json.JSONDecodeError:
        return 400, {"error": "bad_json", "message": "Invalid JSON."}
    except RuntimeError as e:
        if str(e) == "storage_not_configured":
            return 503, {"error": "storage_not_configured", "message": "Storage isn't configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY."}
        raise


class handler(BaseHTTPRequestHandler):  # Vercel entry point
    def _go(self, method):
        n = int(self.headers.get("content-length") or 0)
        raw = self.rfile.read(n).decode("utf-8") if n else ""
        status, payload = handle(method, self.path, {k.lower(): v for k, v in self.headers.items()}, raw)
        out = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(out)))
        self.end_headers()
        self.wfile.write(out)

    def do_GET(self):
        self._go("GET")

    def do_POST(self):
        self._go("POST")

    def do_PUT(self):
        self._go("PUT")
