# bundlebee-import

Resolve, cache and execute pinned Bundlebee releases on Bare.

## Installation

```sh
npm install bundlebee-import
```

## Usage

```js
const Corestore = require('corestore')
const Import = require('bundlebee-import')

const store = new Corestore('./modules')
const pin = await Import.resolve(
  store,
  'bundle+pear://<publisher-key>?name=@example%2Fmath&version=%5E1.0.0'
)
await Import.prepare(store, pin)
const math = await Import(store, pin)
await store.close()
```

Persist the returned pin as JSON to reproduce the same release later. The publisher key authenticates the feed. The package name selects metadata within that feed; it does not discover a publisher. Executing a release runs publisher code with the host's privileges, not in a sandbox.

## API

### `Import.resolve(store, link, options?)`

Resolve a keyed `bundle+pear://` link to a release pin without executing code. A pin contains `{ format: 2, key, length, name, version, entry, abi }`: the publisher key, immutable snapshot length, exact version and entry, and release ABI generation.

Select `name` and either `version` or `abi` through query parameters or options. Version defaults to `*`. Online resolution refreshes the feed before selecting a release. `offline: true` reads only the cached index, which may be older than the publisher's current index.

An optional pathname asserts the published entry. A legacy `0.<length>.<key>` authority asserts an immutable snapshot and requires an exact version. Conflicting selectors, duplicate query fields, traversal paths, fragments and nonzero forks are rejected.

### `Import.prepare(store, pin, options?)`

Verify and cache all blocks and assets for an exact release. A complete cache returns without opening any transport. Otherwise, connect configured mirrors first, then discover peers if fallback is enabled. Preparation never executes code or changes the selected release.

`offline: true` disables all networking and peer waits; missing blocks produce `ERR_RELEASE_NOT_CACHED`.

### `Import(store, pin, options?)`

Execute a prepared pin from the local cache. This operation never connects to peers, refreshes an index or prepares a missing release. Missing blocks produce `ERR_RELEASE_NOT_CACHED`.

Options are `signal`, `assetDirectory`, `platform: { platform, arch }` and `hostProviders`. Host providers are Bundlebee's exact-specifier map of `{ exports, version, abi?, platform?, arch? }`. Each provider must satisfy the release's declared requirement. Native assets require a writable asset directory. There is no implicit dependency lookup in the importer's project.

Module exports are unknown until the caller checks the publisher's application-specific contract. Publisher exceptions propagate unchanged.

### Networking options

Resolve and prepare accept these options:

- `blindPeers`: mirror public keys, encoded strings or 32-byte values. Consumers replicate through direct streams; they do not register storage on a mirror.
- `blindTimeout`: mirror retrieval budget in milliseconds, default `2000`.
- `timeout`: total retrieval budget in milliseconds, default `10000`. The mirror budget consumes part of this deadline.
- `fallback`: defaults to `true`. Disable it for mirror-only retrieval. Only unavailable data or expired mirror retrieval permits fallback; malformed releases, storage errors and programmer errors propagate.
- `bootstrap`: `{ host, port }` bootstrap nodes for owned networking. Use a local HyperDHT testnet or private bootstrap nodes when appropriate.
- `dht` or `swarm`: borrow a DHT for direct mirror connections. Only `swarm.dht` is used. Discovery uses a private swarm, preserving the caller's connections and topics.
- `signal`: caller cancellation. Cancelled operations return `ERR_IMPORT_ABORTED`; expired retrieval returns `ERR_IMPORT_TIMEOUT`, with the original cause retained.

The caller owns its Corestore and any supplied DHT or swarm. Each operation owns its store session, mirror streams and private discovery swarm, and closes them on success or failure. Offline operations allocate no network resources. Deadlines use the runtime's unref'ed abort timeout primitive.

## Development

```sh
npm install
npm test
npm run test:types
npm run lint
```

Strict TypeScript sources use erasable syntax. The build emits CommonJS and a small generated entry preserving `require('bundlebee-import')` as a callable function. The declaration facade derives its types from the same sources and Bundlebee's public types.

Brittle tests exercise the public API, real Corestores and a local HyperDHT testnet. Bare tests cover immutable releases, a publisher-offline blind mirror, discovery fallback, partial-cache repair, deadlines, cancellation and caller ownership. Node checks cover portable external-link parsing through the public API; module execution remains Bare-only.

Before Bundlebee v2 is published, install the sibling checkout's packed tarball using `npm install --no-save --package-lock=false /path/to/bundlebee-2.0.0.tgz`. Publish Bundlebee v2 first. Neither local file dependencies nor development lockfiles are published.

Version 2 replaces floating imports with explicit resolve, prepare and cache-only execution. Historical v1 binary fixtures remain as test assets.

## License

Apache-2.0.
