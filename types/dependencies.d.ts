declare module 'hypercore-id-encoding' {
  export function normalize(key: string | Uint8Array): string
  export function decode(key: string | Uint8Array): Uint8Array
}

declare module 'hyperdht' {
  const DHT: {
    new (options: {
      readonly bootstrap?: ReadonlyArray<import('../lib/transport').BootstrapNode>
    }): import('../lib/transport').DHT
    keyPair(): import('../lib/transport').KeyPair
  }
  export default DHT
}

declare module 'hyperswarm' {
  const Hyperswarm: {
    new (options: {
      readonly bootstrap?: ReadonlyArray<import('../lib/transport').BootstrapNode>
    }): import('../lib/transport').Hyperswarm
  }
  export default Hyperswarm
}

declare module 'safety-catch' {
  export default function safetyCatch(error: unknown): void
}

declare module 'pear-link' {
  interface ParsedLink {
    readonly protocol: string
    readonly hash: string
    readonly pathname: string
    readonly search: string
    readonly drive: {
      readonly key: string | Uint8Array
      readonly fork: number | null
      readonly length: number | null
      readonly hash: Uint8Array | null
    }
  }
  export function parse(link: string): ParsedLink
}
