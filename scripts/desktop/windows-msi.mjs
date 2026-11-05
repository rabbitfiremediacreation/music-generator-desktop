import assert from "node:assert/strict";

// msiexec parses its own command line, rather than the usual Windows argv rules.
// https://learn.microsoft.com/en-us/windows/win32/msi/command-line-options
// Keep PROPERTY= outside the quotes; Node would quote the whole assignment.
function quoted(value) {
  assert(typeof value === "string" && !/["\r\n\0]/.test(value), "Invalid Windows Installer path");
  return `"${value}"`;
}

export function msiArguments(operation, artifact, log, installDir) {
  assert(["/i", "/x"].includes(operation), "Unsupported MSI operation");
  return ["/qn", "/norestart", "/L*v!", quoted(log), operation, quoted(artifact),
    ...(installDir ? [`INSTALLDIR=${quoted(installDir)}`] : [])];
}
