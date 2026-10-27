const test = require('brittle')
const Corestore = require('corestore')
const Bundlebee = require('bundlebee')
const Hyperswarm = require('hyperswarm')
const createTestnet = require('hyperdht/testnet')
const BlindPeer = require('blind-peer')
const BlindPeering = require('blind-peering')
const AbortController = require('bare-abort-controller')
const fs = require('bare-fs')
const path = require('bare-path')
const { pathToFileURL } = require('bare-url')
const id = require('hypercore-id-encoding')
const b4a = require('b4a')
const safetyCatch = require('safety-catch')
const Import = require('..')

test('local pins remain immutable across newer releases, caller ownership survives errors', async (t) => {
  const { storage, bundle, publish } = await publisher(t)
  const first = await publish('1.0.0', 1, { release: 1 })
  const latest = await publish('1.1.0', 2, { release: 2 })
  t.alike(
    await Import.resolve(storage, releaseLink(first, 'version=^1.0.0'), { offline: true }),
    latest
  )
  t.alike(await Import.resolve(storage, releaseLink(first, 'abi=1'), { offline: true }), first)
  t.alike(await Import.prepare(storage, first, { offline: true }), first)
  t.alike(await Import(storage, first), { release: 1 })
  t.alike(await Import(storage, latest), { release: 2 })
  const originalLength = bundle.core.length
  t.alike(await Import(storage, first), { release: 1 })
  t.is(bundle.core.length, originalLength)
  await rejects(t, () => Import.resolve(storage, 'garbage'), 'ERR_INVALID_RELEASE_LINK')
  await rejects(
    t,
    () => Import.resolve(storage, releaseLink(first) + '&abi=1'),
    'ERR_INVALID_RELEASE_LINK'
  )
  await rejects(
    t,
    () => Import.resolve(storage, releaseLink(first).replace('?', '/other.js?'), { offline: true }),
    'ERR_INVALID_RELEASE_LINK'
  )
  t.absent(storage.closed, 'caller store remains open')
  const writable = storage.get({ name: 'caller-still-works' })
  await writable.append('alive')
  t.is(writable.length, 1)
  await writable.close()
})

test('incomplete offline cache fails promptly without network or head updates', async (t) => {
  const { publish } = await publisher(t)
  const pin = await publish('1.0.0', 1, 'offline')
  const empty = await store(t)
  const core = empty.get({ key: pin.key })
  await core.ready()
  t.teardown(() => core.close())
  const before = Date.now()
  await rejects(t, () => Import(empty, pin), 'ERR_RELEASE_NOT_CACHED')
  await rejects(t, () => Import.prepare(empty, pin, { offline: true }), 'ERR_RELEASE_NOT_CACHED')
  t.ok(Date.now() - before < 1000, 'cache misses return promptly')
  t.is(core.length, 0)
  t.absent(empty.closed)
})

test(
  'publisher-offline blind mirror serves immutable release without storage registration',
  { timeout: 30000 },
  async (t) => {
    const { bootstrap } = await createTestnet(3, t)
    const source = await publisher(t)
    const pin = await source.publish('1.0.0', 1, { mirrored: true })
    const mirror = new BlindPeer(await t.tmp(), { bootstrap, enableGc: false })
    await mirror.listen()
    t.teardown(() => mirror.close())
    const publisherSwarm = new Hyperswarm({ bootstrap })
    t.teardown(() => publisherSwarm.destroy())
    const peering = new BlindPeering(publisherSwarm.dht, source.storage, {
      keys: [mirror.publicKey],
      batchIdleWait: 10,
      batchMaxWait: 25
    })
    t.teardown(() => peering.close())
    await peering.addCore(source.bundle.core)
    const mirrorCore = mirror.store.get({ key: source.bundle.key })
    await mirrorCore.ready()
    await mirrorCore.download({ start: 0, end: source.bundle.core.length }).done()
    await mirrorCore.close()
    await peering.close()
    await publisherSwarm.destroy()
    await source.bundle.close()
    await source.storage.close()
    const registrations = mirror.stats.addCoresRx
    const consumer = await store(t)
    const caller = new Hyperswarm({ bootstrap })
    t.teardown(() => caller.destroy())
    const existing = caller.dht.connect(mirror.publicKey)
    existing.on('error', safetyCatch)
    t.teardown(() => existing.destroy())
    await existing.opened
    const options = {
      swarm: caller,
      bootstrap,
      blindPeers: [mirror.publicKey],
      timeout: 10000,
      blindTimeout: 10000,
      fallback: false
    }
    const resolved = await Import.resolve(consumer, releaseLink(pin), options)
    t.alike(resolved, pin)
    await rejects(
      t,
      () => Import.prepare(consumer, { ...pin, name: 'other' }, options),
      'ERR_INVALID_RELEASE',
      'publisher metadata cannot be replaced by a persisted pin'
    )
    t.alike(await Import.prepare(consumer, pin, options), pin)
    t.alike(await Import(consumer, pin), { mirrored: true })
    t.is(mirror.stats.addCoresRx, registrations, 'consumer sent no add-core storage request')
    t.absent(existing.destroyed, 'preexisting caller stream preserved')
    const cached = consumer.get({ key: pin.key })
    await cached.ready()
    await cached.clear(pin.length - 1, pin.length)
    const head = cached.length
    await rejects(
      t,
      () => Import(consumer, pin),
      'ERR_RELEASE_NOT_CACHED',
      'known head with missing payload is an offline miss'
    )
    t.is(cached.length, head, 'offline miss leaves local head unchanged')
    await Import.prepare(consumer, pin, options)
    t.alike(await Import(consumer, pin), { mirrored: true }, 'prepare repairs partial cache')
    await cached.close()
    existing.destroy()

    t.absent(caller.destroyed)
    t.absent(caller.dht.destroyed)
    t.is(caller.connections.size, 0, 'caller swarm connections untouched')
    await mirror.close()
    t.alike(await Import.prepare(consumer, pin), pin)
    t.alike(await Import(consumer, pin), { mirrored: true })
  }
)

