---
'@whatworks/payload-select-search-field': minor
---

Add `relation` arg to `selectSearchField`. When provided, the field is stored as a Payload `relationship` instead of a `text` field, so list-view cells render the related document's title (via the default relationship cell) and existing data from a prior `relationship` field stays compatible.

Honor `readOnly` in the client component so field-level access rules (e.g. `access: { update: () => false }`) actually disable the input.
