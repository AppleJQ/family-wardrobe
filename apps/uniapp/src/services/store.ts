import { platform as wx } from '../platform/runtime';
export type MemberId = 'me' | 'family-a';
export type GarmentCategory = 'onepiece' | 'top' | 'bottom' | 'hat';
export type GarmentStatus = 'wearable' | 'laundry' | 'storage' | 'retired';

export interface Member {
  id: MemberId;
  name: string;
  avatar: string;
  garmentCount: number;
}

export interface Garment {
  id: string;
  memberId: MemberId;
  name: string;
  category: GarmentCategory;
  color: string;
  season: string;
  material: string;
  location: string;
  notes: string;
  status: GarmentStatus;
  image: string;
  version: number;
  createdAt: string;
  deletedAt?: string;
}

export interface Outfit {
  id: string;
  memberId: MemberId;
  name: string;
  occasion: '休闲' | '通勤' | '运动';
  garmentIds: string[];
  description: string;
  favorite: boolean;
  savedAt: string;
}

interface StoredState {
  currentMemberId: MemberId;
  garments: Garment[];
  deletedGarments: Garment[];
  outfits: Outfit[];
}

export interface WardrobeStorage {
  get<T>(key: string): T | undefined;
  set<T>(key: string, value: T): void;
}

export interface GarmentDraft {
  memberId: MemberId;
  name: string;
  image: string;
  category: GarmentCategory;
  color: string;
  season: string;
  material: string;
  location: string;
  notes: string;
  status: GarmentStatus;
}

export interface GarmentFilter {
  memberId?: MemberId;
  category?: GarmentCategory | 'all';
  query?: string;
  includeDeleted?: boolean;
}

const STORAGE_KEY = 'family-wardrobe/local-state/v1';
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const now = () => new Date().toISOString().slice(0, 10);

const members: Member[] = [
  { id: 'me', name: '我', avatar: '我', garmentCount: 32 },
  { id: 'family-a', name: '家人A', avatar: 'A', garmentCount: 24 },
];

const displayGarments: Garment[] = [
  {
    id: 'me-white-top', memberId: 'me', name: '白色棉质短袖', category: 'top', color: '白色', season: '夏季', material: '棉质',
    location: '主卧衣柜／左边第二层', notes: '周末出门常穿，柔软透气', status: 'wearable', image: '/assets/figma/7924df5f279e5072655c.png', version: 1, createdAt: '2026-10-18',
  },
  {
    id: 'me-sage-bottom', memberId: 'me', name: '鼠尾草绿直筒裤', category: 'bottom', color: '鼠尾草绿', season: '四季', material: '棉麻',
    location: '主卧衣柜 · 右边挂衣区', notes: '通勤和周末都适合', status: 'wearable', image: '/assets/figma/da5d0e66dbfc055a092e.png', version: 1, createdAt: '2026-10-17',
  },
  {
    id: 'me-beige-hat', memberId: 'me', name: '米色棒球帽', category: 'hat', color: '米色', season: '四季', material: '棉质',
    location: '玄关柜 · 上层收纳盒', notes: '出门前方便取用', status: 'wearable', image: '/assets/figma/4c0d9590264694c49322.png', version: 1, createdAt: '2026-10-16',
  },
  {
    id: 'me-blue-shirt', memberId: 'me', name: '浅蓝亚麻衬衫', category: 'top', color: '浅蓝', season: '春夏', material: '亚麻',
    location: '主卧衣柜 · 左边挂衣区', notes: '轻薄透气', status: 'laundry', image: '/assets/figma/d68604184076e01554d9.png', version: 1, createdAt: '2026-10-15',
  },
];

const filler = (memberId: MemberId, index: number): Garment => {
  const names = memberId === 'me' ? ['白色针织衫', '浅灰运动裤', '黑色鸭舌帽', '米白针织开衫'] : ['家人A的白衬衫', '家人A的深色长裤', '家人A的遮阳帽', '家人A的蓝色外套'];
  const images = displayGarments.map(garment => garment.image);
  return {
    id: `${memberId}-filler-${index}`,
    memberId,
    name: names[index % names.length],
    category: index % 3 === 0 ? 'top' : index % 3 === 1 ? 'bottom' : 'hat',
    color: index % 2 ? '浅灰' : '米白',
    season: '四季',
    material: '棉质',
    location: '主卧衣柜 · 收纳区',
    notes: '',
    status: index % 7 === 0 ? 'laundry' : 'wearable',
    image: images[index % images.length],
    version: 1,
    createdAt: '2026-10-01',
  };
};

