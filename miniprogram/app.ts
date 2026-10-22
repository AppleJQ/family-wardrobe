interface IAppOption {
  globalData: {
    environment: string;
    cloudEnvironment: string;
  };
}

App<IAppOption>({
  globalData: {
    environment: 'local-demo',
    cloudEnvironment: 'wardrobe-dev-cloude-d5bv128b609',
  },
});
