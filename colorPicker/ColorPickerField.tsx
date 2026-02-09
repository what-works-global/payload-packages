'use client'
import { Button, FieldLabel, useField, usePreferences } from '@payloadcms/ui'
import type { TextFieldServerComponent, Validate } from 'payload'
import { useCallback, useEffect, useState } from 'react'
import './ColorPickerField.scss'

const defaultColors = ['#E90028']

const baseClass = 'custom-color-picker'
const preferenceKey = 'color-picker-colors'

const ColorPickerField: TextFieldServerComponent = ({ field, ...props }) => {
  const {
    value = '',
    setValue,
    errorMessage,
    showError,
  } = useField({
    path: props.path,
    validate: validateHexColor,
  })

  const { getPreference, setPreference } = usePreferences()
  const [colorOptions, setColorOptions] = useState(defaultColors)
  const [isAdding, setIsAdding] = useState(false)
  const [colorToAdd, setColorToAdd] = useState('')

  const handleAddColor = useCallback(() => {
    setIsAdding(false)
    setValue(colorToAdd)

    // prevent adding duplicates
    if (colorOptions.indexOf(colorToAdd) > -1) return

    let newOptions = colorOptions
    newOptions.unshift(colorToAdd)

    // update state with new colors
    setColorOptions(newOptions)
    // store the user color preferences for future use
    setPreference(preferenceKey, newOptions)
  }, [colorOptions, setPreference, colorToAdd, setIsAdding, setValue])

  useEffect(() => {
    const mergeColorsFromPreferences = async () => {
      const colorPreferences = await getPreference<string[]>(preferenceKey)
      if (colorPreferences) {
        setColorOptions(colorPreferences)
      }
    }
    mergeColorsFromPreferences()
  }, [getPreference, setColorOptions])

  const classes = ['field-type', 'text', baseClass, showError && 'error']
    .filter(Boolean)
    .join(' ')

  return (
    <div className={classes}>
      <FieldLabel
        htmlFor={props.path}
        label={field.label as string}
        required={field.required}
      />

      {isAdding ? (
        <div>
          <input
            className={`${baseClass}__input`}
            type="text"
            placeholder="#000000"
            onChange={(e) => setColorToAdd(e.target.value)}
            value={colorToAdd}
          />
          <div className={`${baseClass}__btn-wrap`}>
            <Button
              className={`${baseClass}__btn`}
              buttonStyle="primary"
              iconPosition="left"
              iconStyle="with-border"
              size="small"
              onClick={handleAddColor}
              disabled={validateHexColor(colorToAdd, {} as any) !== true}
            >
              Add
            </Button>
            <Button
              className={`${baseClass}__btn`}
              buttonStyle="secondary"
              iconPosition="left"
              iconStyle="with-border"
              size="small"
              onClick={() => setIsAdding(false)}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <>
          <ul className={`${baseClass}__colors ${showError ? 'error' : ''}`}>
            {colorOptions.map((color, i) => (
              <li key={i}>
                <button
                  type="button"
                  key={color}
                  className={`chip ${color === value ? 'chip--selected' : ''} chip--clickable`}
                  style={{ backgroundColor: color }}
                  aria-label={color}
                  onClick={() => setValue(color)}
                />
              </li>
            ))}
            <li>
              <Button
                className={`${baseClass}__btn-add-color`}
                icon="plus"
                buttonStyle="icon-label"
                iconPosition="left"
                iconStyle="with-border"
                onClick={() => {
                  setIsAdding(true)
                  setValue('')
                }}
              />
            </li>
          </ul>
        </>
      )}
    </div>
  )
}

export default ColorPickerField

const validateHexColor: Validate<string> = (value) => {
  if (value !== null && value !== undefined) {
    return value.match(/^#(?:[0-9a-fA-F]{3}){1,2}$/)
      ? true
      : `${value} is not a valid hex color`
  }
  return 'Not a valid hex color'
}
