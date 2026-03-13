export const PAGE_MANAGED_CALL_QUEUE_FLAG = '__GRPCWEB_CALL_QUEUE_MANAGED__';

export function shouldInstallFallbackCallListener(pageState) {
  return !Boolean(pageState?.[PAGE_MANAGED_CALL_QUEUE_FLAG]);
}
