import type { Payload } from 'payload'

import './DangerBar.scss'

import type { FC } from 'react'

import type { GetEnv } from '../../../types.js'

import { WarningIcon } from '../SwitchEnvButtonClient/icons.js'

export interface DangerBarProps {
  getEnv: GetEnv
  payload: Payload
}

export const DangerBar: FC<DangerBarProps> = async ({ getEnv, payload }) => {
  const env = await getEnv(payload)
  if (env === 'development') {
    return null
  }

  return (
    <div className="danger-bar">
      <WarningIcon className="danger-bar__icon" />
      <span className="danger-bar__text"> You are editing in a production environment</span>
    </div>
  )
}

export default DangerBar
