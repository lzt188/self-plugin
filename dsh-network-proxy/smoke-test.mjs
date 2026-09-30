// Offline smoke test for the @deepseek-ai/dsh-settings 0.2.0-rc.2 port of
// dsh-network-proxy. Run: npm test
//
// The plugin's peers (@deepseek-ai/schemastery) and undici resolve from the
// surrounding installation when the plugin runs inside a DSH profile. In a bare
// checkout (CI) they may be absent, so a missing dependency reports SKIP instead
// of failing the suite; with the dependencies present every check below runs
// for real.
import assert from 'node:assert/strict'

const PROXY_ENV_NAMES = [
  'HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'NO_PROXY',
  'http_proxy', 'https_proxy', 'all_proxy', 'no_proxy',
]

const checks = []
function check(name, fn) {
  checks.push({ name, fn })
}

let mod
let getGlobalDispatcher
let setGlobalDispatcher
try {
  mod = await import('./index.js')
  const undici = await import('undici')
  getGlobalDispatcher = undici.getGlobalDispatcher
  setGlobalDispatcher = undici.setGlobalDispatcher
} catch (error) {
  if (error?.code === 'ERR_MODULE_NOT_FOUND') {
    console.log('SKIP - a dependency of the plugin is not installed in this checkout.')
    console.log(`       ${String(error.message).split('\n')[0]}`)
    console.log('       Run `npm install` (or test inside a DSH profile) to execute the full suite.')
    process.exit(0)
  }
  throw error
}

// Captured before any check mutates the environment: the restore effect must put
// every proxy variable back onto this baseline, regardless of its values.
const baselineEnv = Object.fromEntries(PROXY_ENV_NAMES.map((name) => [name, process.env[name]]))

check('module exports the expected surface', () => {
  assert.equal(typeof mod.apply, 'function')
  assert.equal(typeof mod.parseWindowsProxyServer, 'function')
  assert.equal(typeof mod.readWindowsSystemProxy, 'function')
  assert.equal(typeof mod.validateSettings, 'function')
  assert.equal(typeof mod.Config, 'function')
})

check('Config declares the live proxy settings schema (volatile mode/url)', () => {
  const read = (value) => (typeof value?.get === 'function' ? value.get() : value)
  const resolved = mod.Config({ mode: 'manual', url: 'http://127.0.0.1:7890' })
  assert.equal(read(resolved.mode), 'manual')
  assert.equal(read(resolved.url), 'http://127.0.0.1:7890')
  const defaulted = mod.Config({})
  assert.equal(read(defaulted.mode), 'system')
  assert.equal(read(defaulted.url), '')
})

check('parseWindowsProxyServer: single host applies to both schemes', () => {
  assert.deepEqual(mod.parseWindowsProxyServer('proxy.lan:8080'), {
    httpProxy: 'http://proxy.lan:8080',
    httpsProxy: 'http://proxy.lan:8080',
  })
})

check('parseWindowsProxyServer: per-protocol entries', () => {
  assert.deepEqual(mod.parseWindowsProxyServer('http=10.0.0.2:8080;https=10.0.0.3:8443'), {
    httpProxy: 'http://10.0.0.2:8080',
    httpsProxy: 'http://10.0.0.3:8443',
  })
})

check('parseWindowsProxyServer: explicit schemes are preserved', () => {
  assert.deepEqual(mod.parseWindowsProxyServer('https://secure.lan:8443'), {
    httpProxy: 'https://secure.lan:8443',
    httpsProxy: 'https://secure.lan:8443',
  })
})

check('parseWindowsProxyServer: empty input', () => {
  assert.deepEqual(mod.parseWindowsProxyServer(''), {})
  assert.deepEqual(mod.parseWindowsProxyServer(undefined), {})
})

check('validateSettings: manual mode rejects non-http(s) URLs', () => {
  assert.throws(() => mod.validateSettings({ mode: 'manual', url: 'socks5://127.0.0.1:1080' }), /HTTP/)
  assert.throws(() => mod.validateSettings({ mode: 'manual', url: 'not a url' }), /HTTP/)
})

check('validateSettings: manual mode accepts http/https, system/direct pass', () => {
  mod.validateSettings({ mode: 'manual', url: 'http://127.0.0.1:7890' })
  mod.validateSettings({ mode: 'manual', url: 'https://proxy.lan:8443' })
  mod.validateSettings({ mode: 'system', url: '' })
  mod.validateSettings({ mode: 'direct', url: '' })
})

check('apply() activates direct mode from Config and registers the restore effect', () => {
  const effects = []
  const ctx = {
    fiber: {},
    inject: () => {},
    effect: (factory, name) => effects.push({ factory, name }),
  }
  mod.apply(ctx, { mode: { get: () => 'direct' }, url: { get: () => '' } })
  for (const name of ['HTTP_PROXY', 'HTTPS_PROXY', 'http_proxy', 'https_proxy', 'ALL_PROXY', 'all_proxy']) {
    assert.equal(process.env[name], undefined, `${name} must be cleared in direct mode`)
  }
  assert.equal(effects.length, 1, 'the restore proxy-env effect is registered')
  assert.equal(effects[0].name, 'network-proxy: restore proxy env on reload')
})

check('apply() in manual mode replaces the global dispatcher', () => {
  const original = getGlobalDispatcher()
  const ctx = { fiber: {}, inject: () => {}, effect: () => {} }
  mod.apply(ctx, { mode: { get: () => 'manual' }, url: { get: () => 'http://127.0.0.1:7890' } })
  try {
    const after = getGlobalDispatcher()
    assert.notEqual(after, original, 'global dispatcher must be replaced by the plugin')
    assert.equal(typeof after.dispatch, 'function')
  } finally {
    setGlobalDispatcher(original)
  }
})

check('restore effect restores the inherited proxy environment on reload', () => {
  let factory
  const ctx = { fiber: {}, inject: () => {}, effect: (fn) => { factory = fn } }
  mod.apply(ctx, { mode: { get: () => 'manual' }, url: { get: () => 'http://127.0.0.1:7890' } })
  assert.equal(process.env.HTTP_PROXY, 'http://127.0.0.1:7890')
  const dispose = factory()
  assert.equal(typeof dispose, 'function', 'effect factory returns a disposer')
  dispose()
  for (const name of PROXY_ENV_NAMES) {
    assert.equal(process.env[name], baselineEnv[name], `${name} must return to the launch baseline`)
  }
})

if (process.platform === 'win32') {
  check('readWindowsSystemProxy: real registry read succeeds on this machine', () => {
    // Must not throw: ProxyEnable on/off both return a config object.
    const config = mod.readWindowsSystemProxy()
    assert.equal(typeof config, 'object')
    if (config.httpProxy || config.httpsProxy) {
      assert.match(String(config.httpProxy ?? config.httpsProxy), /^[a-z][a-z\d+.-]*:\/\//i)
    }
  })
}

let failed = 0
for (const { name, fn } of checks) {
  try {
    await fn()
    console.log(`ok   - ${name}`)
  } catch (error) {
    failed += 1
    console.error(`FAIL - ${name}`)
    console.error(error?.stack ?? error)
  }
}
console.log(`\n${checks.length - failed}/${checks.length} checks passed`)
if (failed > 0) process.exit(1)
