import { design } from '../../config/design-assets';
import { call, CloudError, CloudGarment, CloudMember, FamilyAccount, FamilySnapshot, GarmentPage, prepareImage } from '../../services/cloud';

type Screen = 'wardrobe' | 'account' | 'upload' | 'detail';
type Category = CloudGarment['category'];
const categories: Category[] = ['top', 'bottom', 'hat'];
const categoryNames = ['上衣', '裤子', '帽子'];
const statusValues: CloudGarment['status'][] = ['wearable', 'laundry', 'storage', 'retired'];
const statusNames = ['可穿', '待洗', '收纳中', '已淘汰'];
const toast = (title: string) => wx.showToast({ title, icon: 'none' });
const viewGarment = (g: CloudGarment) => ({ ...g, categoryLabel: categoryNames[categories.indexOf(g.category)], statusLabel: statusNames[statusValues.indexOf(g.status)] });
type ViewGarment = ReturnType<typeof viewGarment>;
const emptySnapshot: FamilySnapshot = { family: null, members: [], accounts: [] };
const emptyForm = { name: '', categoryIndex: 0, memberIndex: 0, statusIndex: 0, location: '', notes: '' };
let loadGeneration = 0;
let detailGeneration = 0;
let pendingBase64 = '';
let draftId = '';

