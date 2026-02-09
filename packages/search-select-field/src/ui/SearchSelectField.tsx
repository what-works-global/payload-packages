'use client'

import type { OptionObject, TextFieldClientComponent } from 'payload'
import type { ReactSelectOption } from '@payloadcms/ui'
import { SelectInput, useConfig, useDocumentInfo, useField } from '@payloadcms/ui'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { searchSelectEndpoint } from '../endpointName.js'

const debounceMs = 300

export const SearchSelectField: TextFieldClientComponent = (props) => {
  const { field, path, schemaPath: schemaPathProp } = props

  const { value, setValue, showError } = useField<string | string[]>({
    path,
  })

  const { collectionSlug, globalSlug } = useDocumentInfo()
  const { config } = useConfig()

  const [options, setOptions] = useState<OptionObject[]>([])

  const [inputValue, setInputValue] = useState('')
  const [remoteError, setRemoteError] = useState<string | null>(null)

  const abortRef = useRef<AbortController | null>(null)

  const entityType = globalSlug ? 'global' : 'collection'
  const slug = globalSlug || collectionSlug

  const schemaPath = schemaPathProp ?? field.name
  const hasMany = field.hasMany ?? false

  const apiPath = config.routes?.api || '/api'
  const apiRoute = apiPath.startsWith('/') ? apiPath : `/${apiPath}`
  const baseURL = config.serverURL || ''
  const endpointURL = `${baseURL}${apiRoute}${searchSelectEndpoint}`

  const selectedValues = useMemo(() => {
    if (hasMany) {
      return Array.isArray(value) ? value.map((entry) => String(entry)) : []
    }

    if (Array.isArray(value) || value === null || value === undefined) {
      return []
    }

    return [String(value)]
  }, [hasMany, value])

  const fetchOptions = useCallback(
    async (query: string) => {
      if (!slug || !schemaPath) {
        setOptions([])
        return
      }

      if (abortRef.current) {
        abortRef.current.abort()
      }

      const controller = new AbortController()
      abortRef.current = controller

      setRemoteError(null)

      const res = await fetch(endpointURL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        signal: controller.signal,
        body: JSON.stringify({
          entityType,
          slug,
          schemaPath,
          query,
          selectedValues,
        }),
      })

      if (!res.ok) {
        const errorBody = await res.json().catch(() => null)
        const message = errorBody?.error || 'Failed to fetch options'
        setRemoteError(message)
        setOptions([])
        return
      }

      const data = (await res.json()) as { options?: OptionObject[] }
      setOptions(Array.isArray(data.options) ? data.options : [])
    },
    [endpointURL, entityType, schemaPath, selectedValues, slug],
  )

  useEffect(() => {
    if (!slug || !schemaPath) {
      return
    }

    const timeout = setTimeout(() => {
      void fetchOptions(inputValue)
    }, debounceMs)

    return () => {
      clearTimeout(timeout)
    }
  }, [fetchOptions, inputValue, schemaPath, slug])

  useEffect(() => {
    return () => {
      if (abortRef.current) {
        abortRef.current.abort()
      }
    }
  }, [])

  const handleChange = useCallback(
    (option: ReactSelectOption | ReactSelectOption[] | null) => {
      if (Array.isArray(option)) {
        const values = option.map((entry) => String(entry.value))
        setValue(values)
        return
      }

      if (!option) {
        setValue(hasMany ? [] : null)
        return
      }

      setValue(String(option.value))
    },
    [hasMany, setValue],
  )

  const description = useMemo(() => {
    if (remoteError) {
      return remoteError
    }

    return field.admin?.description
  }, [field.admin?.description, remoteError])

  const selectValue = useMemo(() => {
    if (hasMany) {
      return Array.isArray(value) ? value : []
    }

    return Array.isArray(value) ? '' : value ?? ''
  }, [hasMany, value])

  return (
    <SelectInput
      description={description}
      hasMany={hasMany}
      label={field.label as string}
      localized={field.localized}
      name={field.name}
      onChange={handleChange as (value: ReactSelectOption | ReactSelectOption[]) => void}
      onInputChange={setInputValue}
      options={options}
      path={path}
      required={field.required}
      showError={showError}
      value={selectValue}
    />
  )
}
