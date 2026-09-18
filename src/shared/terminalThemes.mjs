/**
 * The embedded terminal's colour themes: what xterm draws the shell in. Pure so
 * the catalogue and the persisted pick are testable; the renderer only reads
 * and writes `tm.termTheme.v1` and hands `theme` to xterm.
 *
 * `default` is the look the pane shipped with (the pane surface, the Claude
 * cursor, xterm's own ANSI palette) — picking it is the reset. Every other
 * theme carries all sixteen ANSI colours, because a CLI's output (PowerShell's
 * blue directory background, git's red/green) is drawn from those, not from
 * the foreground.
 */

export const DEFAULT_TERMINAL_THEME = 'default'
export const TERMINAL_THEME_KEY = 'tm.termTheme.v1'

const ansi = (black, red, green, yellow, blue, magenta, cyan, white,
  brightBlack, brightRed, brightGreen, brightYellow, brightBlue, brightMagenta, brightCyan, brightWhite) => ({
  black, red, green, yellow, blue, magenta, cyan, white,
  brightBlack, brightRed, brightGreen, brightYellow, brightBlue, brightMagenta, brightCyan, brightWhite
})

/** Picker order. `label` is what the Layout popover and the palette show. */
export const TERMINAL_THEMES = [
  {
    id: 'default',
    label: 'Default',
    hint: 'The app’s own look: the pane surface and xterm’s standard colours',
    theme: {
      background: '#17161b',
      foreground: '#eceae6',
      cursor: '#d97757',
      cursorAccent: '#17161b',
      selectionBackground: 'rgba(217, 119, 87, 0.32)'
    }
  },
  {
    id: 'campbell',
    label: 'Campbell',
    hint: 'Windows Terminal’s default scheme',
    theme: {
      background: '#0c0c0c',
      foreground: '#cccccc',
      cursor: '#ffffff',
      cursorAccent: '#0c0c0c',
      selectionBackground: 'rgba(255, 255, 255, 0.25)',
      ...ansi('#0c0c0c', '#c50f1f', '#13a10e', '#c19c00', '#0037da', '#881798', '#3a96dd', '#cccccc',
        '#767676', '#e74856', '#16c60c', '#f9f1a5', '#3b78ff', '#b4009e', '#61d6d6', '#f2f2f2')
    }
  },
  {
    id: 'one-half-dark',
    label: 'One Half Dark',
    hint: 'Soft, low-contrast dark',
    theme: {
      background: '#282c34',
      foreground: '#dcdfe4',
      cursor: '#a3b3cc',
      cursorAccent: '#282c34',
      selectionBackground: 'rgba(71, 78, 93, 0.8)',
      ...ansi('#282c34', '#e06c75', '#98c379', '#e5c07b', '#61afef', '#c678dd', '#56b6c2', '#dcdfe4',
        '#5a6374', '#e06c75', '#98c379', '#e5c07b', '#61afef', '#c678dd', '#56b6c2', '#dcdfe4')
    }
  },
  {
    id: 'tokyo-night',
    label: 'Tokyo Night',
    hint: 'Deep blue-black with muted neon',
    theme: {
      background: '#1a1b26',
      foreground: '#c0caf5',
      cursor: '#c0caf5',
      cursorAccent: '#1a1b26',
      selectionBackground: 'rgba(40, 52, 87, 0.9)',
      ...ansi('#15161e', '#f7768e', '#9ece6a', '#e0af68', '#7aa2f7', '#bb9af7', '#7dcfff', '#a9b1d6',
        '#414868', '#f7768e', '#9ece6a', '#e0af68', '#7aa2f7', '#bb9af7', '#7dcfff', '#c0caf5')
    }
  },
  {
    id: 'dracula',
    label: 'Dracula',
    hint: 'High-contrast purple and pink',
    theme: {
      background: '#282a36',
      foreground: '#f8f8f2',
      cursor: '#f8f8f2',
      cursorAccent: '#282a36',
      selectionBackground: 'rgba(68, 71, 90, 0.9)',
      ...ansi('#21222c', '#ff5555', '#50fa7b', '#f1fa8c', '#bd93f9', '#ff79c6', '#8be9fd', '#f8f8f2',
        '#6272a4', '#ff6e6e', '#69ff94', '#ffffa5', '#d6acff', '#ff92df', '#a4ffff', '#ffffff')
    }
  },
  {
    id: 'solarized-dark',
    label: 'Solarized Dark',
    hint: 'Ethan Schoonover’s teal-dark palette',
    theme: {
      background: '#002b36',
      foreground: '#839496',
      cursor: '#93a1a1',
      cursorAccent: '#002b36',
      selectionBackground: 'rgba(7, 54, 66, 0.9)',
      ...ansi('#073642', '#dc322f', '#859900', '#b58900', '#268bd2', '#d33682', '#2aa198', '#eee8d5',
        '#586e75', '#cb4b16', '#586e75', '#657b83', '#839496', '#6c71c4', '#93a1a1', '#fdf6e3')
    }
  },
  {
    id: 'one-half-light',
    label: 'One Half Light',
    hint: 'A light terminal for bright rooms',
    theme: {
      background: '#fafafa',
      foreground: '#383a42',
      cursor: '#4f525d',
      cursorAccent: '#fafafa',
      selectionBackground: 'rgba(191, 206, 255, 0.7)',
      ...ansi('#383a42', '#e45649', '#50a14f', '#c18401', '#0184bc', '#a626a4', '#0997b3', '#fafafa',
        '#4f525d', '#df6c75', '#98c379', '#e4c07a', '#61afef', '#c577dd', '#56b5c1', '#ffffff')
    }
  }
]

/** A persisted pick, or the default when it is missing, retired, or garbage. */
export function readTerminalTheme(raw) {
  return TERMINAL_THEMES.some((t) => t.id === raw) ? raw : DEFAULT_TERMINAL_THEME
}

/**
 * xterm's `minimumContrastRatio` for a theme. The curated themes ask for WCAG
 * AA (4.5): their blues are lighter than xterm's, and PowerShell draws folder
 * names as bright white on blue, which would wash out. Default stays at 1 (off)
 * so it is exactly the look it always had.
 */
export function terminalContrast(id) {
  return readTerminalTheme(id) === DEFAULT_TERMINAL_THEME ? 1 : 4.5
}

/** The xterm `ITheme` for an id; unknown ids get the default's. */
export function terminalTheme(id) {
  return (TERMINAL_THEMES.find((t) => t.id === id) ?? TERMINAL_THEMES[0]).theme
}
