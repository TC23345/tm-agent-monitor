/**
 * Windows Terminal reads `;` anywhere in its own argv as a subcommand
 * delimiter (`wt new-tab …; split-pane …`) — even inside an argument meant for
 * the shell it launches. `pwsh -Command "a; b; codex"` became one tab per
 * statement, each trying to run its fragment as an executable (0x80070002 on
 * `" codex"`, `exit`…). Its documented `\;` escape did not survive the trip
 * through Node's argv quoting either. So the script never travels as text:
 * PowerShell's `-EncodedCommand` takes base64 of the UTF-16LE script, and the
 * base64 alphabet has no `;`, no quotes, and no spaces for anything to split.
 */
export function encodedCommand(script) {
  return Buffer.from(String(script), 'utf16le').toString('base64')
}

/** The shell arguments after the executable: stay open, run `script` if any. */
export function shellArgs(script) {
  return script ? ['-NoExit', '-EncodedCommand', encodedCommand(script)] : ['-NoExit']
}
