from mitmproxy import http

# This script intercepts CSS and injects a dark theme override
def response(flow: http.HTTPFlow):
    # Target CSS files or HTML pages that might have styles
    if "text/css" in flow.response.headers.get("Content-Type", "") or ".css" in flow.request.url:

        content = flow.response.get_text()

        # The "Void Protocol" CSS Block
        overrides = """
        <style>
        :root {
            /* Main Backgrounds */
            --hz-color--backgroundDefault: #121212 !important;
            --hz-color--backgroundSecondary: #1e1e1e !important;
            --hz-color--backgroundTertiary: #252525 !important;

            /* Borders & Dividers */
            --hz-color--borderDefault: #333333 !important;
            --hz-color--borderSoft: #2a2a2a !important;

            /* Text & Icons */
            --hz-color--textDefault: #eeeeee !important;
            --hz-color--textPrimary: #ffffff !important;
            --hz-color--textSecondary: #aaaaaa !important;
            --hz-filter--backgroundDefault: invert(100%) brightness(0.8) !important;

            color-scheme: dark !important;
        }

        /* The UI Elements you identified */
        .hz-Header-searchBar {
            background: var(--hz-color--backgroundSecondary) !important;
        }

        .hz-StructuredListing-title,
        .hz-StructuredListing-title a {
            color: #ffffff !important;
        }

        /* The Message Module you just sent */
        .MessageElement-module-root-dsmR_ {
            background-color: #1e1e1e !important;
            border-color: var(--hz-color--borderSoft) !important;
            color: #eeeeee !important;
        }

        /* Global Body Force */
        body {
            background-color: #121212 !important;
            color: #eeeeee !important;
        }
        # The UI Elements you identified
        .hz-Header-searchBar {
            background: var(--hz-color--backgroundSecondary) !important;
        }

        /* Added this bad boy to the dark void! 🖤 */
        .hz-Page-content {
            background-color: #121212 !important;
            color: #eeeeee !important;
        }

        .hz-StructuredListing-title,
        .hz-StructuredListing-title a {
            color: #ffffff !important;
        }
        /* The UI Elements you identified */
        .hz-Header-searchBar {
            background: var(--hz-color--backgroundSecondary) !important;
        }

        /* Keeping the page structure nice and dark! 🖤 */
        .hz-Page-content,
        .hz-Page-container {
            background-color: #121212 !important;
            color: #eeeeee !important;
        }

        .hz-StructuredListing-title,
        .hz-StructuredListing-title a {
            color: #ffffff !important;
        }
        /* The UI Elements you identified */
        .hz-Header-searchBar {
            background: var(--hz-color--backgroundSecondary) !important;
        }

        /* Keeping everything dark and mysterious! 🖤 */
        .hz-Page-content,
        .hz-Page-container,
        .PhoneUpCallBlock-section {
            background-color: #121212 !important;
            color: #eeeeee !important;
            border-color: var(--hz-color--borderSoft) !important;
        }

        .hz-StructuredListing-title,
        .hz-StructuredListing-title a {
            color: #ffffff !important;
        }
        /* Keeping everything dark and mysterious! 🖤 */
        .hz-Page-content,
        .hz-Page-container,
        .PhoneUpCallBlock-section,
        .cells {
            background-color: #121212 !important;
            color: #eeeeee !important;
            border-color: var(--hz-color--borderSoft) !important;
        }
        /* Target the container and all its internal cells/divs! 🖤 */
        .cells,
        .cells .cell,
        .cells .description-title,
        .cells .listing-status,
        .cells .amount,
        .cells .features-column {
            background-color: #121212 !important;
            color: #eeeeee !important;
        }

        /* Fixing the specific text colors for titles and status! */
        .cells a,
        .cells .description-title a,
        .cells .activity,
        .cells .renewal {
            color: #eeeeee !important;
        }

        /* Ensuring icons and interactive elements look cute in the dark! */
        .cells .mp-Icon {
            filter: invert(100%) brightness(1.5) !important;
        }

        </style>
        """

        # Injecting at the top of the file
        # Note: If it's a raw .css file, we don't need <style> tags.
        # This logic checks if it's a CSS file or HTML.
        if "text/css" in flow.response.headers.get("Content-Type", ""):
            # Strip tags for raw CSS files
            clean_overrides = overrides.replace("<style>", "").replace("</style>", "")
            flow.response.set_text(clean_overrides + content)
        else:
            # Prepend to HTML
            flow.response.set_text(content.replace("<head>", "<head>" + overrides))

        print(f"💀 DARK MODE: Injected into {flow.request.host}{flow.request.path[:20]}...")
