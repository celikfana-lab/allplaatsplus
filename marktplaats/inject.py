import json
import re
from mitmproxy import http

BAD_TRAITS = {"ADMARKT_CONSOLE","DAG_TOPPER_7DAYS","PROFILE"}
# BAD_TRAITS = {"ADMARKT_CONSOLE","DAG_TOPPER_7DAYS","PROFILE"}
BAD_PRIORITY = {"DAGTOPPER", "TOPADVERTENTIE"}

# ── Location filter ──────────────────────────────────────────────────────────
# Block listings from specific cities (case-insensitive).
# Example: BAD_CITIES = {"strijen", "amsterdam", "brussels"}
BAD_CITIES: set[str] = set()

# Block listings from specific countries (match countryName or countryAbbreviation,
# case-insensitive). Example: BAD_COUNTRIES = {"belgië", "be", "germany", "de"}
BAD_COUNTRIES: set[str] = set()

def _location_is_blocked(item: dict) -> bool:
    """Return True if the item's location matches any blocked city or country."""
    if not BAD_CITIES and not BAD_COUNTRIES:
        return False
    loc = item.get("location")
    if not isinstance(loc, dict):
        return False
    if BAD_CITIES:
        city = (loc.get("cityName") or "").lower()
        if city in BAD_CITIES:
            return True
    if BAD_COUNTRIES:
        country_name = (loc.get("countryName") or "").lower()
        country_abbr = (loc.get("countryAbbreviation") or "").lower()
        if country_name in BAD_COUNTRIES or country_abbr in BAD_COUNTRIES:
            return True
    return False

# ── Title word filter ────────────────────────────────────────────────────────
# Add words/phrases (lowercase) to hide listings whose title contains any of them.
# Example: BAD_TITLE_WORDS = {"verhuur", "te huur", "rental"}
BAD_TITLE_WORDS: set[str] = {} # whatever you need

def _title_has_bad_word(item: dict) -> bool:
    """Return True if any BAD_TITLE_WORDS appears in the item's title."""
    if not BAD_TITLE_WORDS:
        return False
    title = (item.get("title") or "").lower()
    for word in BAD_TITLE_WORDS:
        if word in title:
            return True
    return False

# ── Description word filter ───────────────────────────────────────────────────
# Add words/phrases (lowercase) to hide listings whose description or
# categorySpecificDescription contains any of them.
# Example: BAD_DESC_WORDS = {"rent", "rental", "huur", "verhuur"}

BAD_DESC_WORDS: set[str] = {"verhuur", "huur", "10/100"}


def _desc_has_bad_word(item: dict) -> bool:
    """Return True if any BAD_DESC_WORDS appears in the item's description fields."""
    if not BAD_DESC_WORDS:
        return False
    for field in ("description", "categorySpecificDescription"):
        text = item.get(field)
        if not text:
            continue
        text_lower = text.lower()
        for word in BAD_DESC_WORDS:
            if word in text_lower:
                return True
    return False

def is_ad(item: dict) -> bool:
    if not isinstance(item, dict): return False
    item_id  = str(item.get("itemId", "?"))
    title    = item.get("title", "?")[:60]
    label    = f"{item_id} | {title!r}"

    def kill(reason: str) -> bool:
        print(f"  KILL [{reason}] {label}")
        return True

    # itemId starts with "a" = instant death
    if item_id.startswith("a"):
        return kill("itemId=a*")
    # bad traits
    for t in item.get("traits", []):
        if t in BAD_TRAITS:
            return kill(f"trait={t}")
    # dagtopper
    if item.get("priorityProduct") in BAD_PRIORITY:
        return kill(f"priorityProduct={item.get('priorityProduct')}")
    # admarkt CDN anywhere in the item
    item_str = json.dumps(item)
    if "admarkt" in item_str:
        return kill("admarkt in json")
    # tracking blob
    if item.get("trackingData"):
        return kill("trackingData present")
    # reserved
    if item.get("reserved") is True:
        return kill("reserved")
    # title word filter
    if _title_has_bad_word(item):
        title_lower = (item.get("title") or "").lower()
        hit = next(w for w in BAD_TITLE_WORDS if w in title_lower)
        return kill(f"title word={hit!r}")
    # description word filter
    if _desc_has_bad_word(item):
        for field in ("description", "categorySpecificDescription"):
            text = (item.get(field) or "").lower()
            hit = next((w for w in BAD_DESC_WORDS if w in text), None)
            if hit:
                return kill(f"desc word={hit!r} in {field}")
    # location filter
    if _location_is_blocked(item):
        loc = item.get("location", {})
        return kill(f"location={loc.get('cityName')}/{loc.get('countryAbbreviation')}")

    print(f"  KEEP {label}")
    return False

