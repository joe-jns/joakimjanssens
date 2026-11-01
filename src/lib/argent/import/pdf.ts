import type { PdfItem } from "./types";

export async function readPdfItems(file: File): Promise<PdfItem[]> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.min.mjs");
  const worker = (await import("pdfjs-dist/legacy/build/pdf.worker.min.mjs?url")).default;
  pdfjs.GlobalWorkerOptions.workerSrc = worker;
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  const items: PdfItem[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const content = await (await doc.getPage(p)).getTextContent();
    for (const it of content.items as { str: string; transform: number[]; height: number }[])
      if (it.str.trim())
        items.push({ page: p, x: it.transform[4], y: Math.round(it.transform[5] * 2) / 2, h: it.height, s: it.str.trim() });
  }
  // Ordre de lecture : page, puis de haut en bas, puis de gauche à droite.
  return items.sort((a, b) => a.page - b.page || b.y - a.y || a.x - b.x);
}
