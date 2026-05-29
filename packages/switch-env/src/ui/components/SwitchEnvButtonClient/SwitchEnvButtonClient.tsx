'use client'
import { Button, CheckboxInput, Modal, toast, Tooltip, useConfig, useModal } from '@payloadcms/ui'
import { useRouter } from 'next/navigation'
import { formatAdminURL } from 'payload/shared'
import { type FC, useEffect, useRef, useState } from 'react'

import './SwitchEnvButtonClient.scss'

import type {
  SwitchEndpointInput,
  SwitchEndpointOutput,
} from '../../../lib/api-endpoints/switch.js'
import type { Env, QuickSwitchArgs } from '../../../types.js'

import { useMutation } from '../../hooks/useMutation.js'
import { InfoIcon, LoadingSpinnerIcon, SwitchIcon } from './icons.js'

const baseClass = 'switch-env'

export interface SwitchEnvButtonClientProps {
  env: Env
  quickSwitch: QuickSwitchArgs
}

export const SwitchEnvButtonClient: FC<SwitchEnvButtonClientProps> = ({ env, quickSwitch }) => {
  const {
    config: {
      routes: { api: apiRoute },
      serverURL,
    },
  } = useConfig()

  const { closeModal, openModal } = useModal()
  const router = useRouter()
  const hasRefreshed = useRef(false)
  const [buttonLoading, setButtonLoading] = useState(false)

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!hasRefreshed.current) {
      hasRefreshed.current = true
      closeModal('switch-env')
      setButtonLoading(false)
    }
  })

  // Use formatAdminURL so the request honours a Next.js `basePath` (it prepends
  // `process.env.NEXT_BASE_PATH`); a hand-built `${serverURL}${apiRoute}` URL drops it.
  const url = formatAdminURL({ apiRoute, path: '/switch-env', serverURL })
  const { mutate } = useMutation<SwitchEndpointInput, SwitchEndpointOutput>(url, {
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
  const targetEnv = env === 'production' ? 'Development' : 'Production'
  const [copyDatabase, setCopyDatabase] = useState(
    quickSwitch ? quickSwitch.overwriteDevelopmentDatabase : false,
  )
  const [showCopyDatabaseTooltip, setShowCopyDatabaseTooltip] = useState(false)

  return (
    <div className={`${baseClass}`}>
      <button
        className={`${baseClass}__btn-switch`}
        onClick={() => {
          if (quickSwitch) {
            void mutate({
              copyDatabase,
            })
            setButtonLoading(true)
          } else {
            openModal('switch-env')
          }
        }}
        type="button"
      >
        {buttonLoading && quickSwitch ? (
          <LoadingSpinnerIcon />
        ) : (
          <SwitchIcon className={`${baseClass}__btn-switch__icon`} />
        )}
      </button>
      <Modal className={`${baseClass}__modal`} slug="switch-env">
        <button
          aria-label="Close"
          className={`${baseClass}__modal-close`}
          onClick={() => closeModal('switch-env')}
          type="button"
        />
        <div className={`${baseClass}__modal-content`}>
          <h4>Switch to {targetEnv}</h4>
          {targetEnv == 'Development' && (
            <div className={`${baseClass}__modal-content-checkbox-wrapper`}>
              <div className={`${baseClass}__modal-content-checkbox-wrapper-icon-wrapper`}>
                <CheckboxInput
                  checked={copyDatabase}
                  id="copy-database"
                  label="Copy database?"
                  name="copy-database"
                  onToggle={() => setCopyDatabase(!copyDatabase)}
                />
                <div className={`${baseClass}__modal-content-checkbox-wrapper-icon-tooltip`}>
                  <InfoIcon
                    height="20"
                    onMouseEnter={() => setShowCopyDatabaseTooltip(true)}
                    onMouseLeave={() => setShowCopyDatabaseTooltip(false)}
                    width="20"
                  />
                  <Tooltip show={showCopyDatabaseTooltip}>
                    This will overwrite your local database with the production database
                  </Tooltip>
                </div>
              </div>
            </div>
          )}
          <Button
            onClick={() => {
              void mutate({
                copyDatabase,
              })
              setButtonLoading(true)
            }}
          >
            {buttonLoading ? <LoadingSpinnerIcon /> : 'Switch'}
          </Button>
        </div>
      </Modal>
    </div>
  )
}
