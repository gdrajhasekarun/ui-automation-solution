import { RegistryClient } from '@learning/registry-client'

/**
 * Vite plugin that registers this dev server with the CaaS service catalog.
 *
 * The active client is stored on `process.__viteRegistryClient` so it survives
 * Vite HMR module re-evaluation (module-level vars are reset on each reload).
 */

async function stopActive() {
  const c = process.__viteRegistryClient
  if (c) {
    process.__viteRegistryClient = null
    await c.stop()
  }
}

// Register signal handlers only once per process lifetime
if (!process.__viteRegistrySignalsAttached) {
  process.__viteRegistrySignalsAttached = true

  const handleSignal = () => {
    // Remove ourselves so the second Ctrl+C force-exits
    process.off('SIGINT',  handleSignal)
    process.off('SIGTERM', handleSignal)

    stopActive()
      .catch(() => {})
      .finally(() => process.exit(0))
  }

  process.on('SIGINT',  handleSignal)
  process.on('SIGTERM', handleSignal)
}

export function registryPlugin({ catalogUrl, name, port, healthPath = '/', metadata = {} } = {}) {
  return {
    name: 'vite-registry',
    apply: 'serve',
    configureServer(server) {
      if (!server.httpServer) return

      // Use the httpServer identity as the guard — only the first configureServer
      // call for a given httpServer instance wires up the listener.
      if (process.__viteRegistryServer === server.httpServer) return
      process.__viteRegistryServer = server.httpServer

      server.httpServer.once('listening', async () => {
        // Deregister any previous client synchronously before starting the new one
        await stopActive()
        const client = new RegistryClient({ catalogUrl, name, port, healthPath, metadata, handleSignals: false })
        process.__viteRegistryClient = client
        await client.start()
      })

      server.httpServer.once('close', async () => {
        if (process.__viteRegistryServer === server.httpServer) {
          process.__viteRegistryServer = null
        }
        await stopActive()
      })
    },
  }
}
