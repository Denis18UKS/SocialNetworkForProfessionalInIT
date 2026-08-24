const cinemaLaunch = document.getElementById('cinema-manager-launch');
const appRoot = document.getElementById('app');

const syncCinemaLaunchVisibility = () => {
  if (!cinemaLaunch) return;
  cinemaLaunch.style.display = appRoot?.querySelector('.shell') ? 'block' : 'none';
};

syncCinemaLaunchVisibility();
if (appRoot) {
  new MutationObserver(syncCinemaLaunchVisibility).observe(appRoot, { childList: true, subtree: true });
}

cinemaLaunch?.addEventListener('click', async () => {
  try {
    await window.socialBirdAdmin.openCinemaManager();
  } catch (error) {
    window.alert(error?.message || String(error));
  }
});
