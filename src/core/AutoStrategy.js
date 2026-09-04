export class AutoStrategy {
  select(availableAccounts) {
    if (!availableAccounts || availableAccounts.length === 0) return null;
    return availableAccounts.slice().sort((a, b) => {
      const loadA = (a.requestCount || 0) * 1000 + (a.totalTokens || 0);
      const loadB = (b.requestCount || 0) * 1000 + (b.totalTokens || 0);
      if (loadA !== loadB) return loadA - loadB;
      return (b.expiresAt || 0) - (a.expiresAt || 0);
    })[0];
  }
}
