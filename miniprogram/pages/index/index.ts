import { design } from '../../config/design-assets';
import { createWardrobeStore, Garment, GarmentCategory, MemberId, Outfit } from '../../services/store';

type Screen = 'wardrobe' | 'upload' | 'detail' | 'outfits' | 'favorites' | 'fitting' | 'history' | 'profile';
type ViewGarment = Garment & { statusLabel: string; categoryLabel: string; locationShort: string };
type ViewOutfit = Outfit & { items: ViewGarment[] };

const store = createWardrobeStore();
const categoryLabels: Record<GarmentCategory, string> = { onepiece: '整装', top: '上衣', bottom: '裤子', hat: '帽子' };
const statusLabels: Record<Garment['status'], string> = { wearable: '可穿', laundry: '待洗', storage: '收纳中', retired: '已淘汰' };

const toViewGarment = (garment: Garment): ViewGarment => ({
  ...garment,
  statusLabel: statusLabels[garment.status],
  categoryLabel: categoryLabels[garment.category],
  locationShort: garment.location.replace('／', ' · '),
});

const toViewOutfit = (outfit: Outfit): ViewOutfit => ({
  ...outfit,
  items: store.outfitGarments(outfit).map(toViewGarment),
});

const toast = (title: string) => wx.showToast({ title, icon: 'none', duration: 1600 });

