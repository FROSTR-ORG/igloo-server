import { describe, expect, test } from 'bun:test'
import { Database } from 'bun:sqlite'
import { createUiEventLogStore, ensureUiEventLogSchema } from './ui-event-log.js'

describe('ui-event-log store', () => {
  test('appends entries, paginates by seq, and de-dupes blobs by hash', () => {
    const mem = new Database(':memory:')
    ensureUiEventLogSchema(mem)
    const store = createUiEventLogStore(mem)

    const commonData = { a: 1, b: 'x' }
    const e1 = store.append({ type: 'info', message: 'one', data: commonData, timestamp: new Date().toISOString(), id: 'tmp1' })
    const e2 = store.append({ type: 'info', message: 'two', data: commonData, timestamp: new Date().toISOString(), id: 'tmp2' })
    const e3 = store.append({ type: 'error', message: 'three', data: { c: true }, timestamp: new Date().toISOString(), id: 'tmp3' })

    expect(e1.seq).toBeGreaterThan(0)
    expect(e2.seq).toBeGreaterThan(e1.seq)
    expect(e3.seq).toBeGreaterThan(e2.seq)
    expect(e1.dataHash).toBeTruthy()
    expect(e2.dataHash).toBe(e1.dataHash)

    const blobCount = mem.prepare('SELECT COUNT(*) as c FROM ui_event_log_blobs').get() as { c: number }
    expect(blobCount.c).toBe(2)

    const page1 = store.list({ limit: 2 })
    expect(page1.entries.length).toBe(2)
    expect(page1.entries[0].id).toBe(String(e3.seq))
    expect(page1.entries[1].id).toBe(String(e2.seq))
    expect(page1.nextBeforeSeq).toBe(e2.seq)

    const page2 = store.list({ limit: 5, beforeSeq: page1.nextBeforeSeq ?? undefined })
    expect(page2.entries.length).toBe(1)
    expect(page2.entries[0].id).toBe(String(e1.seq))

    const blob = store.getBlob(e1.dataHash!)
    expect(blob).toBeTruthy()
    expect((blob as any).data).toEqual(commonData)
  })

  test('redacts sensitive keys and truncates oversized payloads', () => {
    const mem = new Database(':memory:')
    ensureUiEventLogSchema(mem)
    const store = createUiEventLogStore(mem)

    const e1 = store.append({
      type: 'info',
      message: 'sensitive',
      data: {
        Authorization: 'Bearer SHOULD_NOT_PERSIST',
        password: 'pw',
        nested: { apiKey: 'key', ok: true }
      },
      timestamp: new Date().toISOString(),
      id: 'tmp'
    })

    const blob1 = store.getBlob(e1.dataHash!)
    expect(blob1).toBeTruthy()
    const data1 = (blob1 as any).data as any
    expect(data1.Authorization).toBe('[REDACTED]')
    expect(data1.password).toBe('[REDACTED]')
    expect(data1.nested.apiKey).toBe('[REDACTED]')
    expect(data1.nested.ok).toBe(true)

    const hugeObj: Record<string, string> = {}
    for (let i = 0; i < 120; i++) {
      hugeObj[`k${i}`] = 'x'.repeat(4096)
    }
    const e2 = store.append({
      type: 'info',
      message: 'huge',
      data: hugeObj,
      timestamp: new Date().toISOString(),
      id: 'tmp2'
    })
    const blob2 = store.getBlob(e2.dataHash!)
    expect(blob2).toBeTruthy()
    const data2 = (blob2 as any).data as any
    expect(data2._truncated).toBe(true)
    expect(data2.originalBytes).toBeGreaterThan(200_000)
    expect(typeof data2.originalSha256).toBe('string')
    expect(typeof data2.preview).toBe('string')
  })

  test('prunes entries older than a retention cutoff and deletes orphan blobs', () => {
    const mem = new Database(':memory:')
    ensureUiEventLogSchema(mem)
    const store = createUiEventLogStore(mem)

    const insert = mem.prepare(`
      INSERT INTO ui_event_log_entries (
        created_at_ms, type, message, data_hash, data_preview, data_bytes, source_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `)

    const now = Date.now()
    const oldMs = now - 10 * 86400000
    const keepMs = now - 1 * 86400000

    // Old entry with a blob.
    const blobJson = JSON.stringify({ ok: true })
    const blobHash = 'a'.repeat(64)
    mem.prepare('INSERT INTO ui_event_log_blobs (hash, json, byte_length) VALUES (?, ?, ?)').run(blobHash, blobJson, blobJson.length)
    insert.run(oldMs, 'info', 'old', blobHash, blobJson, blobJson.length, null)

    // Newer entry with the same blob (should keep blob after pruning).
    insert.run(keepMs, 'info', 'new', blobHash, blobJson, blobJson.length, null)

    // Orphan blob (should be removed by prune).
    const orphanHash = 'b'.repeat(64)
    mem.prepare('INSERT INTO ui_event_log_blobs (hash, json, byte_length) VALUES (?, ?, ?)').run(orphanHash, blobJson, blobJson.length)

    const beforeEntries = mem.prepare('SELECT COUNT(*) as c FROM ui_event_log_entries').get() as { c: number }
    const beforeBlobs = mem.prepare('SELECT COUNT(*) as c FROM ui_event_log_blobs').get() as { c: number }
    expect(beforeEntries.c).toBe(2)
    expect(beforeBlobs.c).toBe(2)

    const result = store.prune({ retentionDays: 2 })
    expect(result).toBeTruthy()
    expect((result as any).deletedEntries).toBe(1)

    const afterEntries = mem.prepare('SELECT COUNT(*) as c FROM ui_event_log_entries').get() as { c: number }
    const afterBlobs = mem.prepare('SELECT COUNT(*) as c FROM ui_event_log_blobs').get() as { c: number }
    expect(afterEntries.c).toBe(1)
    expect(afterBlobs.c).toBe(1)
  })
})
