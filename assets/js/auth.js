// Unified home-page sign-in using PCAuth (shared Drive token)
// Renders a button into #g_button_target and signs in only on click (no auto popups).

(function () {
  function renderButton(target) {
    if (!target) return;
    target.innerHTML = `
      <button id="pcSignInBtn" class="btn btn-secondary" type="button" style="min-width:260px;">
        Sign in with Google
      </button>
    `;
    const btn = target.querySelector('#pcSignInBtn');
    btn?.addEventListener('click', async () => {
      try {
        // Ensure GIS/gapi warmed up (no popup yet)
        await (window.PCAuth?.init?.() || Promise.resolve());
        // User-initiated → allows popup exactly once
        const token = await window.PCAuth.signIn();
        if (token) {
          // Mark user mode and continue
          window.PCState?.setUser?.({ mode: 'google' });
          window.location.href = 'calculator.html';
        }
      } catch (e) {
        alert('Sign-in failed: ' + (e?.message || e));
      }
    });
  }

  // Render once DOM is ready
  document.addEventListener('DOMContentLoaded', () => {
    renderButton(document.getElementById('g_button_target'));
  });
})();


