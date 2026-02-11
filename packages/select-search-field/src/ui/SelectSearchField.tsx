'use client'

import type { ReactSelectOption } from '@payloadcms/ui'
import type { OptionObject, TextFieldClientComponent, TextFieldClientProps } from 'payload'

import {
  SelectInput,
  useConfig,
  useDocumentInfo,
  useField,
  useForm,
  useFormFields,
} from '@payloadcms/ui'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import type { SelectSearchRequest } from '../types.js'

import { selectSearchEndpoint } from '../endpointName.js'

const defaultQueryDebounceMs = 300
const defaultWatchedFieldsDebounceMs = 700

const serializeRefetchValue = (value: unknown): string => {
  try {
    return JSON.stringify(value) ?? ''
  } catch {
    return ''
  }
}

const isAbortError = (error: unknown): boolean => {
  return (
    typeof error === 'object' &&
    error !== null &&
    'name' in error &&
    error.name === 'AbortError'
  )
}

type SelectSearchFieldClientProps = {
  debounce?: {
    query?: number
    watchedFields?: number
  }
  passDataToSearchFunction?: boolean
  passSiblingDataToSearchFunction?: boolean
  watchFieldPaths?: string[]
} & TextFieldClientProps

export const SelectSearchField: TextFieldClientComponent = (
  props: SelectSearchFieldClientProps,
) => {
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
  const fetchOptionsRef = useRef<((query: string) => Promise<void>) | null>(null)
  const latestInputValueRef = useRef('')
  const hasInitializedWatchedFieldsEffectRef = useRef(false)

  const entityType = globalSlug ? 'global' : 'collection'
  const slug = globalSlug || collectionSlug

  const schemaPath = schemaPathProp ?? field.name
  const hasMany = field.hasMany ?? false
  const passDataToSearchFunction = props.passDataToSearchFunction === true
  const passSiblingDataToSearchFunction = props.passSiblingDataToSearchFunction === true
  // `selectSearch` normalizes these values before passing to `clientProps`.
  const queryDebounceMs = props.debounce?.query ?? defaultQueryDebounceMs
  const watchedFieldsDebounceMs = props.debounce?.watchedFields ?? defaultWatchedFieldsDebounceMs
  const watchFieldPaths = props.watchFieldPaths ?? []

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

  const watchedFieldPathsRefetchToken = useFormFields(([fields]) => {
    if (watchFieldPaths.length === 0) {
      return ''
    }

    const watchedPathValues: Array<[string, unknown]> = []

    for (const watchPath of watchFieldPaths) {
      if (!Object.prototype.hasOwnProperty.call(fields, watchPath)) {
        continue
      }

      watchedPathValues.push([watchPath, fields[watchPath]?.value])
    }

    return serializeRefetchValue(watchedPathValues)
  })

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

      try {
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
      } catch (error) {
        if (isAbortError(error)) {
          return
        }

        const message = error instanceof Error ? error.message : 'Failed to fetch options'
        setRemoteError(message)
        setOptions([])
      }
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
    fetchOptionsRef.current = fetchOptions
  }, [fetchOptions])

  useEffect(() => {
    latestInputValueRef.current = inputValue
  }, [inputValue])

  useEffect(() => {
    if (!slug || !schemaPath) {
      return
    }

    // Query typing should feel responsive, so use a shorter debounce.
    const timeout = setTimeout(() => {
      void fetchOptionsRef.current?.(inputValue)
    }, queryDebounceMs)

    return () => {
      clearTimeout(timeout)
    }
  }, [inputValue, queryDebounceMs, schemaPath, slug])

  useEffect(() => {
    if (!slug || !schemaPath || watchFieldPaths.length === 0) {
      return
    }

    if (!hasInitializedWatchedFieldsEffectRef.current) {
      hasInitializedWatchedFieldsEffectRef.current = true
      return
    }

    // Watched field changes can happen in bursts, so use a longer debounce.
    const timeout = setTimeout(() => {
      void fetchOptionsRef.current?.(latestInputValueRef.current)
    }, watchedFieldsDebounceMs)

    return () => {
      clearTimeout(timeout)
    }
  }, [schemaPath, slug, watchFieldPaths.length, watchedFieldsDebounceMs, watchedFieldPathsRefetchToken])

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
