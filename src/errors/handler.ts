import { CLIError } from "./base";
import { ExitCode } from "./codes";
import { detectOutputFormat } from "../output/formatter";

export function handleError(err: unknown): never {
  if (err instanceof CLIError) {
    const format = detectOutputFormat(process.env.MINIMAX_OUTPUT);

    if (format === "json") {
      process.stderr.write(JSON.stringify(err.toJSON(), null, 2) + "\n");
    } else {
      process.stderr.write(`\nError: ${err.message}\n`);
      if (err.hint) {
        process.stderr.write(`\n  ${err.hint.split("\n").join("\n  ")}\n`);
      }
      process.stderr.write(`  (exit code ${err.exitCode})\n`);
    }
    process.exit(err.exitCode);
  }

  if (err instanceof Error) {
    if (
      err.name === "AbortError" ||
      err.name === "TimeoutError" ||
      err.message.includes("timed out")
    ) {
      const timeout = new CLIError(
        "Request timed out.",
        ExitCode.TIMEOUT,
        "Try increasing --timeout (e.g. --timeout 60).\n" +
          "If this happens on every request with a valid API key, you may be hitting the wrong region.\n" +
          "Run: mmx auth status   — to check your credentials and region.\n" +
          "Run: mmx config set region global   (or cn) — to override the region.",
      );
      return handleError(timeout);
    }

    // Detect TypeError from fetch with invalid URL (e.g., malformed base_url in config.json)
    if (err instanceof TypeError && err.message === "fetch failed") {
      const networkErr = new CLIError(
        "Network request failed.",
        ExitCode.NETWORK,
        "Check your network connection.\n" +
          "To use a proxy: set HTTPS_PROXY env var, or run: mmx config set --key proxy --value http://HOST:PORT",
      );
      return handleError(networkErr);
    }

    // Detect network-level errors (proxy, connection refused, DNS, etc.)
    const msg = err.message.toLowerCase();
    const isNetworkError =
      msg.includes("failed to fetch") ||
      msg.includes("connection refused") ||
      msg.includes("econnrefused") ||
      msg.includes("connection reset") ||
      msg.includes("econnreset") ||
      msg.includes("network error") ||
      msg.includes("enotfound") ||
      msg.includes("getaddrinfo") ||
      msg.includes("proxy") ||
      msg.includes("socket") ||
      msg.includes("etimedout") ||
      msg.includes("timeout") ||
      msg.includes("eai_AGAIN");

    if (isNetworkError) {
      let hint =
        "Check your network connection.\n" +
        "To use a proxy: set HTTPS_PROXY env var, or run: mmx config set --key proxy --value http://HOST:PORT";
      if (msg.includes("proxy")) {
        hint =
          "Proxy connection failed — verify your proxy URL and authentication.\n" +
          "Check: HTTPS_PROXY / HTTP_PROXY env vars, or mmx config show for configured proxy.";
      }
      const networkErr = new CLIError(
        "Network request failed.",
        ExitCode.NETWORK,
        hint,
      );
      return handleError(networkErr);
    }

    // Detect filesystem-level errors (ENOENT, EACCES, ENOSPC, etc.)
    const ecode = (err as NodeJS.ErrnoException).code;
    if (
      ecode === "ENOENT" ||
      ecode === "EACCES" ||
      ecode === "ENOSPC" ||
      ecode === "ENOTDIR" ||
      ecode === "EISDIR" ||
      ecode === "EPERM" ||
      ecode === "EBUSY"
    ) {
      let hint = "Check the file path and permissions.";
      if (ecode === "ENOENT") hint = "File or directory not found.";
      if (ecode === "EACCES" || ecode === "EPERM")
        hint = "Permission denied — check file or directory permissions.";
      if (ecode === "ENOSPC") hint = "Disk full — free up space and try again.";
      const fsErr = new CLIError(
        `File system error: ${err.message}`,
        ExitCode.GENERAL,
        hint,
      );
      return handleError(fsErr);
    } else if (typeof ecode === "string" && ecode.startsWith("E")) {
      // All other Node.js filesystem error codes (EMFILE, EEXIST, EROFS, etc.)
      const fsErr = new CLIError(
        `File system error: ${err.message}`,
        ExitCode.GENERAL,
        "Check the file path and permissions.",
      );
      return handleError(fsErr);
    }

    process.stderr.write(`\nError: ${err.message}\n`);
    if (process.env.MINIMAX_VERBOSE === "1") {
      process.stderr.write(`${err.stack}\n`);
    }
  } else {
    process.stderr.write(`\nError: ${String(err)}\n`);
  }

  process.exit(ExitCode.GENERAL);
}
