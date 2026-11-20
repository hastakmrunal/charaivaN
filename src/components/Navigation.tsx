import React, { useState } from 'react';
import { AppTab, Language, GuideOutputMode, ThemePreset, THEME_PRESETS, UserProfile } from '../types';
import { MeenakshiLogo } from './MeenakshiLogo';
import { DeviceExactLocation } from '../utils/geolocation';
import { useBackLayer } from '../utils/navigationHistory';
import { useLocalizedTexts } from '../data/localizedStrings';
import { APP_PRIMARY_FEATURES } from '../data/appFeatures';
import {
  Compass,
  Camera,
  Search,
  MessageSquare,
  History,
  Map,
  Sliders,
  MapPin,
  Palette,
  Sparkles,
  Check,
  User,
  MoreHorizontal,
  X,
} from 'lucide-react';

interface NavigationProps {
  activeTab: AppTab;
  setActiveTab: (tab: AppTab) => void;
  selectedLanguage: Language;
  onOpenLanguageModal?: () => void;
  visitedMemoryCount: number;
  outputMode: GuideOutputMode;
  onToggleOutputMode?: (mode: GuideOutputMode) => void;
  deviceExactLocation?: DeviceExactLocation | null;
  onOpenCityGuide?: (cityName: string) => void;
  currentTheme?: ThemePreset;
  onSelectTheme?: (theme: ThemePreset) => void;
  userProfile?: UserProfile | null;
  isSubScreenActive?: boolean;
  tourHighlightTab?: AppTab | null;
}

const NAV_UI_DEFAULTS = {
  brandBadge: 'AI Guide',
  heritageGuide: 'Heritage Guide',
  guestExplorer: 'Guest Explorer',
  colorAtmosphere: 'Color Atmosphere',
  eyeSoothing: 'Eye-Soothing',
  tabExplore: 'Explore',
  tabCamera: 'Photo Guide',
  tabDiscover: 'Discover',
  tabNearby: 'Attractions',
  tabChat: 'AI Guide',
  tabMap: 'Map',
  tabHistory: 'Journal',
  tabSettings: 'Settings',
  tabMore: 'More',
};

const NAV_ICON_BY_TAB: Partial<Record<AppTab, React.ComponentType<{ className?: string; style?: React.CSSProperties }>>> = {
  home: Compass,
  camera: Camera,
  discover: Search,
  nearby: MapPin,
  chat: MessageSquare,
  map: Map,
  history: History,
  settings: Sliders,
};

const NAV_LABEL_KEY_BY_TAB: Partial<Record<AppTab, keyof typeof NAV_UI_DEFAULTS>> = {
  home: 'tabExplore',
  camera: 'tabCamera',
  discover: 'tabDiscover',
  nearby: 'tabNearby',
  chat: 'tabChat',
  map: 'tabMap',
  history: 'tabHistory',
  settings: 'tabSettings',
};

