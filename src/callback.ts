const params = new URLSearchParams(window.location.search);
const code = params.get("code");
const error = params.get("error");
const codeEl = document.getElementById("code");
const msgEl = document.getElementById("message");
if (!codeEl || !msgEl) throw new Error("Missing authorization elements");
if (code) {
  codeEl.textContent = code;
  codeEl.classList.add("success");
} else {
  codeEl.textContent = error || "No code found";
  codeEl.classList.add("error");
  msgEl.textContent = error
    ? "Authorization failed. Check your Spotify app settings and try again."
    : "No authorization code was returned.";
}
