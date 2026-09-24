import * as pdfjsLib from "pdfjs-dist";
import workerSrc from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { itemsToLines } from "./flipkartText";
pdfjsLib.GlobalWorkerOptions.workerSrc = workerSrc;

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

export async function fileToImageDataUrl(file) {
  if (file.type.startsWith("image/")) return blobToDataUrl(file);

  if (file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const pdf = await pdfjsLib.getDocument({ data: bytes }).promise;
    const page = await pdf.getPage(1);
    const viewport = page.getViewport({ scale: 2.2 });
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    await page.render({ canvasContext: ctx, viewport }).promise;
    return canvas.toDataURL("image/jpeg", 0.92);
  }

  throw new Error("Use a PDF, JPG, JPEG or PNG shipping label.");
}

// Like fileToImageDataUrl, but returns one image per PDF page (an image file gives a single image).
export async function fileToImageDataUrls(file) {
  if (file.type.startsWith("image/")) return [await blobToDataUrl(file)];

  if (file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const pdf = await pdfjsLib.getDocument({ data: bytes }).promise;
    const out = [];
    for (let n = 1; n <= pdf.numPages; n++) {
      const page = await pdf.getPage(n);
      const viewport = page.getViewport({ scale: 2.2 });
      const canvas = document.createElement("canvas");
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      await page.render({ canvasContext: canvas.getContext("2d"), viewport }).promise;
      out.push(canvas.toDataURL("image/jpeg", 0.92));
    }
    return out;
  }

  throw new Error("Use a PDF, JPG, JPEG or PNG shipping label.");
}

// Reads a PDF one page at a time: the embedded text (as lines) first, and a lazy image render for the Ollama fallback.
export async function fileToPdfPages(file, perf) {
  const read=()=>file.arrayBuffer();
  const bytes = new Uint8Array(perf ? await perf.async('pdf_file_read',read) : await read());
  const load=()=>pdfjsLib.getDocument({ data: bytes }).promise;
  const pdf = perf ? await perf.async('pdf_load_worker',load) : await load();
  const pages = [];
  for (let n = 1; n <= pdf.numPages; n++) {
    const page = perf ? await perf.async('pdf_get_page',()=>pdf.getPage(n),{page:n}) : await pdf.getPage(n);
    let lines = [];
    try {
      const content=perf ? await perf.async('pdf_get_text_content',()=>page.getTextContent(),{page:n}) : await page.getTextContent();
      lines = perf ? perf.sync('pdf_items_to_lines',()=>itemsToLines(content.items),{page:n,items:content.items.length}) : itemsToLines(content.items);
      perf?.log('pdf_text_ready',{page:n,lineCount:lines.length,characterCount:lines.join(' ').length});
    } catch (error) {
      // A broken text layer can still have a usable page image for Ollama.
      console.debug('[Daily Sales PDF]', { method: 'OLLAMA_FALLBACK', page: n, reason: 'text extraction failed', error: error.message });
      perf?.log('pdf_text_error',{page:n,error:error.message});
    }
    pages.push({
      lines,
      pageNumber:n,
      render: async () => {
        if (perf) perf.state.imageRenderStarted=true;
        const renderEnd=perf?.begin('pdf_to_image_render',{page:n});
        try {
        const viewport = page.getViewport({ scale: 2.2 });
        const canvas = document.createElement("canvas");
        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
        await page.render({ canvasContext: canvas.getContext("2d"), viewport }).promise;
        const encode=()=>canvas.toDataURL("image/jpeg", 0.92);
        const image=perf ? perf.sync('pdf_image_encoding',encode,{page:n}) : encode();
        if (perf) perf.state.imageRendered=true;
        renderEnd?.();
        return image;
        } catch(error) { renderEnd?.({error:error.message}); throw error; }
      }
    });
  }
  return pages;
}
