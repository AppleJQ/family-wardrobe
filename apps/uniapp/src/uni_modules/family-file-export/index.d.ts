declare module '@/uni_modules/family-file-export' {
  export interface ExportDocumentFailure { code: string; message: string }
  export interface ExportDocumentOptions {
    filePath: string;
    fileName: string;
    success?: () => void;
    fail?: (error: ExportDocumentFailure) => void;
  }
  export function exportDocument(options: ExportDocumentOptions): void;
}