test(
  'unavailable blind mirror falls back to owned swarm and pins survive newer head',
  { timeout: 30000 },
  async (t) => {
    const { bootstrap } = await createTestnet(3, t)
    const source = await publisher(t)
    const first = await source.publish('1.0.0', 1, 'first')
    const latest = await source.publish('2.0.0', 2, 'second')
    await advertise(t, source.storage, source.bundle, bootstrap)
    const consumer = await store(t)
    const caller = new Hyperswarm({ bootstrap })
    t.teardown(() => caller.destroy())
    const options = {
      swarm: caller,
      bootstrap,
      blindPeers: [id.encode(b4a.alloc(32, 9))],
      blindTimeout: 100,
      timeout: 10000
    }
    t.alike(await Import.resolve(consumer, releaseLink(first, 'version=*'), options), latest)
    await Import.prepare(consumer, first, options)
    t.is(await Import(consumer, first), 'first')
    t.absent(caller.destroyed)
    t.absent(caller.dht.destroyed)
    t.is(caller.connections.size, 0)
  }
)

test(
  'timeouts and cancellation close owned transports and preserve caller resources',
  { timeout: 10000 },
  async (t) => {
    const { bootstrap } = await createTestnet(3, t)
    const { publish } = await publisher(t)
    const pin = await publish('1.0.0', 1, 'unavailable')
    const consumer = await store(t)
    const caller = new Hyperswarm({ bootstrap })
    t.teardown(() => caller.destroy())
    const options = {
      swarm: caller,
      bootstrap,
      blindPeers: [id.encode(b4a.alloc(32, 8))],
      blindTimeout: 50,
      timeout: 150
    }
    const start = Date.now()
    await rejects(t, () => Import.prepare(consumer, pin, options), 'ERR_IMPORT_TIMEOUT')
    t.ok(Date.now() - start < 2000, 'bounded timeout includes cleanup')
    const controller = new AbortController()
    const pending = Import.prepare(consumer, pin, {
      ...options,
      timeout: 5000,
      blindTimeout: 5000,
      signal: controller.signal
    })
    const timer = setTimeout(() => controller.abort(), 50)
    await rejects(t, () => pending, 'ERR_IMPORT_ABORTED')
    clearTimeout(timer)
    const fallbackAbort = new AbortController()
    const fallbackPending = Import.prepare(consumer, pin, {
      bootstrap,
      timeout: 5000,
      signal: fallbackAbort.signal
    })
    const fallbackTimer = setTimeout(() => fallbackAbort.abort(), 50)
    await rejects(
      t,
      () => fallbackPending,
      'ERR_IMPORT_ABORTED',
      'fallback discovery is cancellable'
    )
    clearTimeout(fallbackTimer)
    t.absent(consumer.closed)
    t.absent(caller.destroyed)
    t.absent(caller.dht.destroyed)
    t.is(caller.connections.size, 0)
  }
)

