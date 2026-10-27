import Hyperswarm from 'hyperswarm'
import DHT from 'hyperdht'
import AbortController, { AbortSignal } from 'bare-abort-controller'
import { decode } from 'hypercore-id-encoding'
import safetyCatch from 'safety-catch'
import type Bundlebee from 'bundlebee'
import type { Store } from 'bundlebee/types'
import type { NetworkOptions } from './options'
import type { Connection, DHT as DHTResource, Hyperswarm as SwarmResource } from './transport'
import { cancelled } from './errors'

export class Network {
  readonly store: Store
  readonly bundle: Bundlebee
  readonly options: NetworkOptions
  readonly controller: AbortController
  private deadline: AbortSignal | null
  private dht: DHTResource | null
  private swarm: SwarmResource | null
  private connections: { readonly stream: Connection; readonly closed: Promise<void> }[]
  private done: () => void
  private readonly abort: () => void
  private readonly expire: () => void

  constructor(store: Store, bundle: Bundlebee, options: NetworkOptions) {
    this.store = store
    this.bundle = bundle
    this.options = options
    this.controller = new AbortController()
    this.deadline = null
    this.dht = null
    this.swarm = null
    this.connections = []
    this.done = noop
    this.abort = () => this.controller.abort(options.signal?.reason)
    this.expire = () => this.controller.abort(this.deadline?.reason)
  }

  get signal(): AbortSignal {
    return this.controller.signal
  }

  connectMirrors(): AbortSignal {
    this.start()
    const borrowed = this.options.dht ?? this.options.swarm?.dht
    const dht = borrowed ?? (this.dht = new DHT({ bootstrap: this.options.bootstrap }))
    // Separate identities prevent mirrors from replacing caller-owned connections.
    const keyPair = DHT.keyPair()
    const done = (this.done = this.bundle.core.findingPeers())

    for (const key of this.options.blindPeers ?? []) {
      const stream = dht.connect(decode(key), { keyPair })
      this.connections.push({
        stream,
        closed: new Promise<void>((resolve) => stream.once('close', resolve))
      })
      // Unreachable mirrors are handled by retrieval; programmer errors remain fatal.
      stream.on('error', safetyCatch)
      this.store.replicate(stream)
    }
    Promise.all(this.connections.map(({ stream }) => stream.opened)).then(done, (error) => {
      done()
      safetyCatch(error)
    })
    return AbortSignal.any([this.signal, AbortSignal.timeout(this.options.blindTimeout ?? 2000)])
  }

  async discover(): Promise<void> {
    this.start()
    await this.closeMirrors()
    this.signal.throwIfAborted()
    const swarm = (this.swarm = new Hyperswarm({ bootstrap: this.options.bootstrap }))
    const done = (this.done = this.bundle.core.findingPeers())
    swarm.on('connection', (stream) => this.store.replicate(stream))
    swarm.join(this.bundle.discoveryKey, { client: true, server: false })
    swarm.flush().then(done, (error) => {
      done()
      this.controller.abort(error)
      safetyCatch(error)
    })
  }

  async close(): Promise<void> {
    try {
      await this.closeMirrors()
    } finally {
      this.done()
      this.options.signal?.removeEventListener('abort', this.abort)
      this.deadline?.removeEventListener('abort', this.expire)
      await this.swarm?.destroy()
    }
  }

  private start(): void {
    cancelled(this.options.signal)
    if (this.deadline) return
    this.options.signal?.addEventListener('abort', this.abort, { once: true })
    this.deadline = AbortSignal.timeout(this.options.timeout ?? 10000)
    this.deadline.addEventListener('abort', this.expire, { once: true })
  }

  private async closeMirrors(): Promise<void> {
    this.done()
    for (const { stream } of this.connections) stream.destroy()
    await Promise.all(this.connections.map(({ closed }) => closed))
    await this.dht?.destroy()
    this.dht = null
    this.connections = []
  }
}

function noop(): void {}
