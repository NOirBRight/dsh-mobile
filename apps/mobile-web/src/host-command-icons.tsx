/**
 * Host 0.1.6 command-menu glyphs missing from the Alpha.4 / 0.1.5 primitives
 * the mobile shell seeds. ui-commands looks them up at HOST_FACES construction;
 * without these exports those rows render with no official icon.
 *
 * Source of record: dsh-v0.1.6-alpha.1 packages/client/ui-primitives/src/icons/index.tsx.
 * Copied into this plugin because the pinned Alpha.4 seed cannot export them.
 * Do not import from dsh-client-ui-primitives here — Vite appends these
 * exports onto that seeded module, and a reverse import would cycle.
 */
import type { ReactElement } from 'react'

interface IconProps {
  size?: number | undefined
  className?: string | undefined
}

/** ic_ds_plan_outline_14 */
export const IconPlanOutline14 = ({ size = 14, className }: IconProps): ReactElement => (
  <svg width={size} height={size} className={className} viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M9.56143 3.14672V4.24774H3.94716V3.14672H9.56143Z" fill="currentColor" />
    <path d="M9.56143 5.44201V6.54304H3.94716V5.44201H9.56143Z" fill="currentColor" />
    <path d="M7.97328 7.73731V8.83833H3.94716V7.73731H7.97328Z" fill="currentColor" />
    <path
      d="M8.02789 0.500001C8.82106 0.500001 9.46528 0.499108 9.97973 0.553797C10.5054 0.609708 10.9678 0.729732 11.3714 1.01734C11.6057 1.18436 11.8125 1.38729 11.9827 1.61716C12.2758 2.01317 12.3982 2.46699 12.4552 2.98269C12.5109 3.48743 12.51 4.11964 12.51 4.89782V5.48599L11.2928 6.72061V4.89782C11.2928 4.09333 11.2923 3.53731 11.2453 3.1118C11.1995 2.69759 11.1162 2.47711 10.9986 2.31831C10.9034 2.18976 10.7879 2.07638 10.6568 1.98298C10.495 1.86762 10.2704 1.7858 9.84814 1.7409C9.41445 1.69482 8.84789 1.69427 8.02789 1.69427H5.4821C4.66215 1.69427 4.09555 1.69485 3.66184 1.7409C3.23978 1.78576 3.01501 1.86773 2.85315 1.98298C2.72221 2.07632 2.60657 2.18986 2.51139 2.31831C2.39384 2.4771 2.31045 2.69763 2.26467 3.1118C2.21772 3.53731 2.21716 4.09333 2.21716 4.89782V8.91011C2.21716 9.71498 2.21771 10.2714 2.26467 10.697C2.3104 11.111 2.39397 11.3308 2.51139 11.4896C2.60659 11.6182 2.72214 11.7315 2.85315 11.825C3.01505 11.9404 3.23938 12.023 3.66184 12.0679C4.09555 12.114 4.66212 12.1146 5.4821 12.1146H5.97554L4.80224 13.3034C4.3108 13.3002 3.88905 13.2923 3.53026 13.2541C3.00445 13.1982 2.5423 13.0784 2.13857 12.7906C1.90424 12.6235 1.6975 12.4216 1.52725 12.1917C1.23396 11.7955 1.1118 11.3412 1.05483 10.8252C0.999149 10.3205 1 9.68831 1 8.91011V4.89782C1 4.11964 0.999094 3.48743 1.05483 2.98269C1.11182 2.46701 1.23416 2.01316 1.52725 1.61716C1.69745 1.3874 1.90437 1.1843 2.13857 1.01734C2.54218 0.729872 3.00468 0.609682 3.53026 0.553797C4.04472 0.499135 4.68896 0.500001 5.4821 0.500001H8.02789Z"
      fill="currentColor"
    />
    <path d="M12.6413 13.2999H8.82536L10.0608 12.1056H12.6413V13.2999Z" fill="currentColor" />
    <path
      d="M7.22216 11.8899L6.53753 13.2335C6.4571 13.3913 6.62775 13.5587 6.78861 13.4798L8.15787 12.8081L13 8.08806L12.0643 7.16994L7.22216 11.8899Z"
      fill="currentColor"
    />
  </svg>
)

/** ic_ds_paper_plane_outline_14 */
export const IconPaperPlaneOutline14 = ({ size = 14, className }: IconProps): ReactElement => (
  <svg width={size} height={size} className={className} viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path
      d="M11.8249 1.11733C12.4401 0.929305 13.0795 1.42149 13.0238 2.08968L12.2321 11.5935C12.1751 12.2735 11.4312 12.6646 10.8386 12.3263L7.99539 10.7011L6.0967 12.7005L6.07413 12.7248L6.04808 12.7465C5.55601 13.1565 4.80867 12.8069 4.80833 12.1665V8.69211C4.80843 8.44469 4.90686 8.20727 5.08181 8.0323L9.79684 3.31641L2.46775 6.6988L4.10251 7.35253L3.67364 8.42559L1.57874 7.5878V7.5852C0.807611 7.2988 0.757207 6.21577 1.5145 5.86622L11.7025 1.16421L11.8249 1.11733ZM5.96474 11.1603L6.9614 10.1107L5.96474 9.54118V11.1603ZM6.32937 8.41864L11.1086 11.149L11.791 2.95698L6.32937 8.41864Z"
      fill="currentColor"
    />
  </svg>
)

/** ic_ds_compact_outline_16 */
export const IconCompactOutline16 = ({ size = 16, className }: IconProps): ReactElement => (
  <svg width={size} height={size} className={className} viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
    <circle cx="8" cy="8" r="6.4" stroke="currentColor" strokeWidth="1.6" opacity="0.35" />
    <path d="M8 1.6A6.4 6.4 0 0 1 14.4 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
  </svg>
)

const SHIELD_OUTLINE_PATH =
  'M8.20554 0.899994L14.7901 3.36857V7.01026C14.7901 12 11.0466 14.2103 8.20554 15.3C5.36446 14.2103 1.62012 12 1.62012 7.01026V3.36857L8.20554 0.899994Z'

const SHIELD_OUTLINE_STROKE = '1.31831'

/** ic_ds_shield_outline_16 */
export const IconShieldOutline16 = ({ size = 16, className }: IconProps): ReactElement => (
  <svg width={size} height={size} className={className} viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d={SHIELD_OUTLINE_PATH} stroke="currentColor" strokeWidth={SHIELD_OUTLINE_STROKE} strokeLinejoin="round" />
  </svg>
)
