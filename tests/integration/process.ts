import type { ChildProcess } from "node:child_process";

/** Stops a detached child process group on macOS or Linux. */
export async function stop(child: ChildProcess): Promise<void> {
  if (!child.pid || child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise<void>((done) => child.once("exit", () => done()));
  const kill = (signal: NodeJS.Signals): void => {
    try {
      if (child.pid) process.kill(-child.pid, signal);
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "ESRCH")) throw error;
    }
  };
  kill("SIGTERM");
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      try {
        kill("SIGKILL");
        reject(new Error("Child process did not exit within the cleanup deadline"));
      } catch (error) {
        reject(error);
      }
    }, 5_000);
  });
  try {
    await Promise.race([exited, timeout]);
  } finally {
    clearTimeout(timer);
  }
}
