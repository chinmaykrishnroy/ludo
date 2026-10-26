export const PHOTO_MAX_EDGE = 1080;
export const PHOTO_TARGET_BYTES = 256 * 1024;
export const PHOTO_MAX_BYTES = 1024 * 1024;
export const PHOTO_SOURCE_BYTES = 20 * 1024 * 1024;
export function fitPhoto(width: number, height: number) {
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width < 1 ||
    height < 1
  )
    throw new Error("This photo has invalid dimensions.");
  const scale = Math.min(1, PHOTO_MAX_EDGE / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}
/** Read bounded JPEG frame headers rather than client-supplied dimensions. */
export function jpegDimensions(bytes: Uint8Array) {
  if (
    bytes.length < 16 ||
    bytes.length > PHOTO_MAX_BYTES ||
    bytes[0] !== 0xff ||
    bytes[1] !== 0xd8 ||
    bytes.at(-2) !== 0xff ||
    bytes.at(-1) !== 0xd9
  )
    throw new Error("Choose a JPEG photo up to 1 MB.");
  let offset = 2,
    size: { width: number; height: number } | undefined;
  while (offset < bytes.length - 2) {
    if (bytes[offset++] !== 0xff) break;
    while (bytes[offset] === 0xff) offset++;
    const marker = bytes[offset++];
    if (marker === 0xda) {
      if (size) return size;
      break;
    }
    if (marker === 0xd9 || offset + 2 > bytes.length) break;
    const length = bytes[offset] * 256 + bytes[offset + 1];
    if (length < 2 || offset + length > bytes.length) break;
    if ([0xc0, 0xc1, 0xc2].includes(marker)) {
      if (length < 8 || bytes[offset + 2] !== 8) break;
      const height = bytes[offset + 3] * 256 + bytes[offset + 4],
        width = bytes[offset + 5] * 256 + bytes[offset + 6];
      if (
        !width ||
        !height ||
        width > PHOTO_MAX_EDGE ||
        height > PHOTO_MAX_EDGE
      )
        throw new Error("Photos must be resized to a maximum 1080-pixel edge.");
      size = { width, height };
    }
    offset += length;
  }
  throw new Error("This photo could not be read. Choose another photo.");
}
