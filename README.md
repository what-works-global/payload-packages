# Whatworks Payload Packages

<a href="https://whatworks.com.au/?utm_source=github.com">
  <picture>
    <source media="(prefers-color-scheme: light)" srcset="./assets/blackbanner.svg">
    <img alt="Whatworks Payload Packages" src="./assets/whitebanner.svg">
  </picture>
</a>

&nbsp;

A monorepo of [Payload CMS](https://payloadcms.com) plugins, fields, and utilities published under the `@whatworks` scope.

## Packages

| Package <img width="185" height="1" alt="">             | Description                                                                                                                                   |
| ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| [`activity-log`](./packages/activity-log)               | Chronological activity feed for the whole CMS — who did what, when, across collections and globals.                                           |
| [`algolia-search`](./packages/algolia-search)           | Draft-aware Algolia sync with best-effort record extraction, admin reindex buttons, and settings as code.                                     |
| [`audit-fields`](./packages/audit-fields)               | Track `createdBy`/`lastModifiedBy` on every collection and global, with a per-version "Modified By" column.                                   |
| [`block-settings`](./packages/block-settings)           | Hide extra fields for blocks behind a visibility toggle button.                                                                               |
| [`heading-field`](./packages/heading-field)             | Let editors choose the rendered heading tag (`h1`–`h6`) for a text, textarea, or richText field.                                              |
| [`rbac`](./packages/rbac)                               | Database-backed role-based access control with a CRUD permissions matrix, privilege-escalation protection, and a locked admin role.           |
| [`redirects`](./packages/redirects)                     | Managed redirects with a cache-backed Next.js middleware matcher — match types + regex, query forwarding, loop-safe chains, and hit tracking. |
| [`select-search-field`](./packages/select-search-field) | Server-backed search select field and plugin for Payload.                                                                                     |
| [`sitemap`](./packages/sitemap)                         | Chunked, lazily cached XML sitemaps with hook-driven invalidation and robots.txt helpers.                                                     |
| [`switch-env`](./packages/switch-env)                   | Switch a running admin between production and development databases, or copy prod-to-dev.                                                     |
| [`utilities`](./packages/payload-utilities)             | A collection of utilities for Payload 3.0.                                                                                                    |
| [`analytics`](./packages/analytics)                     | Analytics components for Next.js with cookie consent.                                                                                         |