export const Navigation: React.FC<NavigationProps> = ({
  activeTab,
  setActiveTab,
  selectedLanguage,
  deviceExactLocation,
  currentTheme = 'celestial',
  onSelectTheme,
  userProfile,
  isSubScreenActive = false,
  tourHighlightTab = null,
}) => {
  const { t } = useLocalizedTexts(NAV_UI_DEFAULTS, selectedLanguage, 'Navigation tabs and header labels');
  const [isThemePickerOpen, setIsThemePickerOpen] = useState(false);
  const [isMoreMenuOpen, setIsMoreMenuOpen] = useState(false);

  useBackLayer(
    'nav-theme-picker',
    isThemePickerOpen,
    () => setIsThemePickerOpen(false),
    95
  );
  useBackLayer(
    'nav-more-drawer',
    isMoreMenuOpen,
    () => setIsMoreMenuOpen(false),
    94
  );

  const displayUserName =
    userProfile?.name && userProfile.name.trim().length > 0
      ? userProfile.name.trim()
      : t.guestExplorer;

  const navItems = APP_PRIMARY_FEATURES.map((feat) => {
    const labelKey = NAV_LABEL_KEY_BY_TAB[feat.id];
    const localizedLabel = labelKey ? t[labelKey] : feat.navLabel;
    return {
      id: feat.id,
      label: localizedLabel || feat.navLabel,
      icon: NAV_ICON_BY_TAB[feat.id] || Compass,
      primaryMobile: feat.primaryMobile,
    };
  });

  const primaryMobileItems = navItems.filter((item) => item.primaryMobile);
  const secondaryMobileItems = navItems.filter((item) => !item.primaryMobile);
  const isSecondaryActive =
    !isSubScreenActive && secondaryMobileItems.some((item) => item.id === activeTab);
  const isSecondaryTourTarget =
    isSubScreenActive &&
    Boolean(tourHighlightTab && secondaryMobileItems.some((item) => item.id === tourHighlightTab));

  return (
    <>
      {/* Panel 1: Persistent App Brand, Quick Controls & Explorer Identity */}
      <header
        id="charaiva-top-header"
        style={{
          backgroundColor: 'var(--theme-header-bg)',
          borderColor: 'var(--theme-card-border)',
        }}
        className="shrink-0 z-40 text-[var(--theme-text-title)] backdrop-blur-xl border-b shadow-md px-3 py-1 transition-colors duration-300"
      >
        <div className="max-w-5xl mx-auto flex items-center justify-between gap-2">
          {/* Brand with Meenakshi Temple Logo */}
          <div
            className="flex items-center gap-2 cursor-pointer select-none group min-h-[40px]"
            onClick={() => setActiveTab('home')}
          >
            <div
              className="relative w-8 h-8 rounded-xl p-0.5 shadow-md flex items-center justify-center group-hover:scale-105 transition-transform duration-200"
              style={{ background: 'var(--theme-accent-primary-gradient)' }}
            >
              <div
                className="w-full h-full rounded-[10px] flex items-center justify-center p-0.5"
                style={{ backgroundColor: 'var(--theme-card-bg-subtle)' }}
              >
                <MeenakshiLogo className="w-5 h-5" />
              </div>
            </div>
            <div>
              <div className="flex items-center gap-1.5">
                <h1 className="text-sm sm:text-base font-serif font-bold tracking-tight bg-gradient-to-r from-[var(--theme-accent-primary)] via-[var(--theme-text-title)] to-[var(--theme-accent-secondary)] bg-clip-text text-transparent leading-none">
                  Charaiva
                </h1>
                <span className="text-[8.5px] uppercase tracking-wider px-1.5 py-0.5 rounded-full font-sans font-bold leading-none theme-badge-teal">
                  {t.brandBadge}
                </span>
              </div>
              <p className="text-[9.5px] text-[var(--theme-text-muted)] font-medium leading-none mt-0.5 flex items-center gap-1">
                <span className="text-[var(--theme-accent-primary)] font-semibold">
                  {deviceExactLocation?.city || t.heritageGuide}
                </span>
                <span>·</span>
                <span className="text-[var(--theme-accent-secondary)]">{selectedLanguage.nativeName}</span>
              </p>
            </div>
          </div>

          {/* Quick Header Actions: Theme Switcher, Language/Settings & Explorer Name */}
          <div className="flex items-center gap-1.5 relative">
            {onSelectTheme && (
              <div className="relative">
                <button
                  id="btn-header-theme-picker"
                  type="button"
                  onClick={() => setIsThemePickerOpen(!isThemePickerOpen)}
                  style={{
                    backgroundColor: 'var(--theme-card-bg-subtle)',
                    borderColor: 'var(--theme-card-border)',
                    color: 'var(--theme-accent-secondary)',
                  }}
                  className="flex items-center gap-1 px-2 py-1.5 rounded-full text-xs font-semibold hover:border-[var(--theme-card-border-glow)] cursor-pointer active:scale-95 shadow-sm transition-all min-h-[36px]"
                  title={t.colorAtmosphere}
                >
                  <Palette className="w-3.5 h-3.5 text-[var(--theme-accent-primary)]" />
                  <span className="text-[10.5px] font-bold capitalize hidden xs:inline">{currentTheme}</span>
                </button>

                {isThemePickerOpen && (
                  <>
                    <div
                      className="fixed inset-0 z-40"
                      onClick={() => setIsThemePickerOpen(false)}
                    />
                    <div
                      style={{
                        backgroundColor: 'var(--theme-header-bg)',
                        borderColor: 'var(--theme-card-border)',
                      }}
                      className="absolute right-0 top-full mt-2 w-64 p-2.5 rounded-2xl backdrop-blur-2xl border shadow-2xl z-50 space-y-1.5 animate-in fade-in zoom-in-95 duration-150"
                    >
                      <div
                        className="flex items-center justify-between pb-1.5 border-b px-1"
                        style={{ borderColor: 'var(--theme-card-border)' }}
                      >
                        <span className="text-xs font-serif font-bold text-[var(--theme-text-title)] flex items-center gap-1.5">
                          <Sparkles className="w-3.5 h-3.5 text-[var(--theme-accent-primary)]" />
                          <span>{t.colorAtmosphere}</span>
                        </span>
                        <span className="text-[9.5px] font-medium text-[var(--theme-text-muted)]">{t.eyeSoothing}</span>
                      </div>

                      <div className="grid grid-cols-1 gap-1 pt-0.5">
                        {THEME_PRESETS.map((preset) => {
                          const isSelected = currentTheme === preset.id;
                          return (
                            <button
                              key={preset.id}
                              type="button"
                              onClick={() => {
                                onSelectTheme(preset.id);
                                setIsThemePickerOpen(false);
                              }}
                              style={{
                                backgroundColor: isSelected ? 'var(--theme-card-hover)' : 'var(--theme-card-bg-subtle)',
                                borderColor: isSelected ? 'var(--theme-accent-secondary)' : 'var(--theme-card-border)',
                              }}
                              className="w-full text-left p-2 rounded-xl border flex items-center justify-between gap-2 transition-all cursor-pointer hover:border-[var(--theme-card-border-glow)]"
                            >
                              <div className="flex items-center gap-2 min-w-0">
                                <div
                                  className="w-4 h-4 rounded-full border border-white/20 shrink-0 shadow-xs"
                                  style={{
                                    background: `linear-gradient(135deg, ${preset.primaryColor}, ${preset.secondaryColor})`,
                                  }}
                                />
                                <div className="min-w-0">
                                  <div className="text-xs font-bold text-[var(--theme-text-title)] truncate">{preset.name}</div>
                                  <div className="text-[9px] text-[var(--theme-text-muted)] truncate">{preset.subtitle}</div>
                                </div>
                              </div>
                              {isSelected && <Check className="w-3.5 h-3.5 text-[var(--theme-accent-secondary)] shrink-0" />}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </>
                )}
              </div>
            )}

            <button
              id="btn-header-quick-settings"
              type="button"
              onClick={() => setActiveTab('settings')}
              style={{
                backgroundColor: !isSubScreenActive && activeTab === 'settings' ? undefined : 'var(--theme-card-bg-subtle)',
                borderColor: !isSubScreenActive && activeTab === 'settings' ? 'var(--theme-accent-primary)' : 'var(--theme-card-border)',
                color: !isSubScreenActive && activeTab === 'settings' ? 'var(--theme-accent-primary-text)' : 'var(--theme-text-title)',
              }}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold transition-all border cursor-pointer active:scale-95 shadow-sm min-h-[36px] ${
                !isSubScreenActive && activeTab === 'settings'
                  ? 'theme-btn-primary'
                  : 'hover:border-[var(--theme-card-border-glow)]'
              }`}
              title={t.tabSettings}
            >
              <span>{selectedLanguage.flag}</span>
              <span className="text-[11px] font-bold hidden sm:inline">{selectedLanguage.nativeName}</span>
              <Sliders className="w-3 h-3 text-[var(--theme-accent-primary)] ml-0.5" />
            </button>

            <button
              id="btn-header-user-name"
              type="button"
              onClick={() => setActiveTab('settings')}
              style={{
                backgroundColor: 'var(--theme-card-bg-subtle)',
                borderColor: 'var(--theme-card-border)',
                color: 'var(--theme-text-title)',
              }}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border cursor-pointer hover:border-[var(--theme-card-border-glow)] transition-all active:scale-95 shadow-sm max-w-[125px] sm:max-w-[190px] min-h-[36px]"
              title={displayUserName}
            >
              <User className="w-3.5 h-3.5 text-[var(--theme-accent-secondary)] shrink-0" />
              <span className="text-[11px] font-bold truncate">{displayUserName}</span>
            </button>
          </div>
        </div>
      </header>

      {/* Panel 2: Persistent Primary Screen Navigation Bar */}
      <nav
        id="charaiva-bottom-nav"
        aria-label="Primary sections"
        style={{
          backgroundColor: 'var(--theme-nav-bg)',
          borderColor: 'var(--theme-card-border)',
        }}
        className="shrink-0 z-30 text-[var(--theme-text-muted)] border-b backdrop-blur-xl shadow-md px-1.5 relative"
      >
        {/* Mobile Navigation (5 Primary Tabs + More Popover -> zero crowding, >=44px tap targets) */}
        <div className="sm:hidden max-w-5xl mx-auto flex items-center justify-around gap-0.5 py-0.5">
          {primaryMobileItems.map((item) => {
            const Icon = item.icon;
            const isActive = !isSubScreenActive && activeTab === item.id;
            const isTourTarget = isSubScreenActive && tourHighlightTab === item.id;
            return (
              <button
                key={item.id}
                id={`nav-tab-mobile-${item.id}`}
                type="button"
                data-tour-target={isTourTarget ? 'true' : undefined}
                aria-current={isActive ? 'page' : undefined}
                onClick={() => {
                  setIsMoreMenuOpen(false);
                  setActiveTab(item.id);
                }}
                style={{
                  backgroundColor: isActive || isTourTarget ? 'var(--theme-card-hover)' : 'transparent',
                  borderColor: isActive || isTourTarget ? 'var(--theme-card-border-glow)' : 'transparent',
                }}
                className={`flex-1 min-h-[44px] flex flex-col items-center justify-center py-1 px-1 rounded-xl transition-all duration-200 cursor-pointer select-none active:scale-95 border min-w-0 ${
                  isTourTarget
                    ? 'ring-2 ring-[var(--theme-accent-primary)] text-[var(--theme-text-title)] font-bold shadow-md'
                    : isActive
                    ? 'text-[var(--theme-accent-secondary)] font-bold shadow-sm'
                    : 'text-[var(--theme-text-muted)] hover:text-[var(--theme-text-title)]'
                }`}
              >
                <Icon
                  style={{ color: isActive || isTourTarget ? 'var(--theme-accent-primary)' : undefined }}
                  className="w-4 h-4 shrink-0"
                />
                <span
                  style={{ color: isActive || isTourTarget ? 'var(--theme-text-title)' : undefined }}
                  className="text-[10px] font-medium mt-0.5 tracking-tight truncate max-w-full text-center"
                >
                  {item.label}
                </span>
              </button>
            );
          })}

          <button
            id="nav-tab-mobile-more"
            type="button"
            data-tour-target={isSecondaryTourTarget ? 'true' : undefined}
            onClick={() => setIsMoreMenuOpen((prev) => !prev)}
            style={{
              backgroundColor:
                isSecondaryActive || isSecondaryTourTarget || isMoreMenuOpen
                  ? 'var(--theme-card-hover)'
                  : 'transparent',
              borderColor:
                isSecondaryActive || isSecondaryTourTarget || isMoreMenuOpen
                  ? 'var(--theme-card-border-glow)'
                  : 'transparent',
            }}
            className={`flex-1 min-h-[44px] flex flex-col items-center justify-center py-1 px-1 rounded-xl transition-all duration-200 cursor-pointer select-none active:scale-95 border min-w-0 ${
              isSecondaryTourTarget
                ? 'ring-2 ring-[var(--theme-accent-primary)] text-[var(--theme-text-title)] font-bold shadow-md'
                : isSecondaryActive
                ? 'text-[var(--theme-accent-secondary)] font-bold shadow-sm'
                : 'text-[var(--theme-text-muted)] hover:text-[var(--theme-text-title)]'
            }`}
          >
            {isMoreMenuOpen ? <X className="w-4 h-4" /> : <MoreHorizontal className="w-4 h-4" />}
            <span className="text-[10px] font-medium mt-0.5 tracking-tight truncate max-w-full text-center">
              {t.tabMore}
            </span>
          </button>
        </div>

        {/* Mobile Overflow Popover for Map, Journal, Settings */}
        {isMoreMenuOpen && (
          <>
            <div
              className="sm:hidden fixed inset-0 z-40"
              onClick={() => setIsMoreMenuOpen(false)}
            />
            <div
              style={{
                backgroundColor: 'var(--theme-header-bg)',
                borderColor: 'var(--theme-card-border-glow)',
              }}
              className="sm:hidden absolute right-2 top-full mt-1.5 w-48 p-1.5 rounded-2xl border shadow-2xl z-50 space-y-1 backdrop-blur-2xl"
            >
              {secondaryMobileItems.map((item) => {
                const Icon = item.icon;
                const isActive = !isSubScreenActive && activeTab === item.id;
                const isTourTarget = isSubScreenActive && tourHighlightTab === item.id;
                return (
                  <button
                    key={item.id}
                    id={`nav-tab-mobile-drawer-${item.id}`}
                    type="button"
                    data-tour-target={isTourTarget ? 'true' : undefined}
                    onClick={() => {
                      setIsMoreMenuOpen(false);
                      setActiveTab(item.id);
                    }}
                    style={{
                      backgroundColor: isActive || isTourTarget ? 'var(--theme-card-hover)' : 'var(--theme-card-bg-subtle)',
                      borderColor: isActive || isTourTarget ? 'var(--theme-accent-primary)' : 'var(--theme-card-border)',
                      color: 'var(--theme-text-title)',
                    }}
                    className={`w-full min-h-[44px] px-3 py-2 rounded-xl border flex items-center gap-2.5 text-xs font-bold cursor-pointer transition-all ${
                      isTourTarget ? 'ring-2 ring-[var(--theme-accent-primary)]' : ''
                    }`}
                  >
                    <Icon className="w-4 h-4 text-[var(--theme-accent-primary)] shrink-0" />
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </div>
          </>
        )}

        {/* Tablet & Desktop Navigation (All 8 Tabs Side-by-Side) */}
        <div className="hidden sm:flex max-w-5xl mx-auto items-center justify-around gap-0.5 py-1">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = !isSubScreenActive && activeTab === item.id;
            const isTourTarget = isSubScreenActive && tourHighlightTab === item.id;

            return (
              <button
                key={item.id}
                id={`nav-tab-${item.id}`}
                type="button"
                data-tour-target={isTourTarget ? 'true' : undefined}
                aria-current={isActive ? 'page' : undefined}
                onClick={() => setActiveTab(item.id)}
                style={{
                  backgroundColor: isActive || isTourTarget ? 'var(--theme-card-hover)' : 'transparent',
                  borderColor: isActive || isTourTarget ? 'var(--theme-card-border-glow)' : 'transparent',
                }}
                className={`flex-1 min-h-[44px] flex flex-col items-center justify-center py-1 px-1 rounded-xl transition-all duration-200 cursor-pointer select-none active:scale-95 border min-w-0 ${
                  isTourTarget
                    ? 'ring-2 ring-[var(--theme-accent-primary)] text-[var(--theme-text-title)] font-bold shadow-md'
                    : isActive
                    ? 'text-[var(--theme-accent-secondary)] font-bold shadow-sm'
                    : 'text-[var(--theme-text-muted)] hover:text-[var(--theme-text-title)]'
                }`}
              >
                <Icon
                  style={{
                    color: isActive || isTourTarget ? 'var(--theme-accent-primary)' : undefined,
                  }}
                  className={`w-4 h-4 sm:w-5 sm:h-5 transition-transform ${
                    isActive || isTourTarget ? 'scale-105' : ''
                  }`}
                />
                <span
                  style={{
                    color: isActive || isTourTarget ? 'var(--theme-text-title)' : undefined,
                  }}
                  className={`text-[10.5px] font-medium mt-0.5 tracking-tight truncate max-w-full text-center ${
                    isActive || isTourTarget ? 'font-bold' : ''
                  }`}
                >
                  {item.label}
                </span>
              </button>
            );
          })}
        </div>
      </nav>
    </>
  );
};
