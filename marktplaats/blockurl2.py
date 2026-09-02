from mitmproxy import http

# the vip list
ALLOWED_DOMAINS = [
    "marktplaats.nl",
    "hzcdn.io",
    "marktplaats.com",
    "dhlparcel.nl",
    "dhlecommerce.nl",
    "postnl.nl",
    "firefox.com",
    "mikuiscringe.com",
    "127.0.0.5",
    "openstreetmap.org",
    "unpkg.com",
    'mitm.it',
    "googleapis.com",
    "onlinebetaalplatform.nl",
    "ideal.nl",
    "abnamro.nl",
    "gemini.google.com"
]

def request(flow: http.HTTPFlow) -> None:
    host = flow.request.pretty_host

    # check if the host ends with any of our allowed domains
    # this covers both the root and any subdomains (e.g., *.marktplaats.nl)
    is_allowed = any(host == domain or host.endswith(f".{domain}") for domain in ALLOWED_DOMAINS)

    if not is_allowed:
        print(f"🚫 BLOCKED: {host} is giving mid energy")
        # kill the flow so it doesn't go through
        flow.kill()
