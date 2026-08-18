/** Native QR acquisition boundary for Android automatic pairing. */
import { parseOffer } from '@dsh-mobile/e2e-tunnel'
import { claimedNativeBridges, concealShellNativeBridges } from './native-bridges.ts'

export interface BarcodeScanResult { ScanResult: string }
export type ScanBarcode = () => Promise<BarcodeScanResult>
export type EnsureCameraPermission = () => Promise<void>

async function ensureNativeCameraPermission(): Promise<void> {
  await claimedNativeBridges().ensureCamera()
}

async function scanNativeQr(): Promise<BarcodeScanResult> {
  // Lazy import keeps this pure boundary testable in Node; Vite bundles the native plugin locally.
  const scanner = await import('@capacitor/barcode-scanner')
  try {
    return await scanner.CapacitorBarcodeScanner.scanBarcode({
      hint: scanner.CapacitorBarcodeScannerTypeHint.QR_CODE,
      cameraDirection: scanner.CapacitorBarcodeScannerCameraDirection.BACK,
      scanOrientation: scanner.CapacitorBarcodeScannerScanOrientation.PORTRAIT,
      scanInstructions: '扫描桌面端显示的 DSH Mobile 配对二维码',
      cancelButtonAccessibilityLabel: '取消扫码',
      android: { scanningLibrary: scanner.CapacitorBarcodeScannerAndroidScanningLibrary.ZXING },
    })
  } finally {
    concealShellNativeBridges()
  }
}

/** Scan one QR code and fail loud unless it is a current, valid DSH offer. */
export async function scanPairingQr(scan: ScanBarcode = scanNativeQr, ensurePermission: EnsureCameraPermission = ensureNativeCameraPermission): Promise<string> {
  // Resolve the system permission dialog on MainActivity before launching the scanner Activity.
  // Some Android vendors otherwise resume MainActivity and orphan the pending ActivityResult callback.
  await ensurePermission()
  const result = (await scan()).ScanResult.trim()
  if (result === '') throw new Error('pairing scan cancelled')
  try {
    parseOffer(result)
  } catch {
    throw new Error('QR code is not a valid DSH pairing code')
  }
  return result
}
