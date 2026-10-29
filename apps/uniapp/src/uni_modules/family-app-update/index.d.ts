export interface VerifyApkOptions {
  filePath: string; sha256: string; size: number; versionCode: number;
  success?: () => void; fail?: (error: { message: string }) => void;
}
export declare function verifyApk(options: VerifyApkOptions): void;
export declare function canInstallPackages(): boolean;
export declare function openInstallSettings(): void;
