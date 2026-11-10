import React, { createContext, useContext, useEffect, useState } from 'react';

export type ThemeMode = 'dark' | 'light';

interface ThemeContextType {
  theme: ThemeMode;
  crmTheme: ThemeMode;
  setTheme: (mode: ThemeMode) => void;
  toggleTheme: () => void;
  setForcedTheme: (mode: ThemeMode | null) => void;
}

const THEME_STORAGE_KEY = 'triverus:theme';

const ThemeContext = createContext<ThemeContextType>({
  theme: 'dark',
  crmTheme: 'dark',
  setTheme: () => {},
  toggleTheme: () => {},
  setForcedTheme: () => {},
});

export const ThemeProvider: React.FC<{ forcedTheme?: ThemeMode | null; children: React.ReactNode }> = ({
  forcedTheme = null,
  children,
}) => {
  const [crmTheme, setCrmThemeState] = useState<ThemeMode>(() => {
    try {
      const stored = localStorage.getItem(THEME_STORAGE_KEY);
      if (stored === 'light' || stored === 'dark') {
        return stored;
      }
    } catch {}
    return 'dark';
  });

  const [activeForcedTheme, setActiveForcedTheme] = useState<ThemeMode | null>(forcedTheme);

  useEffect(() => {
    setActiveForcedTheme(forcedTheme);
  }, [forcedTheme]);

  const effectiveTheme: ThemeMode = activeForcedTheme || crmTheme;

  const setTheme = (mode: ThemeMode) => {
    setCrmThemeState(mode);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, mode);
    } catch {}
  };

  const toggleTheme = () => {
    setTheme(crmTheme === 'dark' ? 'light' : 'dark');
  };

  useEffect(() => {
    const root = document.documentElement;
    if (effectiveTheme === 'light') {
      root.classList.remove('dark');
      root.classList.add('light');
      root.setAttribute('data-theme', 'light');
    } else {
      root.classList.remove('light');
      root.classList.add('dark');
      root.setAttribute('data-theme', 'dark');
    }
  }, [effectiveTheme]);

  return (
    <ThemeContext.Provider
      value={{
        theme: effectiveTheme,
        crmTheme,
        setTheme,
        toggleTheme,
        setForcedTheme: setActiveForcedTheme,
      }}
    >
      {children}
    </ThemeContext.Provider>
  );
};

export const useTheme = () => useContext(ThemeContext);

