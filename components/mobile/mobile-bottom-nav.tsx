'use client';

import { useState } from 'react';
import {
  BookOpen,
  Columns3,
  FileText,
  Images,
  MoreHorizontal,
  Users,
  MapPin,
  ListVideo,
  Download,
  LayoutDashboard,
  FolderOpen,
  type LucideIcon,
} from 'lucide-react';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet';
import type { Project } from '@/lib/project';

export type MainMobileTab = 'Story' | 'Scene cards' | 'Screenplay' | 'Storyboard';

interface MobileBottomNavProps {
  currentView: string;
  onSelectView: (view: string) => void;
  project: Project;
  cloudStatus: string;
  saved: string;
  user: any;
  onOpenSyncDetails?: () => void;
  onOpenDashboard?: () => void;
}

// ─── Single nav item ────────────────────────────────────────────────────────
function NavItem({
  icon: Icon,
  label,
  active,
  onClick,
  ariaLabel,
}: {
  icon: LucideIcon;
  label: string;
  active: boolean;
  onClick: () => void;
  ariaLabel?: string;
}) {
  return (
    <button
      type="button"
      className={`mobile-nav-item${active ? ' active' : ''}`}
      onClick={onClick}
      aria-label={ariaLabel ?? label}
      aria-current={active ? 'page' : undefined}
    >
      <span className="mobile-nav-icon">
        <Icon size={22} strokeWidth={active ? 2.2 : 1.7} />
      </span>
      <span className="mobile-nav-label">{label}</span>
    </button>
  );
}

// ─── Main export ─────────────────────────────────────────────────────────────
export function MobileBottomNav({
  currentView,
  onSelectView,
  project,
  cloudStatus,
  saved,
  user,
  onOpenSyncDetails,
  onOpenDashboard,
}: MobileBottomNavProps) {
  const [moreOpen, setMoreOpen] = useState(false);

  const mainTabs: { id: string; label: string; icon: LucideIcon }[] = [
    { id: 'Story',      label: 'Story',  icon: BookOpen  },
    { id: 'Scene cards',label: 'Cards',  icon: Columns3  },
    { id: 'Screenplay', label: 'Script', icon: FileText  },
    { id: 'Storyboard', label: 'Board',  icon: Images    },
  ];

  const isMoreActive =
    !mainTabs.some((t) => t.id === currentView) && currentView !== 'Overview';

  const moreItems: { id: string; label: string; desc: string; icon: LucideIcon }[] = [
    { id: 'Overview',   label: 'Overview',        desc: 'Story stats & progress',                        icon: LayoutDashboard },
    { id: 'Characters', label: 'Characters',       desc: `${project.characters?.length ?? 0} cast members`, icon: Users           },
    { id: 'Locations',  label: 'Locations',        desc: `${project.locations?.length ?? 0} world places`,  icon: MapPin          },
    { id: 'Shot list',  label: 'Shot List',        desc: `${project.panels?.length ?? 0} planned shots`,    icon: ListVideo       },
    { id: 'Export',     label: 'Export & Backups', desc: 'PDF, Fountain, JSON',                          icon: Download        },
  ];

  return (
    <>
      <nav className="mobile-bottom-nav" aria-label="Primary navigation">
        {mainTabs.map((tab) => (
          <NavItem
            key={tab.id}
            icon={tab.icon}
            label={tab.label}
            active={currentView === tab.id}
            onClick={() => onSelectView(tab.id)}
          />
        ))}
        <NavItem
          icon={MoreHorizontal}
          label="More"
          active={isMoreActive}
          onClick={() => setMoreOpen(true)}
          ariaLabel="More workspaces and tools"
        />
      </nav>

      <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
        <SheetContent side="bottom" className="mobile-more-sheet">
          <SheetHeader className="pb-2">
            <div className="flex items-center justify-between">
              <div>
                <SheetTitle className="text-base font-semibold">More Workspaces</SheetTitle>
                <SheetDescription className="text-xs">{project.title}</SheetDescription>
              </div>
              {onOpenDashboard && (
                <button
                  type="button"
                  onClick={() => { setMoreOpen(false); onOpenDashboard(); }}
                  className="mobile-sheet-pill-btn"
                >
                  <FolderOpen size={13} />
                  Projects
                </button>
              )}
            </div>
          </SheetHeader>

          <div className="mobile-more-grid">
            {moreItems.map((item) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.id}
                  type="button"
                  className={`mobile-more-card${currentView === item.id ? ' selected' : ''}`}
                  onClick={() => { onSelectView(item.id); setMoreOpen(false); }}
                >
                  <div className="more-card-icon">
                    <Icon size={18} />
                  </div>
                  <div className="more-card-text">
                    <b>{item.label}</b>
                    <small>{item.desc}</small>
                  </div>
                </button>
              );
            })}
          </div>

          <div className="mobile-sync-footer">
            <div className="mobile-sync-status">
              <span className="sync-dot" />
              <span>{saved}</span>
              {user && <span className="sync-cloud">· {cloudStatus}</span>}
            </div>
            {onOpenSyncDetails && (
              <button
                type="button"
                className="sync-details-link"
                onClick={() => { setMoreOpen(false); onOpenSyncDetails(); }}
              >
                Sync details
              </button>
            )}
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
