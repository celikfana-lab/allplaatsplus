// allplaatsplus - content script
//
// 1) Seeds settings into the page's main world and injects page.js, which hooks
//    fetch/XHR to filter listing JSON (the primary, mitmproxy-equivalent path).
// 2) Applies the dark mode CSS (ported from darkmode.py).
// 3) Runs a MutationObserver as a fallback to remove ad / filtered cards that
//    are server-rendered (__NEXT_DATA__) or injected reactively.

(function () {
  'use strict';

  var DEFAULTS = {
    blockAds: true,
    blockByTitle: false,
    blockByDescription: false,
    titleWords: [],
    descWords: [],
    blockCities: [],
    blockCountries: [],
    hideBlocked: false,
    aggressiveIdBlock: true,
    darkMode: false,
    hdImages: false
  };

  var DARK_CSS = '\n@media (prefers-color-scheme: dark) {\n' +
    ':root {\n' +
    '  --hz-color--backgroundDefault: #121212 !important;\n' +
    '  --hz-color--backgroundSecondary: #1e1e1e !important;\n' +
    '  --hz-color--backgroundTertiary: #252525 !important;\n' +
    '  --hz-color--borderDefault: #333333 !important;\n' +
    '  --hz-color--borderSoft: #2a2a2a !important;\n' +
    '  --hz-color--textDefault: #eeeeee !important;\n' +
    '  --hz-color--textPrimary: #ffffff !important;\n' +
    '  --hz-color--textSecondary: #aaaaaa !important;\n' +
    '  color-scheme: dark !important;\n' +
    '}\n' +
    'body { background-color: #121212 !important; color: #eeeeee !important; }\n' +
    '.hz-Page-content, .hz-Page-container { background-color: #121212 !important; color: #eeeeee !important; }\n' +
    '.hz-Header-searchBar { background: var(--hz-color--backgroundSecondary) !important; }\n' +
    '.hz-StructuredListing-title, .hz-StructuredListing-title a { color: #ffffff !important; }\n' +
    '.MessageElement-module-root-dsmR_, .cells { background-color: #1e1e1e !important; color: #eeeeee !important; border-color: var(--hz-color--borderSoft) !important; }\n' +
    '.cells .cell, .cells .description-title, .cells .listing-status, .cells .amount, .cells .features-column { background-color: #121212 !important; color: #eeeeee !important; }\n' +
    '.cells a, .cells .description-title a, .cells .activity, .cells .renewal { color: #eeeeee !important; }\n' +
    '.cells .mp-Icon, .hz-Header svg img { filter: invert(100%) brightness(1.5) !important; }\n' +
    '}\n';

  // Kleinanzeigen (DE) dark theme — from the user's KA dark-mode stylesheet.
  var KA_DARK_CSS = [
    'body, .bg-background, .bg-surface, .bg-backgroundSubdued,',
    '.bg-surfaceSubdued, .bg-onSecondary, #srchrslt-content .bg-surface,',
    '.rounded-small.bg-surface, .rounded-xsmall.bg-surface,',
    'header .bg-surface, footer .bg-backgroundSubdued,',
    '#browsebox-form .bg-surface, .bg-primary,',
    '.bg-secondaryContainer, .bg-secondary,',
    '.bg-onSecondary, .bg-utilityNonessential, .bg-interactive,',
    '[class*="bg-background"], [class*="bg-surface"], [class*="bg-primary"],',
    '[class*="bg-secondary"], [class*="bg-utility"] {',
    '  background-color: #1a1a2e !important;',
    '}',
    '.bg-surface, .bg-backgroundSubdued, .bg-onSecondary,',
    '.border-utilityNonessential, .border-utility,',
    '.bg-secondaryContainer, .bg-secondary,',
    '[class*="border-utility"], [class*="border-"] {',
    '  border-color: #2d2d44 !important;',
    '}',
    'body, .text-onSurface, .text-bodyRegular, .text-title3,',
    '.text-bodyRegularStrong, .text-onSurfaceSubdued,',
    'h1, h2, h3, h4, .font-strong, .text-onBackgroundSubdued,',
    '.text-onSurface, .text-onSecondaryContainer,',
    '[class*="text-onSurface"], [class*="text-onBackground"] {',
    '  color: #e0e0e0 !important;',
    '}',
    '.text-onSurfaceSubdued, .text-onBackgroundSubdued,',
    '.text-onSurfaceNonessential, .text-bodySmall,',
    '.text-utility, .text-neutral { color: #a0a0b8 !important; }',
    '.text-secondary, .text-interactive, .text-onInteractive,',
    '.text-onPrimary, .text-accent, .text-onAccent { color: #6c63ff !important; }',
    '.text-onCritical, .text-critical { color: #ff6b6b !important; }',
    'a:not([class*="text-"]) { color: #6c63ff !important; }',
    'a:not([class*="text-"]) .text-onSurface { color: #6c63ff !important; }',
    'input, select, textarea, .box-border.border-utility,',
    '.box-border.border-utilityNonessential,',
    '[class*="border-utility"] {',
    '  background-color: #2d2d44 !important;',
    '  border-color: #3d3d5c !important;',
    '  color: #e0e0e0 !important;',
    '}',
    'input::placeholder, textarea::placeholder { color: #7a7a9a !important; }',
    '.bg-primary, .bg-interactive, .bg-secondaryContainer,',
    '[class*="bg-primary"], [class*="bg-interactive"],',
    '.rounded-full.bg-interactive, .rounded-full.bg-primary {',
    '  background-color: #6c63ff !important;',
    '  color: #ffffff !important;',
    '}',
    '.bg-secondaryContainer, .bg-secondary {',
    '  background-color: #2d2d44 !important;',
    '  color: #e0e0e0 !important;',
    '}',
    '.hover\\:bg-secondaryContainer:hover { background-color: #3d3d5c !important; }',
    '.bg-surfaceSubdued, .bg-onSurface { background-color: #2d2d44 !important; }',
    '[data-clickable="card"] {',
    '  background-color: #1e1e32 !important;',
    '  border-color: #2d2d44 !important;',
    '}',
    '[data-clickable="card"]:hover { box-shadow: 0 4px 20px rgba(108, 99, 255, 0.15) !important; }',
    'aside[data-filter-panel] { background-color: #16162a !important; }',
    'aside[data-filter-panel] .bg-surface { background-color: #1a1a2e !important; }',
    'details summary h3 { color: #e0e0e0 !important; }',
    'details summary .text-onSurfaceSubdued { color: #a0a0b8 !important; }',
    '.bg-surfaceSubdued, .bg-utilitySubdued { background-color: #2d2d44 !important; color: #a0a0b8 !important; }',
    '.bg-accent, .bg-onAccent { background-color: #6c63ff !important; color: #ffffff !important; }',
    '.bg-secondary, .bg-secondaryContainer { background-color: #2d2d44 !important; }',
    '::-webkit-scrollbar { width: 8px; height: 8px; }',
    '::-webkit-scrollbar-track { background: #1a1a2e !important; }',
    '::-webkit-scrollbar-thumb { background: #3d3d5c !important; border-radius: 4px; }',
    '::-webkit-scrollbar-thumb:hover { background: #5a5a7a !important; }',
    'svg:not([fill="none"]) { fill: #e0e0e0 !important; }',
    '.text-onSurfaceSubdued svg, .text-utility svg, .text-neutral svg { fill: #a0a0b8 !important; }',
    '.bg-accent, .text-onAccent { background-color: #6c63ff !important; color: #ffffff !important; }',
    '#pagination-container a, #pagination-container span { color: #e0e0e0 !important; }',
    '#pagination-container .bg-interactive { background-color: #6c63ff !important; }',
    '#pagination-container .text-interactive { color: #6c63ff !important; }',
    'footer, #footer, #mobile-footer { background-color: #16162a !important; }',
    'footer .text-onSurface, #footer .text-onSurface, #mobile-footer .text-onSurface { color: #e0e0e0 !important; }',
    'footer .text-onBackgroundSubdued, #footer .text-onBackgroundSubdued { color: #7a7a9a !important; }',
    'footer .border-t-utilitySubdued { border-color: #2d2d44 !important; }',
    'header, .bg-primary, .bg-background { background-color: #1a1a2e !important; }',
    'header .text-onPrimary { color: #e0e0e0 !important; }',
    'header .border-b-4.border-transparent { border-color: transparent !important; }',
    'header .border-interactive { border-color: #6c63ff !important; }',
    '[data-testid="search-bar-container"] .bg-background, [data-testid="search-form"], [data-testid="search-form"] input { background-color: #2d2d44 !important; }',
    '.collapsible-filter-section { border-color: #2d2d44 !important; }',
    '[role="tab"] { background-color: transparent !important; color: #a0a0b8 !important; }',
    '[role="tab"][aria-selected="true"] { color: #e0e0e0 !important; border-color: #2d2d44 !important; border-bottom-color: #1a1a2e !important; }',
    '[role="tabpanel"] a { color: #a0a0b8 !important; }',
    '[role="tabpanel"] a:hover { color: #e0e0e0 !important; }',
    '.text-onConfirmContainer { color: #a0a0b8 !important; }',
    '.text-onConfirmContainer:hover { color: #e0e0e0 !important; }',
    '.text-secondary, .text-title3.font-strong.text-secondary { color: #6c63ff !important; }',
    '.bg-interactive { background-color: #6c63ff !important; }',
    '[class*="bg-white"], .bg-white { background-color: #1a1a2e !important; }',
    '.text-black, [class*="text-black"] { color: #e0e0e0 !important; }',
    '[style*="background-color"]:not([style*="background-color:transparent"]) { background-color: #1a1a2e !important; }',
    '[style*="color"]:not([style*="color:transparent"]) { color: #e0e0e0 !important; }'
  ].join('\n');

  // leboncoin.fr dark theme — aggressive version (ported from the user's
  // enhanced console script). It blanket-overrides every background/text so no
  // white boxes survive, while keeping the orange accent and images visible.
  var LBC_DARK_CSS = [
    ':root {',
    '  --bg-surface: #1a1a2e !important;',
    '  --bg-background: #16213e !important;',
    '  --bg-neutral-container: #2a2a4a !important;',
    '  --text-on-surface: #e8e8e8 !important;',
    '  --text-neutral: #a0a0b8 !important;',
    '  --text-on-neutral-container: #e8e8e8 !important;',
    '  --border-outline: #3a3a5a !important;',
    '  --border-outline-high: #5a5a7a !important;',
    '  --shadow-sm: 0 2px 8px rgba(0,0,0,0.4) !important;',
    '  --shadow-md: 0 4px 16px rgba(0,0,0,0.5) !important;',
    '  --color-main: #f56b2a !important;',
    '  --color-support: #ff8c5a !important;',
    '  --color-accent: #f56b2a !important;',
    '  --color-main-hovered: #ff7a3a !important;',
    '}',
    // Blanket: force every container / bg- class / inline-styled element dark.
    // Specific class rules below (higher specificity) still win where needed.
    'body, #__next, div, section, article, main, header, footer, nav,',
    '.bg-surface, .bg-background, .bg-neutral-container, .bg-white,',
    '.bg-background-variant, .bg-surface-variant, [class*="bg-"], [style*="background"] {',
    '  background-color: #1a1a2e !important;',
    '  background: #1a1a2e !important;',
    '}',
    // Keep overlays / absolutely-positioned layers and images transparent.
    '.pointer-events-none, .absolute.inset-0, [class*="absolute"] { background-color: transparent !important; }',
    'img { background-color: transparent !important; }',
    // Text: everything light, then restore neutral/dimmed & accent tones.
    '* { color: #e8e8e8 !important; }',
    '.text-neutral, .text-on-surface, .text-body-1, .text-body-2, .text-caption,',
    '.text-subhead, .text-body-1-highlight, .text-body-2-highlight,',
    '.text-headline-1, .text-callout,',
    '.text-on-background-variant, .text-on-surface-variant { color: #e8e8e8 !important; }',
    '.text-neutral, .text-on-surface\\/dim-1, .text-on-surface\\/dim-2, .text-on-surface\\/dim-3 { color: #a0a0b8 !important; }',
    '.text-main, .text-main-variant { color: #f56b2a !important; }',
    '.text-success { color: #4caf50 !important; }',
    // Borders.
    '.border-sm, .border-outline, [class*="border"], .styles_separator__R_iBi { border-color: #3a3a5a !important; }',
    '.border-outline-high { border-color: #5a5a7a !important; }',
    // Inputs.
    'input, .Input_inputWrapperRightComponent__rjwgB { background-color: #2a2a4a !important; color: #e8e8e8 !important; }',
    'input::placeholder { color: #a0a0b8 !important; }',
    // Buttons / accent (oranges) and badge text.
    'button, .bg-main { background-color: #f56b2a !important; }',
    'button:hover, .bg-main-hovered:hover { background-color: #ff7a3a !important; }',
    '.bg-accent { background-color: #f56b2a !important; }',
    '.text-on-accent { color: #fff !important; }',
    // Cards & navbar.
    '.styles_adCard__9GEgr, .styles_listing--generic__80fyT, .Column_adContentVisibility__ow19j { background-color: #1a1a2e !important; }',
    '.styles_navbarWrapper__MD3_6, .styles_navbarContent__FfBnj { background-color: #1a1a2e !important; }',
    '.styles_Listing__715OM { background-color: #1a1a2e !important; }',
    '.StickyNav_separator__olhSA { background-color: #1a1a2e !important; }',
    '.adcard_f54259e4e { background-color: #2a2a4a !important; }',
    '.vl-wrapper, .styles_videoListing__BXDt4 { background-color: #1a1a2e !important; }',
    // Inline white backgrounds (CSS !important beats inline non-important).
    '[style*="background:#fff"], [style*="background: #fff"], [style*="background-color:#fff"],',
    '[style*="background-color: #fff"], [style*="background:white"], [style*="background: white"],',
    '[style*="background-color:white"], [style*="background-color: white"], [data-theme*="light"] {',
    '  background-color: #1a1a2e !important;',
    '}',
    // White-ish class leftovers.
    '[class*="white"], [class*="White"], [class*="bg-white"] { background-color: #1a1a2e !important; }',
    // Shadows & scrollbar.
    '.shadow-sm, .shadow-md, .shadow-lg { box-shadow: 0 2px 12px rgba(0,0,0,0.5) !important; }',
    '::-webkit-scrollbar { width: 8px; height: 8px; }',
    '::-webkit-scrollbar-track { background: #1a1a2e; }',
    '::-webkit-scrollbar-thumb { background: #3a3a5a; border-radius: 4px; }',
    '::-webkit-scrollbar-thumb:hover { background: #5a5a7a; }',
    // Dim/clear the ad placeholder boxes so no grey/white shimmer is left.
    '.adSkinPlaceholder, .styles_placeholderSkin__QFC_v, .styles_genericWrapper__lOEag,',
    '[id*="skyscraper-container"], [id*="lht-space-ad"], .topBanner_topBannerContainer__IkzNM,',
    '.styles_Shimmer__6LFO3, .apn-na, .apn-hb, .teal-apn, .liberty-unfilled,',
    '.styles_genericWrapperPlaceholderImage__P04bp {',
    '  background-color: transparent !important;',
    '  opacity: 0.5 !important;',
    '}'
  ].join('\n');

  // Vinted dark theme — ported from the user's console script. Same colors, no
  // floating toggle (the popup's Dark Mode toggle already controls this).
  var VINTED_DARK_CSS = (function () {
    var bg = '#12121e';
    var bg2 = '#1a1a2e';
    var bg3 = '#252540';
    var bg4 = '#2d2d4a';
    var bgHover = '#35355a';
    var border = '#3a3a5a';
    var text = '#e8e8f0';
    var textMuted = '#a8a8c0';
    var textBright = '#ffffff';
    var accent = '#6c5ce7';
    var accentHover = '#7d6ff0';
    var shadow = '0 2px 12px rgba(0,0,0,0.6)';
    return `
    /* base */
    html, body, .next-page, .standard-layout,
    .u-background-white, .ContentLayoutStructure-module-scss-module__79pw-q__site {
      background-color: ${bg} !important;
      color: ${text} !important;
    }
    /* containers */
    .LayoutContainer-module-scss-module__m5slWq__container,
    .web_ui__Cell__cell,
    .web_ui__Card__card,
    .web_ui__Card__overflowAuto,
    [class*="ItemBox-module"] .web_ui__Cell__cell,
    [class*="ItemBox-module"] .web_ui__Cell__body {
      background-color: transparent !important;
    }
    /* header */
    [class*="Header-module"] {
      background-color: ${bg2} !important;
      border-bottom: 1px solid ${border} !important;
    }
    [class*="Header-module"] [class*="logo"] img {
      filter: brightness(0.9) saturate(0.8);
    }
    /* search bar */
    .web_ui__InputBar__input-bar {
      background-color: ${bg3} !important;
      border: 1px solid ${border} !important;
      border-radius: 8px !important;
    }
    .web_ui__InputBar__input-bar:focus-within {
      border-color: ${accent} !important;
      box-shadow: 0 0 0 3px rgba(108,92,231,0.25) !important;
    }
    .web_ui__InputBar__value {
      background: transparent !important;
      color: ${text} !important;
    }
    .web_ui__InputBar__value::placeholder {
      color: ${textMuted} !important;
    }
    .web_ui__InputBar__prefix button,
    .web_ui__InputBar__suffix button {
      color: ${textMuted} !important;
    }
    .web_ui__InputBar__prefix button:hover,
    .web_ui__InputBar__suffix button:hover {
      color: ${text} !important;
    }
    .web_ui__Divider__divider.web_ui__Divider__vertical {
      background-color: ${border} !important;
    }
    /* buttons (flat/outlined/filled) */
    .web_ui__Button__button.web_ui__Button__filled.web_ui__Button__primary {
      background-color: ${accent} !important;
      color: #fff !important;
    }
    .web_ui__Button__button.web_ui__Button__filled.web_ui__Button__primary:hover {
      background-color: ${accentHover} !important;
    }
    .web_ui__Button__button.web_ui__Button__outlined.web_ui__Button__primary {
      border-color: ${accent} !important;
      color: ${accent} !important;
      background: transparent !important;
    }
    .web_ui__Button__button.web_ui__Button__outlined.web_ui__Button__primary:hover {
      background: ${accent} !important;
      color: #fff !important;
    }
    .web_ui__Button__button.web_ui__Button__flat {
      color: ${text} !important;
    }
    .web_ui__Button__button.web_ui__Button__flat:hover {
      background: ${bgHover} !important;
    }
    .web_ui__Button__button.web_ui__Button__muted {
      color: ${textMuted} !important;
    }
    .web_ui__Button__button.web_ui__Button__muted:hover {
      color: ${text} !important;
    }
    /* tabs / navigation */
    .web_ui__Tabs__tabs {
      background-color: ${bg2} !important;
      border-bottom: 1px solid ${border} !important;
    }
    .web_ui__Tabs__tab {
      color: ${textMuted} !important;
    }
    .web_ui__Tabs__tab[aria-selected="true"] {
      color: ${textBright} !important;
      border-bottom-color: ${accent} !important;
    }
    .web_ui__Tabs__tab:hover {
      color: ${text} !important;
    }
    /* product cards */
    [class*="ItemBox-module"] [class*="container"] {
      background: ${bg2} !important;
      border-radius: 12px !important;
      overflow: hidden !important;
      box-shadow: ${shadow} !important;
      transition: transform 0.15s, box-shadow 0.15s !important;
    }
    [class*="ItemBox-module"] [class*="container"]:hover {
      transform: translateY(-2px) !important;
      box-shadow: 0 6px 24px rgba(0,0,0,0.7) !important;
    }
    [class*="ItemBox-module"] [class*="summary"] {
      background: ${bg2} !important;
      padding: 10px 12px 12px !important;
    }
    [class*="ItemBox-module"] .web_ui__Text__text {
      color: ${text} !important;
    }
    [class*="ItemBox-module"] .web_ui__Text__text.web_ui__Text__muted {
      color: ${textMuted} !important;
    }
    [class*="ItemBox-module"] .web_ui__Text__text.web_ui__Text__primary {
      color: ${textBright} !important;
    }
    [class*="ItemBox-module"] [class*="bump-text"] {
      color: ${accent} !important;
    }
    [class*="ItemBox-module"] .web_ui__Image__image {
      background-color: ${bg4} !important;
    }
    [class*="ItemBox-module"] .web_ui__Image__image img {
      filter: brightness(0.9) contrast(1.05);
    }
    [class*="ItemBoxFavouriteIcon-module"] {
      background: ${bg2}cc !important;
      backdrop-filter: blur(4px) !important;
      border-radius: 20px !important;
      padding: 4px 8px !important;
      color: ${text} !important;
    }
    [class*="ItemBoxFavouriteIcon-module"]:hover {
      background: ${bg4} !important;
    }
    /* filter chips */
    .web_ui__Chip__chip.web_ui__Chip__outlined {
      background: ${bg3} !important;
      border: 1px solid ${border} !important;
      color: ${text} !important;
    }
    .web_ui__Chip__chip.web_ui__Chip__outlined:hover {
      background: ${bgHover} !important;
      border-color: ${accent} !important;
    }
    .web_ui__Chip__chip.web_ui__Chip__filled {
      background: ${accent} !important;
      color: #fff !important;
      border: 1px solid ${accent} !important;
    }
    .web_ui__Chip__chip.web_ui__Chip__filled:hover {
      background: ${accentHover} !important;
    }
    .web_ui__Chip__chip .web_ui__Text__text {
      color: inherit !important;
    }
    .web_ui__Chip__chip .web_ui__Icon__icon {
      color: inherit !important;
    }
    /* category navigation links */
    [class*="SubcatalogNavigationFaceted-module"] [class*="nav-link"] {
      color: ${textMuted} !important;
    }
    [class*="SubcatalogNavigationFaceted-module"] [class*="nav-link"]:hover {
      color: ${textBright} !important;
      background: ${bgHover} !important;
    }
    /* pagination */
    .web_ui__Pagination__pagination {
      background: ${bg2} !important;
      border-radius: 8px !important;
      padding: 8px 4px !important;
    }
    .web_ui__Pagination__item a {
      color: ${textMuted} !important;
      background: transparent !important;
      border-radius: 6px !important;
      padding: 6px 12px !important;
    }
    .web_ui__Pagination__item a:hover {
      background: ${bgHover} !important;
      color: ${text} !important;
    }
    .web_ui__Pagination__item.web_ui__Pagination__is-active a {
      background: ${accent} !important;
      color: #fff !important;
    }
    .web_ui__Pagination__prev a,
    .web_ui__Pagination__next a {
      color: ${textMuted} !important;
    }
    .web_ui__Pagination__prev a:hover,
    .web_ui__Pagination__next a:hover {
      color: ${text} !important;
    }
    /* dividers */
    .web_ui__Divider__divider {
      background-color: ${border} !important;
    }
    /* text overrides */
    .web_ui__Text__text {
      color: ${text} !important;
    }
    .web_ui__Text__text.web_ui__Text__muted {
      color: ${textMuted} !important;
    }
    .web_ui__Text__text.web_ui__Text__primary {
      color: ${textBright} !important;
    }
    .web_ui__Text__text.web_ui__Text__heading {
      color: ${textBright} !important;
    }
    .web_ui__Text__text.web_ui__Text__amplified {
      color: ${text} !important;
    }
    .web_ui__Text__text.web_ui__Text__subtitle {
      color: ${text} !important;
    }
    /* icons */
    .web_ui__Icon__icon {
      color: ${textMuted} !important;
    }
    .web_ui__Icon__icon.web_ui__Icon__greyscale-level-2 {
      color: ${textMuted} !important;
    }
    .web_ui__Icon__icon.web_ui__Icon__greyscale-level-3 {
      color: ${text} !important;
    }
    .web_ui__Icon__icon.web_ui__Icon__primary-default {
      color: ${accent} !important;
    }
    button:hover .web_ui__Icon__icon {
      color: ${textBright} !important;
    }
    /* footer */
    [class*="_main-footer-module"] {
      background-color: ${bg2} !important;
      border-top: 1px solid ${border} !important;
    }
    [class*="_main-footer-module"] [class*="links-section-link"],
    [class*="_main-footer-module"] [class*="privacy-section-link"] {
      color: ${textMuted} !important;
    }
    [class*="_main-footer-module"] [class*="links-section-link"]:hover,
    [class*="_main-footer-module"] [class*="privacy-section-link"]:hover {
      color: ${textBright} !important;
    }
    [class*="_main-footer-module"] [class*="links-section-label"] {
      color: ${textBright} !important;
    }
    [class*="_main-footer-module"] [class*="social-section"] img {
      filter: brightness(0.8) saturate(0.7);
    }
    [class*="_main-footer-module"] [class*="social-section"] a:hover img {
      filter: brightness(1) saturate(1);
    }
    /* search results ranking button */
    [data-testid="search_results_ranking_link--pressable-button"] {
      color: ${textMuted} !important;
    }
    [data-testid="search_results_ranking_link--pressable-button"]:hover {
      color: ${text} !important;
    }
    /* price breakdown tooltip / compact price */
    [class*="CompactPrice-module"] {
      color: ${textBright} !important;
    }
    [class*="CompactPrice-module"] .web_ui__Text__text {
      color: inherit !important;
    }
    /* language selector */
    .web_ui__Cell__cell.web_ui__Cell__navigating {
      background: ${bg3} !important;
      border: 1px solid ${border} !important;
      border-radius: 8px !important;
    }
    .web_ui__Cell__cell.web_ui__Cell__navigating:hover {
      background: ${bgHover} !important;
    }
    /* misc */
    .web_ui__Label__label .web_ui__Label__content {
      color: ${textMuted} !important;
    }
    .web_ui__Spacer__regular,
    .web_ui__Spacer__medium,
    .web_ui__Spacer__small,
    .web_ui__Spacer__x-small,
    .web_ui__Spacer__vertical,
    .web_ui__Spacer__horizontal {
      background: transparent !important;
    }
    /* scrollbar (optional polish) */
    ::-webkit-scrollbar {
      width: 8px;
      height: 8px;
    }
    ::-webkit-scrollbar-track {
      background: ${bg};
    }
    ::-webkit-scrollbar-thumb {
      background: ${bg4};
      border-radius: 8px;
    }
    ::-webkit-scrollbar-thumb:hover {
      background: ${accent};
    }
    /* loading skeletons */
    .react-loading-skeleton {
      background: ${bg4} !important;
      background-image: linear-gradient(90deg, ${bg4}, ${bgHover}, ${bg4}) !important;
    }
    `;
  })();

  function isVintedSite() {
    return /(^|\.)vinted\.[a-z]{2,}/i.test(location.hostname);
  }

  function isKleinanzeigenSite() {
    return /kleinanzeigen\.de/i.test(location.hostname);
  }

  function isLeboncoinSite() {
    return /leboncoin\.fr/i.test(location.hostname);
  }

  // Hide banner ad containers immediately (prevents a flash) and keep them out.
  // NOTE: do NOT use bare `[id^="ad-"]` / `[id^="adslot-"]` wildcards — the
  // seller dashboard wraps the user's OWN listings in elements whose id starts
  // with "ad-", so those wildcards would hide real listings. Only target the
  // concrete banner containers.
  var BANNER_CSS =
    '.hz-Banner, .hz-Banner--fluid, [id^="banner-"], .bannerContainerLoading, ' +
    '.BrandTileBanner, [data-testid="brand-tile-banner"], [id^="premium-content-"], ' +
    '[data-testid="listing-other-seller"], [class*="hz-Listing-other-seller"], ' +
    '[class*="Listing-other-seller"], ' +
    // leboncoin.fr ad slots (skyscrapers, leaderboard, native/in-feed ads,
    // and the Google AdSense "Annonces Google" footer block)
    '[id^="skyscraper-container-"], [id^="lht-"], [id^="liberty-"], ' +
    // the whole native/in-feed ad card is an <li> (id="generic", class
    // "styles_ad__mAE6t") holding a liberty iframe + "Sponsorisé" skeleton;
    // hide the entire card, not just the inner liberty slot, so the grey
    // shimmer box disappears too.
    '[data-liberty-position-name], li[id="generic"], li[class*="styles_ad_"], ' +
    '[class*="styles_genericWrapper_"], [id^="afs-"], #google_ads, .googleafs, ' +
    '[class*="apn-afs"], ' +
    '[class*="_components_topBannerWithSkinPlaceholder"], [class*="topBanner_topBannerContainer"] { display: none !important; }\n';

  var settings = Object.assign({}, DEFAULTS);
  var darkStyleEl = null;
  var bannerStyleEl = null;

  // ---------- block statistics (reported to background.js) ----------
  // The DOM-removal counter is bumped in removeCard(); SSR listing kills are
  // bumped in cleanNextData(); and API listing kills are relayed from page.js
  // (via a window message). A small interval batches the deltas to background.
  var statsAccum = { listingsKilled: 0, listingsTotal: 0, domRemoved: 0 };
  function flushStats() {
    if (!statsAccum.listingsKilled && !statsAccum.domRemoved) return;
    try {
      chrome.runtime.sendMessage({
        type: 'MARKTPL_STATS',
        data: {
          listingsKilled: statsAccum.listingsKilled,
          listingsTotal: statsAccum.listingsTotal,
          domRemoved: statsAccum.domRemoved,
          domTotal: document.getElementsByTagName('*').length
        }
      });
    } catch (e) { /* ignore */ }
    statsAccum.listingsKilled = 0;
    statsAccum.listingsTotal = 0;
    statsAccum.domRemoved = 0;
  }
  setInterval(flushStats, 1500);
  window.addEventListener('message', function (e) {
    if (e && e.data && e.data.type === 'MARKTPL_STATS_API') {
      var d = e.data.data || {};
      if (typeof d.listingsKilled === 'number') statsAccum.listingsKilled += d.listingsKilled;
      if (typeof d.listingsTotal === 'number') statsAccum.listingsTotal += d.listingsTotal;
    }
  });

  function loadSettings() {
    chrome.storage.local.get(DEFAULTS, function (s) {
      settings = Object.assign({}, DEFAULTS, s);
      window.__MARKTPL_SETTINGS__ = settings;
      window.postMessage({ type: 'MARKTPL_SETTINGS', payload: settings }, '*');
      syncDarkMode();
      syncBanners();
    });
  }

  function syncBanners() {
    if (settings.blockAds) {
      if (!bannerStyleEl) {
        bannerStyleEl = document.createElement('style');
        bannerStyleEl.id = 'marktl-banners';
        (document.head || document.documentElement).appendChild(bannerStyleEl);
      }
      bannerStyleEl.textContent = BANNER_CSS;
    } else if (bannerStyleEl) {
      bannerStyleEl.remove();
      bannerStyleEl = null;
    }
  }

  function syncDarkMode() {
    if (settings.darkMode) {
      if (!darkStyleEl) {
        darkStyleEl = document.createElement('style');
        darkStyleEl.id = 'marktl-dark';
        (document.head || document.documentElement).appendChild(darkStyleEl);
      }
      darkStyleEl.textContent = isKleinanzeigenSite() ? KA_DARK_CSS
        : isLeboncoinSite() ? LBC_DARK_CSS
        : DARK_CSS;
      // leboncoin.fr styles itself via the data-theme attribute; mirror the
      // console script so its own component styles follow too.
      if (isLeboncoinSite()) {
        try { document.documentElement.setAttribute('data-theme', 'dark'); } catch (e) { /* ignore */ }
      }
    } else if (darkStyleEl) {
      darkStyleEl.remove();
      darkStyleEl = null;
      if (isLeboncoinSite()) {
        try { document.documentElement.setAttribute('data-theme', 'light'); } catch (e) { /* ignore */ }
      }
    }
  }

  // Inject page.js into the page's main world (needs web_accessible_resources).
  function injectPageScript() {
    var src = chrome.runtime.getURL('page.js');
    try {
      var s = document.createElement('script');
      s.src = src;
      s.classList.add('marktl-page-script');
      (document.head || document.documentElement).appendChild(s);
      s.onload = function () { s.parentNode && s.parentNode.removeChild(s); };
    } catch (e) { /* ignore */ }
  }

  // ---------- DOM fallback filtering ----------
  // The network hook (page.js) is the reliable path; this is only a safety net
  // for server-rendered / reactively inserted cards. We ONLY remove individual
  // cards (never large containers), so the page can't break.
  var ITEM_LINK = 'a[href*="/v/"], a[href*="/a/"], a[href*="/z/"]';

  function textOf(el) {
    return (el.textContent || '').toLowerCase();
  }

  function wordMatches(text, words) {
    for (var i = 0; i < words.length; i++) {
      if (text.indexOf(words[i]) !== -1) return words[i];
    }
    return null;
  }

  function countLinks(el) {
    try { return el.querySelectorAll(ITEM_LINK).length; } catch (e) { return 0; }
  }

  // Ad items on Marktplaats have an item id like a1513450851 (starts with "a"),
  // real listings use other letters (m2437820726). Match "a" followed by 7+ digits.
  function linkIsAd(a) {
    var base = (a.getAttribute('href') || '').split('?')[0];
    return /(^|[^a-z])(a\d{7,})($|[^0-9])/.test(base);
  }

  // A card is an ad / promoted listing only when it carries a Dagtopper /
  // Admarkt marker. Deliberately avoids the generic "gesponsord"/"uitgelicht"
  // (featured) wording — real / seller-owned listings can be labelled featured
  // ("Uitgelicht") too, so matching that would delete real listings.
  function cardLooksLikeAd(el) {
    var cls = (el.className && String(el.className).toLowerCase()) || '';
    if (/dagtopper|admarkt|sponsored|promoted/.test(cls)) return true;
    var t = textOf(el);
    if (/dagtopper|admarkt/.test(t)) return true;
    return false;
  }

  // Kleinanzeigen (DE) cards are <article data-adid="...">. An ad always shows
  // the PRO badge (a `bg-accent ... text-onAccent` div reading "PRO") or the
  // purple PRO logo (svg path fill #5A33AE). A normal listing has neither.
  function isKleinanzeigenAd(article) {
    var pro = article.querySelector('[class*="bg-accent"][class*="text-onAccent"]');
    if (pro && /^pro$/i.test((pro.textContent || '').trim())) return true;
    // purple PRO logo (33x16) OR the grey "Anzeige" wordmark (244x40, fill #BEBCB7)
    if (article.querySelector('path[fill="#5A33AE"], svg[width="33"][height="16"]')) return true;
    if (article.querySelector('svg[width="244"][height="40"], path[fill="#BEBCB7"]')) return true;
    return false;
  }

  // Never remove the search form / site header / top navigation — these are
  // matched by the generic ancestor walker but must never be taken out.
  function isProtected(el) {
    if (!el || !el.closest) return false;
    return !!el.closest('.hz-SearchForm, .hz-Header, .mp-Header, header, nav, .hz-SearchForm-search');
  }

  // Marktplaats is React/Next.js — calling .remove() on nodes React owns throws
  // "Node.removeChild ... not a child" and breaks hydration (React error #418).
  // We NEVER remove; we only HIDE (display:none), which React ignores.
  function removeCard(card, kind, countAsListing) {
    if (isProtected(card)) return;
    try {
      card.style.setProperty('display', 'none', 'important');
      card.setAttribute('data-marktl-blocked', kind || 'true');
      // countAsListing: some cards (Kleinanzeigen.de) are whole listings caught
      // in the DOM, so route them to the "listings were ads" stat instead of
      // the generic DOM counter to avoid double-counting in "Total blocked".
      if (!countAsListing) statsAccum.domRemoved++;
    } catch (e) { /* ignore */ }
  }

  // A card on list view is a <li class="hz-Listing ...">. Return the nearest such
  // list-item above el. We only ever hide whole <li> cards — never generic divs,
  // grids, or the seller-dashboard rows — which is what removed real listings.
  function cardRootFrom(el) {
    var cur = el && el.parentElement ? el : null;
    for (var i = 0; i < 20 && cur && cur !== document.documentElement; i++) {
      if (cur.tagName === 'LI' && /listing|card/i.test(String(cur.className || ''))) {
        return cur;
      }
      cur = cur.parentElement;
    }
    return null;
  }

  var CARD_SELECTOR = 'li[class*="Listing"], li[class*="Card"], li[class*="listing"], li[class*="card"]';

  // Remove empty listing <li> shells left behind after ad data is removed.
  // A short grace period avoids nuking a real card that's still hydrating.
  function sweepEmptyListings(timeoutMs) {
    var empties = document.querySelectorAll('li.hz-Listing, li[class*="Listing"]');
    for (var e = 0; e < empties.length; e++) {
      var el = empties[e];
      if (isProtected(el)) continue;
      // skip anything with real content (link, image, or text)
      var hasContent = el.querySelector('a[href]') || el.querySelector('img[src]') ||
                       (el.textContent || '').trim().length > 0;
      if (hasContent) {
        if (el.__marktlEmptyAt) delete el.__marktlEmptyAt;
        continue;
      }
      if (el.__marktlEmptyAt) {
        if (Date.now() - el.__marktlEmptyAt > timeoutMs) {
          el.__marktlEmptyAt = null;
          el.style.setProperty('display', 'none', 'important');
        }
      } else {
        el.__marktlEmptyAt = Date.now();
      }
    }
  }

  // leboncoin.fr: the native/in-feed ad is a whole <li> card (e.g.
  // <li id="generic" class="styles_ad__mAE6t">) that wraps a liberty iframe
  // (#na3-m) and a "Sponsorisé" skeleton. BANNER_CSS hides the inner
  // [data-liberty-position-name], but React can re-insert the card, so we
  // also hide the whole <li> here (the DOM fallback path).
  function lbcCardRoot(el) {
    for (var i = 0; i < 12 && el && el !== document.documentElement; i++) {
      if (el.tagName === 'LI') return el;
      el = el.parentElement;
    }
    return null;
  }

  function sweepLbcAds() {
    var sources = document.querySelectorAll(
      '[data-liberty-position-name], span[data-spark-component="tag"]'
    );
    for (var i = 0; i < sources.length; i++) {
      var el = sources[i];
      if (el.tagName === 'SPAN' && !/(sponsorisé|sponsor)/i.test(textOf(el))) continue;
      var card = lbcCardRoot(el);
      if (card && !card.__marktlHandled) {
        card.__marktlHandled = true;
        removeCard(card, 'ad');
      }
    }
  }

  var cleanupScheduled = false;
  function cleanup() {
    if (cleanupScheduled) return;
    cleanupScheduled = true;
    setTimeout(function () {
      cleanupScheduled = false;
      if (typeof document.body === 'undefined') return;

      // 1) Ads detected by their admarkt-cdn image source (very reliable).
      if (settings.blockAds) {
        var imgs = document.querySelectorAll('img[src*="admarkt"]');
        for (var i = 0; i < imgs.length; i++) {
          var card = cardRootFrom(imgs[i]);
          if (card && !card.__marktlHandled) { card.__marktlHandled = true; removeCard(card, 'ad'); }
        }
      }

      // 2) Whole listing cards (<li>). Detect ads by item-id prefix or badge,
      //    then apply the title/description filters. Always hide the full card
      //    so no empty <li> shells are left behind.
      var cards = document.querySelectorAll(CARD_SELECTOR);
      for (var k = 0; k < cards.length; k++) {
        var card2 = cards[k];
        if (card2.__marktlHandled) continue;
        var a = card2.querySelector(ITEM_LINK);
        var t = textOf(card2);
        var kind = null;
        if (settings.blockAds && ((a && linkIsAd(a)) || cardLooksLikeAd(card2))) {
          kind = 'ad';
        } else if (settings.blockByTitle && wordMatches(t, settings.titleWords || [])) {
          kind = 'title';
        } else if (settings.blockByDescription && wordMatches(t, settings.descWords || [])) {
          kind = 'description';
        }
        if (kind) { card2.__marktlHandled = true; removeCard(card2, kind); }
      }

      // 3) Static banner ad containers (e.g. #banner-rubrieks-dt inside
      //    .hz-Banner.hz-Banner--fluid). Gated behind the blockAds toggle.
      if (settings.blockAds) {
        var banners = document.querySelectorAll('.hz-Banner, [id^="banner-"], .bannerContainerLoading, .BrandTileBanner, [data-testid="brand-tile-banner"], [id^="premium-content-"], [data-testid="listing-other-seller"], [class*="hz-Listing-other-seller"], [class*="Listing-other-seller"], [id^="skyscraper-container-"], [id^="lht-"], [id^="liberty-"], [data-liberty-position-name], [id^="afs-"], #google_ads, .googleafs, [class*="apn-afs"], [class*="_components_topBannerWithSkinPlaceholder"], [class*="topBanner_topBannerContainer"]');
        for (var b = 0; b < banners.length; b++) {
          if (banners[b].__marktlHandled) continue;
          banners[b].__marktlHandled = true;
          removeCard(banners[b], 'banner');
        }
      }

      // 3b) leboncoin.fr native/in-feed ad cards — hide the whole <li>.
      if (settings.blockAds) {
        sweepLbcAds();
      }

      // 4) Kleinanzeigen (DE) cards. The whole card is the outer
      //    <li data-clickable="card"> (PRO logo/badge/"Anzeige" can sit directly
      //    on it OR inside the inner <article>), so hide the <li>, not the
      //    <article>. Also apply title/description word filters here.
      function processKaCard(card0) {
        if (card0.__marktlHandled) return;
        // Count each card once so the "listings were ads" stat is populated for
        // Kleinanzeigen.de, which is removed purely in the DOM (no data layer).
        if (!card0.__marktlSeen) { card0.__marktlSeen = true; statsAccum.listingsTotal++; }
        var t0 = textOf(card0);
        var kind0 = null;
        if (settings.blockAds && isKleinanzeigenAd(card0)) {
          kind0 = 'ad';
        } else if (settings.blockByTitle && wordMatches(t0, settings.titleWords || [])) {
          kind0 = 'title';
        } else if (settings.blockByDescription && wordMatches(t0, settings.descWords || [])) {
          kind0 = 'description';
        }
        if (kind0) {
          card0.__marktlHandled = true;
          statsAccum.listingsKilled++;
          removeCard(card0, kind0, true);
        }
      }
      if (settings.blockAds || settings.blockByTitle || settings.blockByDescription) {
        var kaCards = document.querySelectorAll('li[data-clickable="card"]');
        for (var m = 0; m < kaCards.length; m++) processKaCard(kaCards[m]);
        // Fallback for <article> cards not wrapped in that <li>.
        var articles = document.querySelectorAll('article[data-adid]');
        for (var n = 0; n < articles.length; n++) {
          var art = articles[n];
          if (art.closest && art.closest('li[data-clickable="card"]')) continue;
          processKaCard(art);
        }
      }

      // 5) Empty listing <li> shells left after ads were removed.
      if (settings.blockAds) {
        sweepEmptyListings(400);
      }
    }, 120);
  }

  var observer = null;
  function startObserver() {
    if (!document.body) return;
    observer = new MutationObserver(function () { cleanup(); });
    observer.observe(document.body, { childList: true, subtree: true });
    cleanup();
  }

  // ---------- SSR __NEXT_DATA__ cleaning ----------
  // The search/home page is server-rendered: the listing data lives in the
  // `#__NEXT_DATA__` JSON that React hydrates from. A client fetch/XHR hook can
  // never see it, so we rewrite it here BEFORE hydration to strip ads/dagtoppers
  // and prevent a flash. Same rules as page.js (duplicated because content
  // scripts run in an isolated world and can't reuse it).
  var SSR_BAD_TRAITS = ['ADMARKT_CONSOLE', 'DAG_TOPPER_7DAYS', 'DAG_TOPPER_3DAYS', 'DAG_TOPPER', 'PROFILE'];
  var SSR_BAD_PRIORITY = ['DAGTOPPER', 'TOPADVERTENTIE'];

  // leboncoin.fr listings are shaped differently: keys are "list_id" and every
  // ad item has an "owner" object. Paid / shop listings sold by a storefront
  // ("owner.type === 'pro'", e.g. a seller with a SIREN) are treated as ads;
  // private sellers ("owner.type === 'private'") are kept.
  function ssrIsLbcAd(item) {
    if (!item || typeof item !== 'object') return false;
    if (settings.blockAds === false) return false;
    var owner = item.owner;
    if (owner && typeof owner === 'object' && owner.type === 'pro') return true;
    // Storefront-reseller markers that only paid shops carry.
    if (typeof item.new_item_price !== 'undefined' && (item.custom_ref || item.stock_quantity)) return true;
    return false;
  }

  // Dispatch to the right detector: leboncoin items carry "owner"/"list_id",
  // everything else uses the Marktplaats-family rules.
  function ssrAd(item) {
    if (item && typeof item === 'object' && ('list_id' in item || 'owner' in item)) {
      return ssrIsLbcAd(item);
    }
    return ssrIsAd(item);
  }

  function isListingsArray(a) {
    return Array.isArray(a) && a.length && a[0] && typeof a[0] === 'object' &&
           ('itemId' in a[0] || 'list_id' in a[0]);
  }

  function ssrIsAd(item) {
    if (!item || typeof item !== 'object') return false;
    if (settings.blockAds !== false) {
      var itemId = String(item.itemId == null ? '?' : item.itemId);
      if (settings.aggressiveIdBlock === true && itemId.charAt(0) === 'a') return true;
      var traits = Array.isArray(item.traits) ? item.traits : [];
      for (var i = 0; i < traits.length; i++) {
        if (SSR_BAD_TRAITS.indexOf(traits[i]) !== -1) return true;
      }
      if (SSR_BAD_PRIORITY.indexOf(item.priorityProduct) !== -1) return true;
      try {
        var pic = (item.picture && item.picture.url) || '';
        if (pic.indexOf('admarkt') !== -1) return true;
        if (JSON.stringify(item).indexOf('admarkt') !== -1) return true;
      } catch (e) { /* ignore */ }
      if (item.trackingData) return true;
      if (item.reserved === true) return true;
    }
    if (settings.blockByTitle) {
      var title = String(item.title || '').toLowerCase();
      var tw = settings.titleWords || [];
      for (var t = 0; t < tw.length; t++) if (title.indexOf(tw[t]) !== -1) return true;
    }
    if (settings.blockByDescription) {
      var dw = settings.descWords || [];
      var fields = ['description', 'categorySpecificDescription'];
      for (var f = 0; f < fields.length; f++) {
        var txt = String(item[fields[f]] || '');
        if (!txt) continue;
        txt = txt.toLowerCase();
        for (var d = 0; d < dw.length; d++) if (txt.indexOf(dw[d]) !== -1) return true;
      }
    }
    var loc = item.location;
    if (loc && typeof loc === 'object') {
      var cities = settings.blockCities || [];
      var countries = settings.blockCountries || [];
      if (cities.length || countries.length) {
        var city = String(loc.cityName || '').toLowerCase();
        var cn = String(loc.countryName || '').toLowerCase();
        var ca = String(loc.countryAbbreviation || '').toLowerCase();
        if (cities.indexOf(city) !== -1 || countries.indexOf(cn) !== -1 || countries.indexOf(ca) !== -1) return true;
      }
    }
    return false;
  }

  // Count itemId-bearing listings the same way ssrNuke walks the payload, used
  // only to report the "N listings were ads (P%)" stat for server-rendered pages.
  function ssrCount(data) {
    var n = 0;
    (function walk(v) {
      if (!v || typeof v !== 'object') return;
      if (Array.isArray(v)) {
        if (isListingsArray(v)) {
          n += v.length;
        } else {
          for (var i = 0; i < v.length; i++) walk(v[i]);
        }
        return;
      }
      for (var key in v) {
        if (Object.prototype.hasOwnProperty.call(v, key)) walk(v[key]);
      }
    })(data);
    return n;
  }

  function ssrNuke(data, depth) {
    depth = depth || 0;
    if (depth > 15 || !data) return 0;
    var killed = 0;
    if (Array.isArray(data)) {
      if (isListingsArray(data)) {
        for (var i = data.length - 1; i >= 0; i--) if (ssrAd(data[i])) { data.splice(i, 1); killed++; }
      } else {
        for (var j = 0; j < data.length; j++) killed += ssrNuke(data[j], depth + 1);
      }
    } else if (data && typeof data === 'object') {
      for (var key in data) {
        if (Object.prototype.hasOwnProperty.call(data, key)) {
          var val = data[key];
          if (isListingsArray(val)) {
            var before = val.length;
            data[key] = val.filter(function (x) { return !ssrAd(x); });
            killed += before - data[key].length;
          } else {
            killed += ssrNuke(val, depth + 1);
          }
        }
      }
    }
    return killed;
  }

  function cleanNextData() {
    try {
      var el = document.getElementById('__NEXT_DATA__');
      if (!el || el.__marktlNextData) return;
      var raw = el.textContent;
      if (!raw) return;
      var data = JSON.parse(raw);
      var total = ssrCount(data);
      var killed = ssrNuke(data);
      el.__marktlNextData = true;
      if (killed > 0) {
        var clean = JSON.stringify(data).replace(/</g, '\\u003c');
        el.textContent = clean;
        try { if (window.__NEXT_DATA__) window.__NEXT_DATA__ = data; } catch (e) { /* ignore */ }
      }
      if (killed > 0) {
        statsAccum.listingsKilled += killed;
        statsAccum.listingsTotal += total;
      }
    } catch (e) { /* not JSON yet, skip */ }
  }

  function initNextDataCleanup() {
    // Run as soon as the script node appears (during head parsing, before the
    // app bundle executes / hydrates) and once more on DOMContentLoaded.
    cleanNextData();
    var obs = new MutationObserver(function () { cleanNextData(); });
    obs.observe(document.documentElement, { childList: true, subtree: true });
    document.addEventListener('DOMContentLoaded', cleanNextData, { once: true });
  }

  // Boot
  // Seed a synchronous default so page.js never sees undefined, then refresh
  // from storage and re-broadcast the real settings via postMessage.
  window.__MARKTPL_SETTINGS__ = Object.assign({}, DEFAULTS);
  loadSettings();
  injectPageScript();
  initNextDataCleanup();
  chrome.storage.onChanged.addListener(function (changes, area) {
    if (area === 'local') loadSettings();
  });

  function boot() {
    // Wait for React/Next hydration to finish before touching the DOM, so we
    // never interfere with React. We only HIDE anyway, but by starting after
    // 'load' we fully avoid hydration mismatches.
    var start = function () { setTimeout(startObserver, 300); };
    if (document.readyState === 'complete') {
      start();
    } else {
      window.addEventListener('load', start, { once: true });
    }
  }
  boot();

  // Re-run after SPA navigations (React removes/readds nodes).
  var lastPath = location.href;
  setInterval(function () {
    if (location.href !== lastPath) {
      lastPath = location.href;
      cleanup();
    }
  }, 800);
})();
