const { contextBridge, ipcRenderer } = require('electron');

const call = async (ch, ...args) => {
  const r = await ipcRenderer.invoke(ch, ...args);
  if (!r.ok) throw new Error(r.error);
  return r.data;
};

contextBridge.exposeInMainWorld('api', {
  getSettings: () => call('settings:get'),
  updateSettings: (patch) => call('settings:update', patch),
  login: (env) => call('account:login', env),
  removeAccount: (id) => call('account:remove', id),
  lookupSku: (sku, brand) => call('sku:lookup', sku, brand),
  fetchImage: (url) => call('image:fetch', url),
  traceSearch: (q) => call('trace:search', q),
  searchCategories: (env, q) => call('category:search', env, q),
  categoryDetails: (env, n) => call('category:details', env, n),
  validate: (payload) => call('listing:validate', payload),
  fees: (payload) => call('listing:fees', payload),
  submit: (payload) => call('listing:submit', payload),
  openExternal: (url) => call('open:external', url),
  onProgress: (fn) => ipcRenderer.on('progress', (_e, msg) => fn(msg)),
  accountPayments: (accountId) => call('account:payments', accountId),
  accountBalance: (accountId) => call('account:balance', accountId),
  priceComps: (payload) => call('price:comps', payload),
  sold: (accountIds) => call('sold:list', accountIds),
  live: (accountIds) => call('live:list', accountIds),
  getListing: (payload) => call('listing:get', payload),
  editListing: (payload) => call('listing:edit', payload),
  withdrawListing: (payload) => call('listing:withdraw', payload),
  appVersion: () => call('app:version'),
  checkUpdate: () => call('update:check'),
  downloadUpdate: () => call('update:download'),
  installUpdate: () => call('update:install'),
  onUpdateProgress: (fn) => ipcRenderer.on('update-progress', (_e, p) => fn(p)),
  questions: (accountId) => call('questions:list', accountId),
  answerQuestion: (payload) => call('questions:answer', payload),
  relistList: (accountId) => call('relist:list', accountId),
  relistRun: (payload) => call('relist:run', payload),
  onRelistProgress: (fn) => ipcRenderer.on('relist-progress', (_e, p) => fn(p)),
});
