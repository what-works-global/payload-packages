import type { FieldHook, GroupField, SelectField } from 'payload'

import type { HeadingFieldConfig, HeadingTag, HeadingValueField } from '../types.js'

import {
  ALL_HEADING_TAGS,
  DEFAULT_HEADING_TAG,
  DEFAULT_HEADING_TAGS,
  HEADING_FIELD_CUSTOM_KEY,
  HEADING_TAG_FIELD_NAME,
  HEADING_TAGS_CUSTOM_KEY,
  HEADING_TOOLTIP_CUSTOM_KEY,
  HEADING_VALUE_FIELD_NAME,
  normalizeHeadingValue,
} from '../shared.js'

type NamedGroupField = Extract<GroupField, { name: string }>

const fieldComponentPath = '@whatworks/payload-heading-field/client#HeadingGroupField'

const normalizeTags = (tags: readonly HeadingTag[] | undefined): HeadingTag[] => {
  const candidate = tags && tags.length > 0 ? tags : DEFAULT_HEADING_TAGS
  const seen = new Set<HeadingTag>()

  for (const tag of candidate) {
    if (!(ALL_HEADING_TAGS as readonly string[]).includes(tag)) {
      throw new Error(
        `headingField: invalid tag "${String(tag)}". Expected one of ${ALL_HEADING_TAGS.join(', ')}.`,
      )
    }

    seen.add(tag)
  }

  return [...seen]
}

/**
 * Wraps a text / textarea / rich text field in a group that also stores the
 * heading tag the content editor selected. The group is rendered as a single,
 * normal-looking field with a small inline tag dropdown beside its label —
 * never as a default Payload group.
 *
 * Stored shape: `{ tag: HeadingTag, value: <field value> }` under `field.name`.
 *
 * @param field - The text / textarea / rich text field to wrap. Pass your
 *   existing field object here to adopt the heading tag with a one-line change.
 * @param config - Optional tag/default/tooltip overrides. Omit for the defaults.
 */
export const headingField = (
  field: HeadingValueField,
  config?: HeadingFieldConfig,
): NamedGroupField => {
  if (!('name' in field) || typeof field.name !== 'string' || field.name.length === 0) {
    throw new Error('headingField: `field` must be a named field (it needs a `name`).')
  }

  const tags = normalizeTags(config?.tags)
  const defaultTag = config?.defaultTag ?? DEFAULT_HEADING_TAG

  if (!tags.includes(defaultTag)) {
    throw new Error(
      `headingField: defaultTag "${defaultTag}" is not included in tags [${tags.join(', ')}].`,
    )
  }

  const { name, admin: fieldAdmin, label: fieldLabel, ...valueFieldRest } = field

  // The group's custom Field component renders the label itself (beside the tag
  // dropdown), so the consumer's custom `Label` is lifted out of the value field
  // and onto the group. Everything else (Description, Before/AfterInput, a custom
  // value Field, etc.) stays with the value field, where it renders normally.
  const { components: fieldComponents, ...valueAdminRest } = fieldAdmin ?? {}
  const { Label: labelComponent, ...valueComponents } = fieldComponents ?? {}

  // Payload types `Label` components per field type, so a text/textarea/richText
  // Label is not structurally a group Label. Lifting it onto the group is a
  // deliberate bridge — the rendered node is field-type agnostic at runtime.
  const groupComponents = {
    Field: fieldComponentPath,
    // Forward the consumer's custom Label so it renders in the header, beside
    // the tag dropdown, in place of the default field label.
    ...(labelComponent ? { Label: labelComponent } : {}),
  } as NonNullable<NamedGroupField['admin']>['components']

  // The tag lives in the group schema (so it is saved and typed), but it is
  // never rendered through `RenderFields` — the group's custom Field component
  // renders its own compact dropdown bound to this path instead.
  const tagField: SelectField = {
    name: HEADING_TAG_FIELD_NAME,
    type: 'select',
    defaultValue: defaultTag,
    options: tags.map((tag) => ({ label: tag.toUpperCase(), value: tag })),
    required: true,
  }

  const valueField = {
    ...valueFieldRest,
    name: HEADING_VALUE_FIELD_NAME,
    admin: { ...valueAdminRest, components: valueComponents },
    // The label is rendered by the group's custom Field component alongside the
    // tag dropdown, so the inner value field stays label-less.
    label: false as const,
  } as { name: typeof HEADING_VALUE_FIELD_NAME } & typeof field

  // Backwards compatibility: a document saved before `field` was wrapped in
  // `headingField()` holds the raw value (string / Lexical state) directly under
  // `name`, not a `{ tag, value }` group. Coerce it into the group shape so
  // pre-existing data keeps loading instead of being dropped (afterRead) or
  // failing the required-`tag` validation (beforeValidate). Both hooks run
  // before Payload descends into the sub-fields, and the first save through the
  // admin then persists the canonical shape — a transparent, lazy migration.
  const coerceLegacyHeadingValue: FieldHook = ({ value }) =>
    normalizeHeadingValue(value, defaultTag)

  return {
    name,
    type: 'group',
    admin: {
      components: groupComponents,
      custom: {
        [HEADING_FIELD_CUSTOM_KEY]: true,
        [HEADING_TAGS_CUSTOM_KEY]: tags,
        ...(config?.tooltip ? { [HEADING_TOOLTIP_CUSTOM_KEY]: config.tooltip } : {}),
      },
    },
    fields: [tagField, valueField],
    hooks: {
      afterRead: [coerceLegacyHeadingValue],
      beforeValidate: [coerceLegacyHeadingValue],
    },
    // Drive the rendered label from the original field's label (or its name).
    label: fieldLabel ?? undefined,
  }
}
