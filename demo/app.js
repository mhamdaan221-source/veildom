const continueButton = document.querySelector("#continue-button");

continueButton.addEventListener("click", () => {
  const main = document.querySelector("main");
  main.innerHTML = `
    <section class="completion-card" aria-live="polite">
      <div class="completion-icon" aria-hidden="true">✓</div>
      <p class="eyebrow">Application 24-0817 · Step 2 of 2</p>
      <h2>Profile confirmed</h2>
      <p>The browser assistant safely advanced the application. Your private field values remained on this device.</p>
      <button id="restart-demo" class="primary" type="button">Restart demo</button>
    </section>
  `;

  document.querySelector("#restart-demo").addEventListener("click", () => window.location.reload());
});
