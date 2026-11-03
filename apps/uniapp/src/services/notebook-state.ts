import type { NotebookHome } from './notebook';
export interface CalendarDay { date: string; label: number; inMonth: boolean }
interface Participants { participantMemberIds?: string[]; participantUserIds: string[] }
export function selectedMemberIds(entry: Participants, home: Pick<NotebookHome, 'members'>): string[] {
  return entry.participantMemberIds ?? entry.participantUserIds.map(id => home.members.find(m => m.linkedUserId === id)?.id || id);
}
export function participantNames(entry: Participants, home: Pick<NotebookHome, 'members' | 'accounts'>): string[] {
  return selectedMemberIds(entry, home).map(id => home.members.find(m => m.id === id)?.name
    || home.accounts.find(a => a.userId === id)?.name || '已移除的家庭成员');
}
export function beijingToday(now = Date.now()): string {
  return new Date(now + 8 * 3600000).toISOString().slice(0, 10);
}
function dateValue(date: string): Date { return new Date(`${date}T00:00:00Z`); }
function iso(date: Date): string { return date.toISOString().slice(0, 10); }
export function shiftDate(date: string, days: number): string {
  const value = dateValue(date); value.setUTCDate(value.getUTCDate() + days); return iso(value);
}
export function monthDays(selected: string): CalendarDay[] {
  const first = dateValue(`${selected.slice(0, 7)}-01`);
  const month = first.getUTCMonth();
  const offset = (first.getUTCDay() + 6) % 7;
  const last = new Date(Date.UTC(first.getUTCFullYear(), month + 1, 0));
  const count = Math.ceil((offset + last.getUTCDate()) / 7) * 7;
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(first); date.setUTCDate(1 - offset + index);
    return { date: iso(date), label: date.getUTCDate(), inMonth: date.getUTCMonth() === month };
  });
}
export function shiftMonth(selected: string, amount: number): string {
  const date = dateValue(`${selected.slice(0, 7)}-01`); date.setUTCMonth(date.getUTCMonth() + amount); return iso(date);
}
export function weekendDates(today = beijingToday()): string[] {
  const day = (dateValue(today).getUTCDay() + 6) % 7;
  return [shiftDate(today, 5 - day), shiftDate(today, 6 - day)];
}
export function dateLabel(date: string): string {
  if (!date) return ''; const d = dateValue(date);
  return `${d.getUTCMonth() + 1}月${d.getUTCDate()}日 · 周${'日一二三四五六'[d.getUTCDay()]}`;
}
interface TimedEvent extends Participants { id?: string; kind?: string; status?: string; date: string; startTime: string; endTime: string; eventState?: string }
export function findConflicts<T extends TimedEvent>(draft: TimedEvent, entries: T[]): T[] {
  if (!draft.startTime || !draft.endTime) return [];
  return entries.filter(entry => entry.id !== draft.id && entry.kind === 'event' && entry.status === 'active'
    && entry.eventState !== 'cancelled' && entry.date === draft.date && entry.startTime && entry.endTime
    && (entry.participantUserIds.some(id => draft.participantUserIds.includes(id))
      || entry.participantMemberIds?.some(id => draft.participantMemberIds?.includes(id)))
    && entry.startTime < draft.endTime && draft.startTime < entry.endTime);
}
export function createRequestScope(account: () => string) {
  let generation = 0;
  return {
    begin: () => ({ generation: ++generation, account: account() }),
    invalidate: () => { generation++; },
    active: (request: { generation: number; account: string }) => request.generation === generation && request.account === account(),
  };
}
export function requestId(): string {
  return `nb-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}
/** Notebook wire values contain only JSON data; this also accepts Vue proxies. */
export function copyNotebookData<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
