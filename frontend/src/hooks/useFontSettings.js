import { useState, useEffect, useCallback } from 'react';

/**
 * useFontSettings — React hook for managing application-wide font size settings.
 * 
 * Provides:
 * - Font size scale (small, medium, large, extra large)
 * - Persistence to localStorage
 * - CSS variable updates for responsive font scaling
 * - Reset to default functionality
 */

const FONT_SETTINGS_STORAGE_KEY = 'aquadex_font_settings';
const DEFAULT_FONT_SCALE = 'medium';

const FONT_SCALES = {
  small: {
    label: 'Small',
    value: 0.875, // 14px base (16px * 0.875)
    description: 'Compact text for dense information'
  },
  medium: {
    label: 'Medium',
    value: 1.0, // 16px base (default)
    description: 'Standard text size'
  },
  large: {
    label: 'Large', 
    value: 1.125, // 18px base (16px * 1.125)
    description: 'Larger text for better readability'
  },
  'extra-large': {
    label: 'Extra Large',
    value: 1.25, // 20px base (16px * 1.25)
    description: 'Maximum text size for accessibility'
  }
};

/**
 * Load persisted font settings from localStorage.
 */
function loadFontSettings() {
  try {
    const raw = localStorage.getItem(FONT_SETTINGS_STORAGE_KEY);
    if (!raw) return { scale: DEFAULT_FONT_SCALE };
    const settings = JSON.parse(raw);
    // Validate the scale value
    if (!FONT_SCALES[settings.scale]) {
      return { scale: DEFAULT_FONT_SCALE };
    }
    return settings;
  } catch {
    return { scale: DEFAULT_FONT_SCALE };
  }
}

/**
 * Persist font settings to localStorage.
 */
function persistFontSettings(settings) {
  try {
    localStorage.setItem(FONT_SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // localStorage unavailable - degrade gracefully
  }
}

/**
 * Apply font scale to CSS custom properties.
 */
function applyFontScale(scale) {
  if (typeof document === 'undefined') return;
  
  const scaleValue = FONT_SCALES[scale]?.value || FONT_SCALES[DEFAULT_FONT_SCALE].value;
  
  // Update CSS custom properties for responsive font scaling
  document.documentElement.style.setProperty('--font-scale', scaleValue.toString());
  document.documentElement.style.setProperty('--font-size-xs', `${0.75 * scaleValue}rem`);
  document.documentElement.style.setProperty('--font-size-sm', `${0.875 * scaleValue}rem`);
  document.documentElement.style.setProperty('--font-size-base', `${1 * scaleValue}rem`);
  document.documentElement.style.setProperty('--font-size-lg', `${1.125 * scaleValue}rem`);
  document.documentElement.style.setProperty('--font-size-xl', `${1.25 * scaleValue}rem`);
  document.documentElement.style.setProperty('--font-size-2xl', `${1.5 * scaleValue}rem`);
  document.documentElement.style.setProperty('--font-size-3xl', `${1.875 * scaleValue}rem`);
}

export function useFontSettings() {
  const [settings, setSettings] = useState(loadFontSettings);

  // Apply font scale when settings change
  useEffect(() => {
    applyFontScale(settings.scale);
    persistFontSettings(settings);
  }, [settings]);

  // Initialize font scale on mount
  useEffect(() => {
    applyFontScale(settings.scale);
  }, []);

  const updateFontScale = useCallback((scale) => {
    if (!FONT_SCALES[scale]) return;
    setSettings(prev => ({ ...prev, scale }));
  }, []);

  const resetSettings = useCallback(() => {
    setSettings({ scale: DEFAULT_FONT_SCALE });
  }, []);

  const previewScale = useCallback((scale) => {
    if (!FONT_SCALES[scale]) return;
    applyFontScale(scale);
  }, []);

  return {
    settings,
    currentScale: settings.scale,
    availableScales: FONT_SCALES,
    updateFontScale,
    resetSettings,
    previewScale,
    ready: true,
  };
}