export function zeroizeUint8(array?: Uint8Array | null): void {
  if (!array) return
  array.fill(0)
}

export function zeroizeAndDelete(map: Map<string, Uint8Array>, key: string): void {
  const value = map.get(key)
  if (!value) return
  zeroizeUint8(value)
  map.delete(key)
}