def nuke_listings(data, depth=0) -> int:
    """Recursively nuke ads from ANY list of objects that have itemId."""
    if depth > 15 or not data: return 0
    killed = 0
    if isinstance(data, dict):
        for key, val in data.items():
            if (isinstance(val, list) and len(val) > 0
                    and isinstance(val[0], dict) and "itemId" in val[0]):
                before = len(val)
                data[key] = [x for x in val if not is_ad(x)]
                killed += before - len(data[key])
            else:
                killed += nuke_listings(val, depth+1)
    elif isinstance(data, list):
        # top-level list (e.g. feed-items returns a bare array)
        if len(data) > 0 and isinstance(data[0], dict) and "itemId" in data[0]:
            to_remove = [i for i, x in enumerate(data) if is_ad(x)]
            for i in reversed(to_remove):
                data.pop(i)
            killed += len(to_remove)
        else:
            for item in data:
                killed += nuke_listings(item, depth+1)
    return killed

def fix_response(flow: http.HTTPFlow):
    flow.response.headers.pop("content-encoding", None)
    flow.response.headers.pop("content-length", None)
    flow.response.headers.pop("transfer-encoding", None)

def handle_json(flow: http.HTTPFlow, label: str):
    try:
        flow.response.decode()
        raw = flow.response.get_text(strict=False)
        if not raw: return

        data = json.loads(raw)
        killed = nuke_listings(data)

        if killed > 0:
            fix_response(flow)
            flow.response.text = json.dumps(data)
            print(f">>> [{label}] NUKED {killed} ads")
        else:
            print(f"    [{label}] clean")
    except Exception as e:
        print(f"!!! [{label}] {type(e).__name__}: {e}")

def response(flow: http.HTTPFlow) -> None:
    url = flow.request.pretty_url
    ct  = flow.response.headers.get("content-type", "")

    # ── /lrp/api/search — main search API ────────────────────────────────────
    if "/lrp/api/search" in url:
        handle_json(flow, "API/search")
        return

    # ── /hp/api/feed-items — homepage/popular feed ───────────────────────────
    if "/hp/api/feed-items" in url:
        handle_json(flow, "API/feed-items")
        return

    # ── HTML pages — patch __NEXT_DATA__ ─────────────────────────────────────
    if "marktplaats.nl" in url and "text/html" in ct:
        try:
            flow.response.decode()
            html = flow.response.get_text(strict=False)
            if not html or "__NEXT_DATA__" not in html: return

            pattern = r'(<script[^>]+id="__NEXT_DATA__"[^>]*>)(.*?)(</script>)'
            match = re.search(pattern, html, re.DOTALL)
            if not match:
                print("!!! [HTML] __NEXT_DATA__ not found"); return

            data = json.loads(match.group(2))
            killed = nuke_listings(data)

            if killed > 0:
                clean = json.dumps(data)
                new_html = html[:match.start()] \
                         + match.group(1) + clean + match.group(3) \
                         + html[match.end():]
                fix_response(flow)
                flow.response.text = new_html
                print(f">>> [HTML/__NEXT_DATA__] NUKED {killed} ads")
            else:
                print(f"    [HTML/__NEXT_DATA__] clean")

        except Exception as e:
            print(f"!!! [HTML] {type(e).__name__}: {e}")
