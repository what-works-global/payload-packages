export default function Home() {
  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', lineHeight: 1.6, padding: '3rem 2rem' }}>
      <h1>video-optimizer on Vercel</h1>
      <p>
        A measurement rig, not a demo. <code>POST /api/benchmark</code> with a video as multipart{' '}
        <code>file</code> and it encodes the ladder inside one invocation, reporting what each rung
        cost on this hardware. <code>GET</code> the same path for the machine details alone.
      </p>
      <p>
        Storage is <code>/tmp</code>, which is per-instance, so nothing here survives past the
        request that wrote it. <a href="/admin">The admin</a> works on a warm instance and shows an
        empty database on a cold one — that is the trade, not a bug.
      </p>
    </main>
  )
}