function createInitialState(): StoredState {
  const me = [...displayGarments, ...Array.from({ length: 28 }, (_, index) => filler('me', index))];
  const family = Array.from({ length: 24 }, (_, index) => filler('family-a', index));
  return {
    currentMemberId: 'me',
    garments: [...me, ...family],
    deletedGarments: [],
    outfits: [
      { id: 'me-outfit-1', memberId: 'me', name: '草木之间', occasion: '休闲', garmentIds: ['me-white-top', 'me-sage-bottom', 'me-beige-hat'], description: '白与鼠尾草绿，适合散步和周末咖啡。', favorite: true, savedAt: '10月21日' },
      { id: 'me-outfit-2', memberId: 'me', name: '慢下来的 一天', occasion: '休闲', garmentIds: ['me-white-top', 'me-sage-bottom', 'me-filler-2'], description: '换上柔软渔夫帽，留一点自然的松弛。', favorite: true, savedAt: '10月19日' },
      { id: 'family-a-outfit-1', memberId: 'family-a', name: '家人A的日常', occasion: '通勤', garmentIds: ['family-a-filler-0', 'family-a-filler-1', 'family-a-filler-2'], description: '轻松舒适的一套日常搭配。', favorite: false, savedAt: '10月18日' },
    ],
  };
}

const defaultStorage: WardrobeStorage = {
  get: <T>(key: string) => typeof wx === 'undefined' ? undefined : wx.getStorageSync(key) as T | undefined,
  set: <T>(key: string, value: T) => { if (typeof wx !== 'undefined') wx.setStorageSync(key, value); },
};

function assertMember(memberId: string): asserts memberId is MemberId {
  if (memberId !== 'me' && memberId !== 'family-a') throw new Error('成员不存在');
}

function assertName(name: string) {
  if (!name.trim()) throw new Error('名称不能为空');
}

export function createWardrobeStore(storage: WardrobeStorage = defaultStorage) {
  let state = storage.get<StoredState>(STORAGE_KEY) || createInitialState();
  const persist = () => storage.set(STORAGE_KEY, clone(state));
  const membersWithCount = () => members.map(member => ({ ...member, garmentCount: state.garments.filter(g => g.memberId === member.id && !g.deletedAt).length }));
  const find = (id: string) => state.garments.find(g => g.id === id);
  return {
    members: () => clone(membersWithCount()),
    currentMember: () => clone(members.find(member => member.id === state.currentMemberId) || members[0]),
    selectMember: (memberId: MemberId) => { assertMember(memberId); state.currentMemberId = memberId; persist(); },
    getGarment: (id: string) => { const garment = find(id); if (!garment || garment.deletedAt) throw new Error('衣物不存在'); return clone(garment); },
    listGarments: (filter: GarmentFilter = {}) => {
      const memberId = filter.memberId || state.currentMemberId;
      assertMember(memberId);
      const query = filter.query?.trim().toLowerCase();
      return clone(state.garments.filter(garment => !garment.deletedAt && garment.memberId === memberId && (!filter.category || filter.category === 'all' || garment.category === filter.category) && (!query || `${garment.name} ${garment.location}`.toLowerCase().includes(query))));
    },
    listDeleted: () => clone(state.deletedGarments),
    updateGarment: (id: string, patch: Partial<Pick<Garment, 'name' | 'category' | 'color' | 'season' | 'material' | 'location' | 'notes' | 'status'>>, version: number) => {
      const garment = find(id);
      if (!garment || garment.deletedAt) throw new Error('衣物不存在');
      if (garment.version !== version) throw new Error('衣物已更新，请刷新后重试');
      if (patch.name !== undefined) assertName(patch.name);
      Object.assign(garment, patch, { version: garment.version + 1 });
      persist();
      return clone(garment);
    },
    removeGarment: (id: string, version: number) => {
      const garment = find(id);
      if (!garment || garment.deletedAt) throw new Error('衣物不存在');
      if (garment.version !== version) throw new Error('衣物已更新，请刷新后重试');
      garment.deletedAt = now();
      state.deletedGarments.push(clone(garment));
      persist();
    },
    restoreGarment: (id: string) => {
      const deleted = state.deletedGarments.find(g => g.id === id);
      const garment = find(id);
      if (!deleted || !garment) throw new Error('回收站中没有这件衣物');
      delete garment.deletedAt;
      state.deletedGarments = state.deletedGarments.filter(item => item.id !== id);
      persist();
    },
    addGarments: (drafts: GarmentDraft[]) => {
      const checked = drafts.map((draft, index) => {
        assertMember(draft.memberId);
        assertName(draft.name);
        return { ...draft, id: `local-${Date.now()}-${index}`, version: 1, createdAt: now() } as Garment;
      });
      state.garments.push(...checked);
      persist();
      return clone(checked);
    },
    listOutfits: (memberId: MemberId = state.currentMemberId) => { assertMember(memberId); return clone(state.outfits.filter(outfit => outfit.memberId === memberId)); },
    toggleFavorite: (id: string) => { const outfit = state.outfits.find(item => item.id === id); if (!outfit) throw new Error('搭配不存在'); outfit.favorite = !outfit.favorite; persist(); return outfit.favorite; },
    outfitGarments: (outfit: Outfit) => outfit.garmentIds.map(id => find(id)).filter((garment): garment is Garment => Boolean(garment && !garment.deletedAt)).map(clone),
    exportData: () => JSON.stringify(clone(state)),
  };
}
