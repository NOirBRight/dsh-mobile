import test from 'node:test'
import assert from 'node:assert/strict'
import { enhancementDisclosure, readSessionEnhancementPreference, writeSessionEnhancementPreference } from '../src/enhancement-preference.ts'

class Storage {
  values = new Map()
  getItem(key) { return this.values.get(key) ?? null }
  setItem(key, value) { this.values.set(key, value) }
}

test('compatibility mode is the default and enhancement requires an explicit choice', () => {
  const storage = new Storage()
  assert.equal(readSessionEnhancementPreference(storage), 'compatible')
  writeSessionEnhancementPreference(storage, 'enhanced')
  assert.equal(readSessionEnhancementPreference(storage), 'enhanced')
  storage.setItem('dsh-mobile:session-enhancement-mode:v1', 'unknown')
  assert.equal(readSessionEnhancementPreference(storage), 'compatible')
})

test('disclosure distinguishes default support, optional features, and upgrade fallback', () => {
  assert.match(enhancementDisclosure({ status: 'core' }), /默认兼容模式/)
  assert.match(enhancementDisclosure({ status: 'enabled', officialRuntimeRevision: 'abc' }), /会话缓存增强已启用/)
  assert.match(enhancementDisclosure({ status: 'incompatible', reason: 'runtime-revision', officialRuntimeRevision: 'new' }), /官方 DSH 更新/)
  assert.match(enhancementDisclosure({ status: 'incompatible', reason: 'runtime-revision', officialRuntimeRevision: 'new' }), /配对与连接不受影响/)
})
