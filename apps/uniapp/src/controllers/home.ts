import { APP_NAME, APP_ROUTES } from '../config/app';
import { design } from '../config/design-assets';
import { call, FamilySnapshot } from '../services/cloud';
import { platform as wx } from '../platform/runtime';
import { definePage } from '../platform/page-state';
import { removeFile } from '../platform/files';
import {getSession} from '../services/session';
import {isWechat} from '../platform/runtime';
export default function createController() {
const accountId=getSession()?.userId||'';

let generation = 0;
let disposed = false;

return definePage({
  data: {
    appName: APP_NAME,
    statusBarHeight: wx.getWindowInfo().statusBarHeight,
    assets: design.wardrobe,
    family: null as FamilySnapshot['family'],
    members: [] as FamilySnapshot['members'],
    accounts: [] as FamilySnapshot['accounts'],
    loading: false, ready: false, error: '',
  },
  onLoad() { disposed = false; return this.refresh(); },
  onShow() { return this.refresh(); },
  onHide() { generation++; this.setData({ loading: false }); },
  onUnload() { disposed = true; generation++; },
  async refresh() {
    const request = ++generation;
    // Revalidate the current household before displaying any shared information.
    this.setData({ loading: true, ready: false, error: '', family: null, members: [], accounts: [] });
    try {
      const snapshot = await call<FamilySnapshot>('bootstrapUser', 'bootstrap');
      if (disposed || request !== generation || (!isWechat&&(getSession()?.userId||'')!==accountId)) return;
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

}
