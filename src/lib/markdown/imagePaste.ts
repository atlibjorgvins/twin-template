// Image paste/drop handler. When the user pastes or drops an image into
// the editor we upload it to Directus and insert the resulting markdown
// image reference at the cursor. Failure is non-destructive — the
// original paste/drop is suppressed (so you don't get binary garbage in
// the doc) and any error is surfaced through the `onError` callback.

import { EditorView } from '@codemirror/view';
import { uploadFile, assetUrl } from '$lib/directus';
import { insertImage } from './commands';

type Options = {
  onUploading?: (active: boolean) => void;
  onError?: (msg: string) => void;
};

function pickImageFile(items: DataTransferItemList | null, files: FileList | null): File | null {
  if (items) {
    for (const it of Array.from(items)) {
      if (it.kind === 'file' && it.type.startsWith('image/')) {
        const f = it.getAsFile();
        if (f) return f;
      }
    }
  }
  if (files) {
    for (const f of Array.from(files)) {
      if (f.type.startsWith('image/')) return f;
    }
  }
  return null;
}

export function imagePasteExtension(opts: Options = {}) {
  async function handleFile(view: EditorView, file: File) {
    opts.onUploading?.(true);
    try {
      const id = await uploadFile(file, { title: file.name || 'pasted-image' });
      // 1200px wide, fit=cover capped — fine default for most notes.
      const url = assetUrl(id, { width: 1200 });
      insertImage(view, url || `/assets/${id}`, file.name?.replace(/\.[^.]+$/, '') || 'image');
    } catch (e) {
      opts.onError?.(e instanceof Error ? e.message : String(e));
    } finally {
      opts.onUploading?.(false);
    }
  }

  return EditorView.domEventHandlers({
    paste(event, view) {
      const file = pickImageFile(event.clipboardData?.items ?? null, event.clipboardData?.files ?? null);
      if (!file) return false;
      event.preventDefault();
      void handleFile(view, file);
      return true;
    },
    drop(event, view) {
      const file = pickImageFile(event.dataTransfer?.items ?? null, event.dataTransfer?.files ?? null);
      if (!file) return false;
      event.preventDefault();
      void handleFile(view, file);
      return true;
    }
  });
}
