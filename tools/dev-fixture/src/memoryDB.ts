import { MongoMemoryReplSet } from 'mongodb-memory-server'

export interface StartMemoryMongoOptions {
  dbName?: string
  replSetCount?: number
}

export async function startMemoryMongo(options: StartMemoryMongoOptions = {}): Promise<string> {
  const memoryDB = await MongoMemoryReplSet.create({
    replSet: {
      count: options.replSetCount ?? 3,
      dbName: options.dbName ?? 'payloadmemory',
    },
  })

  const uri = `${memoryDB.getUri()}&retryWrites=true`
  process.env.DATABASE_URI = uri
  return uri
}
