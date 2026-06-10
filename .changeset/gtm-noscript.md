---
'@whatworks/analytics': patch
---

`GoogleTagManager` now renders the GTM `<noscript>` `ns.html` iframe fallback (gated on granted consent) for clients with JavaScript disabled.