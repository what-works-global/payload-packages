/** Humanizes a slug, e.g. `'site-settings'` → `'Site Settings'`. */
const humanizeSlug = (slug: string): string => {
  return slug
    .split(/[-_]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}

/**
 * Resolves a display label for a collection or global at plugin time. Matrix rows
 * cross to the client as serialized props, so only plain-string labels can be used —
 * localized objects and label functions fall back to the humanized slug.
 */
export const entityLabel = (label: unknown, slug: string): string => {
  return typeof label === 'string' && label.trim() !== '' ? label : humanizeSlug(slug)
}
