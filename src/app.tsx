import { GithubCalendar } from "./components/github-calendar";
import { SpotifyCard } from "./components/spotify-card";
import { ThemeToggle } from "./components/theme-toggle";

export function App() {
  return (
    <>
      <main className="card-main" aria-labelledby="page-title">
        <ThemeToggle />
        <div className="card-inner">
          <h1 id="page-title" tabIndex={-1}>
            Caleb Kan
          </h1>
          <p>
            <strong>email</strong>{" "}
            <a
              href="mailto:calebkan1106@gmail.com"
              aria-label="Email calebkan1106@gmail.com"
            >
              calebkan1106@gmail.com
            </a>
          </p>
          <nav className="social-links" aria-label="Social links">
            <a
              href="https://github.com/caleb-kan"
              target="_blank"
              rel="noopener noreferrer"
              aria-label="GitHub"
              title="GitHub"
            >
              <i className="fa-brands fa-github" aria-hidden="true" />
            </a>
            <a
              href="https://www.linkedin.com/in/caleb-kan"
              target="_blank"
              rel="noopener noreferrer"
              aria-label="LinkedIn"
              title="LinkedIn"
            >
              <i className="fa-brands fa-linkedin-in" aria-hidden="true" />
            </a>
          </nav>
          <GithubCalendar />
        </div>
      </main>
      <SpotifyCard />
    </>
  );
}
