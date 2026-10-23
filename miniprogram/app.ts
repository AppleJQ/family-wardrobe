import { CLOUD_ENV } from './config/cloud';

interface IAppOption {
  globalData: {
    environment: string;
    cloudEnvironment: string;
  };
}

App<IAppOption>({
  onLaunch() {
    if (wx.cloud) wx.cloud.init({ env: CLOUD_ENV });
  },
  globalData: {
    environment: 'cloud-mvp',
    cloudEnvironment: CLOUD_ENV,
  },
});
