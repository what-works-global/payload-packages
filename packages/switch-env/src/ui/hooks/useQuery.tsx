import { useCallback, useEffect, useState } from 'react'

type UseQueryResult<T> = {
  data: null | T
  error: Error | null
  loading: boolean
  refetch: () => Promise<void>
}

type UseQueryOptions<T> = {
  fetchFn?: (url: string) => Promise<Response>
  onError?: (error: Error) => void
  onSuccess?: (data: T) => void
}

export function useQuery<T>(url: string, options?: UseQueryOptions<T>): UseQueryResult<T> {
  const [data, setData] = useState<null | T>(null)
  const [error, setError] = useState<Error | null>(null)
  const [loading, setLoading] = useState<boolean>(true)

  const fetchData = useCallback(async () => {
    try {
      setLoading(true)
      const fetchFunction = options?.fetchFn || fetch
      const response = await fetchFunction(url)
      if (!response.ok) {
        throw new Error(`Error: ${response.status} ${response.statusText}`)
      }
      const result: T = await response.json()
      setData(result)
      if (options?.onSuccess) {
        options.onSuccess(result)
      }
    } catch (err) {
      const errorObj = err as Error
      setError(errorObj)
      if (options?.onError) {
        options.onError(errorObj)
      }
    } finally {
      setLoading(false)
    }
  }, [url, options])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  const refetch = useCallback(async () => {
    await fetchData()
  }, [fetchData])

  return { data, error, loading, refetch }
}
