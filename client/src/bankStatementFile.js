import * as pdfjsLib from 'pdfjs-dist';
import workerSrc from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
pdfjsLib.GlobalWorkerOptions.workerSrc = workerSrc;

export async function statementInput(file) {
  if (!file || !/\.(pdf|csv|xlsx)$/i.test(file.name)) throw new Error('Select a PDF, CSV or XLSX statement.');
  if (!file.size || file.size > 15 * 1024 * 1024) throw new Error('Statements must be between 1 byte and 15 MB.');
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (/\.pdf$/i.test(file.name)) {
    const loading = pdfjsLib.getDocument({ data: bytes });
    const pdf = await loading.promise;
    try {
      if (pdf.numPages > 300) throw new Error('Split statements longer than 300 pages.');
      const pages = [];
      for (let number = 1; number <= pdf.numPages; number++) {
        const page = await pdf.getPage(number);
        const text = await page.getTextContent();
        pages.push({ pageNumber: number, items: text.items.filter(item => typeof item.str === 'string').map(item => ({ text: item.str, x: item.transform[4], y: item.transform[5] })) });
      }
      return { filename: file.name, pages };
    } finally { await loading.destroy(); }
  }
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 8192) binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  return { filename: file.name, base64: btoa(binary) };
}
