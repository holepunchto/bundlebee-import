const test = require('brittle')
const Corestore = require('corestore')
const id = require('hypercore-id-encoding')
const b4a = require('b4a')
const Import = require('..')

test('public resolution rejects ambiguous external release links', async (t) => {
  const store = new Corestore(await t.tmp())
  t.teardown(() => store.close())
  const key = id.encode(b4a.alloc(32, 42))
  const link = 'bundle+pear://' + key

  for (const input of [
    link + '?name=app&name=other',
    link + '?name=app&version=1&abi=1',
    link + '?name=app#fragment',
    link + '/%2e%2e/main.js?name=app',
    'bundle+pear://0.12.' + key + '?name=app&version=^1.0.0'
  ]) {
    await t.exception.all(() => Import.resolve(store, input), { code: 'ERR_INVALID_RELEASE_LINK' })
  }

  const core = store.get({ name: 'caller' })
  await core.append('alive')
  t.is(core.length, 1)
  await core.close()
})
