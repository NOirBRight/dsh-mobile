const CONTROL_CHARS = /[\u0000-\u001f\u007f]/g
const MODEL_FILLERS = new Set(['find', 'galaxy', 'thinkpad', 'ideapad'])

/**
 * Keep human-facing paired-device names useful in narrow controls. This is
 * presentation metadata only: Host Identity, endpoint, and Room never use it.
 */
export function compactDisplayName(value: string, fallback = 'Device', maxLength = 18): string {
  let normalized = value.replace(CONTROL_CHARS, '').replace(/\s+/g, ' ').trim()
  if (normalized === '') normalized = fallback
  normalized = normalized.replace(/\b(workstation|desktop|computer)\b/giu, 'PC')
  const words = normalized.split(' ')
  if (words.length >= 3) {
    const withoutModelFiller = words.filter((word, index) => index > 0 && index < words.length - 1 && MODEL_FILLERS.has(word.toLocaleLowerCase()) ? false : true).join(' ')
    if (withoutModelFiller.length < normalized.length) normalized = withoutModelFiller
  }
  if (Array.from(normalized).length <= maxLength) return normalized
  const parts = normalized.split(' ')
  if (parts.length >= 2) {
    const edgeName = parts[0] + ' ' + parts.at(-1)
    if (Array.from(edgeName).length <= maxLength) return edgeName
  }
  return Array.from(normalized).slice(0, Math.max(1, maxLength - 1)).join('') + '…'
}
