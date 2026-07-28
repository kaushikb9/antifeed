(() => {
  const acct = document.querySelector('[data-testid="SideNav_AccountSwitcher_Button"]');
  return JSON.stringify({ loggedIn: !!acct, url: location.href });
})()
