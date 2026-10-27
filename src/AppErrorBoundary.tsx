import { Component, useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  ArrowClockwise,
  GithubLogo,
  WarningCircle,
  X,
} from "@phosphor-icons/react";
import {
  incident,
  issueUrl,
  REPORT_EVENT,
  type Incident,
  type FailureKind,
} from "./errorReporting";
function ErrorNotice({
  item,
  onClose,
}: {
  item: Incident;
  onClose: () => void;
}) {
  const [target, setTarget] = useState<Element>(document.body);
  useEffect(() => {
    const find = () =>
      setTarget(document.querySelector("dialog[open]") ?? document.body);
    find();
    const observer = new MutationObserver(find);
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["open"],
    });
    return () => observer.disconnect();
  }, []);
  return createPortal(
    <aside role="alert" className="app-error-notice">
      <WarningCircle weight="bold" />
      <div>
        <strong>Something went wrong.</strong>
        <p>Your game is still open. You can retry or report the problem.</p>
        <a href={issueUrl(item)} target="_blank" rel="noopener noreferrer">
          Report issue <GithubLogo />
        </a>
      </div>
      <button
        className="icon-button"
        aria-label="Dismiss error report"
        onClick={onClose}
      >
        <X />
      </button>
    </aside>,
    target,
  );
}
export default class AppErrorBoundary extends Component<
  { children: ReactNode },
  { failed: boolean; incident: Incident | null }
> {
  state: { failed: boolean; incident: Incident | null } = {
    failed: false,
    incident: null,
  };
  static getDerivedStateFromError() {
    return { failed: true, incident: incident("UI_RENDER_ERROR") };
  }
  private runtime = () => this.show("RUNTIME_ERROR");
  private show = (kind: FailureKind) =>
    this.setState((state) =>
      state.failed || state.incident ? null : { incident: incident(kind) },
    );
  private error = (event: ErrorEvent) => {
    if (event.message) this.runtime();
  };
  private server = (event: Event) => {
    const kind = (event as CustomEvent).detail?.kind as FailureKind;
    if (["UI_RENDER_ERROR", "RUNTIME_ERROR", "SERVER_ERROR"].includes(kind))
      this.show(kind);
  };
  componentDidMount() {
    window.addEventListener("error", this.error);
    window.addEventListener("unhandledrejection", this.runtime);
    window.addEventListener(REPORT_EVENT, this.server);
  }
  componentWillUnmount() {
    window.removeEventListener("error", this.error);
    window.removeEventListener("unhandledrejection", this.runtime);
    window.removeEventListener(REPORT_EVENT, this.server);
  }
  render() {
    const item = this.state.incident;
    if (this.state.failed)
      return (
        <main className="app-error-screen">
          <WarningCircle size={48} weight="bold" />
          <h1>Something went wrong.</h1>
          <p>
            Reload to reconnect to your game. Your saved progress has not been
            cleared.
          </p>
          <div>
            <button className="primary" onClick={() => location.reload()}>
              <ArrowClockwise />
              Reload game
            </button>
            <a
              className="secondary"
              href={issueUrl(item ?? incident("UI_RENDER_ERROR"))}
              target="_blank"
              rel="noopener noreferrer"
            >
              <GithubLogo />
              Report issue
            </a>
          </div>
          <small>
            The issue draft includes the app version, browser and error
            category.
          </small>
        </main>
      );
    return (
      <>
        {this.props.children}
        {item && (
          <ErrorNotice
            item={item}
            onClose={() => this.setState({ incident: null })}
          />
        )}
      </>
    );
  }
}
