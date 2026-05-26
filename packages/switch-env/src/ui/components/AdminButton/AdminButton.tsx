import type { Payload } from 'payload'
import type { FC } from 'react'

import type { ButtonMode, GetEnv, QuickSwitchArgs } from '../../../types.js'

import { CopyDbButtonClient } from '../CopyDbButtonClient/CopyDbButtonClient.js'
import { SwitchEnvButtonClient } from '../SwitchEnvButtonClient/SwitchEnvButtonClient.js'

export type AdminButtonProps = {
  getEnv: GetEnv
  mode: ButtonMode
  payload: Payload
  quickSwitch: QuickSwitchArgs
}

export const AdminButton: FC<AdminButtonProps> = async ({ getEnv, mode, payload, quickSwitch }) => {
  const env = await getEnv(payload)
  if (mode === 'copy') {
    if (env === 'production') {
      // If we somehow got into production mode, don't show the button
      return null
    } else {
      return <CopyDbButtonClient />
    }
  }
  return <SwitchEnvButtonClient env={env} quickSwitch={quickSwitch} />
}

export default AdminButton
