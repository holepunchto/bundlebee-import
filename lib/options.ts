import type { ReleaseLoadOptions, Signal } from 'bundlebee/types'
export type { Signal } from 'bundlebee/types'
import type { DHT, PublicKey, BootstrapNode } from './transport'

export interface NetworkOptions {
  readonly offline?: boolean
  readonly signal?: Signal
  readonly timeout?: number
  readonly blindTimeout?: number
  readonly blindPeers?: ReadonlyArray<PublicKey>
  readonly fallback?: boolean
  readonly bootstrap?: ReadonlyArray<BootstrapNode>
  readonly dht?: Pick<DHT, 'connect'>
  readonly swarm?: { readonly dht: Pick<DHT, 'connect'> }
}

export interface ResolveOptions extends NetworkOptions {
  readonly name?: string
  readonly version?: string
  readonly abi?: number
}

export interface ImportOptions {
  readonly signal?: Signal
  readonly assetDirectory?: ReleaseLoadOptions['assetDirectory']
  readonly platform?: ReleaseLoadOptions['platform']
  readonly hostProviders?: ReleaseLoadOptions['hostProviders']
}
