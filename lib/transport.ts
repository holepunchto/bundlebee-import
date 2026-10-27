import type { ReplicationStream } from 'bundlebee/types'

export type PublicKey = string | Uint8Array

export interface BootstrapNode {
  readonly host: string
  readonly port: number
}

export interface Connection extends ReplicationStream {
  readonly opened: Promise<boolean>
}

export interface KeyPair {
  readonly publicKey: Uint8Array
  readonly secretKey: Uint8Array
}

export interface DHT {
  connect(key: Uint8Array, options: { readonly keyPair: KeyPair }): Connection
  destroy(): Promise<void>
}

export interface Hyperswarm {
  readonly dht: DHT
  on(event: 'connection', listener: (stream: Connection) => void): this
  join(topic: Uint8Array, options: { readonly client: boolean; readonly server: boolean }): void
  flush(): Promise<void>
  destroy(): Promise<void>
}
