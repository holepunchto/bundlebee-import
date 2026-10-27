import { parse } from 'pear-link'
import { normalize } from 'hypercore-id-encoding'
import { Range, Version } from 'bare-semver'
import type { ReleaseQuery } from 'bundlebee/types'
import type { ResolveOptions } from './options'
import { ImportError } from './errors'

interface ReleaseLink {
  readonly key: string
  readonly selector: ReleaseQuery
  readonly length: number | null
  readonly entry: string | null
}

export function parseLink(link: string, options: ResolveOptions): ReleaseLink {
  if (!link.startsWith('bundle+pear://')) throw invalid('Expected bundle+pear protocol')
  const rawPath = link.replace(/^[^:]+:\/\/[^/]+/, '').split(/[?#]/)[0]
  const parsed = parse(link.slice(7))
  if (parsed.hash || parsed.drive.hash || parsed.drive.fork) {
    throw invalid('Unsupported hash or fork selector')
  }
  const query = new URLSearchParams(parsed.search)
  for (const [key] of query) {
    if (!['name', 'version', 'abi'].includes(key) || query.getAll(key).length !== 1) {
      throw invalid('Unknown or repeated selector: ' + key)
    }
  }
  const name = select(query, 'name', options.name)
  if (!name || !/^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/.test(name)) {
    throw invalid('Package name required')
  }
  const abi = select(query, 'abi', options.abi?.toString())
  const version = select(query, 'version', options.version)
  if (abi !== null && version !== null) throw invalid('Choose version or ABI')
  const selector: ReleaseQuery =
    abi === null ? { name, version: version ?? '*' } : { name, abi: Number(abi) }
  if (abi !== null && (!/^[1-9]\d*$/.test(abi) || !Number.isSafeInteger(Number(abi)))) {
    throw invalid('Invalid ABI')
  }
  if ('version' in selector && selector.version !== undefined) Range.parse(selector.version)
  const length = parsed.drive.length
  if (
    length !== null &&
    (length < 1 ||
      !Number.isSafeInteger(length) ||
      !version ||
      !/^\d+\.\d+\.\d+(?:[-+].*)?$/.test(version) ||
      Version.parse(version).toString() !== version ||
      abi !== null)
  ) {
    throw invalid('Snapshot requires an exact version')
  }
  const entry =
    parsed.pathname && parsed.pathname !== '/' ? decodeURIComponent(parsed.pathname) : null
  if (
    rawPath.split('/').some((part) => ['.', '..'].includes(decodeURIComponent(part))) ||
    entry?.includes('\\') ||
    entry?.includes('\0')
  ) {
    throw invalid('Invalid entry assertion')
  }
  return { key: normalize(parsed.drive.key), selector, length, entry }
}

function select(query: URLSearchParams, key: string, option?: string): string | null {
  const value = query.get(key)
  if (value !== null && option !== undefined && value !== option) {
    throw invalid('Conflicting release selector: ' + key)
  }
  return value ?? option ?? null
}

function invalid(message: string): ImportError {
  return new ImportError(message, { code: 'ERR_INVALID_RELEASE_LINK' })
}
