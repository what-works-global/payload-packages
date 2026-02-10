'use client'

import type { ReactSelectOption } from '@payloadcms/ui'
import type { OptionObject, TextFieldClientComponent, TextFieldClientProps } from 'payload'

import { SelectInput, useConfig, useDocumentInfo, useField, useForm } from '@payloadcms/ui'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import type { SelectSearchRequest } from '../types.js'

import { selectSearchEndpoint } from '../endpointName.js'

const debounceMs = 300

type SelectSearchFieldClientProps = {
  passDataToSearchFunction?: boolean
  passSiblingDataToSearchFunction?: boolean
} & TextFieldClientProps

export const SelectSearchField: TextFieldClientComponent = (props: SelectSearchFieldClientProps) => {
  const { field, path, schemaPath: schemaPathProp } = props

  const { setValue, showError, value } = useField<string | string[]>({
    path,
  })

  const { collectionSlug, globalSlug } = useDocumentInfo()
  const { config } = useConfig()
  const { getData, getSiblingData } = useForm()

  const [options, setOptions] = useState<OptionObject[]>([])

  const [inputValue, setInputValue] = useState('')
  const [remoteError, setRemoteError] = useState<null | string>(null)

  const abortRef = useRef<AbortController | null>(null)

  const entityType = globalSlug ? 'global' : 'collection'
  const slug = globalSlug || collectionSlug

  const schemaPath = schemaPathProp ?? field.name
  const hasMany = field.hasMany ?? false
  const passDataToSearchFunction = props.passDataToSearchFunction === true
  const passSiblingDataToSearchFunction = props.passSiblingDataToSearchFunction === true

  const apiPath = config.routes?.api || '/api'
  const apiRoute = apiPath.startsWith('/') ? apiPath : `/${apiPath}`
  const baseURL = config.serverURL || ''
  const endpointURL = `${baseURL}${apiRoute}${selectSearchEndpoint}`

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

      const payload: SelectSearchRequest = {
        slug,
        entityType,
        query,
        schemaPath,
        selectedValues,
      }

      if (passDataToSearchFunction) {
        payload.data = getData()
      }

      if (passSiblingDataToSearchFunction) {
        payload.siblingData = getSiblingData(path)
      }

      const res = await fetch(endpointURL, {
        body: JSON.stringify(payload),
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
        },
        method: 'POST',
        signal: controller.signal,
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
    [
      endpointURL,
      entityType,
      getData,
      getSiblingData,
      passDataToSearchFunction,
      passSiblingDataToSearchFunction,
      path,
      schemaPath,
      selectedValues,
      slug,
    ],
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
    (option: null | ReactSelectOption | ReactSelectOption[]) => {
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

    return Array.isArray(value) ? '' : (value ?? '')
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
