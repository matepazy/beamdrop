const DANGEROUS_FILE_EXTENSIONS = new Set([
  // Native executables, installers, shortcuts, and command files.
  'apk', 'app', 'appimage', 'bat', 'bin', 'cab', 'cmd', 'com', 'command',
  'cpl', 'deb', 'desktop', 'dmg', 'exe', 'gadget', 'hta', 'img', 'inf',
  'ins', 'iso', 'jar', 'jnlp', 'lnk', 'msc', 'msi', 'msp', 'mst', 'pif',
  'pkg', 'ps1', 'reg', 'rpm', 'run', 'scr', 'scf', 'sh', 'shb', 'sys',
  'url', 'vbe', 'vbs', 'vhd', 'vhdx', 'vxd', 'wsc', 'wsf', 'wsh',

  // Scripts and active web content.
  'bash', 'cjs', 'fish', 'htm', 'html', 'js', 'jse', 'jsx', 'ksh', 'mjs',
  'php', 'pl', 'py', 'rb', 'sct', 'svg', 'swf', 'xhtml', 'zsh',

  // Legacy and macro-enabled Office formats.
  'doc', 'docm', 'dot', 'dotm', 'pot', 'potm', 'ppa', 'ppam', 'pps', 'ppsm',
  'ppt', 'pptm', 'sldm', 'xls', 'xlsb', 'xlsm', 'xlt', 'xltm',

  // Documents and containers that may contain active or malicious content.
  '7z', 'ace', 'arj', 'bz2', 'gz', 'pdf', 'rar', 'tar', 'tgz', 'xz', 'zip',
])

/** Returns true when a filename needs an explicit safety confirmation. */
export function isPotentiallyDangerousFile(name: string): boolean {
  const extension = name.trim().toLowerCase().split('.').at(-1)

  return Boolean(extension && DANGEROUS_FILE_EXTENSIONS.has(extension))
}
