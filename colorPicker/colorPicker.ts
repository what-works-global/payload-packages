import type { Field } from 'payload'

interface ColorPickerFieldArgs {
  name: string
  required?: boolean
}

export const colorPickerField = ({
  name,
  required = false,
}: ColorPickerFieldArgs): Field => {
  return {
    name,
    type: 'text',
    required,
    admin: {
      components: {
        Field: {
          path: 'app/(payload)/fields/colorPicker/ColorPickerField',
        },
        Cell: {
          path: 'app/(payload)/fields/colorPicker/ColorPickerCell',
        },
      },
    },
  }
}