test('cancelled cached operations preserve the caller store', async (t) => {
  const { storage, publish } = await publisher(t)
  const pin = await publish('1.0.0', 1, 'cached')
  const controller = new AbortController()
  controller.abort()

  await rejects(t, () => Import(storage, pin, { signal: controller.signal }), 'ERR_IMPORT_ABORTED')
  await rejects(
    t,
    () => Import.prepare(storage, pin, { offline: true, signal: controller.signal }),
    'ERR_IMPORT_ABORTED'
  )
  t.is(await Import(storage, pin), 'cached')
  t.absent(storage.closed)
})

test('publisher-thrown values are preserved by the importer boundary', async (t) => {
  const { storage, bundle, root } = await publisher(t)
  for (const [index, value] of [null, undefined].entries()) {
    fs.writeFileSync(path.join(root, 'main.js'), 'throw ' + String(value))
    const pin = await bundle.publish(pathToFileURL(root + path.sep), 'main.js', {
      name: 'throws',
      version: '1.0.' + index,
      abi: index + 1
    })
    let caught = false
    try {
      await Import(storage, pin)
    } catch (err) {
      caught = true
      t.is(err, value)
    }
    t.ok(caught, 'publisher exception propagated')
  }
})

test('publisher timeout errors are not retrieval deadlines', async (t) => {
  const { storage, bundle, root } = await publisher(t)
  fs.writeFileSync(
    path.join(root, 'main.js'),
    "const error = new Error('publisher timeout'); error.name = 'TimeoutError'; throw error"
  )
  const pin = await bundle.publish(pathToFileURL(root + path.sep), 'main.js', {
    name: 'throws',
    version: '1.0.0',
    abi: 1
  })

  try {
    await Import(storage, pin)
    t.fail('publisher error must propagate')
  } catch (error) {
    t.is(error.name, 'TimeoutError')
    t.is(error.message, 'publisher timeout')
    t.absent(error.code)
  }
})

test(
  'online resolution deadlines and aborts cancel pending head updates',
  { timeout: 10000 },
  async (t) => {
    const { bootstrap } = await createTestnet(3, t)
    const { publish } = await publisher(t)
    const pin = await publish('1.0.0', 1, 'unavailable')
    const consumer = await store(t)
    const core = consumer.get({ key: pin.key })
    await core.ready()
    t.teardown(() => core.close())
    // A caller-owned discovery attempt keeps head upgrades pending even if one mirror fails fast.
    const doneFinding = core.findingPeers()
    t.teardown(doneFinding)
    const options = {
      bootstrap,
      blindPeers: [id.encode(b4a.alloc(32, 7))],
      fallback: false,
      timeout: 100,
      blindTimeout: 100
    }
    await rejects(
      t,
      () => Import.resolve(consumer, releaseLink(pin), options),
      'ERR_IMPORT_TIMEOUT',
      'online head update has a deadline'
    )

    const controller = new AbortController()
    const pending = Import.resolve(consumer, releaseLink(pin), {
      ...options,
      timeout: 5000,
      blindTimeout: 5000,
      signal: controller.signal
    })
    const timer = setTimeout(() => controller.abort(), 20)
    await rejects(t, () => pending, 'ERR_IMPORT_ABORTED', 'online head update is cancellable')
    clearTimeout(timer)

    t.absent(consumer.closed, 'caller remains usable after aborted resolution')
  }
)

async function store(t) {
  const result = new Corestore(await t.tmp())
  await result.ready()
  t.teardown(() => result.close())
  return result
}

async function publisher(t) {
  const storage = await store(t)
  const bundle = new Bundlebee(storage.session())
  await bundle.ready()
  t.teardown(() => bundle.close())
  const root = await t.tmp()
  const url = pathToFileURL(root + path.sep)
  function publish(version, abi, value) {
    fs.writeFileSync(path.join(root, 'main.js'), 'module.exports = ' + JSON.stringify(value))
    return bundle.publish(url, 'main.js', { name: 'example', version, abi })
  }
  return { storage, bundle, publish, root }
}

async function advertise(t, storage, bundle, bootstrap) {
  const swarm = new Hyperswarm({ bootstrap })
  swarm.on('connection', (stream) => storage.replicate(stream))
  t.teardown(() => swarm.destroy())
  await swarm.join(bundle.discoveryKey, { client: false, server: true }).flushed()
  return swarm
}

function releaseLink(pin, selector = 'version=' + pin.version) {
  return 'bundle+pear://' + pin.key + '?name=' + pin.name + '&' + selector
}

async function rejects(t, fn, code, label) {
  let err
  try {
    await fn()
  } catch (caught) {
    err = caught
  }
  t.is(err?.code, code, label)
}
