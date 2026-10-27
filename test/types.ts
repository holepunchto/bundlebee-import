import Import = require('..')

async function contract(store: Import.Store, pin: Import.ReleasePin) {
  const resolved: Import.ReleasePin = await Import.resolve(store, 'bundle+pear://key?name=app', {
    version: '^1.0.0'
  })
  await Import.prepare(store, resolved, { offline: true })
  const value: unknown = await Import(store, pin)
  // @ts-expect-error Execution only accepts an immutable pin.
  await Import(store, 'bundle+pear://key?name=app')
  // @ts-expect-error Pins must use format 2.
  await Import(store, { ...pin, format: 1 })
  return value
}
void contract
