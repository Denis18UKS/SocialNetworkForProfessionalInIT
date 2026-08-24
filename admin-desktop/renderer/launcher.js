const cinemaLaunch = document.getElementById('cinema-manager-launch');

cinemaLaunch?.addEventListener('click', async () => {
  try {
    await window.socialBirdAdmin.openCinemaManager();
  } catch (error) {
    window.alert(error?.message || String(error));
  }
});
