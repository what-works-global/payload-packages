import type { EmailAdapter, SendEmailOptions } from 'payload'

export const testEmailAdapter: EmailAdapter<void> = ({ payload }) => ({
  name: 'test-email-adapter',
  defaultFromAddress: 'dev@payloadcms.com',
  defaultFromName: 'Payload Test',
  sendEmail: async (message) => {
    const stringifiedTo = getStringifiedToAddress(message)
    const res = `Test email to: '${stringifiedTo}', Subject: '${message.subject}'`
    payload.logger.info({ content: message, msg: res })
    return Promise.resolve()
  },
})

function getStringifiedToAddress(message: SendEmailOptions): string | undefined {
  if (typeof message.to === 'string') {
    return message.to
  }
  if (Array.isArray(message.to)) {
    return message.to
      .map((to: { address: string } | string) => {
        if (typeof to === 'string') {
          return to
        }
        return to.address ?? ''
      })
      .join(', ')
  }
  return message.to?.address
}