Page({
  data: {
    statusBarHeight: wx.getWindowInfo().statusBarHeight,
    ...emptySnapshot, screen: 'wardrobe' as Screen, ready: false, loading: false, saving: false,
    error: '', syncLabel: '正在连接云端', selectedMember: '', selectedMemberName: '全家', category: 'all',
    garments: [] as ViewGarment[], cursor: '', selected: null as ViewGarment | null,
    form: { ...emptyForm }, formDirty: false, categoryNames, statusNames, memberNames: [] as string[],
    imagePath: '', inviteToken: '', invitePreview: '', inviteInput: '', inviteId: '',
    showPrivacy: false, privacyContractName: '隐私保护指引',
    assets: design.wardrobe,
  },
  onLoad() { this.bootstrap(); },
  onShow() {
    if (this.data.screen === 'detail' && this.data.formDirty) return;
    if (this.data.ready && this.data.family) this.refresh();
  },
  onUnload() { loadGeneration++; detailGeneration++; pendingBase64 = ''; draftId = ''; },
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
    loadGeneration++; detailGeneration++; pendingBase64 = ''; draftId = '';
    this.setData({ ...emptySnapshot, loading: false, garments: [], selected: null, cursor: '', selectedMember: '', selectedMemberName: '全家', memberNames: [], imagePath: '', inviteToken: '', inviteId: '', screen: 'wardrobe', formDirty: false });
  },
  async bootstrap() {
    if (this.data.loading) return;
    this.setData({ loading: true, error: '' });
    try {
      const snapshot = await call<FamilySnapshot>('bootstrapUser', 'bootstrap');
      this.applySnapshot(snapshot);
      this.setData({ ready: true, syncLabel: snapshot.family ? '已连接云端' : '尚未加入家庭' });
    } catch (error) { this.setData({ error: error instanceof Error ? error.message : '连接失败', syncLabel: '连接失败' }); }
    finally { this.setData({ loading: false }); }
    if (this.data.ready && this.data.family) await this.loadGarments(false);
  },
  applySnapshot(snapshot: FamilySnapshot) {
    const selected = snapshot.members.find(m => m.id === this.data.selectedMember);
    this.setData({ ...snapshot, memberNames: snapshot.members.map(m => m.name), selectedMember: selected?.id || '', selectedMemberName: selected?.name || '全家' });
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
    this.setData({ loading: true, error: '', syncLabel: '正在同步' });
    try {
      this.applySnapshot(await call<FamilySnapshot>('families', 'get'));
      if (detailId) {
        const latest = await call<CloudGarment>('garments', 'get', { garmentId: detailId });
        if (detailRequest === detailGeneration && this.data.screen === 'detail' && this.data.selected?.id === detailId && !this.data.formDirty) this.applySelected(latest);
      }
    }
    catch (error) { this.setData({ loading: false }); await this.report(error); return; }
    this.setData({ loading: false });
    await this.loadGarments(false);
  },
  async loadGarments(more: boolean) {
    if (this.data.loading || !this.data.family || (more && !this.data.cursor)) return;
    const generation = ++loadGeneration;
    this.setData({ loading: true, error: '' });
    try {
      const page = await call<GarmentPage>('garments', 'list', {
        memberId: this.data.selectedMember || undefined, category: this.data.category,
        cursor: more ? this.data.cursor : undefined, limit: 20,
      });
      if (generation !== loadGeneration) return;
      this.setData({ garments: more ? [...this.data.garments, ...page.items.map(viewGarment)] : page.items.map(viewGarment), cursor: page.cursor, syncLabel: `已同步 · ${new Date().toLocaleTimeString().slice(0, 5)}` });
    } catch (error) { if (generation === loadGeneration) { this.setData({ loading: false }); await this.report(error); } }
    finally { if (generation === loadGeneration) this.setData({ loading: false }); }
  },
  loadMore() { this.loadGarments(true); },
  nav(event: WechatMiniprogram.TouchEvent) {
    if (this.data.saving) return;
    detailGeneration++;
    const screen = event.currentTarget.dataset.screen as Screen;
    this.setData({ screen, selected: null, error: '' });
    if (screen === 'wardrobe' && this.data.family) this.refresh();
  },
  async chooseMember(event: WechatMiniprogram.TouchEvent) {
    if (this.data.loading) return;
    const memberId = event.currentTarget.dataset.id as string;
    this.setData({ selectedMember: memberId, selectedMemberName: this.data.members.find((m: CloudMember) => m.id === memberId)?.name || '全家' });
    await this.loadGarments(false);
  },
  async filterCategory(event: WechatMiniprogram.TouchEvent) {
    if (this.data.loading) return;
    this.setData({ category: event.currentTarget.dataset.category as string }); await this.loadGarments(false);
  },
  async createFamily() {
    if (this.data.saving) return;
    const name = await this.prompt('创建家庭', '例如：我们的家'); if (!name) return;
    const memberName = await this.prompt('你的衣物档案名', '例如：我、爸爸'); if (!memberName) return;
    await this.mutate(async () => {
      this.applySnapshot(await call<FamilySnapshot>('families', 'create', { name, memberName }));
      toast('家庭已创建');
    });
    if (this.data.family) await this.loadGarments(false);
  },
  prompt(title: string, placeholderText: string, content = ''): Promise<string> {
    return new Promise(resolve => wx.showModal({ title, editable: true, placeholderText, content,
      success: result => resolve(result.confirm ? result.content?.trim() || '' : ''), fail: () => resolve(''),
    }));
  },
  async mutate(work: () => Promise<void>) {
    if (this.data.saving) return;
    this.setData({ saving: true, error: '' });
    try { await work(); }
    catch (error) { this.setData({ saving: false }); await this.report(error); }
    finally { this.setData({ saving: false }); }
  },
  inviteInput(event: WechatMiniprogram.Input) { this.setData({ inviteInput: event.detail.value.trim(), invitePreview: '' }); },
  async previewInvite() {
    await this.mutate(async () => {
      const preview = await call<{ familyName: string }>('familyInvites', 'preview', { token: this.data.inviteInput });
      this.setData({ invitePreview: preview.familyName });
    });
  },
  async acceptInvite() {
    const confirmation = await wx.showModal({ title: `加入「${this.data.invitePreview}」？`, content: '加入后，全体家人都可以查看、修改和删除全部家庭衣物及照片。衣物归属档案不限制家人的编辑权限。', confirmText: '确认加入' });
    if (!confirmation.confirm) return;
    await this.mutate(async () => {
      this.applySnapshot(await call<FamilySnapshot>('familyInvites', 'accept', { token: this.data.inviteInput, confirmed: true }));
      this.setData({ inviteInput: '', invitePreview: '' }); toast('已加入家庭');
    });
    if (this.data.family) await this.loadGarments(false);
  },
  async createInvite() {
    await this.mutate(async () => {
      const invite = await call<{ id: string; token: string }>('familyInvites', 'create');
      this.setData({ inviteToken: invite.token, inviteId: invite.id });
    });
  },
  copyInvite() { wx.setClipboardData({ data: this.data.inviteToken }); },
  async revokeInvite() {
    await this.mutate(async () => { await call('familyInvites', 'revoke', { inviteId: this.data.inviteId }); this.setData({ inviteToken: '', inviteId: '' }); toast('邀请已撤销'); });
  },
  async addMember() {
    const name = await this.prompt('新增衣物归属档案', '例如：孩子'); if (!name) return;
    await this.mutate(async () => { await call('members', 'create', { name }); this.applySnapshot(await call<FamilySnapshot>('families', 'get')); });
  },
  async renameMember(event: WechatMiniprogram.TouchEvent) {
    const member = this.data.members.find((m: CloudMember) => m.id === event.currentTarget.dataset.id); if (!member) return;
    const name = await this.prompt('修改档案名', '请输入档案名称', member.name); if (!name) return;
    await this.mutate(async () => { await call('members', 'rename', { memberId: member.id, version: member.version, name }); this.applySnapshot(await call<FamilySnapshot>('families', 'get')); });
  },
  async renameFamily() {
    const name = await this.prompt('修改家庭名', '请输入家庭名称', this.data.family?.name || ''); if (!name) return;
    await this.mutate(async () => { await call('families', 'rename', { name }); this.applySnapshot(await call<FamilySnapshot>('families', 'get')); });
  },
  async manageAccount(event: WechatMiniprogram.TouchEvent) {
    const account = this.data.accounts.find((a: FamilyAccount) => a.userId === event.currentTarget.dataset.id); if (!account || account.isSelf) return;
    const action = await wx.showActionSheet({ itemList: ['移交管理员给此账号', '移出此账号'] }).catch(() => null); if (!action) return;
    const confirmation = await wx.showModal({ title: action.tapIndex === 0 ? '移交管理权？' : '移出此账号？', content: action.tapIndex === 0 ? '移交后你成为普通家庭成员。' : '该账号将无法再访问家庭；已有衣物与档案保留。' }); if (!confirmation.confirm) return;
    await this.mutate(async () => { await call('families', action.tapIndex === 0 ? 'transfer' : 'remove', { userId: account.userId }); this.applySnapshot(await call<FamilySnapshot>('families', 'get')); this.setData({ inviteToken: '', inviteId: '' }); });
  },
  async leaveFamily() {
    const confirmation = await wx.showModal({ title: '退出家庭？', content: '家庭衣物会保留。退出后将无法继续访问，重新加入需要新邀请。管理员需先移交管理权。' }); if (!confirmation.confirm) return;
    await this.mutate(async () => { await call('families', 'leave'); this.clearFamily(); });
  },
  openUpload() {
    pendingBase64 = ''; draftId = '';
    const index = Math.max(0, this.data.members.findIndex((m: CloudMember) => m.id === this.data.selectedMember));
    this.setData({ screen: 'upload', imagePath: '', form: { ...emptyForm, memberIndex: index }, selected: null, error: '' });
  },
  async choosePhoto() {
    if (this.data.saving) return;
    try {
      const privacy = await new Promise<WechatMiniprogram.GetPrivacySettingSuccessCallbackResult>((resolve, reject) => wx.getPrivacySetting({ success: resolve, fail: reject }));
      if (privacy.needAuthorization) {
        this.setData({ showPrivacy: true, privacyContractName: privacy.privacyContractName });
        return;
      }
      const picked = await wx.chooseMedia({ count: 1, mediaType: ['image'], sourceType: ['album', 'camera'] });
      if (!picked.tempFiles[0]) return;
      this.setData({ saving: true });
      const prepared = await prepareImage(picked.tempFiles[0].tempFilePath);
      pendingBase64 = prepared.base64; draftId = '';
      this.setData({ imagePath: prepared.path });
    } catch (error) { if (!String((error as { errMsg?: string }).errMsg).includes('cancel')) await this.report(error); }
    finally { this.setData({ saving: false }); }
  },
  formInput(event: WechatMiniprogram.Input) {
    const field = event.currentTarget.dataset.field as string;
    this.setData({ [`form.${field}`]: event.detail.value, formDirty: true });
    if (this.data.screen === 'upload') draftId = '';
  },
  formPicker(event: WechatMiniprogram.PickerChange) {
    const field = event.currentTarget.dataset.field as string;
    this.setData({ [`form.${field}`]: Number(event.detail.value), formDirty: true });
    if (this.data.screen === 'upload') draftId = '';
  },
  async saveGarment() {
    if (this.data.saving) return;
    const form = this.data.form, memberId = this.data.members[form.memberIndex]?.id;
    if (!form.name.trim() || !memberId) { toast('请填写衣物名称并选择归属档案'); return; }
    if (this.data.screen === 'upload' && !pendingBase64) { toast('请先选择一张衣物照片'); return; }
    await this.mutate(async () => {
      const patch = { name: form.name.trim(), memberId, category: categories[form.categoryIndex], status: statusValues[form.statusIndex], location: form.location.trim(), notes: form.notes.trim() };
      if (this.data.screen === 'detail' && this.data.selected) {
        await call('garments', 'update', { garmentId: this.data.selected.id, version: this.data.selected.version, patch });
      } else {
        // Preserve the id on an ambiguous timeout so a successful retry cannot duplicate the record.
        if (!draftId) draftId = (await call<{ id: string }>('garments', 'beginUpload', patch)).id;
        try { await call('garments', 'upload', { garmentId: draftId, base64: pendingBase64 }); }
        catch (error) {
          if (error instanceof CloudError && ['INVALID_IMAGE', 'UPLOAD_INVALID'].includes(error.code)) draftId = '';
          throw error;
        }
        pendingBase64 = ''; draftId = '';
      }
      this.setData({ screen: 'wardrobe', selected: null, imagePath: '' }); toast('已保存到家庭衣橱');
    });
    if (this.data.screen === 'wardrobe') await this.loadGarments(false);
  },
  async openGarment(event: WechatMiniprogram.TouchEvent) {
    const detailRequest = ++detailGeneration;
    const garment = this.data.garments.find((g: ViewGarment) => g.id === event.currentTarget.dataset.id); if (!garment) return;
    this.applySelected(garment);
    try {
      const latest = await call<CloudGarment>('garments', 'get', { garmentId: garment.id });
      if (detailRequest === detailGeneration && this.data.screen === 'detail' && this.data.selected?.id === garment.id && !this.data.formDirty) this.applySelected(latest);
    } catch (error) { await this.report(error); }
  },
  applySelected(garment: CloudGarment) {
    this.setData({ selected: viewGarment(garment), screen: 'detail', error: '', formDirty: false, form: { name: garment.name, memberIndex: Math.max(0, this.data.members.findIndex((m: CloudMember) => m.id === garment.memberId)), categoryIndex: categories.indexOf(garment.category), statusIndex: statusValues.indexOf(garment.status), location: garment.location, notes: garment.notes } });
  },
  previewImage() {
    const id = this.data.selected?.id; if (!id) return;
    this.mutate(async () => { const { url } = await call<{ url: string }>('garments', 'image', { garmentId: id }); if (url) wx.previewImage({ urls: [url] }); });
  },
  async deleteGarment() {
    const selected = this.data.selected; if (!selected) return;
    const confirmation = await wx.showModal({ title: '删除这件衣物？', content: '此操作对全家生效。衣物会从衣橱移除，本阶段暂不提供恢复入口。', confirmText: '确认删除', confirmColor: '#a64538' }); if (!confirmation.confirm) return;
    await this.mutate(async () => { await call('garments', 'delete', { garmentId: selected.id, version: selected.version }); this.setData({ selected: null, screen: 'wardrobe' }); toast('已删除'); });
    if (this.data.screen === 'wardrobe') await this.loadGarments(false);
  },
  openDemo() { wx.navigateTo({ url: '/pages/index/index' }); },
  agreePrivacy() { this.setData({ showPrivacy: false }); this.choosePhoto(); },
  declinePrivacy() { this.setData({ showPrivacy: false }); },
  viewPrivacy() {
    wx.openPrivacyContract({ fail: () => toast('暂时无法打开隐私指引，请稍后重试') });
  },
  showHelp() {
    wx.showModal({ title: '家庭衣橱使用说明', content: '创建家庭后，管理员可在“我的家庭”生成邀请。家人用各自微信加入，均可查看、编辑和删除全部家庭衣物。衣物档案只区分归属，不授予登录权限。照片仅用于衣物管理，请勿上传人物照片。图片与衣物信息保存在云端；删除衣物对全家生效。', showCancel: false });
  },
});
