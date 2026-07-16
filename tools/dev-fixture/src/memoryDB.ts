import { MongoMemoryReplSet } from 'mongodb-memory-server'

export interface StartMemoryMongoOptions {
  dbName?: string
  replSetCount?: number
}

export interface MemoryReplSet {
  stop: () => Promise<void>
  uri: string
}

/**
 * Starts an in-memory MongoDB replica set and returns its connection URI along
 * with a `stop` handle for teardown. A replica set (not a standalone) is what
 * enables transactions, so this is the fixture to use when a test needs to
 * reproduce transaction-dependent behaviour (e.g. concurrent-boot seeding).
 */
export async function createMemoryReplSet(
  options: StartMemoryMongoOptions = {},
): Promise<MemoryReplSet> {
  const memoryDB = await MongoMemoryReplSet.create({
    replSet: {
      count: options.replSetCount ?? 3,
      dbName: options.dbName ?? 'payloadmemory',
    },
  })

  return {
    stop: async () => {
      await memoryDB.stop()
    },
    uri: `${memoryDB.getUri()}&retryWrites=true`,
  }
}

export async function startMemoryMongo(options: StartMemoryMongoOptions = {}): Promise<string> {
  const { uri } = await createMemoryReplSet(options)
  process.env.DATABASE_URI = uri
  return uri
}
