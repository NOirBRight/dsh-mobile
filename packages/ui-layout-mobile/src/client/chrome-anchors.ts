/** Named Host-chrome label matchers. Official aria/copy is the fallback contract. */

export const NEW_SESSION_ARIA = /(?:new|create)\s+session/i
export const NEW_SESSION_ARIA_ZH = /(?:新建|创建)会话/
export const COMPOSER_STOP_LABEL = /^(?:停止生成|停止|stop generating|stop)$/i
export const COMPOSER_SEND_LABEL = /^(?:发送消息|发送|send message|send)$/i

export function isOfficialNewSessionLabel(label: string): boolean {
  return NEW_SESSION_ARIA.test(label) || NEW_SESSION_ARIA_ZH.test(label)
}

export function isComposerStopLabel(label: string | null): boolean {
  return label !== null && COMPOSER_STOP_LABEL.test(label.trim())
}

export function isComposerSendLabel(label: string | null): boolean {
  return label !== null && COMPOSER_SEND_LABEL.test(label.trim())
}
