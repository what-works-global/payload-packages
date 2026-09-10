/** Human wording for the reasons the job records when it doesn't store a preset. */
export const SKIP_LABEL: Record<string, string> = {
  'duplicate-size': 'same size as another rendition',
  'exceeds-budget': 'too long for one run',
  'output-larger': 'larger than source',
  'source-smaller': 'source too small',
}

export interface SkippedRow {
  preset: string
  skippedReason: null | string
}

/** "a", "a and b", "a, b and c" */
const listPhrase = (names: string[]): string =>
  names.length <= 1
    ? (names[0] ?? '')
    : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`

/**
 * One line naming the presets that were deliberately not stored, grouped by reason.
 * The renditions table only lists files that exist — a row reading "larger than
 * source" looks like a failure — but saying nothing at all would leave an editor
 * wondering where a configured preset went, so the reason survives as a footnote.
 *
 * Returns `null` when there is nothing to explain.
 */
export const summariseSkipped = (
  rows: SkippedRow[],
  presetLabels?: Record<string, string>,
): null | string => {
  const byReason = new Map<string, string[]>()
  for (const row of rows) {
    const reason = SKIP_LABEL[row.skippedReason ?? ''] ?? row.skippedReason ?? 'not stored'
    byReason.set(reason, [
      ...(byReason.get(reason) ?? []),
      presetLabels?.[row.preset] ?? row.preset,
    ])
  }
  if (byReason.size === 0) {
    return null
  }
  return [...byReason.entries()]
    .map(([reason, names]) => `${listPhrase(names)}: ${reason}`)
    .join(' · ')
}
