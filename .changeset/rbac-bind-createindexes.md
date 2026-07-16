---
'@whatworks/payload-rbac': patch
---

Fix `onInit` failing with "`Model.createIndexes()` cannot run without a model as `this`" on the mongoose adapter. The write-conflict retry added in 0.2.2 called the roles-collection index build as a bare, detached function, stripping the `this` mongoose requires; it is now bound to its model.
