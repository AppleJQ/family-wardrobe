import { call } from './cloud';
import { GarmentCategory } from './store';

export interface AiTask {
  id: string; type: 'recognize' | 'recommend'; status: 'running' | 'succeeded' | 'failed' | 'unknown';
  errorCode: string; billingState: 'not_submitted' | 'rejected' | 'reported' | 'unknown';
  usage: { promptTokens: number; completionTokens: number; cachedTokens: number } | null;
  result: {
    garmentId?: string; photoRequestId?: string; needsConfirmation?: boolean;
    suggestions?: { name: string; category: GarmentCategory | null; color: string; season: string };
    memberId?: string; outfits?: Array<{ garmentIds: string[]; reason: string }>;
  } | null;
  createdAt: number; updatedAt: number;
}

export interface AiStatus {
  configured: boolean; dailyLimit: number; dailyUsed: number;
  usage: { promptTokens: number; completionTokens: number; cachedTokens: number };
  usageScope: 'current_family'; capabilities: string[];
}
export const getAiStatus = () => call<AiStatus>('ai', 'status');
export const listAiTasks = (cursor = '') => call<{items: AiTask[]; cursor: string}>('ai', 'list', {cursor});
export const getAiTask = (taskId: string) => call<AiTask>('ai', 'get', { taskId });
// The caller persists one requestId per user action and reuses it after a network failure.
export const recognizeGarment = (garmentId: string, requestId: string) => call<AiTask>('ai', 'recognize', { garmentId, requestId });
export const recognizePhoto = (memberId: string, requestId: string, base64: string) => call<AiTask>('ai', 'recognizePhoto', { memberId, requestId, base64 });
export const recommendOutfits = (input: { memberId: string; requestId: string; occasion?: string; season?: string; lockedGarmentIds?: string[] }) => call<AiTask>('ai', 'recommend', input);
