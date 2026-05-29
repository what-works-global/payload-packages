'use client'
import { Button, Modal, toast, useConfig, useModal } from '@payloadcms/ui'
import { useRouter } from 'next/navigation'
import { formatAdminURL } from 'payload/shared'
import { type FC, useEffect, useRef, useState } from 'react'

import './CopyDbButtonClient.scss'

import type { CopyEndpointInput, CopyEndpointOutput } from '../../../lib/api-endpoints/copy.js'

import { useMutation } from '../../hooks/useMutation.js'
import { LoadingSpinnerIcon } from '../SwitchEnvButtonClient/icons.js'
import { CopyIcon } from './icons.js'

const baseClass = 'copy-db'

export type CopyDbButtonClientProps = Record<string, never>

export const CopyDbButtonClient: FC<CopyDbButtonClientProps> = () => {
  const {
    config: {
      routes: { api: apiRoute },
      serverURL,
    },
  } = useConfig()

  const router = useRouter()
  const hasRefreshed = useRef(false)
  const [buttonLoading, setButtonLoading] = useState(false)

  const { closeModal, openModal } = useModal()

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!hasRefreshed.current) {
      hasRefreshed.current = true
      closeModal('copy-db')
      setButtonLoading(false)
    }
  })

  // Use formatAdminURL so the request honours a Next.js `basePath` (it prepends
  // `process.env.NEXT_BASE_PATH`); a hand-built `${serverURL}${apiRoute}` URL drops it.
  const url = formatAdminURL({ apiRoute, path: '/copy-db', serverURL })
  const { mutate } = useMutation<CopyEndpointInput, CopyEndpointOutput>(url, {
    onError: (error) => {
      const message = error?.message || 'An unknown error occurred'
      toast.error(message)
      setButtonLoading(false)
    },
    onSuccess: (data) => {
      if (data.success) {
        setTimeout(() => {
          router.refresh()
          hasRefreshed.current = false
        }, 10)
      }
    },
  })

  return (
    <div className={`${baseClass}`}>
      <button
        className={`${baseClass}__btn-copy`}
        onClick={() => openModal('copy-db')}
        type="button"
      >
        {buttonLoading ? (
          <LoadingSpinnerIcon />
        ) : (
          <CopyIcon className={`${baseClass}__btn-copy__icon`} />
        )}
      </button>
      <Modal className={`${baseClass}__modal`} slug="copy-db">
        <button
          aria-label="Close"
          className={`${baseClass}__modal-close`}
          onClick={() => closeModal('copy-db')}
          type="button"
        />
        <div className={`${baseClass}__modal-content`}>
          <h4>Overwrite local database with production?</h4>
          <p className={`${baseClass}__modal-content__description`}>
            The local database is whatever the <code>url</code> is in <code>developmentArgs</code>{' '}
            in the plugin config.
          </p>
          <Button
            onClick={() => {
              void mutate({})
              setButtonLoading(true)
            }}
          >
            {buttonLoading ? <LoadingSpinnerIcon /> : 'Copy & Overwrite'}
          </Button>
        </div>
      </Modal>
    </div>
  )
}
