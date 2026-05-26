import { useState } from 'react'

type UseMutationResult<I, O> = {
  data: null | O
  error: Error | null
  loading: boolean
  mutate: (variables: I) => Promise<void>
}

type UseMutationOptions<O> = {
  fetchFn?: (url: string, options: RequestInit) => Promise<Response>
  onError?: (error: Error) => void
  onSuccess?: (data: O) => void
}

export function useMutation<I = any, O = any>(
  url: string,
  options?: UseMutationOptions<O>,
): UseMutationResult<I, O> {
  const [data, setData] = useState<null | O>(null)
  const [error, setError] = useState<Error | null>(null)
  const [loading, setLoading] = useState<boolean>(false)

  const mutate = async (data: any) => {
    try {
      setLoading(true)
      const fetchFunction = options?.fetchFn || fetch
      const response = await fetchFunction(url, {
        body: JSON.stringify(data),
        headers: {
          'Content-Type': 'application/json',
        },
        method: 'POST', // or 'PUT', 'DELETE', depending on the mutation type
      })

      if (!response.ok) {
        setLoading(false)
        setError(new Error(`Error: ${response.status} ${response.statusText}`))
        return
      }

      const result: O = await response.json()
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
  }

  return { data, error, loading, mutate }
}
