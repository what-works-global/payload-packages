#!/usr/bin/env node
/* eslint-disable no-console -- printing the result is this file's whole job. */
/**
 * `video-webm-sizes <url> --selector <css>` — measures a slot in a real browser and
 * prints the `sizes` string that describes it, ready to paste into the component.
 *
 * Playwright is loaded dynamically and only here. It is not a dependency of the
 * plugin, and nothing a consumer bundles can reach this file: `sweepSizes` itself
 * takes any page object with the two methods it uses, so a project that already has
 * Playwright (or Puppeteer) in its e2e suite can skip this CLI entirely.
 */

import type { SweepablePage } from '../exports/sizesDevtools.js'

import { fitSizes } from '../core/fitSizes.js'
import { sweepSizes } from '../exports/sizesDevtools.js'

interface Args {
  height: number
  max: number
  min: number
  selector: string
  step: number
  url: string
}

const USAGE = `
video-webm-sizes <url> --selector <css-selector> [options]

  --selector <css>   element to measure (required)
  --min <px>         narrowest viewport to sweep (default 320)
  --max <px>         widest viewport to sweep (default 2560)
  --step <px>        coarse sweep step (default 16; breakpoints are then bisected)
  --height <px>      viewport height held constant (default 900)

Example:
  video-webm-sizes http://localhost:3000/blog --selector "[data-slot=card]"
`.trim()

const parseArgs = (argv: string[]): Args => {
  const positional: string[] = []
  const flags = new Map<string, string>()
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index]
    if (argument.startsWith('--')) {
      flags.set(argument.slice(2), argv[++index] ?? '')
    } else {
      positional.push(argument)
    }
  }

  const url = positional[0]
  const selector = flags.get('selector')
  if (!url || !selector) {
    console.error(USAGE)
    process.exit(1)
  }
  const number = (name: string, fallback: number): number => {
    const raw = flags.get(name)
    return raw === undefined ? fallback : Number(raw)
  }
  return {
    height: number('height', 900),
    max: number('max', 2560),
    min: number('min', 320),
    selector,
    step: number('step', 16),
    url,
  }
}

/** The slice of Playwright this CLI drives, typed locally so it needn't be installed. */
interface PlaywrightLike {
  chromium: {
    launch: () => Promise<{
      close: () => Promise<void>
      newPage: () => Promise<
        { goto: (url: string, options?: { waitUntil?: string }) => Promise<unknown> } & SweepablePage
      >
    }>
  }
}

const loadPlaywright = async (): Promise<PlaywrightLike> => {
  try {
    // Non-literal on purpose: nothing may resolve Playwright at build time.
    const specifier = 'playwright'
    return (await import(specifier)) as PlaywrightLike
  } catch {
    console.error(
      `[payload-video-webm] this command needs Playwright, which the plugin deliberately does not depend on.\n  pnpm add -D playwright && pnpm exec playwright install chromium`,
    )
    return process.exit(1)
  }
}

const main = async (): Promise<void> => {
  const args = parseArgs(process.argv.slice(2))
  const { chromium } = await loadPlaywright()
  const browser = await chromium.launch()

  try {
    const page = await browser.newPage()
    await page.goto(args.url, { waitUntil: 'networkidle' })
    const samples = await sweepSizes(page, args.selector, args)
    const { clauses, plateaus, sizes } = fitSizes(samples)

    console.log(
      `\nsweeping ${args.min} → ${args.max}px … ${samples.length} samples, ${clauses.length} segment${clauses.length === 1 ? '' : 's'} found\n`,
    )
    console.log(`  ${sizes}\n`)
    for (const plateau of plateaus) {
      console.log(
        `⚠ ${plateau}px is a max-width plateau, not a media query — easy to miss by hand.`,
      )
    }
  } finally {
    await browser.close()
  }
}

await main()
