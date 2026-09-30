// dsh-network-proxy — server half.
// Upstream source: https://github.com/kriskite/dsh-network-proxy
// Pinned upstream commit: 4cc265a2115cffdcfbf4f74257243b12a98ac9e0
//
// @deepseek-ai/dsh-settings 0.2.0-rc.2 port: the legacy `settingsNamespace`
// factory and `settings.register(ns, schema, { applies, validate })` scope API
// were removed. The plugin's live-editable proxy settings are now declared as
// the plugin's own schemastery `Config` (read by SettingsForms through
// `fiber.runtime.Config`); a live edit flows through the config editor + Loader
// HMR, which re-mounts this entry and re-runs `apply()` with the new config.
//
// DSH Desktop 2.0.10 compatibility note (kept from the upstream patch):
// `activate()` does not close the previous global dispatcher. The Desktop
// launcher installs a boot-time proxy policy through @deepseek-ai/dsh-http-proxy,
// whose `proxyRouteFor()` keeps handing that dispatcher object to the web-fetch
// tool for proxied routes even after another dispatcher is installed globally.
// Closing it here would break `web fetch` whenever a boot-time env proxy policy
// is active. Skipping the close only leaks one dispatcher per mode switch.
import { execFileSync } from 'node:child_process'
import z from '@deepseek-ai/schemastery'
import {
  Agent,
  EnvHttpProxyAgent,
  ProxyAgent,
  setGlobalDispatcher,
} from 'undici'

const PROXY_ENV_NAMES = [
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'ALL_PROXY',
  'NO_PROXY',
  'http_proxy',
  'https_proxy',
  'all_proxy',
  'no_proxy',
]
const inheritedProxyEnvironment = Object.fromEntries(
  PROXY_ENV_NAMES.map((name) => [name, process.env[name]]),
)

/**
 * Mark a schemastery field as live-editable when the running schemastery
 * supports `.volatile()` (host 3.18.4+); fall back to an ordinary field on
 * older releases (the plugin's own 3.18.2 peer lacks it). Either way the
 * value is read through {@link readLive} below.
 */
const live = (schema) => (typeof schema.volatile === 'function' ? schema.volatile() : schema)

/** Read a config field whether it is a volatile accessor (`.get()`) or a plain value. */
const readLive = (value) => (typeof value?.get === 'function' ? value.get() : value)

/**
 * Live-editable proxy settings, exposed as this plugin's own configuration.
 * SettingsForms presents and edits these volatile fields; a change re-mounts
 * the entry (Loader HMR), re-running {@link apply} with the updated values.
 */
export const Config = z.object({
  mode: live(z.union([
    z.const('system').description('Follow system'),
    z.const('manual').description('Manual proxy'),
    z.const('direct').description('Direct'),
  ]).default('system')),
  url: live(z.string().default('')),
})

function validateSettings(value) {
  if (value.mode !== 'manual') return
  let url
  try {
    url = new URL(value.url)
  } catch {
    throw new Error('Manual proxy must be a valid HTTP or HTTPS URL')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Manual proxy supports only HTTP and HTTPS URLs')
  }
}

function restoreInheritedProxyEnvironment() {
  for (const name of PROXY_ENV_NAMES) {
    const value = inheritedProxyEnvironment[name]
    if (value === undefined) delete process.env[name]
    else process.env[name] = value
  }
}

function setManualProxyEnvironment(url) {
  for (const name of PROXY_ENV_NAMES) delete process.env[name]
  process.env.HTTP_PROXY = url
  process.env.HTTPS_PROXY = url
  process.env.http_proxy = url
  process.env.https_proxy = url
  const noProxy = inheritedProxyEnvironment.NO_PROXY ?? inheritedProxyEnvironment.no_proxy
  if (noProxy !== undefined) {
    process.env.NO_PROXY = noProxy
    process.env.no_proxy = noProxy
  }
}

function clearProxyEnvironment() {
  for (const name of PROXY_ENV_NAMES) delete process.env[name]
}

function normalizeProxyUrl(value) {
  if (!value) return undefined
  return /^[a-z][a-z\d+.-]*:\/\//i.test(value) ? value : `http://${value}`
}

