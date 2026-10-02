import { faGithub, faLinkedinIn } from "@fortawesome/free-brands-svg-icons";
import { faArrowUpRightFromSquare } from "@fortawesome/free-solid-svg-icons";
import { GithubCalendar } from "./components/github-calendar";
import { Icon } from "./components/icon";
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
          <p className="contact-line">
            <span className="contact-label">Email</span>{" "}
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
              <Icon icon={faGithub} className="social-icon" />
              <span>GitHub</span>
              <Icon icon={faArrowUpRightFromSquare} className="social-arrow" />
            </a>
            <a
              href="https://www.linkedin.com/in/caleb-kan"
              target="_blank"
              rel="noopener noreferrer"
              aria-label="LinkedIn"
              title="LinkedIn"
            >
              <Icon icon={faLinkedinIn} className="social-icon" />
              <span>LinkedIn</span>
              <Icon icon={faArrowUpRightFromSquare} className="social-arrow" />
            </a>
          </nav>
          <section className="activity" aria-labelledby="activity-title">
            <div className="activity-header">
              <h2 id="activity-title">GitHub activity</h2>
              <span>Past year</span>
            </div>
            <GithubCalendar />
          </section>
        </div>
      </main>
      <SpotifyCard />
    </>
  );
}
