import QRCode from 'qrcode'

/** ISO/IEC 18004 QR quiet-zone width, in modules. */
export const PAIRING_QR_QUIET_ZONE_MODULES = 4

export async function renderPairingQrSvg(value: string): Promise<string> {
  return QRCode.toString(value, {
    type: 'svg',
    margin: PAIRING_QR_QUIET_ZONE_MODULES,
    errorCorrectionLevel: 'M',
  })
}
