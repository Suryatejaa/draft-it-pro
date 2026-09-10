'use client';

import { useState } from 'react';
import {
  ChevronLeft,
  MoreVertical,
  Cloud,
  Check,
  RefreshCw,
  Download,
  Settings,
  Tv,
  Trash2,
  Share2,
  FileText,
} from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { episodeLabel, type Project } from '@/lib/project';

interface MobileProjectHeaderProps {
  project: Project;
  rootProject: Project;
  isSeries: boolean;
  currentView: string;
  saved: string;
  cloudStatus: string;
  user: any;
  onBackToProjects: () => void;
  onSelectView: (view: string) => void;
  onOpenEpisodeDialog?: () => void;
  onDeleteProject?: () => void;
  onRetrySync?: () => void;
}

export function MobileProjectHeader({
  project,
  rootProject,
  isSeries,
  currentView,
  saved,
  cloudStatus,
  user,
  onBackToProjects,
  onSelectView,
  onOpenEpisodeDialog,
  onDeleteProject,
  onRetrySync,
}: MobileProjectHeaderProps) {
  const [syncModalOpen, setSyncModalOpen] = useState(false);

  // Compute clean status label
  const isSaving = saved.toLowerCase().includes('saving');
  const isSynced = cloudStatus.toLowerCase().includes('synced') || saved.toLowerCase().includes('saved');

  const subtitle = isSeries
    ? `${episodeLabel(project)} · ${project.title}`
    : `${project.format || 'Project'} · ${project.draft || 'Draft 1'}`;

  return (
    <>
      <header className="mobile-header">
        <button
          type="button"
          onClick={onBackToProjects}
          className="mobile-back-btn"
          aria-label="Back to projects"
        >
          <ChevronLeft size={20} />
          <span className="text-xs font-medium">Projects</span>
        </button>

        <div className="mobile-header-center">
          <h1 className="mobile-header-title truncate">
            {isSeries ? rootProject.title : project.title}
          </h1>
          <div className="mobile-header-sub truncate">
            <span>{subtitle}</span>
            <span className="bullet">·</span>
            <span className="view-kicker">{currentView}</span>
          </div>
        </div>

        <div className="mobile-header-actions">
          {/* Subtle cloud indicator */}
          <button
            type="button"
            className={`mobile-sync-pill ${isSaving ? 'saving' : isSynced ? 'synced' : 'idle'}`}
            onClick={() => setSyncModalOpen(true)}
            aria-label="Cloud sync status"
            title="Tap for sync details"
          >
            {isSaving ? (
              <>
                <RefreshCw size={11} className="animate-spin" />
                <span className="text-[11px]">Saving…</span>
              </>
            ) : isSynced ? (
              <>
                <Check size={11} />
                <span className="text-[11px]">Synced</span>
              </>
            ) : (
              <>
                <Cloud size={11} />
                <span className="text-[11px]">Local</span>
              </>
            )}
          </button>

          {/* Overflow Menu */}
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <button
                  type="button"
                  className="mobile-menu-trigger"
                  aria-label="Project actions"
                >
                  <MoreVertical size={19} />
                </button>
              }
            />
            <DropdownMenuContent align="end" className="w-48">
              {isSeries && (
                <DropdownMenuItem onClick={() => onSelectView('Series overview')}>
                  <Tv className="mr-2 h-4 w-4" />
                  Series Overview
                </DropdownMenuItem>
              )}
              {isSeries && onOpenEpisodeDialog && (
                <DropdownMenuItem onClick={onOpenEpisodeDialog}>
                  <Tv className="mr-2 h-4 w-4" />
                  Add Episode
                </DropdownMenuItem>
              )}
              <DropdownMenuItem onClick={() => onSelectView('Export')}>
                <Download className="mr-2 h-4 w-4" />
                Export & Backups
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => onSelectView('Story')}>
                <FileText className="mr-2 h-4 w-4" />
                Project Details
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setSyncModalOpen(true)}>
                <Cloud className="mr-2 h-4 w-4" />
                Sync Status
              </DropdownMenuItem>
              {onDeleteProject && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    className="text-destructive focus:text-destructive"
                    onClick={onDeleteProject}
                  >
                    <Trash2 className="mr-2 h-4 w-4" />
                    Delete Project
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      {/* Sync Status Details Dialog */}
      <Dialog open={syncModalOpen} onOpenChange={setSyncModalOpen}>
        <DialogContent className="max-w-xs sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <Cloud size={18} /> Storage & Cloud Sync
            </DialogTitle>
            <DialogDescription className="text-xs">
              Draft-it persists locally first and syncs with Firebase in the background.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-2 text-sm">
            <div className="flex justify-between items-center pb-2 border-b border-border/50">
              <span className="text-muted-foreground text-xs">Local Storage</span>
              <span className="font-medium text-xs flex items-center gap-1">
                <Check size={12} className="text-green-600" />
                {saved}
              </span>
            </div>

            <div className="flex justify-between items-center pb-2 border-b border-border/50">
              <span className="text-muted-foreground text-xs">Firebase Cloud</span>
              <span className="font-medium text-xs">
                {user ? cloudStatus : 'Guest mode (local only)'}
              </span>
            </div>

            <div className="flex justify-between items-center">
              <span className="text-muted-foreground text-xs">Account</span>
              <span className="font-medium text-xs truncate max-w-[150px]">
                {user?.email || 'Not signed in'}
              </span>
            </div>

            {onRetrySync && user && (
              <Button
                variant="outline"
                size="sm"
                className="w-full mt-2"
                onClick={() => {
                  onRetrySync();
                  setSyncModalOpen(false);
                }}
              >
                <RefreshCw size={12} className="mr-1.5" />
                Retry Cloud Sync
              </Button>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
