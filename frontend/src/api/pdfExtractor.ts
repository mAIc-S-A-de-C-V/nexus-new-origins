import { pdfExtractorClient, PDF_EXTRACTOR_BASE_URL } from './client';

export interface PdfJob {
  id: string;
  tenant_id: string;
  filename: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  model: string;
  dpi: number;
  page_range: string | null;
  total_pages: number | null;
  pages_done: number;
  products_found: number;
  error: string | null;
  progress_log: Array<{
    event: string;
    page?: number;
    page_type?: string;
    category?: string;
    products?: number;
    error?: string | null;
    total_pages?: number;
  }>;
  pushed_to_object_type_id: string | null;
  pushed_at: string | null;
  created_at: string | null;
  updated_at: string | null;
}

export interface PdfProduct {
  id: string;
  page: number;
  category: string | null;
  name: string | null;
  sku_internal: string | null;
  sku_ref: string | null;
  specifications: Record<string, string>;
  accessories: string[];
  variants: Array<Record<string, string>>;
  image_url: string | null;
}

export interface CreateJobOptions {
  file: File;
  model?: string;
  dpi?: number;
  pageRange?: string;       // "13-20"
  schemaPrompt?: string;    // override default catalog prompt
  onUploadProgress?: (pct: number, loadedBytes: number, totalBytes: number) => void;
  signal?: AbortSignal;     // pass an AbortController.signal to cancel
}

export async function createJob(opts: CreateJobOptions): Promise<PdfJob> {
  const form = new FormData();
  form.append('file', opts.file);
  if (opts.model) form.append('model', opts.model);
  if (opts.dpi != null) form.append('dpi', String(opts.dpi));
  if (opts.pageRange) form.append('page_range', opts.pageRange);
  if (opts.schemaPrompt) form.append('schema_prompt', opts.schemaPrompt);
  const resp = await pdfExtractorClient.post<PdfJob>('/pdf-jobs', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
    // 0 = no timeout. Large catalogs (100+ MB) on residential uplinks easily
    // exceed any reasonable axios timeout; let the request run as long as the
    // browser allows. The user sees percent progress via onUploadProgress
    // and can cancel via the signal.
    timeout: 0,
    maxContentLength: Infinity,
    maxBodyLength: Infinity,
    signal: opts.signal,
    onUploadProgress: (e) => {
      if (!opts.onUploadProgress) return;
      const total = e.total || opts.file.size || 0;
      const loaded = e.loaded || 0;
      const pct = total > 0 ? Math.min(100, Math.round((loaded / total) * 100)) : 0;
      opts.onUploadProgress(pct, loaded, total);
    },
  });
  return resp.data;
}

export async function listJobs(): Promise<PdfJob[]> {
  const resp = await pdfExtractorClient.get<PdfJob[]>('/pdf-jobs');
  return resp.data;
}

export async function getJob(jobId: string): Promise<PdfJob> {
  const resp = await pdfExtractorClient.get<PdfJob>(`/pdf-jobs/${jobId}`);
  return resp.data;
}

export async function listJobProducts(jobId: string, limit = 500): Promise<PdfProduct[]> {
  const resp = await pdfExtractorClient.get<PdfProduct[]>(`/pdf-jobs/${jobId}/products`, {
    params: { limit },
  });
  return resp.data;
}

export async function deleteJob(jobId: string): Promise<void> {
  await pdfExtractorClient.delete(`/pdf-jobs/${jobId}`);
}

export async function pushToOntology(
  jobId: string,
  objectTypeId: string,
  fieldMap: Record<string, string> = {},
): Promise<PdfJob> {
  const resp = await pdfExtractorClient.post<PdfJob>(`/pdf-jobs/${jobId}/push-to-ontology`, {
    object_type_id: objectTypeId,
    field_map: fieldMap,
  });
  return resp.data;
}

export function csvDownloadUrl(jobId: string): string {
  return `${PDF_EXTRACTOR_BASE_URL}/pdf-jobs/${jobId}/csv`;
}

// Browser's <a download> can't send Authorization headers — so for the
// CSV download we fetch as a blob ourselves, then trigger a save.
export async function downloadCsv(jobId: string, filename: string): Promise<void> {
  const resp = await pdfExtractorClient.get(`/pdf-jobs/${jobId}/csv`, {
    responseType: 'blob',
  });
  const blob = new Blob([resp.data as Blob], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
