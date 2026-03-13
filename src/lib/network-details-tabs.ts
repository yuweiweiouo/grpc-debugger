export function normalizeActiveTab(activeTab, isCombinedView) {
  if (isCombinedView && (activeTab === 'request' || activeTab === 'response')) {
    return 'data';
  }

  if (!isCombinedView && activeTab === 'data') {
    return 'request';
  }

  return activeTab;
}
