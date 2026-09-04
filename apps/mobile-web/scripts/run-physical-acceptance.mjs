#!/usr/bin/env node
/** Install and preflight the signed Campaign APK on one authorized physical device. */
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

export function parseAdbDevices(text) {
  return String(text).split(/\r?\n/).slice(1).filter(line => line.trim() !== '').map(line => {
    const fields = line.trim().split(/\s+/)
    const model = fields.find(field => field.startsWith('model:'))?.slice('model:'.length)
    return { serial: fields[0], state: fields[1], model }
  })
}

function lastNumberPair(text) {
  const matches = [...String(text).matchAll(/(\d+)x(\d+)/g)]
  const match = matches.at(-1)
  return match === undefined ? [undefined, undefined] : [Number(match[1]), Number(match[2])]
}

function lastNumber(text) {
  const matches = [...String(text).matchAll(/(\d+)/g)]
  return matches.length === 0 ? undefined : Number(matches.at(-1)[1])
}

export function physicalDeviceFacts({ qemu, sdk, model, size, density }) {
  const [widthPx] = lastNumberPair(size)
  const densityDpi = lastNumber(density)
  return {
    model,
    sdk: Number(sdk),
    widthPx,
    densityDpi,
    approximateCssWidth: widthPx !== undefined && densityDpi !== undefined && densityDpi > 0
      ? Math.round(widthPx * 160 / densityDpi)
      : undefined,
    physical: String(qemu).trim() !== '1',
  }
}

export function parsePackageVersion(text) {
  const code = /versionCode=(\d+)/.exec(text)?.[1]
  const name = /versionName=([^\s]+)/.exec(text)?.[1]
  return { versionCode: code === undefined ? undefined : Number(code), versionName: name }
}

function adb(serial, args, allowFailure = false) {
  const result = spawnSync('adb', ['-s', serial, ...args], { encoding: 'utf8' })
  if (!allowFailure && result.status !== 0) {
    throw new Error('adb ' + args.join(' ') + ' failed: ' + (result.stderr || result.stdout).trim())
  }
  return result.stdout.trim()
}

function selectDevice() {
  const result = spawnSync('adb', ['devices', '-l'], { encoding: 'utf8' })
  if (result.status !== 0) throw new Error('adb devices failed: ' + result.stderr.trim())
  const authorized = parseAdbDevices(result.stdout).filter(row => row.state === 'device')
  const requested = process.env.DSH_ANDROID_SERIAL
  if (requested !== undefined) {
    const match = authorized.find(row => row.serial === requested)
    if (match === undefined) throw new Error('DSH_ANDROID_SERIAL is not an authorized connected device: ' + requested)
    return match
  }
  if (authorized.length === 0) throw new Error('no authorized Android device; connect a physical device, unlock it, and approve USB debugging')
  if (authorized.length > 1) throw new Error('multiple devices connected; set DSH_ANDROID_SERIAL to the intended physical device')
  return authorized[0]
}

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

export function runPhysicalAcceptancePreflight() {
  const device = selectDevice()
  const facts = physicalDeviceFacts({
    qemu: adb(device.serial, ['shell', 'getprop', 'ro.kernel.qemu']),
    sdk: adb(device.serial, ['shell', 'getprop', 'ro.build.version.sdk']),
    model: adb(device.serial, ['shell', 'getprop', 'ro.product.model']) || device.model || 'unknown',
    size: adb(device.serial, ['shell', 'wm', 'size']),
    density: adb(device.serial, ['shell', 'wm', 'density']),
  })
  if (!facts.physical) throw new Error('selected target reports ro.kernel.qemu=1; the Campaign requires physical-device acceptance')

  const apk = resolve(import.meta.dirname, '../../../artifacts/' + (process.env.DSH_MOBILE_APK ?? 'dsh-mobile-1.1.5.apk'))
  const expectedHash = process.env.DSH_MOBILE_APK_SHA256
  if (expectedHash === undefined || !/^[0-9a-f]{64}$/u.test(expectedHash)) {
    throw new Error('set DSH_MOBILE_APK_SHA256 to the SHA-256 of the signed release APK')
  }
  const actualHash = sha256(apk)
  if (actualHash !== expectedHash) throw new Error('APK SHA-256 mismatch: ' + actualHash)

  console.log('device:', JSON.stringify({ serial: device.serial, ...facts }))
  console.log(adb(device.serial, ['install', '-r', apk]))
  const packageDump = adb(device.serial, ['shell', 'dumpsys', 'package', 'top.noirbright.dshmobile'])
  const installed = parsePackageVersion(packageDump)
  if (installed.versionCode !== 16 || installed.versionName !== '1.1.5') {
    throw new Error('installed APK version mismatch: ' + JSON.stringify(installed))
  }
  adb(device.serial, ['shell', 'am', 'force-stop', 'top.noirbright.dshmobile'])
  adb(device.serial, ['shell', 'monkey', '-p', 'top.noirbright.dshmobile', '-c', 'android.intent.category.LAUNCHER', '1'])
  console.log('installed:', JSON.stringify(installed))
  console.log('launched: top.noirbright.dshmobile')
  console.log('complete the human checks in docs/mobile-targeted-repair-physical-matrix.md')
}

const invoked = process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (invoked) {
  try { runPhysicalAcceptancePreflight() } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}
