// Design tokens — mirrors the admin-web Tailwind theme so both surfaces share
// the same visual language. Imported by every screen.

export const colors = {
  // Brand (Tailwind blue-*)
  primary: '#2563eb',
  primaryHover: '#1d4ed8',
  primaryActive: '#1e40af',
  primaryLight: '#3b82f6',
  primaryGhost: '#eff6ff',
  primarySoft: '#dbeafe',
  primaryDeep: '#1e3a8a',
  primaryOnText: '#1d4ed8',

  // Neutral
  white: '#ffffff',
  bg: '#f9fafb',
  bgAlt: '#f3f4f6',
  card: '#ffffff',
  border: '#e5e7eb',
  borderSoft: '#f3f4f6',
  divider: '#f3f4f6',

  // Text
  text: '#111827',
  textStrong: '#0f172a',
  textBody: '#374151',
  textMuted: '#6b7280',
  textSubtle: '#9ca3af',
  textDisabled: '#d1d5db',

  // Accent — status
  success: '#10b981',
  successDeep: '#059669',
  successText: '#065f46',
  successSoft: '#d1fae5',

  warning: '#f59e0b',
  warningDeep: '#d97706',
  warningText: '#92400e',
  warningSoft: '#fef3c7',

  danger: '#ef4444',
  dangerDeep: '#dc2626',
  dangerText: '#991b1b',
  dangerSoft: '#fee2e2',

  // Misc
  overlay: 'rgba(15, 23, 42, 0.55)',
  shadow: '#0f172a',
};

export const radius = {
  xs: 6,
  sm: 8,
  md: 10,
  lg: 12,
  xl: 16,
  '2xl': 20,
  '3xl': 24,
  full: 9999,
};

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  '2xl': 24,
  '3xl': 32,
  '4xl': 40,
};

export const typography = {
  // sizes (close to Tailwind text-* scale)
  xs: 11,
  sm: 12,
  base: 14,
  md: 15,
  lg: 16,
  xl: 18,
  '2xl': 20,
  '3xl': 24,
  '4xl': 28,
  '5xl': 32,
};

export const weight = {
  regular: '400' as const,
  medium: '500' as const,
  semibold: '600' as const,
  bold: '700' as const,
  extrabold: '800' as const,
};

export const shadow = {
  none: {},
  xs: {
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 2,
    elevation: 1,
  },
  sm: {
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 6,
    elevation: 2,
  },
  md: {
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
    elevation: 4,
  },
  lg: {
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.12,
    shadowRadius: 20,
    elevation: 8,
  },
};

export const theme = {
  colors,
  radius,
  spacing,
  typography,
  weight,
  shadow,
};

export default theme;