function parseWindowsProxyServer(value) {
  const entries = String(value ?? '').split(';').map((entry) => entry.trim()).filter(Boolean)
  if (!entries.length) return {}
  const named = Object.fromEntries(entries.flatMap((entry) => {
    const separator = entry.indexOf('=')
    return separator < 0 ? [] : [[entry.slice(0, separator).toLowerCase(), entry.slice(separator + 1)]]
  }))
  const fallback = entries.find((entry) => !entry.includes('='))
  return {
    httpProxy: normalizeProxyUrl(named.http ?? fallback),
    httpsProxy: normalizeProxyUrl(named.https ?? named.http ?? fallback),
  }
}

function readWindowsSystemProxy() {
  const script = [
    "$p=Get-ItemProperty 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings';",
    '[pscustomobject]@{',
    'ProxyEnable=[int]$p.ProxyEnable;',
    'ProxyServer=[string]$p.ProxyServer;',
    'ProxyOverride=[string]$p.ProxyOverride;',
    'AutoConfigURL=[string]$p.AutoConfigURL',
    '}|ConvertTo-Json -Compress',
  ].join('')
  const output = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
    encoding: 'utf8',
    windowsHide: true,
  })
  const config = JSON.parse(output)
  if (!config.ProxyEnable) {
    if (config.AutoConfigURL) throw new Error('Windows PAC proxy is not supported; use Manual proxy')
    return {}
  }
  const proxies = parseWindowsProxyServer(config.ProxyServer)
  if (!proxies.httpProxy && !proxies.httpsProxy) {
    throw new Error('Windows system proxy is enabled but no proxy server is configured')
  }
  return {
    ...proxies,
    noProxy: String(config.ProxyOverride ?? '').split(';').map((entry) => entry.trim()).filter((entry) => entry && entry !== '<local>').join(','),
  }
}

function systemProxyOptions() {
  if (process.platform === 'win32') return readWindowsSystemProxy()
  return {
    httpProxy: inheritedProxyEnvironment.HTTP_PROXY ?? inheritedProxyEnvironment.http_proxy,
    httpsProxy: inheritedProxyEnvironment.HTTPS_PROXY ?? inheritedProxyEnvironment.https_proxy,
    noProxy: inheritedProxyEnvironment.NO_PROXY ?? inheritedProxyEnvironment.no_proxy,
  }
}

function dispatcherFor(value) {
  if (value.mode === 'direct') return new Agent()
  if (value.mode === 'manual') return new ProxyAgent(value.url)
  const options = systemProxyOptions()
  if (!options.httpProxy && !options.httpsProxy) return new Agent()
  return new EnvHttpProxyAgent(options)
}

function applyProxyEnvironment(value) {
  if (value.mode === 'system') restoreInheritedProxyEnvironment()
  else if (value.mode === 'manual') setManualProxyEnvironment(value.url)
  else clearProxyEnvironment()
}

function activate(value) {
  validateSettings(value)
  // The previous global dispatcher is intentionally left unclosed —
  // @deepseek-ai/dsh-http-proxy may still reference it for proxied web-fetch
  // routes. See the file header. Skipping the close only leaks one dispatcher.
  const dispatcher = dispatcherFor(value)
  applyProxyEnvironment(value)
  setGlobalDispatcher(dispatcher)
}

/**
 * Activate the global undici dispatcher from the plugin's live proxy config.
 *
 * The proxy activates immediately from {@link Config} (it does not wait on the
 * settings service). A live settings edit re-mounts this entry through the
 * config editor + Loader HMR, so `apply()` runs again with the new config: the
 * registered effect first restores the inherited proxy environment, then the new
 * `activate()` applies the updated mode/url.
 * @param ctx - the plugin's Context.
 * @param config - the resolved schemastery Config (volatile `mode`/`url`).
 */
export function apply(ctx, config) {
  activate({ mode: readLive(config.mode), url: readLive(config.url) })

  // Present the settings page through the settings service (optional; the
  // proxy activates independently of it).
  ctx.inject(['settings'], (settingsCtx) => {
    settingsCtx.effect(() => settingsCtx.settings.configure({ auto: true }, ctx.fiber), 'network-proxy: settings presentation')
  })

  // Restore the inherited proxy environment when this entry is re-mounted or
  // disposed, so the next activation starts from the launch-time baseline.
  ctx.effect(() => () => restoreInheritedProxyEnvironment(), 'network-proxy: restore proxy env on reload')
}

export { parseWindowsProxyServer, readWindowsSystemProxy, validateSettings }
