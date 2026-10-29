import { design } from '../config/design-assets';
import { APP_NAME, APP_ROUTES } from '../config/app';
import { call, CloudError, CloudMember, FamilyAccount, FamilySnapshot, prepareImage } from '../services/cloud';
import { categories, categoryNames, emptyForm, viewGarment, ViewGarment, WardrobeGarment, Location, Outfit, wardrobe, outfitProblem } from '../services/wardrobe';
import { BatchEntry, createBatchEntry, persistBatch, resumeBatch, discardBatch, removeBatchPhoto, saveBatchEntry, formPatch, requestId, canRestartBatch } from '../services/batch';
import { AiTask, AiStatus, getAiStatus, listAiTasks, getAiTask, recognizeGarment, recommendOutfits } from '../services/ai';
import { exportWardrobe } from '../services/export';
import { CutoutResult, getCutout, processCutout, applyCutout, saveCutoutPreview } from '../services/cutout';
import { recognizeEntry } from '../services/entry-recognition';
import { entryPhoto, previewEntryCutout } from '../services/entry-cutout';
import { platform as wx } from '../platform/runtime';
import { definePage } from '../platform/page-state';
import { removeFile } from '../platform/files';
import {getSession} from '../services/session';
import {isWechat} from '../platform/runtime';
export default function createController() {
const accountId=getSession()?.userId||'';

type Screen = 'wardrobe' | 'outfits' | 'account' | 'upload' | 'detail' | 'trash' | 'locations' | 'outfitEdit' | 'picker' | 'ai';
const toast = (title: string) => wx.showToast({ title, icon: 'none' });
const emptySnapshot: FamilySnapshot = { family: null, members: [], accounts: [] };
let loadGeneration = 0;
let detailGeneration = 0;
let scopeEpoch = 0;
let disposed = false;
let exportCancelled = false;
interface Scope { epoch: number; familyId: string }
interface PendingAi { kind: 'recognize' | 'recommend'; requestId: string; taskId?: string; garmentId?: string; memberId?: string; occasion?: string; season?: string; lockedGarmentIds?: string[] }
const aiKey = (familyId: string) => `wardrobe_ai_v02_${familyId}`;
const emptyOutfit = { id: '', version: 0, name: '', memberId: '', partial: false, occasion: '', reason: '', requestId: '' };
const batchPhotoState = (entry?: BatchEntry) => ({ imagePath: entry ? entryPhoto(entry) : '',
  cutoutPath: entry?.cutout?.status === 'succeeded' && !entry.cutout.applied && !entry.submittedPatch && entry.status !== 'saved' ? entry.cutout.previewPath : '',
  cutoutRequestId: entry?.cutout?.requestId || '', cutoutVersion: 0 });
interface HomeSnapshot extends FamilySnapshot { userId: string; garments: {items: WardrobeGarment[]; cursor: string}; locations: Location[] }
const garmentCache = new Map<string, { familyId: string; at: number; items: ViewGarment[]; cursor: string }>();

return definePage({
  data: {
    appName: APP_NAME, entryScreen: 'wardrobe' as 'wardrobe' | 'account',
    statusBarHeight: wx.getWindowInfo().statusBarHeight,
    ...emptySnapshot, screen: 'wardrobe' as Screen, ready: false, loading: false, saving: false,
    error: '', syncLabel: '正在连接云端', selectedMember: '', selectedMemberName: '全家', category: 'all',
    garments: [] as ViewGarment[], cursor: '', listContext: '', selected: null as ViewGarment | null,
    form: { ...emptyForm }, formDirty: false, categoryNames, memberNames: [] as string[],
    search: '', filterColor: '', filtersOpen: false,
    selecting: false, selectedIds: [] as string[], locations: [] as Location[], locationNames: ['未指定位置'], locationIds: [''],
    batch: [] as BatchEntry[], batchIndex: -1, photoCount: 1, replaceBatchIndex: -1, batchProgress: '',
    recognizingBatch: false, recognitionPending: false,
    outfits: [] as Outfit[], outfitCursor: '', outfitForm: { ...emptyOutfit }, outfitPicked: [] as WardrobeGarment[], outfitMemberName: '', suggestionCategory: '',
    outfitCandidates: [] as ViewGarment[], candidateCursor: '', pickerReturn: 'outfitEdit', pickedIds: [] as string[],
    aiStatus: null as AiStatus | null, aiTask: null as AiTask | null, aiHistory: [] as AiTask[], aiCursor: '',
    aiBusy: false, pendingAi: null as PendingAi | null, recommendations: [] as Array<{ garments: ViewGarment[]; reason: string; missing: boolean }>,
    aiMemberIndex: 0, aiOccasion: '', aiSeason: '', lockedIds: [] as string[], lockedNames: '', lockedGarments: [] as WardrobeGarment[],
    exporting: false, exportCount: 0, exportPath: '', exportBytes: 0, cutoutPath: '', cutoutRequestId: '', cutoutVersion: 0,
    imagePath: '', inviteToken: '', invitePreview: '', inviteInput: '', inviteId: '',
    showPrivacy: false, privacyContractName: '隐私保护指引',
    assets: design.wardrobe,
  },
  onLoad(options: { section?: string } = {}) {
    disposed = false;
    const screen = options.section === 'account' ? 'account' : 'wardrobe';
    this.setData({ entryScreen: screen, screen });
    return this.bootstrap();
  },
  async onShow() {
    if (!this.data.ready || !this.data.family) return;
    if (this.data.screen === 'wardrobe') { await this.refresh(); return; }
    const scope = this.scope();
    try {
      // Recheck membership on every resume, including dirty forms and in-progress batches.
      const snapshot = await call<FamilySnapshot>('families', 'get');
      if (!this.active(scope)) return;
      this.applySnapshot(snapshot);
      if (!this.active(scope) || this.data.saving || this.data.loading) return;
      if (this.data.screen === 'outfits') await this.loadOutfits(false);
    } catch (error) { if (this.active(scope)) await this.report(error); }
  },
  onUnload() { disposed = true; scopeEpoch++; loadGeneration++; detailGeneration++; exportCancelled = true; },
  scope(): Scope { return { epoch: scopeEpoch, familyId: this.data.family?.id || '' }; },
  active(scope: Scope): boolean { return !disposed && (isWechat||(getSession()?.userId||'')===accountId) && scope.epoch === scopeEpoch && scope.familyId === (this.data.family?.id || ''); },
  async report(error: unknown) {
    const message = error instanceof Error ? error.message : '操作失败，请稍后重试';
    this.setData({ error: message, syncLabel: '同步未完成' });
    toast(message);
    if (error instanceof CloudError && ['NO_FAMILY', 'UNAUTHENTICATED'].includes(error.code)) {
      this.clearFamily();
      this.setData({ ready: false });
      await this.bootstrap();
    }
  },
  clearFamily() {
    garmentCache.clear();
    const familyId = this.data.family?.id;
    if (familyId) { discardBatch(familyId, this.data.batch); wx.removeStorageSync(aiKey(familyId)); wx.removeStorageSync('wardrobe_last_family_v02'); }
    if (this.data.exportPath) { try { void removeFile(this.data.exportPath); } catch { /* Already removed. */ } }
    this.clearCutout();
    loadGeneration++; detailGeneration++; scopeEpoch++; exportCancelled = true;
    this.setData({ replaceBatchIndex: -1, recognizingBatch: false, recognitionPending: false });
    this.setData({ ...emptySnapshot, loading: false, saving: false, garments: [], selected: null, cursor: '', selectedMember: '', selectedMemberName: '全家', memberNames: [], imagePath: '', inviteToken: '', inviteId: '', inviteInput: '', invitePreview: '', screen: 'wardrobe', formDirty: false, form: { ...emptyForm }, search: '', filterColor: '', category: 'all', selectedIds: [], selecting: false, locations: [], locationNames: ['未指定位置'], locationIds: [''], batch: [], batchIndex: -1, batchProgress: '', outfits: [], outfitCursor: '', outfitForm: { ...emptyOutfit }, outfitMemberName: '', suggestionCategory: '', outfitPicked: [], outfitCandidates: [], candidateCursor: '', pickedIds: [], aiStatus: null, aiTask: null, aiHistory: [], aiCursor: '', aiBusy: false, pendingAi: null, recommendations: [], aiMemberIndex: 0, aiOccasion: '', aiSeason: '', lockedIds: [], lockedNames: '', lockedGarments: [], exporting: false, exportPath: '', exportCount: 0, exportBytes: 0, cutoutPath: '', cutoutRequestId: '', cutoutVersion: 0, showPrivacy: false, error: '' });
    this.setData({ screen: this.data.entryScreen });
  },
  async bootstrap() {
    if (this.data.loading) return;
    const scope = this.scope();
    this.setData({ loading: true, error: '' });
    try {
      const snapshot = await call<FamilySnapshot | HomeSnapshot>('bootstrapUser', this.data.screen === 'account' ? 'bootstrap' : 'home');
      if (!this.active(scope)) return;
      const previousFamily = wx.getStorageSync('wardrobe_last_family_v02');
      if (typeof previousFamily === 'string' && previousFamily && previousFamily !== snapshot.family?.id) {
        discardBatch(previousFamily, resumeBatch(previousFamily)); wx.removeStorageSync(aiKey(previousFamily)); wx.removeStorageSync('wardrobe_last_family_v02');
      }
      this.applySnapshot(snapshot);
      this.applyLocations('locations' in snapshot ? snapshot.locations : []);
      const garments = 'garments' in snapshot ? snapshot.garments : { items: [], cursor: '' };
      this.setData({ ready: true, garments: garments.items.map(viewGarment), cursor: garments.cursor, listContext: this.garmentContext(), syncLabel: snapshot.family ? '已连接云端' : '尚未加入家庭' });
      this.cacheGarments();
    } catch (error) { this.setData({ error: error instanceof Error ? error.message : '连接失败', syncLabel: '连接失败' }); }
    finally { if (!disposed) this.setData({ loading: false }); }
  },
  applySnapshot(snapshot: FamilySnapshot) {
    const changed = this.data.family?.id !== snapshot.family?.id;
    if (changed) this.clearFamily();
    const selected = snapshot.members.find(m => m.id === this.data.selectedMember);
    this.setData({ family: snapshot.family, members: snapshot.members, accounts: snapshot.accounts,
      memberNames: snapshot.members.map(m => m.name), selectedMember: selected?.id || '', selectedMemberName: selected?.name || '全家' });
    if (snapshot.family) wx.setStorageSync('wardrobe_last_family_v02', snapshot.family.id);
    if (changed && snapshot.family) this.setData({ batch: resumeBatch(snapshot.family.id), recognitionPending: false, pendingAi: (wx.getStorageSync(aiKey(snapshot.family.id)) || null) as PendingAi | null });
  },
  async refresh() {
    if (this.data.loading || this.data.saving) return;
    if (this.data.screen === 'detail' && this.data.formDirty) {
      const confirmation = await wx.showModal({ title: '重新加载衣物？', content: '这会放弃尚未保存的修改，读取家人最新保存的信息。', confirmText: '重新加载' });
      if (!confirmation.confirm) return;
      this.setData({ formDirty: false });
    }
    const detailId = this.data.screen === 'detail' ? this.data.selected?.id : '';
    const detailRequest = ++detailGeneration;
    const scope = this.scope();
    const generation = ++loadGeneration;
    this.setData({ loading: true, error: '', syncLabel: '正在同步' });
    if (this.data.screen === 'wardrobe') {
      const context = this.garmentContext();
      try {
        const home = await wardrobe<HomeSnapshot>('home', this.garmentFilters());
        if (!this.active(scope) || generation !== loadGeneration || context !== this.garmentContext()) return;
        this.applySnapshot(home);
        this.applyLocations(home.locations);
        if (context !== this.garmentContext()) {
          this.resetSelection();
          this.setData({ garments: [], cursor: '', listContext: '', loading: false });
          await this.loadGarments(false); return;
        }
        this.setData({ garments: home.garments.items.map(g => ({ ...viewGarment(g), checked: this.data.selectedIds.includes(g.id) })), cursor: home.garments.cursor,
          listContext: this.garmentContext(), syncLabel: `已同步 · ${new Date().toLocaleTimeString().slice(0, 5)}` });
        this.cacheGarments();
      } catch (error) { if (this.active(scope) && generation === loadGeneration) await this.report(error); }
      finally { if (this.active(scope) && generation === loadGeneration) this.setData({ loading: false }); }
      return;
    }
    try {
      const snapshot = await call<FamilySnapshot>('families', 'get');
      if (!this.active(scope) || generation !== loadGeneration) return;
      this.applySnapshot(snapshot);
      if (!this.data.family) return;
      if (detailId) {
        const latest = await call<WardrobeGarment>('garments', 'get', { garmentId: detailId });
        if (this.active(scope) && generation === loadGeneration && detailRequest === detailGeneration && this.data.screen === 'detail' && this.data.selected?.id === detailId && !this.data.formDirty) this.applySelected(latest);
      }
    }
    catch (error) { if (this.active(scope) && generation === loadGeneration) { this.setData({ loading: false }); await this.report(error); } return; }
    if (!this.active(scope) || generation !== loadGeneration) return;
    this.setData({ loading: false });
    if (this.data.screen === 'outfits') await this.loadOutfits(false);
    else if (this.data.screen === 'locations') await this.loadLocations();
    else if (this.data.screen === 'trash') await this.loadGarments(false);
  },
  async loadGarments(more: boolean) {
    if (!this.data.family || (more && (this.data.loading || !this.data.cursor))) return;
    if (more && this.data.listContext !== this.garmentContext()) {
      this.resetSelection();
      this.setData({ garments: [], cursor: '', listContext: '' });
      await this.loadGarments(false); return;
    }
    const generation = ++loadGeneration;
    const scope = this.scope();
    const context = this.garmentContext();
    this.setData({ loading: true, error: '' });
    try {
      const page = await wardrobe<{ items: WardrobeGarment[]; cursor: string }>(this.data.screen === 'trash' ? 'trash' : 'list', {
        ...this.garmentFilters(), cursor: more ? this.data.cursor : undefined,
      });
      if (generation !== loadGeneration || !this.active(scope) || context !== this.garmentContext()) return;
      const rows = page.items.map(g => ({ ...viewGarment(g), checked: this.data.selectedIds.includes(g.id) }));
      this.setData({ garments: more ? [...this.data.garments, ...rows] : rows, cursor: page.cursor, listContext: context, syncLabel: `已同步 · ${new Date().toLocaleTimeString().slice(0, 5)}` });
      this.cacheGarments();
    } catch (error) { if (generation === loadGeneration && this.active(scope) && context === this.garmentContext()) { this.setData({ loading: false }); await this.report(error); } }
    finally { if (generation === loadGeneration && this.active(scope)) this.setData({ loading: false }); }
  },
  loadMore() { this.loadGarments(true); },
  garmentFilters(): Record<string, unknown> {
    return { memberId: this.data.selectedMember || undefined, category: this.data.category,
      search: this.data.search.trim() || undefined, color: this.data.filterColor.trim() || undefined,
      limit: 20 };
  },
  cacheGarments() {
    if (!this.data.family || !['wardrobe', 'trash'].includes(this.data.screen)) return;
    const key = this.garmentContext();
    if (this.data.listContext !== key) return;
    garmentCache.delete(key);
    garmentCache.set(key, {familyId: this.data.family.id, at: Date.now(), items: this.data.garments.map((g: ViewGarment) => ({...g, checked: false})), cursor: this.data.cursor});
    if (garmentCache.size > 6) garmentCache.delete(garmentCache.keys().next().value!);
  },
  garmentContext(): string {
    return JSON.stringify([this.data.screen, this.data.selectedMember, this.data.category, this.data.search.trim(), this.data.filterColor.trim()]);
  },
  async nav(event: WechatMiniprogram.TouchEvent) {
    if (this.data.saving || this.data.recognizingBatch || this.data.exporting || this.data.aiBusy || (!this.data.ready && this.data.loading && !this.data.family)) return;
    const screen = event.currentTarget.dataset.screen as Screen;
    if (!this.data.ready && !this.data.family) {
      const entryScreen = screen === 'account' ? 'account' : 'wardrobe';
      this.setData({ entryScreen, screen: entryScreen });
      return this.bootstrap();
    }
    if (screen === this.data.screen) return;
    if (this.data.screen === 'detail' && this.data.formDirty) {
      const scope = this.scope();
      const confirmation = await wx.showModal({ title: '离开衣物详情？', content: '尚未保存的修改会被放弃。' }).catch(() => null);
      if (!confirmation?.confirm || !this.active(scope) || this.data.saving) return;
      this.setData({ formDirty: false });
    }
    detailGeneration++;
    loadGeneration++;
    this.clearCutout();
    if (screen === 'account' || screen === 'wardrobe') this.setData({ entryScreen: screen });
    if (screen === 'trash' && this.data.screen !== 'trash') this.setData({ selectedMember: '', selectedMemberName: '全家', category: 'all', search: '', filterColor: '' });
    this.setData({ screen, loading: false, selected: null, error: '', aiTask: null, cutoutPath: '', cutoutRequestId: '', cutoutVersion: 0, selecting: false, selectedIds: [] });
    if (screen === 'wardrobe' || screen === 'trash') {
      const cached = garmentCache.get(this.garmentContext());
      const fresh = cached && cached.familyId === this.data.family?.id && Date.now() - cached.at < 30000;
      this.setData({ garments: fresh ? cached.items : [], cursor: fresh ? cached.cursor : '', listContext: fresh ? this.garmentContext() : '' });
    }
    if (screen === 'outfits') await this.loadOutfits(false);
    if (screen === 'trash') { this.resetSelection(); await this.loadGarments(false); }
    if (screen === 'locations') await this.loadLocations();
    if (screen === 'ai') await this.loadAiHistory(false);
    if (screen === 'wardrobe' && this.data.family) await this.refresh();
    if (screen === 'account' && this.data.family) await this.refresh();
  },
  goHome() {
    if (this.data.saving || this.data.recognizingBatch || this.data.exporting || this.data.aiBusy) return;
    if (this.data.screen === 'detail' && this.data.formDirty) {
      wx.showModal({ title: '返回首页？', content: '尚未保存的衣物修改会被放弃。', success: result => { if (result.confirm) this.returnHome(); } });
      return;
    }
    this.returnHome();
  },
  returnHome() {
    const pages = getCurrentPages();
    const homeIndex = pages.findIndex(page => page.route === APP_ROUTES.home.slice(1));
    if (homeIndex >= 0 && homeIndex < pages.length - 1) wx.navigateBack({ delta: pages.length - 1 - homeIndex });
    else wx.reLaunch({ url: APP_ROUTES.home });
  },
  async chooseMember(event: WechatMiniprogram.TouchEvent) {
    if (this.data.saving || this.data.exporting) return;
    const member = this.data.members.find((m: CloudMember) => m.id === event.currentTarget.dataset.id);
    this.setData({ selectedMember: member?.id || '', selectedMemberName: member?.name || '全家' });
    this.resetSelection();
    if (this.data.screen === 'outfits') { await this.loadOutfits(false); return; }
    await this.loadGarments(false);
  },
  async filterCategory(event: WechatMiniprogram.TouchEvent) {
    if (this.data.saving) return;
    this.setData({ category: event.currentTarget.dataset.category as string }); this.resetSelection(); await this.loadGarments(false);
  },
  async createFamily() {
    if (this.data.saving) return;
    const scope = this.scope();
    const name = await this.prompt('创建家庭', '例如：我们的家'); if (!name) return;
    const memberName = await this.prompt('你的家庭成员档案名', '例如：我、爸爸'); if (!memberName || !this.active(scope)) return;
    await this.mutate(async () => {
      const snapshot = await call<FamilySnapshot>('families', 'create', { name, memberName }); if (!this.active(scope)) return;
      this.applySnapshot(snapshot);
      toast('家庭已创建');
    });
    if (this.data.family && this.data.screen === 'wardrobe') await this.loadGarments(false);
  },
  prompt(title: string, placeholderText: string, content = ''): Promise<string> {
    return new Promise(resolve => wx.showModal({ title, editable: true, placeholderText, content,
      success: result => resolve(result.confirm ? result.content?.trim() || '' : ''), fail: () => resolve(''),
    }));
  },
  async mutate(work: () => Promise<void>) {
    if (this.data.saving) return;
    garmentCache.clear();
    const scope = this.scope();
    this.setData({ saving: true, error: '' });
    try { await work(); }
    catch (error) { if (this.active(scope)) { this.setData({ saving: false }); await this.report(error); } }
    finally { if (!disposed) this.setData({ saving: false }); }
  },
  inviteInput(event: WechatMiniprogram.Input) { this.setData({ inviteInput: event.detail.value.trim(), invitePreview: '' }); },
  async previewInvite() {
    const scope = this.scope(), token = this.data.inviteInput;
    await this.mutate(async () => {
      const preview = await call<{ familyName: string }>('familyInvites', 'preview', { token });
      if (this.active(scope) && this.data.inviteInput === token) this.setData({ invitePreview: preview.familyName });
    });
  },
  async acceptInvite() {
    const scope = this.scope(), token = this.data.inviteInput;
    const confirmation = await wx.showModal({ title: `加入「${this.data.invitePreview}」？`, content: '加入后，全体家人都可以查看、修改和删除全部家庭衣物及照片。衣物归属档案不限制家人的编辑权限。', confirmText: '确认加入' });
    if (!confirmation.confirm || !this.active(scope) || token !== this.data.inviteInput) return;
    await this.mutate(async () => {
      const snapshot = await call<FamilySnapshot>('familyInvites', 'accept', { token, confirmed: true }); if (!this.active(scope)) return;
      this.applySnapshot(snapshot);
      this.setData({ inviteInput: '', invitePreview: '' }); toast('已加入家庭');
    });
    if (this.data.family && this.data.screen === 'wardrobe') await this.loadGarments(false);
  },
  async createInvite() {
    const scope = this.scope();
    await this.mutate(async () => {
      const invite = await call<{ id: string; token: string }>('familyInvites', 'create');
      if (this.active(scope)) this.setData({ inviteToken: invite.token, inviteId: invite.id });
    });
  },
  copyInvite() { wx.setClipboardData({ data: this.data.inviteToken }); },
  async revokeInvite() {
    const scope = this.scope(), inviteId = this.data.inviteId;
    await this.mutate(async () => { await call('familyInvites', 'revoke', { inviteId }); if (this.active(scope)) { this.setData({ inviteToken: '', inviteId: '' }); toast('邀请已撤销'); } });
  },
  async addMember() {
    const scope = this.scope();
    const name = await this.prompt('新增家庭成员档案', '例如：孩子'); if (!name) return;
    if (!this.active(scope)) return;
    await this.mutate(async () => { await call('members', 'create', { name }); if (!this.active(scope)) return; const snapshot = await call<FamilySnapshot>('families', 'get'); if (this.active(scope)) this.applySnapshot(snapshot); });
  },
  async renameMember(event: WechatMiniprogram.TouchEvent) {
    const scope = this.scope();
    const member = this.data.members.find((m: CloudMember) => m.id === event.currentTarget.dataset.id); if (!member) return;
    const name = await this.prompt('修改档案名', '请输入档案名称', member.name); if (!name) return;
    if (!this.active(scope)) return;
    await this.mutate(async () => { await call('members', 'rename', { memberId: member.id, version: member.version, name }); if (!this.active(scope)) return; const snapshot = await call<FamilySnapshot>('families', 'get'); if (this.active(scope)) this.applySnapshot(snapshot); });
  },
  async renameFamily() {
    const scope = this.scope();
    const name = await this.prompt('修改家庭名', '请输入家庭名称', this.data.family?.name || ''); if (!name) return;
    if (!this.active(scope)) return;
    await this.mutate(async () => { await call('families', 'rename', { name }); if (!this.active(scope)) return; const snapshot = await call<FamilySnapshot>('families', 'get'); if (this.active(scope)) this.applySnapshot(snapshot); });
  },
  async manageAccount(event: WechatMiniprogram.TouchEvent) {
    const scope = this.scope();
    const account = this.data.accounts.find((a: FamilyAccount) => a.userId === event.currentTarget.dataset.id); if (!account || account.isSelf) return;
    const action = await wx.showActionSheet({ itemList: ['移交管理员给此账号', '移出此账号'] }).catch(() => null); if (!action || !this.active(scope)) return;
    const confirmation = await wx.showModal({ title: action.tapIndex === 0 ? '移交管理权？' : '移出此账号？', content: action.tapIndex === 0 ? '移交后你成为普通家庭成员。' : '该账号将无法再访问家庭；已有衣物与档案保留。' }); if (!confirmation.confirm) return;
    if (!this.active(scope)) return;
    await this.mutate(async () => { await call('families', action.tapIndex === 0 ? 'transfer' : 'remove', { userId: account.userId }); if (!this.active(scope)) return; const snapshot = await call<FamilySnapshot>('families', 'get'); if (this.active(scope)) { this.applySnapshot(snapshot); this.setData({ inviteToken: '', inviteId: '' }); } });
  },
  async leaveFamily() {
    const scope = this.scope();
    const confirmation = await wx.showModal({ title: '退出家庭？', content: '家庭衣物会保留。退出后将无法继续访问，重新加入需要新邀请。管理员需先移交管理权。' }); if (!confirmation.confirm) return;
    if (!this.active(scope)) return;
    await this.mutate(async () => { await call('families', 'leave'); if (this.active(scope)) this.clearFamily(); });
  },
  openUpload() {
    loadGeneration++;
    this.clearCutout();
    const index = Math.max(0, this.data.members.findIndex((m: CloudMember) => m.id === this.data.selectedMember));
    this.setData({ screen: 'upload', loading: false, ...batchPhotoState(this.data.batch[0]), batchIndex: this.data.batch.length ? 0 : -1, form: this.data.batch[0]?.form || { ...emptyForm, memberIndex: index }, selected: null, error: '', aiTask: null });
    const unrecognized = this.data.batch.filter((entry: BatchEntry) => entry.status !== 'saved' && !entry.submittedPatch && !entry.recognition).map((entry: BatchEntry) => entry.id);
    if (unrecognized.length) return this.recognizeBatchPhotos(unrecognized);
  },
  chooseMany() { this.setData({ photoCount: 9, replaceBatchIndex: -1 }); this.choosePhoto(); },
  chooseOne() { this.setData({ photoCount: 1, replaceBatchIndex: -1 }); this.choosePhoto(); },
  async replaceBatchPhoto() {
    if (this.data.saving || !this.data.family) return;
    const scope = this.scope(), index = this.data.batchIndex, item = this.data.batch[index];
    if (!item || !canRestartBatch(item)) return;
    const confirmation = await wx.showModal({ title: '更换照片，重新录入本张？', content: '原请求被拒绝或草稿已失效。选择新照片后使用新请求，全部信息可重新确认；本批其他照片和已保存项保留。', confirmText: '更换照片' });
    if (!confirmation.confirm || !this.active(scope) || this.data.batch[index]?.id !== item.id) return;
    this.setData({ replaceBatchIndex: index, photoCount: 1 }); await this.choosePhoto();
  },
  async choosePhoto() {
    if (this.data.saving || this.data.recognizingBatch || !this.data.family) return;
    const scope = this.scope();
    const addedIds: string[] = [];
    try {
      const privacy = await new Promise<WechatMiniprogram.GetPrivacySettingSuccessCallbackResult>((resolve, reject) => wx.getPrivacySetting({ success: resolve, fail: reject }));
      if (!this.active(scope)) return;
      if (privacy.needAuthorization) {
        this.setData({ showPrivacy: true, privacyContractName: privacy.privacyContractName });
        return;
      }
      const replacing = this.data.replaceBatchIndex >= 0 ? this.data.batch[this.data.replaceBatchIndex] : null;
      const replacementIndex = this.data.replaceBatchIndex;
      const remaining = replacing ? 1 : 9 - this.data.batch.length;
      if (remaining < 1) { toast('一批最多9张，请先保存或清空本批'); return; }
      const picked = await wx.chooseMedia({ count: Math.min(this.data.photoCount, remaining), mediaType: ['image'], sourceType: this.data.photoCount > 1 ? ['album'] : ['album', 'camera'] });
      if (!this.active(scope) || !picked.tempFiles.length) return;
      this.setData({ saving: true });
      const firstIndex = replacing ? replacementIndex : this.data.batch.length, defaults = { ...this.data.form, name: replacing ? this.data.form.name : '', color: replacing ? this.data.form.color : '' };
      for (const file of picked.tempFiles.slice(0, remaining)) {
        const prepared = await prepareImage(file.tempFilePath);
        if (!this.active(scope)) return;
        const entry = await createBatchEntry(prepared.path, defaults), batch = [...this.data.batch];
        if (!this.active(scope)) { removeBatchPhoto(entry); return; }
        // A replacement preserves manually filled values from an earlier attempt.
        if (replacing) entry.editedFields = replacing.editedFields || (['name', 'color'] as const).filter(field => !!replacing.form[field]);
        if (replacing) { if (batch[replacementIndex]?.id !== replacing.id) { removeBatchPhoto(entry); return; } batch[replacementIndex] = entry; }
        else batch.push(entry);
        persistBatch(scope.familyId, batch); this.setData({ batch });
        addedIds.push(entry.id);
        if (replacing) removeBatchPhoto(replacing);
      }
      const first = this.data.batch[firstIndex];
      if (first) this.setData({ batchIndex: firstIndex, ...batchPhotoState(first), form: { ...first.form }, formDirty: false });
    } catch (error) { if (this.active(scope) && !String((error as { errMsg?: string }).errMsg).includes('cancel')) await this.report(error); }
    finally { if (this.active(scope)) this.setData({ saving: false, replaceBatchIndex: this.data.showPrivacy ? this.data.replaceBatchIndex : -1 }); }
    if (this.active(scope) && addedIds.length) await this.recognizeBatchPhotos(addedIds);
  },
  formInput(event: WechatMiniprogram.Input) {
    const field = event.currentTarget.dataset.field as string;
    if (!['name', 'color', 'notes'].includes(field) || this.data.saving || this.lockedBatchForm()) return;
    this.setData({ [`form.${field}`]: event.detail.value, formDirty: true });
    if (this.data.screen === 'upload' && ['name', 'color'].includes(field)) {
      const row = this.data.batch[this.data.batchIndex];
      if (row) row.editedFields = [...new Set([...(row.editedFields || []), field as 'name' | 'color'])];
    }
    this.persistForm();
  },
  formPicker(event: WechatMiniprogram.PickerChange) {
    const field = event.currentTarget.dataset.field as string;
    if (!['memberIndex', 'categoryIndex'].includes(field) || this.data.saving || this.lockedBatchForm()) return;
    this.setData({ [`form.${field}`]: Number(event.detail.value), formDirty: true });
    this.persistForm();
  },
  lockedBatchForm(): boolean { return this.data.screen === 'upload' && !!this.data.batch[this.data.batchIndex]?.submittedPatch; },
  persistForm() {
    if (this.data.screen !== 'upload' || this.data.batchIndex < 0 || !this.data.family) return;
    const batch = this.data.batch.map((entry: BatchEntry, index: number) => index === this.data.batchIndex ? { ...entry, form: { ...this.data.form } } : entry);
    persistBatch(this.data.family.id, batch); this.setData({ batch });
  },
  selectBatch(event: WechatMiniprogram.TouchEvent) {
    if (this.data.saving) return;
    const index = Number(event.currentTarget.dataset.index), item = this.data.batch[index]; if (!item) return;
    this.setData({ batchIndex: index, form: { ...item.form }, ...batchPhotoState(item), formDirty: false, error: '' });
  },
  async recognizeBatchPhotos(ids: string[]) {
    if (!this.data.family || this.data.recognizingBatch || this.data.saving) return;
    const scope = this.scope(); this.setData({ recognizingBatch: true });
    const checkpoint = () => {
      if (!this.active(scope)) return;
      persistBatch(scope.familyId, this.data.batch);
      const current = this.data.batch[this.data.batchIndex];
      this.setData({ batch: [...this.data.batch], recognitionPending: this.data.batch.some((row: BatchEntry) => row.recognition?.status === 'running'), ...(this.data.screen === 'upload' && current ? { form: { ...current.form } } : {}) });
    };
    try {
      for (const id of ids) {
        if (!this.active(scope)) break;
        const entry = this.data.batch.find((row: BatchEntry) => row.id === id);
        if (!entry || entry.status === 'saved' || entry.submittedPatch) continue;
        const memberId = this.data.members[entry.form.memberIndex]?.id || '';
        await recognizeEntry(entry, memberId, { active: () => this.active(scope),
          current: () => this.data.batch.find((row: BatchEntry) => row.id === id), checkpoint });
      }
    } catch (error) { if (this.active(scope)) await this.report(error); }
    finally { if (this.active(scope)) this.setData({ recognizingBatch: false }); }
  },
  async retryBatchRecognition() {
    const entry = this.data.batch[this.data.batchIndex];
    if (!entry || this.data.recognizingBatch || this.data.saving || entry.status === 'saved') return;
    if (!entry.recognition) return;
    await this.recognizeBatchPhotos([entry.id]);
  },
  async applyBatchDefaults() {
    if (this.data.saving || !this.data.family) return;
    const scope = this.scope();
    const confirmed = await wx.showModal({ title: '应用本张默认信息？', content: '将归属和分类应用到本批尚未提交的照片；每张名称、颜色和备注保留。' });
    if (!confirmed.confirm || !this.active(scope)) return;
    const defaults = this.data.form;
    const batch = this.data.batch.map((e: BatchEntry) => e.submittedPatch ? e : { ...e, form: { ...e.form, memberIndex: defaults.memberIndex, categoryIndex: defaults.categoryIndex } });
    persistBatch(this.data.family.id, batch); this.setData({ batch }); toast('默认信息已应用');
  },
  async clearBatch() {
    if (this.data.saving || !this.data.family) return;
    const scope = this.scope();
    const result = await wx.showModal({ title: '结束本批录入？', content: '已保存衣物保留；未保存照片和本地重试记录将移除。' });
    if (!result.confirm || !this.active(scope)) return;
    discardBatch(scope.familyId, this.data.batch);
    this.setData({ batch: [], batchIndex: -1, ...batchPhotoState(), form: { ...emptyForm }, batchProgress: '', recognitionPending: false });
  },
  async openBatchSaved() {
    const item = this.data.batch[this.data.batchIndex]; if (!item || item.status !== 'saved') return;
    const scope = this.scope();
    await this.mutate(async () => { const garment = await call<WardrobeGarment>('garments', 'get', { garmentId: item.garmentId }); if (this.active(scope)) this.applySelected(garment); });
  },
  async saveGarment() {
    if (this.data.saving) return;
    if (this.data.screen === 'upload') { await this.saveBatch(); return; }
    const form = this.data.form, memberId = this.data.members[form.memberIndex]?.id;
    if (!form.name.trim() || !memberId) { toast('请填写衣物名称并选择归属档案'); return; }
    const selected = this.data.selected, scope = this.scope(); if (!selected) return;
    let usedExistingList = false;
    await this.mutate(async () => {
      const saved = await call<WardrobeGarment>('garments', 'update', { garmentId: selected.id, version: selected.version, patch: formPatch(form, memberId) });
      if (!this.active(scope)) return;
      this.setData({ screen: 'wardrobe', selected: null, imagePath: '' }); toast('已保存到家庭衣橱');
      if (saved?.id && this.data.listContext === this.garmentContext()) {
        const updated = viewGarment({ ...saved, image: selected.image });
        const search = this.data.search.trim().toLocaleLowerCase(), color = this.data.filterColor.trim();
        const matches = (!this.data.selectedMember || updated.memberId === this.data.selectedMember)
          && (this.data.category === 'all' || updated.category === this.data.category)
          && (!color || updated.color === color) && (!search || `${updated.name}\n${updated.notes}`.toLocaleLowerCase().includes(search));
        this.setData({ garments: this.data.garments.flatMap((row: ViewGarment) => row.id === saved.id ? matches ? [{ ...updated, checked: false }] : [] : [row]) });
        this.cacheGarments(); usedExistingList = true;
      }
    });
    if (this.data.screen === 'wardrobe' && !usedExistingList) await this.loadGarments(false);
  },
  async saveBatch() {
    if (this.data.recognizingBatch || this.data.batch.some((row: BatchEntry) => row.recognition?.status === 'running')) { toast('识别尚在处理中，请稍后重查原任务再保存'); return; }
    if (this.data.saving || !this.data.family || !this.data.batch.length) { if (!this.data.batch.length) toast('请先选择衣物照片'); return; }
    garmentCache.clear();
    let completed = false;
    const scope = this.scope(), entries: BatchEntry[] = this.data.batch.map((e: BatchEntry) => ({ ...e, form: { ...e.form } }));
    this.setData({ saving: true });
    const checkpoint = () => {
      if (!this.active(scope)) return;
      persistBatch(scope.familyId, entries);
      this.setData({ batch: [...entries], batchProgress: `${entries.filter(e => e.status === 'saved').length}/${entries.length} 已保存` });
    };
    try {
      for (const entry of entries) {
        if (!this.active(scope)) break;
        const memberId = this.data.members[entry.form.memberIndex]?.id || '';
        await saveBatchEntry(entry, memberId, checkpoint, () => this.active(scope));
      }
      if (this.active(scope)) {
        if (entries.every(entry => entry.status === 'saved')) {
          discardBatch(scope.familyId, entries);
          garmentCache.clear(); loadGeneration++; detailGeneration++;
          this.setData({ screen: 'wardrobe', batch: [], batchIndex: -1, batchProgress: '',
            imagePath: '', form: { ...emptyForm }, formDirty: false, selected: null, aiTask: null,
            recognizingBatch: false, recognitionPending: false, replaceBatchIndex: -1, photoCount: 1,
            garments: [], cursor: '', listContext: '', selecting: false, selectedIds: [], error: '',
            search: '', filterColor: '', category: 'all',
            selectedMember: '', selectedMemberName: '全家' });
          completed = true; toast('已保存到家庭衣橱');
        } else {
          checkpoint(); toast('部分未保存，检查后重试');
        }
      }
    } catch (error) { if (this.active(scope)) await this.report(error); }
    finally { if (this.active(scope)) this.setData({ saving: false }); }
    if (completed && this.active(scope)) await this.loadGarments(false);
  },
  async openGarment(event: WechatMiniprogram.TouchEvent) {
    if (this.data.selecting || this.data.screen === 'trash') { this.toggleSelection(event); return; }
    const detailRequest = ++detailGeneration;
    const scope = this.scope();
    const garment = this.data.garments.find((g: ViewGarment) => g.id === event.currentTarget.dataset.id); if (!garment) return;
    this.applySelected(garment);
    try {
      const latest = await call<WardrobeGarment>('garments', 'get', { garmentId: garment.id });
      if (this.active(scope) && detailRequest === detailGeneration && this.data.screen === 'detail' && this.data.selected?.id === garment.id && !this.data.formDirty) this.applySelected(latest);
    } catch (error) { if (this.active(scope)) await this.report(error); }
  },
  applySelected(garment: WardrobeGarment) {
    this.clearCutout();
    this.setData({ selected: viewGarment(garment), screen: 'detail', error: '', formDirty: false, aiTask: null, cutoutPath: '', cutoutRequestId: '', cutoutVersion: 0, form: { name: garment.name, memberIndex: Math.max(0, this.data.members.findIndex((m: CloudMember) => m.id === garment.memberId)), categoryIndex: categories.indexOf(garment.category), color: garment.color || '', season: garment.season || '', material: garment.material || '', location: garment.location, locationId: garment.locationId || '', notes: garment.notes } });
  },
  previewImage() {
    const id = this.data.selected?.id; if (!id) return;
    const scope = this.scope();
    this.mutate(async () => { const { url } = await call<{ url: string }>('garments', 'image', { garmentId: id }); if (url && this.active(scope)) wx.previewImage({ urls: [url] }); });
  },
  async deleteGarment() {
    const selected = this.data.selected; if (!selected || this.data.saving) return;
    const scope = this.scope();
    const confirmation = await wx.showModal({ title: '移入回收站？', content: '此操作对全家生效，30天内可在衣橱回收站恢复。', confirmText: '移入', confirmColor: '#a64538' }).catch(async error => {
      if (this.active(scope)) await this.report(error instanceof Error ? error : new Error('暂时无法打开确认，请稍后重试'));
      return null;
    });
    if (!confirmation?.confirm || !this.active(scope) || this.data.selected?.id !== selected.id) return;
    await this.mutate(async () => { await call('garments', 'delete', { garmentId: selected.id, version: selected.version }); if (this.active(scope)) { this.setData({ selected: null, screen: 'wardrobe' }); toast('已移入回收站'); } });
    if (this.data.screen === 'wardrobe') await this.loadGarments(false);
  },
  filterInput(event: WechatMiniprogram.Input) {
    const field = event.currentTarget.dataset.field as string;
    if (['search', 'filterColor'].includes(field)) this.setData({ [field]: event.detail.value });
  },
  toggleFilters() { this.setData({ filtersOpen: !this.data.filtersOpen }); },
  async applyFilters() { this.resetSelection(); this.setData({ cursor: '', garments: [] }); await this.loadGarments(false); },
  async clearFilters() { this.setData({ search: '', filterColor: '', category: 'all', selectedMember: '', selectedMemberName: '全家' }); await this.applyFilters(); },
  resetSelection() { this.setData({ selectedIds: [], garments: this.data.garments.map((g: ViewGarment) => ({ ...g, checked: false })) }); },
  toggleSelecting() { this.resetSelection(); this.setData({ selecting: !this.data.selecting }); },
  toggleSelection(event: WechatMiniprogram.TouchEvent) {
    if (this.data.saving) return;
    const id = event.currentTarget.dataset.id as string;
    if (!this.data.garments.some((g: ViewGarment) => g.id === id)) return;
    const ids = [...this.data.selectedIds], index = ids.indexOf(id);
    if (index >= 0) ids.splice(index, 1);
    else { if (ids.length >= 20) { toast('一次最多选择20件'); return; } ids.push(id); }
    this.setData({ selectedIds: ids, garments: this.data.garments.map((g: ViewGarment) => ({ ...g, checked: ids.includes(g.id) })) });
  },
  async bulkEdit() {
    if (!this.data.selectedIds.length || this.data.saving) return;
    const scope = this.scope();
    const pick = await wx.showActionSheet({ itemList: ['更改归属档案', '更改颜色'] }).catch(() => null);
    if (!pick || !this.active(scope)) return;
    let patch: Record<string, unknown> = {};
    if (pick.tapIndex === 0) {
      const names = this.data.memberNames;
      if (!names.length) return;
      const result = await this.pickOption(names); if (result < 0 || !this.active(scope)) return;
      patch = { memberId: this.data.members[result].id };
    } else if (pick.tapIndex === 1) {
      const value = await this.prompt('批量修改颜色', '所有选中衣物将使用此值');
      if (!value || !this.active(scope)) return;
      patch = { color: value };
    } else return;
    await this.mutate(async () => { await wardrobe('batchUpdate', { items: this.selectedRefs(), patch }); if (this.active(scope)) { this.resetSelection(); toast('已批量更新'); } });
    if (this.active(scope)) await this.loadGarments(false);
  },
  selectedRefs() { return this.data.garments.filter((g: ViewGarment) => this.data.selectedIds.includes(g.id)).map((g: ViewGarment) => ({ id: g.id, version: g.version })); },
  async bulkAction(event: WechatMiniprogram.TouchEvent) {
    const action = event.currentTarget.dataset.action as string;
    if (!['batchDelete', 'restore', 'purge'].includes(action) || !this.data.selectedIds.length || this.data.saving) return;
    const scope = this.scope(), items = this.selectedRefs();
    const confirmed = await wx.showModal({ title: action === 'purge' ? '永久删除选中衣物？' : action === 'restore' ? '恢复选中衣物？' : '移入衣橱回收站？', content: action === 'purge' ? '照片与衣物记录将永久删除，全家均无法恢复。请确认后继续。' : action === 'restore' ? '恢复后重新回到全家的衣橱。' : '30天内可恢复；到期后将永久清理。', confirmColor: action === 'purge' ? '#a64538' : '#60794e', confirmText: action === 'purge' ? '永久删除' : '确认' });
    if (!confirmed.confirm || !this.active(scope)) return;
    await this.mutate(async () => {
      const result = await wardrobe<{ pending?: number }>(action, { items });
      if (!this.active(scope)) return;
      this.resetSelection(); toast(action === 'purge' && result.pending ? '部分照片正在后台清理' : '操作已完成');
    });
    if (this.active(scope)) await this.loadGarments(false);
  },
  async loadLocations() {
    const scope = this.scope(); if (!scope.familyId) return;
    try {
      const result = await wardrobe<{ items: Location[] }>('locations.list');
      if (!this.active(scope)) return;
      this.applyLocations(result.items);
    } catch (error) { if (this.active(scope)) await this.report(error); }
  },
  applyLocations(items: Location[]) {
    const ordered: Location[] = [];
    for (const root of items.filter(l => !l.parentId)) ordered.push(root, ...items.filter(l => l.parentId === root.id));
    const names = ordered.map(l => l.parentId ? `${items.find(p => p.id === l.parentId)?.name || ''} / ${l.name}` : l.name);
    this.setData({ locations: ordered, locationNames: ['未指定位置', ...names], locationIds: ['', ...ordered.map(l => l.id)] });
  },
  async pickOption(names: string[]): Promise<number> {
    // Native action sheets accept at most six rows. Large families and trees stay reachable by paging.
    let offset = 0;
    while (offset < names.length) {
      const rows = names.slice(offset, offset + 5), more = offset + 5 < names.length;
      const result = await wx.showActionSheet({ itemList: more ? [...rows, '更多 ›'] : rows }).catch(() => null);
      if (!result) return -1;
      if (more && result.tapIndex === rows.length) { offset += 5; continue; }
      return offset + result.tapIndex;
    }
    return -1;
  },
  async createLocation(event: WechatMiniprogram.TouchEvent) {
    const scope = this.scope(), parentId = (event.currentTarget.dataset.parent as string) || '';
    const name = await this.prompt(parentId ? '新增二级收纳位置' : '新增一级收纳位置', '例如：主卧衣柜');
    if (!name || !this.active(scope)) return;
    await this.mutate(async () => { await wardrobe('locations.create', { name, parentId }); });
    if (this.active(scope)) await this.loadLocations();
  },
  async editLocation(event: WechatMiniprogram.TouchEvent) {
    const location = this.data.locations.find((l: Location) => l.id === event.currentTarget.dataset.id); if (!location) return;
    const scope = this.scope();
    const action = await wx.showActionSheet({ itemList: ['修改名称', '调整上级位置', '删除位置'] }).catch(() => null);
    if (!action || !this.active(scope)) return;
    let patch: Record<string, unknown> = {};
    if (action.tapIndex === 0) { const name = await this.prompt('位置改名', '位置名称', location.name); if (!name || !this.active(scope)) return; patch = { name }; }
    if (action.tapIndex === 1) {
      const roots = this.data.locations.filter((l: Location) => !l.parentId && l.id !== location.id);
      const index = await this.pickOption(['作为一级位置', ...roots.map((l: Location) => l.name)]);
      if (index < 0 || !this.active(scope)) return;
      patch = { parentId: index === 0 ? '' : roots[index - 1].id };
    }
    if (action.tapIndex === 2) {
      const result = await wx.showModal({ title: '删除这个位置？', content: '请先处理下级位置。衣物已有的位置文字保留，之后可重新指派。' });
      if (!result.confirm || !this.active(scope)) return;
    }
    await this.mutate(async () => { await wardrobe(action.tapIndex === 2 ? 'locations.delete' : 'locations.update', { id: location.id, version: location.version, ...patch }); });
    if (this.active(scope)) await this.loadLocations();
  },
  formLocation(event: WechatMiniprogram.PickerChange) {
    if (this.data.saving || this.lockedBatchForm()) return;
    const index = Number(event.detail.value);
    this.setData({ 'form.locationId': this.data.locationIds[index], 'form.location': index ? this.data.locationNames[index] : '', formDirty: true }); this.persistForm();
  },
  async loadOutfits(more: boolean) {
    if (!this.data.family || (more && (this.data.loading || !this.data.outfitCursor))) return;
    const scope = this.scope(), generation = ++loadGeneration, memberId = this.data.selectedMember;
    this.setData({ loading: true });
    try {
      const result = await wardrobe<{ items: Outfit[]; cursor: string }>('outfits.list', { memberId: this.data.selectedMember || undefined, cursor: more ? this.data.outfitCursor : '', limit: 20 });
      if (this.active(scope) && generation === loadGeneration && memberId === this.data.selectedMember && this.data.screen === 'outfits') this.setData({ outfits: more ? [...this.data.outfits, ...result.items] : result.items, outfitCursor: result.cursor });
    } catch (error) { if (this.active(scope) && generation === loadGeneration) await this.report(error); }
    finally { if (this.active(scope) && generation === loadGeneration) this.setData({ loading: false }); }
  },
  moreOutfits() { this.loadOutfits(true); },
  newOutfit() {
    loadGeneration++;
    const memberId = this.data.selectedMember || this.data.members[0]?.id || '';
    this.setData({ screen: 'outfitEdit', loading: false, outfitForm: { ...emptyOutfit, memberId, requestId: requestId() }, outfitMemberName: this.data.members.find((m: CloudMember) => m.id === memberId)?.name || '', outfitPicked: [], pickedIds: [] });
  },
  async openOutfit(event: WechatMiniprogram.TouchEvent) {
    const scope = this.scope(), id = event.currentTarget.dataset.id as string;
    await this.mutate(async () => {
      const item = await wardrobe<Outfit>('outfits.get', { id }); if (!this.active(scope)) return;
      this.setData({ screen: 'outfitEdit', outfitForm: { id: item.id, version: item.version, name: item.name, memberId: item.memberId, partial: item.partial, occasion: item.occasion || '', reason: item.reason || '', requestId: '' }, outfitMemberName: this.data.members.find((m: CloudMember) => m.id === item.memberId)?.name || '', outfitPicked: item.garments, pickedIds: item.garmentIds, error: item.valid ? '' : '部分衣物已改变或不可用，请移除或重新选择后保存。' });
    });
  },
  outfitInput(event: WechatMiniprogram.Input) {
    const field = event.currentTarget.dataset.field as string;
    if (['name', 'occasion', 'reason'].includes(field)) this.setData({ [`outfitForm.${field}`]: event.detail.value });
  },
  outfitPartial(event: WechatMiniprogram.SwitchChange) { this.setData({ 'outfitForm.partial': event.detail.value }); },
  outfitMember(event: WechatMiniprogram.PickerChange) {
    this.setData({ 'outfitForm.memberId': this.data.members[Number(event.detail.value)]?.id || '', outfitMemberName: this.data.memberNames[Number(event.detail.value)] || '', outfitPicked: [], pickedIds: [] });
  },
  async openOutfitPicker() {
    loadGeneration++;
    this.setData({ pickerReturn: 'outfitEdit', screen: 'picker', loading: false, pickedIds: this.data.outfitPicked.map((g: WardrobeGarment) => g.id), outfitCandidates: [], candidateCursor: '' });
    await this.loadCandidates(false);
  },
  async openLockPicker() {
    loadGeneration++;
    this.setData({ pickerReturn: 'ai', screen: 'picker', loading: false, pickedIds: [...this.data.lockedIds], outfitCandidates: [], candidateCursor: '' }); await this.loadCandidates(false);
  },
  async loadCandidates(more: boolean) {
    const memberId = this.data.pickerReturn === 'ai' ? this.data.members[this.data.aiMemberIndex]?.id : this.data.outfitForm.memberId;
    if (!memberId || this.data.loading || (more && !this.data.candidateCursor)) return;
    const scope = this.scope(), generation = ++loadGeneration; this.setData({ loading: true });
    try {
      const result = await wardrobe<{items: WardrobeGarment[]; cursor: string}>('list', { memberId, limit: 50, cursor: more ? this.data.candidateCursor : '' });
      if (!this.active(scope) || generation !== loadGeneration || this.data.screen !== 'picker') return;
      this.setData({ outfitCandidates: [...(more ? this.data.outfitCandidates : []), ...result.items.map(g => ({ ...viewGarment(g), checked: this.data.pickedIds.includes(g.id) }))], candidateCursor: result.cursor });
    } catch (error) { if (this.active(scope) && generation === loadGeneration) await this.report(error); }
    finally { if (this.active(scope) && generation === loadGeneration) this.setData({ loading: false }); }
  },
  moreCandidates() { this.loadCandidates(true); },
  toggleCandidate(event: WechatMiniprogram.TouchEvent) {
    const id = event.currentTarget.dataset.id as string;
    const item = this.data.outfitCandidates.find((g: ViewGarment) => g.id === id); if (!item) return;
    let ids = [...this.data.pickedIds];
    if (ids.includes(id)) ids = ids.filter(g => g !== id);
    else {
      const known = [...this.data.outfitPicked, ...this.data.outfitCandidates, ...this.data.lockedGarments];
      ids = ids.filter(old => { const g = known.find(g => g.id === old); return g && g.category !== item.category && !(item.category === 'onepiece' && ['top', 'bottom'].includes(g.category)) && !(['top', 'bottom'].includes(item.category) && g.category === 'onepiece'); });
      if (ids.length >= 3) { toast('最多选择3件'); return; } ids.push(id);
    }
    this.setData({ pickedIds: ids, outfitCandidates: this.data.outfitCandidates.map((g: ViewGarment) => ({ ...g, checked: ids.includes(g.id) })) });
  },
  finishPicker() {
    const candidates = [...this.data.outfitCandidates, ...this.data.outfitPicked, ...this.data.lockedGarments];
    const picked = this.data.pickedIds.map((id: string) => candidates.find((g: WardrobeGarment) => g.id === id)).filter((g: WardrobeGarment | undefined): g is WardrobeGarment => !!g);
    if (this.data.pickerReturn === 'ai') this.setData({ screen: 'ai', lockedIds: this.data.pickedIds, lockedNames: picked.map((g: WardrobeGarment) => g.name).join('、'), lockedGarments: picked });
    else this.setData({ screen: 'outfitEdit', outfitPicked: picked });
  },
  removeOutfitItem(event: WechatMiniprogram.TouchEvent) { const id = event.currentTarget.dataset.id; this.setData({ outfitPicked: this.data.outfitPicked.filter((g: WardrobeGarment) => g.id !== id) }); },
  async saveOutfit() {
    if (this.data.saving) return;
    const form = this.data.outfitForm, items = this.data.outfitPicked, scope = this.scope();
    const problem = outfitProblem(items, form.memberId, form.partial);
    if (problem || !form.name.trim()) { toast(problem || '请填写搭配名称'); return; }
    if (items.some((g: WardrobeGarment & {available?: boolean; currentVersion?: number | null}) => g.available === false || (g.currentVersion !== undefined && g.currentVersion !== g.version))) { toast('衣物已改变，请重新选择后保存'); return; }
    await this.mutate(async () => {
      const saved = await wardrobe<Outfit>(form.id ? 'outfits.update' : 'outfits.create', { ...form, name: form.name.trim(), garments: items.map((g: WardrobeGarment) => ({ id: g.id, version: g.version })) });
      if (this.active(scope)) { this.setData({ 'outfitForm.id': saved.id, 'outfitForm.version': saved.version, screen: 'outfits', outfitPicked: [] }); toast('已收藏到搭配'); }
    });
    if (this.active(scope) && this.data.screen === 'outfits') await this.loadOutfits(false);
  },
  async deleteOutfit() {
    const form = this.data.outfitForm, scope = this.scope(); if (!form.id || this.data.saving) return;
    const result = await wx.showModal({ title: '删除收藏搭配？', content: '仅删除这套搭配，衣物仍保留在衣橱。' }); if (!result.confirm || !this.active(scope)) return;
    await this.mutate(async () => { await wardrobe('outfits.delete', { id: form.id, version: form.version }); if (this.active(scope)) this.setData({ screen: 'outfits', outfitPicked: [] }); });
    if (this.active(scope)) await this.loadOutfits(false);
  },
  async openAi() { this.setData({ screen: 'ai', error: '' }); await this.loadAiHistory(false); },
  aiInput(event: WechatMiniprogram.Input) { const field = event.currentTarget.dataset.field as string; if (['aiOccasion', 'aiSeason'].includes(field)) this.setData({ [field]: event.detail.value }); },
  aiMember(event: WechatMiniprogram.PickerChange) { this.setData({ aiMemberIndex: Number(event.detail.value), lockedIds: [], lockedNames: '', lockedGarments: [] }); },
  async loadAiHistory(more: boolean) {
    if (!this.data.family || this.data.aiBusy || (more && !this.data.aiCursor)) return;
    const scope = this.scope(); this.setData({ aiBusy: true });
    try {
      const [status, history] = await Promise.all([getAiStatus(), listAiTasks(more ? this.data.aiCursor : '')]);
      if (this.active(scope)) this.setData({ aiStatus: status, aiHistory: more ? [...this.data.aiHistory, ...history.items] : history.items, aiCursor: history.cursor });
    } catch (error) { if (this.active(scope)) await this.report(error); }
    finally { if (this.active(scope)) this.setData({ aiBusy: false }); }
  },
  moreAiHistory() { this.loadAiHistory(true); },
  refreshAiHistory() { this.loadAiHistory(false); },
  async openAiTask(event: WechatMiniprogram.TouchEvent) {
    if (this.data.aiBusy) return;
    const scope = this.scope(), id = event.currentTarget.dataset.id as string; this.setData({ aiBusy: true });
    try { const task = await getAiTask(id); if (this.active(scope)) await this.displayAiTask(task); }
    catch (error) { if (this.active(scope)) await this.report(error); }
    finally { if (this.active(scope)) this.setData({ aiBusy: false }); }
  },
  async queryAiTask() {
    const task = this.data.aiTask; if (!task || this.data.aiBusy) return;
    const scope = this.scope(); this.setData({ aiBusy: true });
    try { const latest = await getAiTask(task.id); if (this.active(scope)) await this.displayAiTask(latest); }
    catch (error) { if (this.active(scope)) await this.report(error); }
    finally { if (this.active(scope)) this.setData({ aiBusy: false }); }
  },
  async recognizeSelected() {
    const garmentId = this.data.selected?.id; if (!garmentId || this.data.aiBusy || this.data.saving) return;
    const scope = this.scope();
    const consent = await wx.showModal({ title: '重新智能识别这张衣物照片？', confirmText: '重新识别' });
    if (!consent.confirm || !this.active(scope)) return;
    if (this.data.pendingAi) {
      const pending = this.data.pendingAi;
      if (pending.kind === 'recognize' && pending.garmentId === garmentId) { await this.retryAi(); return; }
      toast('请先查看上次结果，或选择重新生成'); return;
    }
    await this.submitAi({ kind: 'recognize', garmentId, requestId: requestId() });
  },
  async generateRecommendations() {
    if (this.data.aiBusy || this.data.saving) return;
    if (this.data.pendingAi) { toast('请先查看上次结果，或选择重新生成'); return; }
    const memberId = this.data.members[this.data.aiMemberIndex]?.id; if (!memberId) { toast('请选择成员'); return; }
    const scope = this.scope();
    const confirm = await wx.showModal({ title: '生成真实衣物搭配？', content: '根据所选成员的衣物和搭配偏好生成建议。', confirmText: '确认生成' });
    if (!confirm.confirm || !this.active(scope)) return;
    await this.submitAi({ kind: 'recommend', memberId, occasion: this.data.aiOccasion.trim(), season: this.data.aiSeason.trim(), lockedGarmentIds: [...this.data.lockedIds], requestId: requestId() });
  },
  async submitAi(pending: PendingAi) {
    if (!this.data.family || this.data.aiBusy) return;
    const scope = this.scope();
    wx.setStorageSync(aiKey(scope.familyId), pending); this.setData({ pendingAi: pending, aiBusy: true, error: '' });
    try {
      const task = pending.kind === 'recognize' ? await recognizeGarment(pending.garmentId || '', pending.requestId) : await recommendOutfits({ memberId: pending.memberId || '', requestId: pending.requestId, occasion: pending.occasion, season: pending.season, lockedGarmentIds: pending.lockedGarmentIds });
      if (!this.active(scope)) return;
      const tracked = { ...pending, taskId: task.id };
      wx.setStorageSync(aiKey(scope.familyId), tracked); this.setData({ pendingAi: tracked });
      await this.displayAiTask(task, true);
      const status = await getAiStatus(); if (this.active(scope)) this.setData({ aiStatus: status });
    } catch (error) { if (this.active(scope)) { await this.report(error); if (this.active(scope)) toast('暂未取得结果，请稍后查看'); } }
    finally { if (this.active(scope)) this.setData({ aiBusy: false }); }
  },
  async retryAi() {
    const pending = this.data.pendingAi;
    if (!pending || this.data.aiBusy) return;
    if (this.data.aiTask?.status === 'unknown') { toast('结果暂未返回，请稍后查看'); return; }
    await this.submitAi(pending);
  },
  async newAiTask() {
    if (this.data.aiBusy || !this.data.family) return;
    const scope = this.scope();
    const confirm = await wx.showModal({ title: '重新生成？', content: '将重新生成建议，之前的结果可在历史中查看。', confirmText: '重新生成' });
    if (!confirm.confirm || !this.active(scope)) return;
    wx.removeStorageSync(aiKey(scope.familyId)); this.setData({ pendingAi: null, aiTask: null, recommendations: [] });
    if (this.data.screen === 'detail') await this.recognizeSelected();
    else await this.generateRecommendations();
  },
  async displayAiTask(task: AiTask, resolvesPending = false) {
    const scope = this.scope();
    this.setData({ aiTask: task, recommendations: [], suggestionCategory: task.result?.suggestions?.category ? categoryNames[categories.indexOf(task.result.suggestions.category)] : '暂无建议' });
    // Only a response to our persisted request may clear its retry state. Opening history is read-only.
    if (task.status === 'succeeded') {
      const pending = this.data.pendingAi;
      if (pending && (resolvesPending || pending.taskId === task.id)) {
        wx.removeStorageSync(aiKey(scope.familyId)); this.setData({ pendingAi: null });
      }
    }
    if (task.status !== 'succeeded' || task.type !== 'recommend' || !task.result?.outfits) return;
    const rows: Array<{ garments: ViewGarment[]; reason: string; missing: boolean }> = [];
    for (const outfit of task.result.outfits.slice(0, 3)) {
      const garments: ViewGarment[] = []; let missing = false;
      for (const id of outfit.garmentIds) {
        try { const garment = await call<WardrobeGarment>('garments', 'get', { garmentId: id }); if (!this.active(scope)) return; if (garment.memberId !== task.result.memberId) missing = true; garments.push(viewGarment(garment)); }
        catch (error) { if (!this.active(scope)) return; if (error instanceof CloudError && ['NO_FAMILY', 'UNAUTHENTICATED'].includes(error.code)) { await this.report(error); return; } missing = true; }
      }
      rows.push({ garments, reason: outfit.reason, missing });
    }
    if (this.active(scope) && this.data.aiTask?.id === task.id) this.setData({ recommendations: rows });
  },
  applySuggestion(event: WechatMiniprogram.TouchEvent) {
    if (this.data.aiTask?.status !== 'succeeded' || this.data.aiTask.result?.garmentId !== this.data.selected?.id || this.data.screen !== 'detail' || this.data.saving) return;
    const suggestions = this.data.aiTask?.result?.suggestions; if (!suggestions) return;
    const field = event.currentTarget.dataset.field as 'name' | 'category' | 'color';
    if (field === 'category' && suggestions.category) this.setData({ 'form.categoryIndex': categories.indexOf(suggestions.category), formDirty: true });
    else if (['name', 'color'].includes(field)) this.setData({ [`form.${field}`]: suggestions[field as 'name' | 'color'], formDirty: true });
  },
  async openRecognizedGarment() {
    const task = this.data.aiTask, id = task?.result?.garmentId; if (!id) return;
    const scope = this.scope();
    await this.mutate(async () => { const g = await call<WardrobeGarment>('garments', 'get', { garmentId: id }); if (this.active(scope)) { this.applySelected(g); this.setData({ aiTask: task }); } });
  },
  useRecommendation(event: WechatMiniprogram.TouchEvent) {
    const index = Number(event.currentTarget.dataset.index), row = this.data.recommendations[index]; if (!row) return;
    this.setData({ screen: 'outfitEdit', outfitForm: { ...emptyOutfit, memberId: this.data.aiTask?.result?.memberId || '', name: `日常搭配 ${index + 1}`, occasion: this.data.aiOccasion, reason: row.reason, requestId: requestId() }, outfitMemberName: this.data.members.find((m: CloudMember) => m.id === this.data.aiTask?.result?.memberId)?.name || '', outfitPicked: row.garments, error: row.missing ? '推荐中的衣物已改变，请手动替换后保存。' : '' });
  },
  async startExport() {
    if (this.data.exporting || !this.data.family) return;
    const scope = this.scope(); exportCancelled = false;
    if (this.data.exportPath) { try { void removeFile(this.data.exportPath); } catch { /* Already removed. */ } }
    this.setData({ exporting: true, exportCount: 0, exportPath: '', exportBytes: 0 });
    try {
      const result = await exportWardrobe({ memberId: this.data.selectedMember || undefined, onProgress: count => { if (this.active(scope)) this.setData({ exportCount: count }); }, isCancelled: () => exportCancelled || !this.active(scope) });
      if (!this.active(scope) || exportCancelled) { try { void removeFile(result.path); } catch { /* Removed. */ } return; }
      this.setData({ exportPath: result.path, exportCount: result.count, exportBytes: result.bytes }); toast('导出已准备好，请点分享文件');
    } catch (error) { if (this.active(scope) && !exportCancelled) await this.report(error); }
    finally { if (this.active(scope)) this.setData({ exporting: false }); }
  },
  cancelExport() { exportCancelled = true; },
  shareExport() { if (this.data.exportPath && !this.data.exporting) wx.shareFileMessage({ filePath: this.data.exportPath, fileName: '家庭衣橱.zip', fail: () => toast('未分享，可稍后再试') }); },
  async cutoutSelected() {
    if (this.data.screen === 'upload') { await this.cutoutBatchPhoto(); return; }
    const selected = this.data.selected; if (!selected || this.data.saving) return;
    const scope = this.scope(), mode = 'common' as const;
    await this.mutate(async () => {
      let result = await getCutout(selected.id, mode);
      if (!this.active(scope) || this.data.selected?.id !== selected.id) return;
      const apply = async (value: CutoutResult) => {
        if (value.status !== 'succeeded' || !value.base64) return false;
        const path = await saveCutoutPreview(value.base64); this.clearCutout(); this.setData({ cutoutPath: path, cutoutRequestId: value.requestId || '', cutoutVersion: selected.version });
        toast(value.cached ? '已打开已有抠图' : '去背景已完成'); return true;
      };
      if (await apply(result)) return;
      if (result.status === 'running') { toast('正在去背景，稍后点击重查即可'); return; }
      let restart = false;
      if (['unknown', 'failed', 'expired'].includes(result.status)) {
        const confirmation = await wx.showModal({ title: '重新生成去背景图片？', content: '将重新生成透明图片，原照片保留。', confirmText: '重新生成' });
        if (!confirmation.confirm || !this.active(scope) || this.data.selected?.id !== selected.id) return;
        restart = true;
      }
      result = await processCutout(selected.id, mode, requestId(), restart);
      if (!this.active(scope) || this.data.selected?.id !== selected.id) return;
      if (!await apply(result)) this.setData({ error: result.error || (result.status === 'running' ? '正在去背景，稍后点击重查即可' : '去背景结果暂不确定，请点击重查，原图已保留') });
    });
  },
  async cutoutBatchPhoto() {
    const entry = this.data.batch[this.data.batchIndex];
    if (!entry || this.data.saving || this.data.recognizingBatch || entry.submittedPatch || entry.status === 'saved') return;
    if (entry.cutout?.applied) { toast('已替换，可直接保存'); return; }
    const scope = this.scope();
    if (entry.cutout && ['failed', 'expired'].includes(entry.cutout.status)) {
      const confirm = await wx.showModal({ title: '重新生成去背景图片？', content: '将重新生成透明图片，当前照片保留。', confirmText: '重新生成' });
      if (!confirm.confirm || !this.active(scope) || this.data.batch[this.data.batchIndex]?.id !== entry.id) return;
      if (entry.cutout.previewPath) { try { void removeFile(entry.cutout.previewPath); } catch { /* Expired local result. */ } }
      delete entry.cutout;
    }
    await this.mutate(async () => {
      await previewEntryCutout(entry, { active: () => this.active(scope), current: () => this.data.batch.find((row: BatchEntry) => row.id === entry.id),
        checkpoint: () => {
          if (!this.active(scope)) return;
          persistBatch(scope.familyId, this.data.batch);
          this.setData({ batch: [...this.data.batch], ...(this.data.screen === 'upload' && this.data.batch[this.data.batchIndex]?.id === entry.id ? batchPhotoState(entry) : {}) });
        } });
      if (this.active(scope)) toast(entry.cutout?.status === 'succeeded' ? '去背景已完成' : entry.cutout?.error || '请稍后查看结果');
    });
  },
  previewCutout() { if (this.data.cutoutPath) wx.previewImage({ urls: [this.data.cutoutPath] }); },
  clearCutout() { if (this.data.cutoutPath.includes('/cutout-')) { try { void removeFile(this.data.cutoutPath); } catch { /* Removed. */ } } },
  async replaceOriginal() {
    if (this.data.screen === 'upload') {
      const entry = this.data.batch[this.data.batchIndex];
      if (!entry?.cutout || entry.cutout.status !== 'succeeded' || !entry.cutout.previewPath || entry.submittedPatch || this.data.saving) return;
      entry.cutout.applied = true;
      persistBatch(this.data.family!.id, this.data.batch);
      this.setData({ batch: [...this.data.batch], ...batchPhotoState(entry) });
      toast('已替换，保存后生效'); return;
    }
    const selected = this.data.selected, request = this.data.cutoutRequestId, version = this.data.cutoutVersion;
    if (!selected || !request || !this.data.cutoutPath || this.data.saving) return;
    const scope = this.scope(); detailGeneration++;
    await this.mutate(async () => {
      const applied = await applyCutout(selected.id, request, version);
      garmentCache.clear();
      if (!this.active(scope) || this.data.selected?.id !== selected.id) return;
      const { url } = await call<{ url: string }>('garments', 'image', { garmentId: selected.id });
      if (!url) throw new Error('照片已替换，暂时无法读取，请稍后重试');
      if (!this.active(scope) || this.data.selected?.id !== selected.id) return;
      const updated = { ...selected, image: url, version: applied.version };
      this.clearCutout();
      this.setData({ selected: updated, garments: this.data.garments.map((item: ViewGarment) => item.id === selected.id ? { ...item, image: url, version: applied.version } : item),
        cutoutPath: '', cutoutRequestId: '', cutoutVersion: 0, aiTask: null });
      toast('已替换原图');
    });
  },
  
  agreePrivacy() { wx.setStorageSync('photo-consent',true); uni.setStorageSync('family-home-photo-consent',true); this.setData({ showPrivacy: false }); this.choosePhoto(); },
  declinePrivacy() { this.setData({ showPrivacy: false, replaceBatchIndex: -1 }); },
  viewPrivacy() {
    wx.openPrivacyContract({ fail: () => toast('暂时无法打开隐私指引，请稍后重试') });
  },
});

}
