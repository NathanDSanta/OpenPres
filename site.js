// Download buttons: the latest release's files (named for what they are, see
// scripts/release/assets.mjs), and the visitor's system first.
(async () => {
  const REPO = "NathanDSanta/OpenPres";
  const releases = `https://github.com/${REPO}/releases/latest`;
  const ua = navigator.userAgent;
  const os = /Windows/i.test(ua) ? "windows" : /Mac/i.test(ua) ? "mac" : /Linux|X11/i.test(ua) ? "linux" : null;
  const mine = os && document.querySelector(`.dl[data-os="${os}"]`);
  if (mine) mine.classList.add("mine");

  const links = document.querySelectorAll("[data-asset]");
  links.forEach((a) => (a.href = releases));
  try {
    const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, { headers: { Accept: "application/vnd.github+json" } });
    if (!res.ok) throw new Error(res.status);
    const release = await res.json();
    const version = release.tag_name.replace(/^v/, "");
    document.getElementById("release-line").textContent = `OpenPres ${version}, released ${new Date(release.published_at).toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" })}.`;
    links.forEach((a) => {
      const asset = release.assets.find((x) => x.name.endsWith(a.dataset.asset));
      if (asset) {
        a.href = asset.browser_download_url;
        a.title = `${asset.name} · ${(asset.size / 1048576).toFixed(0)} MB`;
      } else {
        a.classList.add("disabled");
        a.title = "Not in this release";
      }
    });
    const primary = mine?.querySelector(".btn-primary:not(.disabled)");
    const hero = document.getElementById("hero-download");
    if (primary) {
      hero.href = primary.href;
      hero.textContent = `Download for ${{ windows: "Windows", mac: "macOS", linux: "Linux" }[os]}`;
      document.getElementById("hero-note").textContent = `Version ${version} · Windows, macOS and Linux`;
    }
  } catch {
    // Offline, or GitHub's limit: every button goes to the release page.
  }
})();
