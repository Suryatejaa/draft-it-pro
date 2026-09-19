import { Metadata } from 'next';
import Link from 'next/link';
import { ArrowLeft, Shield, Sliders } from 'lucide-react';

export const metadata: Metadata = {
  title: 'Draft-it PRO · Admin Dashboard',
  description: 'Enterprise administration, user controls, and plan configuration.',
};

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="dark min-h-screen bg-[#0a0c0f] text-slate-100 flex flex-col font-sans">
      <header className="border-b border-white/10 bg-[#0e1116] px-6 py-3.5 flex items-center justify-between sticky top-0 z-50">
        <div className="flex items-center gap-4">
          <Link
            href="/"
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-white transition-colors bg-white/5 hover:bg-white/10 px-2.5 py-1.5 rounded-md border border-white/10"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Back to Workspace</span>
          </Link>
          <div className="h-4 w-px bg-white/10" />
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-orange-500/20 border border-orange-500/30 flex items-center justify-center text-orange-400">
              <Shield className="w-4 h-4" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold tracking-tight text-white">Draft-it PRO</span>
                <span className="text-[10px] font-medium uppercase tracking-wider bg-orange-500/20 text-orange-300 border border-orange-500/30 px-1.5 py-0.2 rounded">
                  Admin
                </span>
              </div>
            </div>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-7xl w-full mx-auto p-6">{children}</main>
    </div>
  );
}
