import { call, CloudGarment } from './cloud';

export type WardrobeGarment = Omit<CloudGarment, 'deletedAt'> & { locationId?: string; updatedAt?: number; deletedAt?: number; restoreUntil?: number };
export interface Location { id: string; name: string; parentId: string; version: number }
export interface Outfit {
  id: string; memberId: string; name: string; partial: boolean; version: number;
  occasion?: string; reason?: string; garmentIds: string[]; valid: boolean; issues: Array<{id: string; code: string}>;
  garments: Array<WardrobeGarment & { available: boolean; currentVersion: number | null }>;
}
export interface VersionRef { id: string; version: number }
export const categories: CloudGarment['category'][] = ['onepiece', 'top', 'bottom', 'hat'];
export const categoryNames = ['整装', '上衣', '裤子', '帽子'];
export const emptyForm = { name: '', categoryIndex: 0, memberIndex: 0, color: '', season: '', material: '', location: '', locationId: '', notes: '' };
export type GarmentForm = typeof emptyForm;
export const wardrobe = <T>(action: string, input: Record<string, unknown> = {}) => call<T>('wardrobe', action, input);
export const viewGarment = (g: WardrobeGarment) => ({ ...g, categoryLabel: categoryNames[categories.indexOf(g.category)], restoreLabel: g.restoreUntil ? new Date(g.restoreUntil).toLocaleDateString() : '', checked: false });
export type ViewGarment = ReturnType<typeof viewGarment>;
export function outfitProblem(items: WardrobeGarment[], memberId: string, partial: boolean): string {
  if (!memberId) return '请先选择一位衣物归属成员';
  if (!items.length || items.length > 3) return '每套请选择1～3件真实衣物';
  if (items.some(g => g.memberId !== memberId)) return '搭配仅支持同一成员的衣物';
  const slots = items.map(g => g.category);
  if (new Set(slots).size !== slots.length) return '每个分类只能选择一件，可先移除再替换';
  if (slots.includes('onepiece') && (slots.includes('top') || slots.includes('bottom'))) return '整装不能与上衣或裤子混搭';
  if (!partial && !slots.includes('onepiece') && !(slots.includes('top') && slots.includes('bottom'))) return '完整搭配需要整装，或上衣与裤子；缺件请开启“局部搭配”';
  return '';
}
