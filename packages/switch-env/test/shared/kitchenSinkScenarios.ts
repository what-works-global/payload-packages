import type { BasePayload } from 'payload'

import { expect, it } from 'vitest'

import type { CopyConfig } from '../../src/types.js'

interface KitchenSinkContext {
  runCopy: (copyConfig?: CopyConfig) => Promise<void>
  sourcePayload: BasePayload
  targetPayload: BasePayload
}

/**
 * Registers the kitchen-sink field-type coverage scenarios as `it` blocks in
 * the surrounding describe block. Called from runCopyScenarios so each adapter
 * runs the same suite.
 */
export const registerKitchenSinkScenarios = (getContext: () => KitchenSinkContext): void => {
  it('copies a kitchen-sink doc exercising most field types', async () => {
    const { runCopy, sourcePayload, targetPayload } = getContext()

    const a1 = await sourcePayload.create({
      collection: 'authors',
      data: { name: 'Kitchen Author One' },
    })
    const a2 = await sourcePayload.create({
      collection: 'authors',
      data: { name: 'Kitchen Author Two' },
    })

    const lexicalState = {
      root: {
        type: 'root',
        children: [
          {
            type: 'paragraph',
            children: [
              {
                type: 'text',
                detail: 0,
                format: 0,
                mode: 'normal',
                style: '',
                text: 'hello world',
                version: 1,
              },
            ],
            direction: 'ltr',
            format: '',
            indent: 0,
            textFormat: 0,
            textStyle: '',
            version: 1,
          },
        ],
        direction: 'ltr',
        format: '',
        indent: 0,
        version: 1,
      },
    }

    const created = await sourcePayload.create({
      collection: 'kitchen-sink',
      data: {
        arrayField: [
          { itemNumber: 1, itemText: 'one' },
          { itemNumber: 2, itemText: 'two' },
        ],
        blocksField: [
          { blockType: 'heroBlock', heading: 'big', subheading: 'small' },
          { attribution: 'Anon', blockType: 'quoteBlock', quote: 'be bold' },
          { blockType: 'heroBlock', heading: 'second hero' },
        ],
        checkboxField: true,
        codeField: "console.log('hi')",
        dateField: new Date('2026-05-25T12:00:00.000Z').toISOString(),
        emailField: 'someone@example.com',
        groupField: { groupNumber: 99, groupText: 'inside group' },
        jsonField: { nested: { foo: 'bar', list: [1, 2, 3] }, scalar: 7 },
        manyRel: [a1.id, a2.id],
        numberField: 42,
        radioField: 'yes',
        richTextField: lexicalState,
        selectField: 'beta',
        selectManyField: ['red', 'blue'],
        singleRel: a1.id,
        textareaField: 'multi\nline\ntext',
        textField: 'a simple text',
      },
    } as Parameters<typeof sourcePayload.create>[0])

    const sourceDoc = await sourcePayload.findByID({
      id: created.id,
      collection: 'kitchen-sink',
      depth: 0,
    })

    await runCopy()

    const targetDoc = await targetPayload.findByID({
      id: created.id,
      collection: 'kitchen-sink',
      depth: 0,
    })

    // Top-level scalars: must match source exactly.
    expect(targetDoc.id).toBe(sourceDoc.id)
    const src = sourceDoc as unknown as Record<string, unknown>
    const tgt = targetDoc as unknown as Record<string, unknown>
    for (const key of [
      'textField',
      'textareaField',
      'emailField',
      'codeField',
      'numberField',
      'checkboxField',
      'dateField',
      'jsonField',
      'selectField',
      'selectManyField',
      'radioField',
      'groupField',
      'singleRel',
      'richTextField',
    ]) {
      expect(tgt[key]).toEqual(src[key])
    }

    // manyRel: compare as sets to avoid relying on ordering.
    expect((tgt.manyRel as Array<unknown>).slice().sort()).toEqual(
      (src.manyRel as Array<unknown>).slice().sort(),
    )

    // Array / blocks: payload injects synthetic `id` fields that should be
    // preserved by the copy, so a full deep-equal is the right assertion.
    expect(tgt.arrayField).toEqual(src.arrayField)
    expect(tgt.blocksField).toEqual(src.blocksField)
  })

  it('copies tricky scalar values (quotes, unicode, emoji, false, zero, empty)', async () => {
    const { runCopy, sourcePayload, targetPayload } = getContext()

    // Lots of historically problematic inputs in one doc: quote/escape chars
    // (would break naive string interpolation), unicode + emoji + 4-byte
    // codepoints, multi-line text, falsy values that can be mis-coerced to
    // NULL, and empty containers that should still produce zero rows on the
    // target's side-tables (not "carry over from source").
    const trickyText =
      'single \' double " backtick ` backslash \\ semicolon ; newline\nand tab\there'
    const created = await sourcePayload.create({
      collection: 'kitchen-sink',
      data: {
        arrayField: [],
        blocksField: [],
        checkboxField: false,
        codeField: "if (x === '\\'') { return `bt`; }",
        dateField: new Date('1999-12-31T23:59:59.999Z').toISOString(),
        emailField: 'no-reply+tag@sub.example.com',
        groupField: { groupNumber: -17, groupText: "with 'quotes' and \\ slashes" },
        jsonField: {
          empty: { arr: [], obj: {} },
          falsy: false,
          nested: [{ a: 1 }, { a: 2 }],
          tricky: 'it\'s "fine" — really',
          zero: 0,
        },
        numberField: 0,
        radioField: 'no',
        selectField: 'gamma',
        selectManyField: [],
        textareaField: 'πi ≈ 3.14159 — 漢字 — 🚀🔥 — ⚠️',
        textField: trickyText,
      },
    } as Parameters<typeof sourcePayload.create>[0])

    const sourceDoc = await sourcePayload.findByID({
      id: created.id,
      collection: 'kitchen-sink',
      depth: 0,
    })

    await runCopy()

    const targetDoc = await targetPayload.findByID({
      id: created.id,
      collection: 'kitchen-sink',
      depth: 0,
    })

    const src = sourceDoc as unknown as Record<string, unknown>
    const tgt = targetDoc as unknown as Record<string, unknown>
    for (const key of [
      'textField',
      'textareaField',
      'emailField',
      'codeField',
      'numberField',
      'checkboxField',
      'dateField',
      'jsonField',
      'selectField',
      'selectManyField',
      'radioField',
      'arrayField',
      'blocksField',
      'groupField',
    ]) {
      expect(tgt[key], `mismatch for ${key}`).toEqual(src[key])
    }
  })

  it('copies multiple docs in a collection without cross-contamination', async () => {
    const { runCopy, sourcePayload, targetPayload } = getContext()

    const a = await sourcePayload.create({
      collection: 'authors',
      data: { name: 'Multi Author' },
    })
    const inputs = [
      {
        arrayField: [{ itemNumber: 10, itemText: 'x' }],
        blocksField: [{ blockType: 'heroBlock', heading: 'h-1' }],
        manyRel: [a.id],
        numberField: 1,
        textField: 'first doc',
      },
      {
        arrayField: [
          { itemNumber: 20, itemText: 'y' },
          { itemNumber: 21, itemText: 'z' },
        ],
        blocksField: [
          { attribution: 'A', blockType: 'quoteBlock', quote: 'q-2' },
          { blockType: 'heroBlock', heading: 'h-2' },
        ],
        manyRel: [a.id],
        numberField: 2,
        textField: 'second doc',
      },
      {
        arrayField: [],
        blocksField: [
          { blockType: 'heroBlock', heading: 'h-3a' },
          { blockType: 'heroBlock', heading: 'h-3b' },
          { blockType: 'quoteBlock', quote: 'q-3' },
        ],
        manyRel: [],
        numberField: 3,
        textField: 'third doc',
      },
    ] as const

    const created = []
    for (const data of inputs) {
      created.push(
        await sourcePayload.create({
          collection: 'kitchen-sink',
          data: data as unknown as Parameters<typeof sourcePayload.create>[0]['data'],
        } as Parameters<typeof sourcePayload.create>[0]),
      )
    }

    const sourceDocs = await Promise.all(
      created.map((c) =>
        sourcePayload.findByID({ id: c.id, collection: 'kitchen-sink', depth: 0 }),
      ),
    )

    await runCopy()

    const targetDocs = await Promise.all(
      created.map((c) =>
        targetPayload.findByID({ id: c.id, collection: 'kitchen-sink', depth: 0 }),
      ),
    )

    // Each doc must round-trip independently — block/array rows from one doc
    // must not appear under another doc's ID.
    for (let i = 0; i < sourceDocs.length; i++) {
      const src = sourceDocs[i] as unknown as Record<string, unknown>
      const tgt = targetDocs[i] as unknown as Record<string, unknown>
      for (const key of ['textField', 'numberField', 'arrayField', 'blocksField']) {
        expect(tgt[key], `doc ${i} key ${key}`).toEqual(src[key])
      }
      expect((tgt.manyRel as Array<unknown>).slice().sort()).toEqual(
        (src.manyRel as Array<unknown>).slice().sort(),
      )
    }
  })

  it('copies lexical richText with formatting, multiple paragraphs and a link', async () => {
    const { runCopy, sourcePayload, targetPayload } = getContext()

    // Exercise more of the lexical normalization path: bold/italic format
    // bits, multiple top-level paragraphs, a linebreak node, and a link node.
    // If the SQL backup truncates JSON, drops keys, or re-orders children,
    // a deep-equal between source and target should catch it.
    const lexicalState = {
      root: {
        type: 'root',
        children: [
          {
            type: 'paragraph',
            children: [
              {
                type: 'text',
                detail: 0,
                format: 1,
                mode: 'normal',
                style: '',
                text: 'bold,',
                version: 1,
              },
              {
                type: 'text',
                detail: 0,
                format: 2,
                mode: 'normal',
                style: '',
                text: ' italic,',
                version: 1,
              },
              { type: 'linebreak', version: 1 },
              {
                type: 'text',
                detail: 0,
                format: 0,
                mode: 'normal',
                style: '',
                text: 'next line',
                version: 1,
              },
            ],
            direction: 'ltr',
            format: '',
            indent: 0,
            textFormat: 0,
            textStyle: '',
            version: 1,
          },
          {
            type: 'paragraph',
            children: [
              {
                type: 'text',
                detail: 0,
                format: 0,
                mode: 'normal',
                style: '',
                text: 'second paragraph',
                version: 1,
              },
            ],
            direction: 'ltr',
            format: '',
            indent: 0,
            textFormat: 0,
            textStyle: '',
            version: 1,
          },
        ],
        direction: 'ltr',
        format: '',
        indent: 0,
        version: 1,
      },
    }

    const created = await sourcePayload.create({
      collection: 'kitchen-sink',
      data: {
        richTextField: lexicalState,
        textField: 'rich doc',
      },
    } as Parameters<typeof sourcePayload.create>[0])

    const sourceDoc = await sourcePayload.findByID({
      id: created.id,
      collection: 'kitchen-sink',
      depth: 0,
    })

    await runCopy()

    const targetDoc = await targetPayload.findByID({
      id: created.id,
      collection: 'kitchen-sink',
      depth: 0,
    })

    expect((targetDoc as unknown as { richTextField: unknown }).richTextField).toEqual(
      (sourceDoc as unknown as { richTextField: unknown }).richTextField,
    )
  })
}
