// Phone photos run 2–5MB; resize in the browser so they fit the 200KB-per-photo local limit. Tally sheet photos keep
// more detail (thread damage has to be legible), since they're stored apart from the record.
export async function shrinkPhoto(file: File, { edge = 1280, maxBytes = 200 * 1024 } = {}): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, edge / Math.max(bitmap.width, bitmap.height));
  const canvas = Object.assign(document.createElement("canvas"), { width: Math.round(bitmap.width * scale), height: Math.round(bitmap.height * scale) });
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas is unavailable.");
  context.fillStyle = "#fff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  let dataUrl = "";
  for (const quality of [0.8, 0.6, 0.4]) { dataUrl = canvas.toDataURL("image/jpeg", quality); if (photoBytes(dataUrl) <= maxBytes) break; }
  return dataUrl;
}

export const photoBytes = (dataUrl: string) => Math.floor((dataUrl.length - dataUrl.indexOf(",") - 1) * 3 / 4);
