import React, { createContext, useContext, useState, useMemo } from 'react';

export interface CondoUIContextState {
  route?: string;
  page?: string;
  viewMode?: string;
  selectedLeadId?: string | null;
  selectedContactId?: string | null;
  selectedInteractionId?: string | null;
  selectedFollowupId?: string | null;
  openSurface?: {
    type?: string;
    entityId?: string;
    title?: string;
  } | null;
  activeFilters?: any;
  setSelectedLeadId: (id: string | null) => void;
  setSelectedInteractionId: (id: string | null) => void;
  setOpenSurface: (surface: { type?: string; entityId?: string; title?: string } | null) => void;
  setPageContext: (page: string, route?: string) => void;
}

const CondoUIContext = createContext<CondoUIContextState | null>(null);

export function CondoUIContextProvider({ children }: { children: React.ReactNode }) {
  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(null);
  const [selectedContactId, setSelectedContactId] = useState<string | null>(null);
  const [selectedInteractionId, setSelectedInteractionId] = useState<string | null>(null);
  const [selectedFollowupId, setSelectedFollowupId] = useState<string | null>(null);
  const [openSurface, setOpenSurface] = useState<{ type?: string; entityId?: string; title?: string } | null>(null);
  const [page, setPage] = useState<string>('pipeline');
  const [route, setRoute] = useState<string>('/app/pipeline');
  const [viewMode, setViewMode] = useState<string>('cards');
  const [activeFilters, setActiveFilters] = useState<any>({});

  const setPageContext = (newPage: string, newRoute?: string) => {
    setPage(newPage);
    if (newRoute) setRoute(newRoute);
  };

  const value = useMemo(
    () => ({
      route,
      page,
      viewMode,
      selectedLeadId,
      selectedContactId,
      selectedInteractionId,
      selectedFollowupId,
      openSurface,
      activeFilters,
      setSelectedLeadId,
      setSelectedInteractionId,
      setOpenSurface,
      setPageContext,
    }),
    [route, page, viewMode, selectedLeadId, selectedContactId, selectedInteractionId, selectedFollowupId, openSurface, activeFilters]
  );

  return <CondoUIContext.Provider value={value}>{children}</CondoUIContext.Provider>;
}

export function useCondoUIContext() {
  const context = useContext(CondoUIContext);
  return context;
}

export function buildCondoUIContext() {
  try {
    const el = document.querySelector('[data-condo-ui-context]');
    if (el) {
      const data = el.getAttribute('data-condo-ui-context');
      if (data) return JSON.parse(data);
    }
  } catch {}

  return {
    page: window.location.pathname.includes('followups') ? 'followups' : 'pipeline',
    route: window.location.pathname,
    timestamp: Date.now(),
  };
}
