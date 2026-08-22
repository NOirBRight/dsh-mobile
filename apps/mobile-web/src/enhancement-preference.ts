import type { SessionEnhancementPreference, SessionEnhancementSelection } from './manifest.ts'

export const SESSION_ENHANCEMENT_PREFERENCE_KEY = 'dsh-mobile:session-enhancement-mode:v1'

export interface PreferenceStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

/** Core compatibility is fail-closed and remains the default until the user opts in. */
export function readSessionEnhancementPreference(storage: PreferenceStorage): SessionEnhancementPreference {
  try { return storage.getItem(SESSION_ENHANCEMENT_PREFERENCE_KEY) === 'enhanced' ? 'enhanced' : 'compatible' }
  catch { return 'compatible' }
}

export function writeSessionEnhancementPreference(
  storage: PreferenceStorage,
  preference: SessionEnhancementPreference,
): void {
  storage.setItem(SESSION_ENHANCEMENT_PREFERENCE_KEY, preference)
}

export function enhancementDisclosure(
  selection: Omit<SessionEnhancementSelection, 'manifest'>,
): string {
  if (selection.status === 'enabled') {
    return '会话缓存增强已启用：提供冷启动历史、会话恢复与权威刷新状态。适配的官方 Runtime：' +
      (selection.officialRuntimeRevision ?? '已验证版本') + '。'
  }
  if (selection.status === 'incompatible') {
    if (selection.reason === 'runtime-revision') {
      return '检测到官方 DSH 更新（Runtime ' + (selection.officialRuntimeRevision ?? '未知') +
        '），会话缓存增强已自动停用。默认支持的配对、设备管理、Tunnel/Relay 与官方界面仍可使用，配对与连接不受影响。'
    }
    return '当前官方 Runtime 未提供可验证的增强入口，会话缓存增强已停用；配对与连接不受影响。'
  }
  return '默认兼容模式：配对、设备管理、Tunnel/Relay 与官方界面默认支持；会话缓存、恢复及权威刷新状态属于可选增强，官方更新后可能暂时失效。'
}
