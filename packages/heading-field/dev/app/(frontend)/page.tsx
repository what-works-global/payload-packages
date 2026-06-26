import type { ReactNode } from 'react'

import config from '@payload-config'
import { RenderHeading } from '@whatworks/payload-heading-field/rsc'
import { getPayload } from 'payload'
import React from 'react'

import type { Page } from '../../payload-types.js'

// Render the page on every request so edits made in the admin show up on reload.
export const dynamic = 'force-dynamic'

type LexicalNode = { children?: LexicalNode[]; text?: string }

/**
 * Collapse a Lexical value to its plain text. A heading should hold inline
 * content, so this is a more faithful `render` for a rich-text heading than
 * dropping block elements (paragraphs, lists) inside an `<h1>`–`<h6>`.
 */
const lexicalToText = (value: Page['richHeading']['value']): string => {
  if (!value?.root) {
    return ''
  }
  const walk = (nodes: LexicalNode[] = []): string =>
    nodes.map((node) => node.text ?? walk(node.children)).join('')
  return walk(value.root.children as LexicalNode[])
}

const Specimen = ({
  children,
  meta,
  title,
}: {
  children: ReactNode
  meta: string
  title: string
}) => (
  <div className="specimen">
    <h2 className="specimen__title">{title}</h2>
    <div className="specimen__output">{children}</div>
    <p className="specimen__meta">{meta}</p>
  </div>
)

export default async function FrontendPage() {
  const payload = await getPayload({ config })
  const { docs: pages } = await payload.find({ collection: 'pages', limit: 10 })

  return (
    <main>
      <h1>Heading field — RSC render</h1>
      <p className="intro">
        Each block below renders a stored heading through the <code>{'<RenderHeading>'}</code>{' '}
        component from <code>@whatworks/payload-heading-field/rsc</code>. Change a tag in the{' '}
        <a href="/admin">admin</a> and reload — the emitted element changes while the visual size
        stays fixed (normalised in CSS) so you can confirm the tag, not the styling.
      </p>

      {pages.length === 0 ? (
        <div className="empty">
          No <code>pages</code> yet. Create one in the <a href="/admin">admin</a> (set the heading,
          sub heading and rich heading), then reload this page.
        </div>
      ) : (
        pages.map((page) => (
          <React.Fragment key={page.id}>
            <Specimen
              meta={`text · stored as ${JSON.stringify(page.heading)}`}
              title={`Page ${page.id} — heading (text)`}
            >
              <RenderHeading data={page.heading} />
            </Specimen>

            <Specimen
              meta={`textarea · stored as ${JSON.stringify(page.subheading)}`}
              title={`Page ${page.id} — subheading (textarea)`}
            >
              <RenderHeading data={page.subheading} />
            </Specimen>

            <Specimen
              meta={`richText · tag "${page.richHeading?.tag}", rendered via the render prop`}
              title={`Page ${page.id} — richHeading (richText)`}
            >
              <RenderHeading data={page.richHeading} render={(value) => lexicalToText(value)} />
            </Specimen>
          </React.Fragment>
        ))
      )}

      <h2 style={{ marginTop: '3rem' }}>Prop showcase (synthetic data)</h2>
      <p className="intro">Exercises the component’s props without needing stored content.</p>

      <Specimen meta="data.tag is used directly" title="Explicit tag (h3)">
        <RenderHeading data={{ tag: 'h3', value: 'Rendered as an <h3>' }} />
      </Specimen>

      <Specimen meta="tag missing → fallbackTag='h4'" title="fallbackTag">
        <RenderHeading data={{ value: 'No tag stored, falls back to <h4>' }} fallbackTag="h4" />
      </Specimen>

      <Specimen meta="children override the value entirely" title="children prop">
        <RenderHeading data={{ tag: 'h2', value: 'ignored' }}>
          <em>Custom</em> children inside the chosen tag
        </RenderHeading>
      </Specimen>

      <Specimen
        meta="data is null → renders nothing (a thin border is all you see)"
        title="null data"
      >
        <RenderHeading data={null} />
      </Specimen>
    </main>
  )
}
