import { describe, expect, it } from 'vitest'

import { detectRuntime } from '../src/core/runtime.js'

describe('detectRuntime', () => {
  it('recognises the hosts that impose an execution limit', () => {
    expect(detectRuntime({ VERCEL: '1' })).toEqual({ name: 'Vercel', kind: 'serverless' })
    expect(detectRuntime({ AWS_LAMBDA_FUNCTION_NAME: 'fn' })).toEqual({
      name: 'AWS Lambda',
      kind: 'serverless',
    })
    expect(detectRuntime({ K_SERVICE: 'svc' })).toEqual({
      name: 'Google Cloud Functions',
      kind: 'serverless',
    })
  })

  it('names Netlify rather than the Lambda underneath it', () => {
    // Netlify Functions run on Lambda and set both; the user deploys to Netlify.
    expect(detectRuntime({ AWS_LAMBDA_FUNCTION_NAME: 'fn', NETLIFY: 'true' }).name).toBe(
      'Netlify Functions',
    )
  })

  it('treats anything else as an ordinary Node host', () => {
    // A worker container, a VPS, local dev: no limit to work around, and the
    // warning must stay quiet or it is noise on every boot.
    expect(detectRuntime({})).toEqual({ name: null, kind: 'node' })
    expect(detectRuntime({ NODE_ENV: 'production', PATH: '/usr/bin' }).kind).toBe('node')
  })
})
