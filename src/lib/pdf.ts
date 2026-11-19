/**
 * PDF text extraction, on-device. pdfjs-dist is loaded lazily (dynamic
 * import + worker) so it never weighs down the main bundle. Only the text
 * layer is read: a scanned, image-only PDF yields no text and the caller
 * says so plainly instead of loading an empty document.
 */

export const MAX_PDF_TEXT_CHARS = 200_000;

export interface JoinedPages {
  text: string;
  truncated: boolean;
}

/** Join per-page text items into document text (pure — unit-tested). */
export function joinPageTexts(pages: string[][], maxChars = MAX_PDF_TEXT_CHARS): JoinedPages {
  const joined = pages.map((items) => items.join(" ")).join("\n\n");
  if (joined.length <= maxChars) return { text: joined, truncated: false };
  return { text: joined.slice(0, maxChars), truncated: true };
}

/** Extract the text layer of a PDF file. Throws when there is no text. */
export async function extractPdfText(file: File): Promise<JoinedPages> {
  const pdfjs = await import("pdfjs-dist");
  const workerUrl = (await import("pdfjs-dist/build/pdf.worker.min.mjs?url")).default;
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
  const data = await file.arrayBuffer();
  const doc = await pdfjs.getDocument({ data }).promise;
  const pages: string[][] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    pages.push(
      content.items.map((item) => ("str" in item ? (item as { str: string }).str : "")),
    );
  }
  const joined = joinPageTexts(pages);
  if (joined.text.trim().length === 0) {
    throw new Error(
      "No extractable text in that PDF — it looks like scanned images. Paste the text instead.",
    );
  }
  return joined;
}
