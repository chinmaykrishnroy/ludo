import {
  fitPhoto,
  PHOTO_MAX_BYTES,
  PHOTO_SOURCE_BYTES,
  PHOTO_TARGET_BYTES,
} from "../shared/photo";
export async function preparePhoto(file: File): Promise<File> {
  if (file.size > PHOTO_SOURCE_BYTES)
    throw new Error("Choose a photo smaller than 20 MB before compression.");
  if (!/^image\/(jpeg|png|webp|avif|heic|heif|bmp)$/.test(file.type))
    throw new Error(
      "Choose a photo or GIF. This image format is not supported.",
    );
  const url = URL.createObjectURL(file),
    image = new Image(),
    canvas = document.createElement("canvas");
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () =>
        reject(
          new Error(
            "Your browser cannot open this photo format. Try JPEG or PNG.",
          ),
        );
      timer = setTimeout(
        () =>
          reject(
            new Error(
              "This photo took too long to open. Choose a smaller photo.",
            ),
          ),
        15000,
      );
      image.src = url;
    });
    clearTimeout(timer);
    if (image.naturalWidth * image.naturalHeight > 64_000_000)
      throw new Error("Choose a photo smaller than 64 megapixels.");
    const size = fitPhoto(image.naturalWidth, image.naturalHeight);
    canvas.width = size.width;
    canvas.height = size.height;
    const context = canvas.getContext("2d");
    if (!context)
      throw new Error("Photo compression is unavailable in this browser.");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, size.width, size.height);
    context.drawImage(image, 0, 0, size.width, size.height);
    let blob: Blob | null = null;
    for (const quality of [0.82, 0.68, 0.54, 0.4]) {
      blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, "image/jpeg", quality),
      );
      if (!blob || blob.type !== "image/jpeg")
        throw new Error("Your browser could not compress this photo.");
      if (blob.size <= PHOTO_TARGET_BYTES) break;
    }
    if (!blob || blob.size > PHOTO_MAX_BYTES)
      throw new Error("This photo is still too large. Choose a smaller photo.");
    // Re-encoding pixels drops the original photo's EXIF/GPS metadata.
    return new File([blob], "photo.jpg", { type: "image/jpeg" });
  } finally {
    clearTimeout(timer);
    image.onload = null;
    image.onerror = null;
    image.src = "";
    URL.revokeObjectURL(url);
    canvas.width = 1;
    canvas.height = 1;
  }
}
