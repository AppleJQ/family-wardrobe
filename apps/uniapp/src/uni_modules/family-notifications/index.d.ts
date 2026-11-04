export interface NotificationPermissionOptions {
  success: (enabled: boolean) => void;
  fail: (error: { message: string }) => void;
}
export declare function notificationsEnabled(): boolean;
export declare function ensureNotificationChannel(): void;
export declare function requestNotificationPermission(options: NotificationPermissionOptions): void;
export declare function createInstallationKey(): string;
