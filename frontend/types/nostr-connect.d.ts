declare module '@cmdcode/nostr-connect' {
  export const InviteEncoder: {
    decode: (uri: string) => unknown
  }
  export const SignerAgent: new (...args: unknown[]) => unknown
  export const SimpleSigner: new (...args: unknown[]) => unknown
}
