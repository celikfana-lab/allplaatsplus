import logging
import re
from mitmproxy import http

def request(flow: http.HTTPFlow) -> None:
    blocked_hosts = {
        "admarkt-cdn.marktplaats.com",
        "tagmanager.marktplaats.nl",
        "consent.marktplaats.nl",
        "faas.marktplaats.nl"
    }

    # CHANGE 1: Use a LIST [] and make sure the name matches the one below
    # CHANGE 2: Use .* for wildcards, not just *
    blocked_patterns = [
        r"/lrp/api/complementary-listings",
        r"/v/api/feed-items",
        r"/bff/static/vendor/ecg-js-banners/ads/ads-adsscript.js",
        r"bff/static/js/auroraAdobeDmpJs\..*",
        r"lrp/api/audience-targeting",
        r"bff/static/vendor/ecg-js-banners/index\.mp\.nlnl.*",
        r"static/js/adsenseForSearch.bcee0a15.js",
        r"bff/static/css/adsenseForSearch.mp.fdaf372f.css"
    ]

    # Host check
    if flow.request.pretty_host in blocked_hosts:
        flow.response = http.Response.make(403, b"L + ratio + no ads.")
        return

    # CHANGE 3: Now 'blocked_patterns' actually exists so this won't crash
    if any(re.search(pattern, flow.request.path) for pattern in blocked_patterns):
        logging.info(f"Path caught in 4k: {flow.request.path}")
        flow.response = http.Response.make(403, b"Blocked. We don't do that here.")
