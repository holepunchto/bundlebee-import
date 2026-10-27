import type Bundlebee from 'bundlebee'
import type { Store, ReleasePin } from 'bundlebee/types'
import type { ImportOptions, NetworkOptions, ResolveOptions } from './lib/options'
import { parseLink } from './lib/link'
import { Network } from './lib/network'
import { ImportError, cancelled, unavailable, importFailure } from './lib/errors'

export type { Store, ReleasePin, HostProvider } from 'bundlebee/types'
export type { ImportOptions, NetworkOptions, ResolveOptions } from './lib/options'

async function importRelease(
  store: Store,
  pin: ReleasePin,
  options: ImportOptions = {}
): Promise<unknown> {
  cancelled(options.signal)
  const { default: Bundlebee } = await import('bundlebee')
  const bundle = new Bundlebee(store.session(), { key: pin.key, offline: true })

  try {
    await bundle.ready()
    const module = await bundle.loadRelease(pin, { ...options, offline: true })
    return module.exports
  } catch (error) {
    throw importFailure(error, { signal: options.signal })
  } finally {
    await bundle.close()
  }
}

async function resolve(
  store: Store,
  link: string,
  options: ResolveOptions = {}
): Promise<ReleasePin> {
  cancelled(options.signal)
  const parsed = parseLink(link, options)
  const { default: Bundlebee } = await import('bundlebee')
  const session = store.session()
  const bundle = new Bundlebee(session, { key: parsed.key, offline: options.offline === true })
  const network = new Network(session, bundle, options)
  let pin: ReleasePin

  try {
    await bundle.ready()
    if (options.offline) {
      pin = await bundle.resolve({ ...parsed.selector, offline: true, signal: options.signal })
    } else {
      pin = await resolveOnline(bundle, network, parsed.selector)
    }
    if (
      (parsed.length !== null && parsed.length !== pin.length) ||
      (parsed.entry && parsed.entry !== pin.entry)
    ) {
      throw new ImportError('Release does not match the link snapshot or entry', {
        code: 'ERR_INVALID_RELEASE_LINK'
      })
    }
    return pin
  } catch (error) {
    throw importFailure(error, { signal: options.signal, deadline: network.signal })
  } finally {
    try {
      await network.close()
    } finally {
      await bundle.close()
    }
  }
}

async function resolveOnline(
  bundle: Bundlebee,
  network: Network,
  selector: Parameters<Bundlebee['resolve']>[0]
): Promise<ReleasePin> {
  if (network.options.blindPeers?.length) {
    const signal = network.connectMirrors()
    try {
      await bundle.update({ signal })
      return await bundle.resolve({ ...selector, signal })
    } catch (error) {
      if (!unavailable(error, signal) || network.options.fallback === false) {
        throw importFailure(error, { signal: network.options.signal, deadline: signal })
      }
    }
  }
  if (network.options.fallback === false) {
    throw new ImportError('No mirrors configured and discovery is disabled', {
      code: 'ERR_IMPORT_UNAVAILABLE'
    })
  }
  await network.discover()
  await bundle.update({ signal: network.signal })
  return bundle.resolve({ ...selector, signal: network.signal })
}

async function prepare(
  store: Store,
  pin: ReleasePin,
  options: NetworkOptions = {}
): Promise<ReleasePin> {
  cancelled(options.signal)
  const { default: Bundlebee } = await import('bundlebee')
  const session = store.session()
  const bundle = new Bundlebee(session, { key: pin.key, offline: true })
  const network = new Network(session, bundle, options)

  try {
    await bundle.ready()
    try {
      return await bundle.prefetch(pin, { offline: true, signal: options.signal })
    } catch (error) {
      if (
        options.offline ||
        !(error instanceof Error) ||
        !('code' in error) ||
        error.code !== 'ERR_RELEASE_NOT_CACHED'
      ) {
        throw error
      }
    }
    if (options.blindPeers?.length) {
      const signal = network.connectMirrors()
      try {
        return await bundle.prefetch(pin, { offline: false, signal })
      } catch (error) {
        if (!unavailable(error, signal) || options.fallback === false) {
          throw importFailure(error, { signal: options.signal, deadline: signal })
        }
      }
    }
    if (options.fallback === false) {
      throw new ImportError('No mirrors configured and discovery is disabled', {
        code: 'ERR_IMPORT_UNAVAILABLE'
      })
    }
    await network.discover()
    return await bundle.prefetch(pin, { offline: false, signal: network.signal })
  } catch (error) {
    throw importFailure(error, { signal: options.signal, deadline: network.signal })
  } finally {
    try {
      await network.close()
    } finally {
      await bundle.close()
    }
  }
}

export default Object.assign(importRelease, { resolve, prepare })
