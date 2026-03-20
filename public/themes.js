// themes.js - Theme definitions for pocket-claude
// Each theme is a set of CSS variable values

window.THEMES = {
  'pocket-claude': {
    name: 'Blue Dark',
    vars: {
      '--bg':           '#1a1a1a',
      '--surface':      '#252525',
      '--surface2':     '#2a2a2a',
      '--surface3':     '#333',
      '--border':       '#3a3a3a',
      '--border-soft':  '#2a2a2a',
      '--border-input': '#4a4a4a',
      '--text':         '#e0e0e0',
      '--text-muted':   '#ccc',
      '--text-dim':     '#888',
      '--text-darker':  '#666',
      '--accent':       '#64B5F6',
      '--accent-hover': 'rgba(100, 181, 246, 0.12)',
      '--accent-active':'rgba(100, 181, 246, 0.18)',
      '--accent-bg':    '#1a2535',
      '--primary':      '#1565C0',
      '--primary-dark': '#0D47A1',
      '--purple':       '#a78bfa',
      '--purple-hover': 'rgba(167, 139, 250, 0.12)',
      '--purple-active':'rgba(167, 139, 250, 0.18)',
      '--green':        '#4CAF50',
      '--green-user':   '#81C784',
      '--green-user-bg':'#1e2a1e',
      '--orange':       '#FF9800',
      '--red':          '#EF5350',
      '--red-bg':       '#3a2020',
      '--effort-border':'#666',
      '--effort-empty': '#555'
    }
  },
  'pocket-code': {
    name: 'Purple Dark',
    vars: {
      '--bg':           '#0d0d16',
      '--surface':      '#131320',
      '--surface2':     '#1a1a2c',
      '--surface3':     '#1f1f32',
      '--border':       'rgba(255, 255, 255, 0.07)',
      '--border-soft':  'rgba(255, 255, 255, 0.04)',
      '--border-input': 'rgba(255, 255, 255, 0.1)',
      '--text':         '#eeeefc',
      '--text-muted':   '#9999cc',
      '--text-dim':     '#7474a8',
      '--text-darker':  '#44446a',
      '--accent':       '#a78bfa',
      '--accent-hover': 'rgba(167, 139, 250, 0.12)',
      '--accent-active':'rgba(167, 139, 250, 0.18)',
      '--accent-bg':    'rgba(167, 139, 250, 0.08)',
      '--primary':      '#7c3aed',
      '--primary-dark': '#6d28d9',
      '--purple':       '#a78bfa',
      '--purple-hover': 'rgba(167, 139, 250, 0.12)',
      '--purple-active':'rgba(167, 139, 250, 0.18)',
      '--green':        '#34d399',
      '--green-user':   '#f9a8d4',
      '--green-user-bg':'rgba(249, 168, 212, 0.08)',
      '--orange':       '#fb923c',
      '--red':          '#f87171',
      '--red-bg':       'rgba(248, 113, 113, 0.1)',
      '--effort-border':'#7474a8',
      '--effort-empty': '#44446a'
    }
  }
}

// Default theme
window.DEFAULT_THEME = 'pocket-claude'
