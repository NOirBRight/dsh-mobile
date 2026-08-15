/** Minimal tweetnacl typing for the surface this package uses (the @types package is unavailable on our mirror). */
declare module 'tweetnacl' {
  interface BoxKeyPair {
    publicKey: Uint8Array
    secretKey: Uint8Array
  }
  interface Box {
    (msg: Uint8Array, nonce: Uint8Array, publicKey: Uint8Array, secretKey: Uint8Array): Uint8Array
    open(boxed: Uint8Array, nonce: Uint8Array, publicKey: Uint8Array, secretKey: Uint8Array): Uint8Array | null
    keyPair(): BoxKeyPair
    readonly publicKeyLength: number
    readonly secretKeyLength: number
    readonly nonceLength: number
    readonly overheadLength: number
  }
  interface Nacl {
    box: Box
    randomBytes(n: number): Uint8Array
  }
  const nacl: Nacl
  export default nacl
}
