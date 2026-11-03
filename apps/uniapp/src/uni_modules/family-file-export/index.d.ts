declare module '@/uni_modules/family-file-export' {
  export interface ExportDocumentFailure { code: string; message: string }
  export interface ExportDocumentOptions {
    filePath: string;
    fileName: string;
    success?: () => void;
    fail?: (error: ExportDocumentFailure) => void;
  }
  export function exportDocument(options: ExportDocumentOptions): void;
  export interface ReadLocalBase64Options {
    filePath: string;
    success: (base64: string) => void;
    fail: (error: ExportDocumentFailure) => void;
  }
  export function readLocalBase64(options: ReadLocalBase64Options): void;
  export interface WriteLocalBase64Options {
    filePath: string;
    base64: string;
    success: () => void;
    fail: (error: ExportDocumentFailure) => void;
  }
  export function writeLocalBase64(options: WriteLocalBase64Options): void;
}
