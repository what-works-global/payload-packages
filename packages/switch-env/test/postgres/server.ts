import EmbeddedPostgres from 'embedded-postgres'
import { mkdtemp, rm } from 'node:fs/promises'
import net from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export interface PostgresTestServer {
  /** Builds a connection string for a database on the running cluster. */
  connectionString: (database: string) => string
  /** Creates a database on the cluster. */
  createDatabase: (name: string) => Promise<void>
  /** Stops the cluster and removes its data directory. */
  stop: () => Promise<void>
}

const PG_USER = 'postgres'
const PG_PASSWORD = 'password'

/** Ask the OS for a free TCP port so parallel runs don't clash on 5432. */
const getFreePort = (): Promise<number> =>
  new Promise((resolve, reject) => {
    const server = net.createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : 0
      server.close(() => resolve(port))
    })
  })

/**
 * Boots an in-process PostgreSQL cluster via `embedded-postgres` (a real
 * Postgres binary, the analog of `mongodb-memory-server` used by the Mongo
 * suite). Faithful to production because `@payloadcms/db-postgres` connects to
 * it over TCP with the real `pg` driver.
 */
export const startPostgres = async (): Promise<PostgresTestServer> => {
  const port = await getFreePort()
  const databaseDir = await mkdtemp(join(tmpdir(), 'switch-env-pg-'))

  const postgres = new EmbeddedPostgres({
    databaseDir,
    onError: () => {},
    onLog: () => {},
    password: PG_PASSWORD,
    persistent: false,
    port,
    user: PG_USER,
  })

  await postgres.initialise()
  await postgres.start()

  return {
    connectionString: (database: string) =>
      `postgresql://${PG_USER}:${PG_PASSWORD}@127.0.0.1:${port}/${database}`,
    createDatabase: (name: string) => postgres.createDatabase(name),
    stop: async () => {
      await postgres.stop()
      await rm(databaseDir, { force: true, recursive: true })
    },
  }
}
