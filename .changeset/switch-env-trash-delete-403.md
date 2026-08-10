---
'@whatworks/payload-switch-env': patch
---

fix(switch-env): stop the development upload guard denying trash deletes with a bare 403

In development mode the plugin's upload-collection `update`/`delete` access read `createdDuringDevelopment` off the **incoming request body**, and only fell back to the stored documents when there was no body at all. Payload sends partial bodies for some writes — on a collection with `trash: true` the admin's delete button is a `PATCH { deletedAt }` and nothing else — so the flag was absent, `!!undefined` denied the write, and every trash delete (single and bulk) failed with an unexplained 403 even though the documents were created in development and their files live under the development prefix.

The stored flag is now the authoritative signal: the targeted documents are resolved whenever the request identifies any, and the incoming body is consulted only for id-less bulk writes that name nothing to look up. Alongside that:

- the document lookup passes `trash: true`, so an already-trashed production document can no longer be permanently deleted through the gap left by payload's default exclusion of trashed rows;
- document ids are collected from `id` and `where[…][id][…]` query params specifically, instead of any key containing the substring "id" — `where[videoId][equals]=abc` no longer feeds `abc` into an `id in (…)` lookup that a numeric-id database rejects;
- refusals throw a public `403` rather than a default `500`, so the guard's explanation reaches the admin panel instead of only the server log.