Page({
  data: {
    screen: 'wardrobe' as Screen,
    scrollTop: 0,
    query: '',
    category: 'all' as GarmentCategory | 'all',
    member: store.currentMember(),
    members: store.members(),
    garments: [] as ViewGarment[],
    topGarments: [] as ViewGarment[],
    selectedGarment: null as ViewGarment | null,
    outfits: [] as ViewOutfit[],
    favorites: [] as ViewOutfit[],
    uploadGarments: [] as ViewGarment[],
    uploadIndex: 0,
    showMembers: false,
    taskCreated: false,
    statusOptions: [
      { value: 'wearable', label: '可穿' },
      { value: 'laundry', label: '待洗' },
      { value: 'storage', label: '收纳中' },
      { value: 'retired', label: '已淘汰' },
    ] as Array<{ value: Garment['status']; label: string }>,
    assets: {
      wardrobe: design.wardrobe,
      upload: design.upload,
      detail: design.detail,
      outfits: design.outfits,
      favorites: design.favorites,
      fitting: design.fitting,
      history: design.history,
      profile: design.profile,
    },
  },

  onLoad() {
    this.refresh();
  },

  refresh() {
    const member = store.currentMember();
    const garments = store.listGarments({ memberId: member.id, category: this.data.category, query: this.data.query }).map(toViewGarment);
    const outfits = store.listOutfits(member.id).map(toViewOutfit);
    const selected = this.data.selectedGarment ? toViewGarment(store.getGarment(this.data.selectedGarment.id)) : null;
    this.setData({ member, members: store.members(), garments, topGarments: garments.slice(0, 3), outfits, favorites: outfits.filter(outfit => outfit.favorite), selectedGarment: selected });
  },

  showScreen(screen: Screen) {
    this.setData({ screen, showMembers: false, scrollTop: 0 });
    this.refresh();
  },

  navTap(event: WechatMiniprogram.TouchEvent) {
    const target = event.currentTarget.dataset.target as Screen;
    this.showScreen(target);
  },

  back() {
    this.showScreen('wardrobe');
  },

  toggleMembers() {
    this.setData({ showMembers: !this.data.showMembers });
  },

  selectMember(event: WechatMiniprogram.TouchEvent) {
    store.selectMember(event.currentTarget.dataset.memberId as MemberId);
    this.setData({ screen: 'wardrobe', query: '', category: 'all', showMembers: false, scrollTop: 0 });
    this.refresh();
  },

  onSearch(event: WechatMiniprogram.Input) {
    this.setData({ query: event.detail.value });
    this.refresh();
  },

  selectCategory(event: WechatMiniprogram.TouchEvent) {
    this.setData({ category: event.currentTarget.dataset.category as GarmentCategory | 'all' });
    this.refresh();
  },

  openGarment(event: WechatMiniprogram.TouchEvent) {
    const selected = toViewGarment(store.getGarment(event.currentTarget.dataset.id as string));
    this.setData({ selectedGarment: selected, screen: 'detail', scrollTop: 0 });
  },

  editGarment() {
    const garment = this.data.selectedGarment;
    if (!garment) return;
    wx.showModal({
      title: '编辑衣物名称',
      editable: true,
      content: garment.name,
      placeholderText: '请输入衣物名称',
      success: result => {
        if (!result.confirm || !result.content?.trim()) return;
        try {
          store.updateGarment(garment.id, { name: result.content.trim() }, garment.version);
          this.refresh();
          toast('已保存');
        } catch (error) {
          toast(error instanceof Error ? error.message : '保存失败');
        }
      },
    });
  },

  changeStatus() {
    const garment = this.data.selectedGarment;
    if (!garment) return;
    wx.showActionSheet({ itemList: ['可穿', '待洗', '收纳中', '已淘汰'], success: result => {
      const status: Garment['status'] = ['wearable', 'laundry', 'storage', 'retired'][result.tapIndex] as Garment['status'];
      store.updateGarment(garment.id, { status }, garment.version);
      this.refresh();
    } });
  },

  lockOutfit() {
    this.showScreen('outfits');
    toast('已带入搭配页');
  },

  chooseMedia() {
    wx.chooseMedia({ count: 3, mediaType: ['image'], sourceType: ['album', 'camera'], success: result => {
      const picked = result.tempFiles.map((file, index) => toViewGarment({
        id: `upload-${index}`, memberId: store.currentMember().id, name: ['白色棉质短袖', '鼠尾草绿直筒裤', '米色棒球帽'][index] || '新衣物', category: (['top', 'bottom', 'hat'][index] || 'top') as GarmentCategory,
        color: ['白色', '鼠尾草绿', '米色'][index] || '未设置', season: '夏季', material: '待确认', location: '待设置', notes: '', status: 'wearable', image: file.tempFilePath, version: 1, createdAt: '2026-10-22',
      }));
      this.setData({ screen: 'upload', uploadGarments: picked, uploadIndex: 0, scrollTop: 0 });
      toast(`已选择 ${picked.length} 张照片`);
    }, fail: () => toast('已保留示例照片，可直接继续确认') });
  },

  openUpload() {
    const items = store.listGarments({ memberId: store.currentMember().id }).slice(0, 3).map(toViewGarment);
    this.setData({ screen: 'upload', uploadGarments: items, uploadIndex: 0, scrollTop: 0 });
  },

  changeUploadItem(event: WechatMiniprogram.TouchEvent) {
    this.setData({ uploadIndex: Number(event.currentTarget.dataset.index) });
  },

  saveUpload() {
    if (!this.data.uploadGarments.length) return;
    const drafts = this.data.uploadGarments.map((item: ViewGarment) => ({ memberId: item.memberId, name: item.name, image: item.image, category: item.category, color: item.color, season: item.season, material: item.material, location: item.location, notes: item.notes, status: item.status }));
    try {
      store.addGarments(drafts);
      this.showScreen('wardrobe');
      toast(`已保存 ${drafts.length} 件衣物`);
    } catch (error) {
      toast(error instanceof Error ? error.message : '保存失败');
    }
  },

  toggleFavorite(event: WechatMiniprogram.TouchEvent) {
    try {
      store.toggleFavorite(event.currentTarget.dataset.id as string);
      this.refresh();
      toast('收藏状态已更新');
    } catch (error) {
      toast(error instanceof Error ? error.message : '操作失败');
    }
  },

  openFitting(event: WechatMiniprogram.TouchEvent) {
    this.setData({ screen: 'fitting', taskCreated: false, scrollTop: 0 });
    if (event.currentTarget.dataset.id) toast('已带入这套搭配');
  },

  createTask() {
    this.setData({ taskCreated: true });
    toast('示例任务已创建，可在任务记录查看');
  },

  backToAi() {
    this.showScreen('outfits');
  },

  showHelp() {
    wx.showModal({ title: '本地演示说明', content: '当前页面使用本地示例数据，云端家庭同步、AI整理和试穿生成将在后续阶段接入。', showCancel: false });
  },
});
