/** Dependency-free wire types shared with the uni-app client. */
export interface CycleSettings { cycleLength: number | null; periodLength: number | null; predictionPaused: boolean }
export interface CyclePeriod { id: string; start: string; end: string; updatedBy: string; updatedAt: number; deletedAt: number | null }
export type CycleSymptom = 'none' | 'mild_cramps' | 'strong_cramps' | 'backache' | 'breast_tenderness' | 'fatigue' | 'headache';
export interface CycleDailyInput {
  date: string; flow: '' | 'light' | 'medium' | 'heavy'; symptoms: CycleSymptom[];
  mood: '' | 'happy' | 'calm' | 'low' | 'irritable' | 'anxious'; intimacy: boolean | null;
  ovulationTest: '' | 'negative' | 'weak_positive' | 'positive';
}
export interface CycleDaily extends CycleDailyInput { updatedBy: string; updatedAt: number; deletedAt: number | null }
export interface CycleProfile {
  id: string; memberId: string; accessUserIds: string[]; version: number; settings: CycleSettings;
  periods: CyclePeriod[]; daily: CycleDaily[]; createdBy: string; updatedBy: string; createdAt: number; updatedAt: number;
}
export interface CycleStatistics {
  cycles: Array<{ start: string; end: string; days: number }>;
  periods: Array<{ start: string; end: string; days: number }>;
  averageCycle: number | null; averagePeriod: number | null; shortest: number | null; longest: number | null; difference: number | null;
}
export interface CyclePrediction {
  start: string; end: string; ovulation: string; fertileStart: string; fertileEnd: string;
  preliminary: boolean; cycleDay: number; daysUntil: number;
}
export interface CycleHome {
  profile: CycleProfile | null; today: string; statistics: CycleStatistics; prediction: CyclePrediction | null;
  predictionReason: string; aiAvailable: boolean;
}
export type CycleAiStatus = 'running' | 'succeeded' | 'failed' | 'unknown';
export interface CycleAiResult {
  requestId: string; status: CycleAiStatus; generatedAt: number; profileVersion: number; stale: boolean;
  range: { start: string; end: string; cycles: number; periods: number; dailyDays: number };
  statistics: CycleStatistics;
  sections: Array<{ title: string; content: string }>;
  error: string;
}
/** Persistence only; never return underlying request or provider metadata to a client. */
export interface CycleProfileRecord extends Omit<CycleProfile, 'id'> {
  _id: string; familyId: string; setupRequestId: string; setupFingerprint: string;
  lastMutation?: { requestId: string; fingerprint: string };
}
export interface CycleMutationReceipt {
  _id: string; familyId: string; createdBy: string; createdAt: number; updatedAt: number; fingerprint: string;
}
export interface CycleAiRequest {
  _id: string; familyId: string; createdBy: string; createdAt: number; updatedAt: number; requestId: string;
  profileVersion: number; fingerprint: string; fence: string; status: CycleAiStatus; result: CycleAiResult | null;
  providerRequestId: string; billingState: 'not_submitted' | 'rejected' | 'reported' | 'unknown';
  usage: { promptTokens: number; completionTokens: number; cachedTokens: number } | null; error: string;
}
