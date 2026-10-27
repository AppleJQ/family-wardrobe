import { APP_NAME, APP_ROUTES } from '../../config/app';
import { design } from '../../config/design-assets';
import { call, FamilySnapshot } from '../../services/cloud';

let generation = 0;
let disposed = false;

Page({
  data: {
    appName: APP_NAME,
    statusBarHeight: wx.getWindowInfo().statusBarHeight,
    assets: design.wardrobe,
    family: null as FamilySnapshot['family'],
    members: [] as FamilySnapshot['members'],
    accounts: [] as FamilySnapshot['accounts'],
    loading: false, ready: false, error: '',
  },
  onLoad() { disposed = false; },
  onShow() { return this.refresh(); },
  onHide() { generation++; this.setData({ loading: false }); },
  onUnload() { disposed = true; generation++; },
  async refresh() {
    const request = ++generation;
    // Revalidate the current household before displaying any shared information.
    this.setData({ loading: true, ready: false, error: '', family: null, members: [], accounts: [] });
    try {
      const snapshot = await call<FamilySnapshot>('bootstrapUser', 'bootstrap');
      if (disposed || request !== generation) return;
      this.setData({ family: snapshot.family, members: snapshot.members, accounts: snapshot.accounts, ready: true });
    } catch (error) {
      if (!disposed && request === generation) this.setData({ error: error instanceof Error ? error.message : '暂时无法连接，请稍后重试' });
    } finally {
      if (!disposed && request === generation) this.setData({ loading: false });
    }
  },
  openWardrobe() {
    if (this.data.ready && this.data.family) wx.navigateTo({ url: APP_ROUTES.wardrobe });
  },
  openFamily() { wx.navigateTo({ url: APP_ROUTES.family }); },
  viewPrivacy() {
    wx.openPrivacyContract({ fail: () => wx.showToast({ title: '暂时无法打开隐私指引', icon: 'none' }) });
  },
});
